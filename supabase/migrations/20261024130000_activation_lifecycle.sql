-- Frozen activation, lifecycle and scheduled completion
-- (docs/DATABASE.md "Draft editing and activation" and "Completion, cancellation, and results";
--  docs/API.md sections 4.4 and 7.1; docs/IMPLEMENTATION_PLAN.md phase 10).
--
-- Every transition takes the same parent-vote row lock the submission path
-- will use, so activation, early completion, cancellation, due completion and
-- (later) submission can never interleave unsafely. Lock order everywhere is:
--   vote -> selected households (by id) -> their profiles (by id) -> settings.
-- Deadlines are enforced by the database clock, never by Cron: Cron only
-- finalises votes that are already past their deadline, and the recorded
-- completion time is always the frozen deadline, not the processing time.

-- ---------------------------------------------------------------------------
-- Restricted scheduling role (created by the migration role; cp_owner cannot create roles)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cp_scheduler') then
    create role cp_scheduler nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$$;

-- The Cron job runs as the migration role and drops to cp_scheduler for the call.
grant cp_scheduler to current_user with inherit false, set true;
grant usage on schema public to cp_scheduler;

set local role cp_owner;

-- ---------------------------------------------------------------------------
-- Invariants: a live or terminal vote must have a complete frozen electorate
-- ---------------------------------------------------------------------------

create or replace function app_private.verify_vote_invariants(p_vote_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.votes;
  v_participants bigint;
begin
  select * into v from public.votes where id = p_vote_id;
  if not found then
    return;
  end if;

  select count(*) into v_participants from public.participation where vote_id = p_vote_id;

  if v.status = 'DRAFT' then
    if v_participants > 0
       or exists (select 1 from public.open_responses where vote_id = p_vote_id)
       or exists (select 1 from public.closed_tallies where vote_id = p_vote_id) then
      raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
    end if;
    return;
  end if;

  -- Once activated, every electorate row carries its frozen snapshot.
  if exists (
    select 1 from public.electorate
    where vote_id = p_vote_id and representative_profile_id is null
  ) then
    raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
  end if;

  if v.voting_type = 'OPEN' then
    if v_participants <> (select count(*) from public.open_responses where vote_id = p_vote_id)
       or exists (select 1 from public.closed_tallies where vote_id = p_vote_id) then
      raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
    end if;
  else
    if exists (select 1 from public.open_responses where vote_id = p_vote_id) then
      raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
    end if;
    -- Counter membership matches the frozen candidates plus one abstention per
    -- office, and every office's counters add up to the participation count.
    if exists (
      select 1 from public.offices o
      where o.vote_id = p_vote_id
        and ((select count(*) from public.closed_tallies t where t.office_id = o.id)
               <> (select count(*) from public.candidates c where c.office_id = o.id) + 1
          or (select count(*) from public.closed_tallies t
              where t.office_id = o.id and t.candidate_id is null) <> 1
          or (select coalesce(sum(t.accepted_count), 0) from public.closed_tallies t
              where t.office_id = o.id) <> v_participants)
    ) then
      raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Due completion (shared by Cron, reconciliation and the lifecycle routines)
-- ---------------------------------------------------------------------------

-- Completes one vote that is past its deadline. Idempotent: anything that is
-- not an ACTIVE vote past its deadline is left alone. The effective completion
-- time is the frozen deadline; the processing time is only audit context.
create function app_private.complete_if_due(p_vote_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
  v_processed timestamptz := pg_catalog.clock_timestamp();
begin
  v := app_private.lock_vote(p_vote_id);
  if v.status <> 'ACTIVE' or v.closes_at > v_processed then
    return false;
  end if;

  -- A mismatch blocks completion and publication; submissions stay closed by the deadline.
  perform app_private.verify_vote_invariants(p_vote_id);

  update public.votes
  set status = 'COMPLETED', completed_at = closes_at, completion_mode = 'DEADLINE'
  where id = p_vote_id;

  perform app_private.append_audit(
    'SYSTEM', null, 'VOTE_COMPLETED', 'VOTE', p_vote_id::text, null,
    pg_catalog.jsonb_build_object(
      'completionMode', 'DEADLINE',
      'effectiveAt', v.closes_at,
      'processedAt', v_processed));
  return true;
end
$$;

-- Cron entry point. Takes no arguments, so there is nothing to override: not
-- the time, the targets, or a batch size. One vote's failure never undoes the
-- others (each runs in its own subtransaction) and never reports full success.
create function public.complete_due_votes()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_completed integer := 0;
  v_blocked integer := 0;
begin
  for r in
    select id from public.votes
    where status = 'ACTIVE' and closes_at <= pg_catalog.clock_timestamp()
    order by closes_at, id
    limit 50
  loop
    begin
      if app_private.complete_if_due(r.id) then
        v_completed := v_completed + 1;
      end if;
    exception
      when others then
        v_blocked := v_blocked + 1;
        -- Operators see this in the database log; no ballot data is ever included.
        raise warning 'complete_due_votes: vote % was not completed (%)', r.id, sqlerrm;
    end;
  end loop;
  return pg_catalog.jsonb_build_object('completed', v_completed, 'blocked', v_blocked);
end
$$;

-- Authorised server-side reconciliation of one vote (for example before an
-- administrator views it). Not available to any signed-in user.
create function public.reconcile_vote(p_vote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  return pg_catalog.jsonb_build_object('completed', app_private.complete_if_due(p_vote_id));
end
$$;

-- ---------------------------------------------------------------------------
-- Activation
-- ---------------------------------------------------------------------------

create function public.activate_vote(
  p_vote_id uuid,
  p_expected_revision integer,
  p_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v public.votes;
  s public.rwa_settings;
  v_blockers jsonb;
  v_versions jsonb;
  v_electorate integer;
begin
  if p_confirmed is distinct from true
     or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v := app_private.lock_vote(p_vote_id);
  if v.status <> 'DRAFT' then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = v.status;
  end if;
  if v.draft_revision <> p_expected_revision then
    raise exception 'STALE_REVISION' using errcode = 'P0001';
  end if;

  -- Re-read the register and settings under lock, in the documented order, so
  -- nothing the snapshot depends on can change until this transaction ends.
  perform 1 from public.households h
  where h.id in (select e.household_id from public.electorate e where e.vote_id = p_vote_id)
  order by h.id for share;
  perform 1 from public.profiles p
  where p.id in (
    select h.representative_profile_id
    from public.households h
    join public.electorate e on e.household_id = h.id
    where e.vote_id = p_vote_id)
  order by p.id for share;
  select * into s from public.rwa_settings where id = 1 for share;
  if not found then
    raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
      detail = 'The RWA name and time zone have not been set up.';
  end if;

  perform app_private.assert_policy_ready();
  v_blockers := app_private.draft_blockers(v);
  if pg_catalog.jsonb_array_length(v_blockers) > 0 then
    raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
      detail = v_blockers -> 0 ->> 'message';
  end if;

  perform pg_catalog.set_config('cp.activation', 'on', true);

  -- Freeze each household's representative as the register stands right now.
  update public.electorate e
  set representative_profile_id = h.representative_profile_id,
      representative_name_snapshot = p.representative_name,
      household_identifier_snapshot = h.identifier
  from public.households h
  join public.profiles p on p.id = h.representative_profile_id
  where e.vote_id = p_vote_id and h.id = e.household_id;
  get diagnostics v_electorate = row_count;

  -- One zero counter per candidate plus one abstention counter per office.
  if v.voting_type = 'CLOSED' then
    insert into public.closed_tallies (vote_id, office_id, candidate_id)
    select o.vote_id, o.id, c.id
    from public.offices o join public.candidates c on c.office_id = o.id
    where o.vote_id = p_vote_id
    union all
    select o.vote_id, o.id, null
    from public.offices o where o.vote_id = p_vote_id;
  end if;

  select pg_catalog.jsonb_object_agg(k, s.policy_approvals -> k ->> 'version')
  into v_versions
  from pg_catalog.unnest(array['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']) as k;

  update public.votes
  set status = 'ACTIVE',
      activated_at = pg_catalog.clock_timestamp(),
      rwa_name_snapshot = s.name,
      timezone_snapshot = s.timezone,
      policy_versions_snapshot = v_versions
  where id = p_vote_id
  returning * into v;

  perform pg_catalog.set_config('cp.activation', 'off', true);

  perform app_private.append_audit(
    'PROFILE', v_actor, 'VOTE_ACTIVATED', 'VOTE', p_vote_id::text, null,
    pg_catalog.jsonb_build_object(
      'votingType', v.voting_type,
      'draftRevision', v.draft_revision,
      'electorate', v_electorate,
      'closesAt', v.closes_at));

  return app_private.vote_detail_json(v);
end
$$;

-- ---------------------------------------------------------------------------
-- Early completion and cancellation
-- ---------------------------------------------------------------------------

-- Returns {applied, reason?, vote}. When the deadline has already passed the
-- vote is completed at its deadline and COMMITTED, and the caller is told the
-- action did not apply: raising here would roll the reconciliation back.
create function app_private.end_active_vote(
  p_vote_id uuid,
  p_actor uuid,
  p_kind text,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v := app_private.lock_vote(p_vote_id);

  if v.status = 'ACTIVE' and v.closes_at <= v_now then
    perform app_private.complete_if_due(p_vote_id);
    select * into v from public.votes where id = p_vote_id;
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason', 'DEADLINE_PASSED', 'vote', app_private.vote_detail_json(v));
  end if;
  if v.status <> 'ACTIVE' then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = v.status;
  end if;

  if p_kind = 'COMPLETE' then
    perform app_private.verify_vote_invariants(p_vote_id);
    update public.votes
    set status = 'COMPLETED', completed_at = v_now, completion_mode = 'EARLY',
        completion_reason = p_reason
    where id = p_vote_id
    returning * into v;
    perform app_private.append_audit(
      'PROFILE', p_actor, 'VOTE_COMPLETED', 'VOTE', p_vote_id::text, p_reason,
      pg_catalog.jsonb_build_object('completionMode', 'EARLY'));
  else
    update public.votes
    set status = 'CANCELLED', cancelled_at = v_now, cancellation_reason = p_reason
    where id = p_vote_id
    returning * into v;
    perform app_private.append_audit(
      'PROFILE', p_actor, 'VOTE_CANCELLED', 'VOTE', p_vote_id::text, p_reason, '{}'::jsonb);
  end if;

  return pg_catalog.jsonb_build_object('applied', true, 'vote', app_private.vote_detail_json(v));
end
$$;

create function public.complete_vote_early(
  p_vote_id uuid,
  p_confirmed boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
begin
  if p_confirmed is distinct from true then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  return app_private.end_active_vote(
    p_vote_id, v_actor, 'COMPLETE', app_private.clean_multiline(p_reason, 2000));
end
$$;

create function public.cancel_vote(
  p_vote_id uuid,
  p_confirmed boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
begin
  if p_confirmed is distinct from true then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  return app_private.end_active_vote(
    p_vote_id, v_actor, 'CANCEL', app_private.clean_multiline(p_reason, 2000));
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function
  public.activate_vote(uuid, integer, boolean),
  public.complete_vote_early(uuid, boolean, text),
  public.cancel_vote(uuid, boolean, text)
from public, anon;
grant execute on function
  public.activate_vote(uuid, integer, boolean),
  public.complete_vote_early(uuid, boolean, text),
  public.cancel_vote(uuid, boolean, text)
to authenticated;

-- Maintenance is reachable only through the scheduling role: not by signed-in
-- users, not by anonymous callers, not by the application's service role.
revoke all on function public.complete_due_votes()
from public, anon, authenticated, service_role;
grant execute on function public.complete_due_votes() to cp_scheduler;

revoke all on function public.reconcile_vote(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_vote(uuid) to service_role;

reset role;

-- ---------------------------------------------------------------------------
-- Supabase Cron: due completion once per minute (idempotent; re-running this
-- migration step replaces the job of the same name). Where pg_cron is not
-- available (for example a bare local PostgreSQL) scheduling is skipped, and
-- the deadline is still enforced by the database clock on every request.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'civic-pulse-complete-due-votes',
      '* * * * *',
      $job$set role cp_scheduler; select public.complete_due_votes()$job$);
  else
    raise notice 'pg_cron is not available here: due-vote completion is not scheduled.';
  end if;
end
$$;
