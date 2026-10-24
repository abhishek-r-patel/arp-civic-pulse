-- Phase 15: retention execution, operational status and the health ping
-- (docs/DATABASE.md section 10, docs/IMPLEMENTATION_PLAN.md phase 15).
--
-- Cleanup is reachable ONLY through the scheduling role. It takes no
-- arguments, so there is no caller time, target or batch size to override. It
-- uses the approved CURRENT settings (a missing value skips that task; null is
-- never "keep forever" nor "delete everything"), works in bounded batches, and
-- one failure never undoes the batches that already succeeded. Live and draft
-- votes are never touched.

set local role cp_owner;

-- ---------------------------------------------------------------------------
-- Retention predicates (shared by the routine and by the guard triggers, so a
-- deletion is re-validated at the row, not only trusted from the caller)
-- ---------------------------------------------------------------------------

create function app_private.vote_retention_expired(v public.votes)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    v.status in ('COMPLETED', 'CANCELLED')
      and coalesce(v.completed_at, v.cancelled_at)
          < pg_catalog.clock_timestamp()
            - pg_catalog.make_interval(days => s.vote_retention_days),
    false)
  from public.rwa_settings s
  where s.id = 1
$$;

-- Deleting terminal vote data needs the transaction flag AND an expired vote.
create function app_private.retention_delete_allowed(v public.votes)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.flag_is_on('cp.retention')
     and coalesce(app_private.vote_retention_expired(v), false)
$$;

-- ---------------------------------------------------------------------------
-- Guards: the same rules as before, plus one narrow retention exception
-- ---------------------------------------------------------------------------

create or replace function app_private.guard_vote_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'DRAFT' and not app_private.retention_delete_allowed(old) then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;
  return old;
end
$$;

create or replace function app_private.guard_participation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
begin
  if tg_op = 'DELETE' then
    v := app_private.lock_vote(old.vote_id);
    if app_private.retention_delete_allowed(v) then
      return old;
    end if;
    raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
  end if;
  if not app_private.flag_is_on('cp.submission') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v := app_private.lock_vote(new.vote_id);
  if v.status <> 'ACTIVE' or v.closes_at <= pg_catalog.clock_timestamp() then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create or replace function app_private.guard_open_response()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
begin
  if tg_op = 'DELETE' then
    v := app_private.lock_vote(old.vote_id);
    if app_private.retention_delete_allowed(v) then
      return old;
    end if;
    raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
  end if;
  if not app_private.flag_is_on('cp.submission') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v := app_private.lock_vote(new.vote_id);
  if v.voting_type <> 'OPEN' or v.status <> 'ACTIVE' then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create or replace function app_private.guard_closed_tally()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
begin
  v := app_private.lock_vote(coalesce(new.vote_id, old.vote_id));
  if v.voting_type <> 'CLOSED' then
    raise exception 'BALLOT_TYPE_MISMATCH' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if v.status <> 'DRAFT' or not app_private.flag_is_on('cp.activation')
       or new.accepted_count <> 0 then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if v.status <> 'ACTIVE' or not app_private.flag_is_on('cp.submission')
       or new.accepted_count <> old.accepted_count + 1
       or new.id <> old.id or new.vote_id <> old.vote_id or new.office_id <> old.office_id
       or new.candidate_id is distinct from old.candidate_id then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if v.status <> 'DRAFT' and not app_private.retention_delete_allowed(v) then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;
  return old;
end
$$;

create or replace function app_private.guard_electorate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
  h public.households;
  p public.profiles;
begin
  v := app_private.lock_vote(coalesce(new.vote_id, old.vote_id));
  if tg_op = 'DELETE' and app_private.retention_delete_allowed(v) then
    return old;
  end if;
  if v.status <> 'DRAFT' then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.vote_id <> old.vote_id or new.household_id <> old.household_id) then
    raise exception 'IMMUTABLE_IDENTITY' using errcode = 'P0001';
  end if;

  if new.representative_profile_id is not null then
    select * into h from public.households where id = new.household_id;
    select * into p from public.profiles where id = new.representative_profile_id;
    if not h.is_eligible
       or h.representative_profile_id is distinct from new.representative_profile_id
       or p.status <> 'ENABLED'
       or new.representative_name_snapshot is distinct from p.representative_name
       or new.household_identifier_snapshot is distinct from h.identifier then
      raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
        detail = 'Snapshots must match an eligible household with an enabled representative.';
    end if;
  end if;

  return new;
end
$$;

create or replace function app_private.guard_ballot_config()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_vote_id uuid;
  v public.votes;
begin
  if tg_table_name = 'candidates' then
    select o.vote_id into v_vote_id from public.offices o
      where o.id = coalesce(new.office_id, old.office_id);
    if tg_op = 'UPDATE' and new.office_id <> old.office_id then
      raise exception 'IMMUTABLE_IDENTITY' using errcode = 'P0001';
    end if;
  else
    v_vote_id := coalesce(new.vote_id, old.vote_id);
    if tg_op = 'UPDATE' and new.vote_id <> old.vote_id then
      raise exception 'IMMUTABLE_IDENTITY' using errcode = 'P0001';
    end if;
  end if;

  v := app_private.lock_vote(v_vote_id);

  if tg_op = 'DELETE' and app_private.retention_delete_allowed(v) then
    return old;
  end if;
  if v.status <> 'DRAFT' then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;
  if tg_table_name in ('offices', 'candidates') and v.voting_type <> 'CLOSED' then
    raise exception 'BALLOT_TYPE_MISMATCH' using errcode = 'P0001',
      detail = 'Offices and candidates belong to CLOSED votes.';
  end if;
  if tg_table_name = 'poll_options' and v.voting_type <> 'OPEN' then
    raise exception 'BALLOT_TYPE_MISMATCH' using errcode = 'P0001',
      detail = 'Options belong to OPEN votes.';
  end if;

  return coalesce(new, old);
end
$$;

-- Audit events are append-only; only expired rows may leave, in the retention
-- transaction, and every row's age is re-checked here.
create function app_private.guard_audit_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and app_private.flag_is_on('cp.audit_retention')
     and coalesce(
       old.occurred_at
         < pg_catalog.clock_timestamp()
           - pg_catalog.make_interval(
               days => (select s.audit_retention_days from public.rwa_settings s where s.id = 1)),
       false) then
    return old;
  end if;
  raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
end
$$;

drop trigger audit_events_immutable on public.audit_events;
create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function app_private.guard_audit_delete();

-- ---------------------------------------------------------------------------
-- Deleting one expired terminal vote, coherently and atomically
-- ---------------------------------------------------------------------------

create function app_private.purge_expired_vote(p_vote_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
begin
  v := app_private.lock_vote(p_vote_id);
  if not coalesce(app_private.vote_retention_expired(v), false) then
    return false;
  end if;

  perform pg_catalog.set_config('cp.retention', 'on', true);

  delete from public.open_responses where vote_id = p_vote_id;
  delete from public.closed_tallies where vote_id = p_vote_id;
  delete from public.participation where vote_id = p_vote_id;
  delete from public.electorate where vote_id = p_vote_id;
  delete from public.candidates c
    using public.offices o where c.office_id = o.id and o.vote_id = p_vote_id;
  delete from public.offices where vote_id = p_vote_id;
  delete from public.poll_options where vote_id = p_vote_id;
  delete from public.votes where id = p_vote_id;

  perform pg_catalog.set_config('cp.retention', 'off', true);

  -- Minimal evidence: what kind of record, never who took part or what they chose.
  perform app_private.append_audit(
    'SYSTEM', null, 'RETENTION_DELETED', 'VOTE', p_vote_id::text, null,
    pg_catalog.jsonb_build_object('kind', 'VOTE', 'votingType', v.voting_type, 'status', v.status));
  return true;
end
$$;

-- ---------------------------------------------------------------------------
-- Cron entry point
-- ---------------------------------------------------------------------------

create function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.rwa_settings;
  r record;
  v_skipped text[] := '{}';
  v_votes integer := 0;
  v_vote_failures integer := 0;
  v_audit integer := 0;
  v_buckets integer := 0;
  v_profiles integer := 0;
  v_profile_failures integer := 0;
begin
  select * into s from public.rwa_settings where id = 1;
  if not found then
    raise warning 'run_maintenance: no settings row; nothing was deleted';
    return pg_catalog.jsonb_build_object('skipped', pg_catalog.to_jsonb(array['ALL']));
  end if;

  -- 1. Expired terminal votes, a few per run; a locked vote is simply left for next time.
  if s.vote_retention_days is null then
    v_skipped := pg_catalog.array_append(v_skipped, 'VOTES');
  else
    for r in
      select id from public.votes
      where status in ('COMPLETED', 'CANCELLED')
        and coalesce(completed_at, cancelled_at)
            < pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => s.vote_retention_days)
      order by coalesce(completed_at, cancelled_at), id
      limit 10
      for update skip locked
    loop
      begin
        if app_private.purge_expired_vote(r.id) then
          v_votes := v_votes + 1;
        end if;
      exception
        when others then
          v_vote_failures := v_vote_failures + 1;
          raise warning 'run_maintenance: vote % was not deleted (%)', r.id, sqlerrm;
      end;
    end loop;
  end if;

  -- 2. Expired audit events, independently of everything else.
  if s.audit_retention_days is null then
    v_skipped := pg_catalog.array_append(v_skipped, 'AUDIT');
  else
    begin
      perform pg_catalog.set_config('cp.audit_retention', 'on', true);
      with doomed as (
        select id from public.audit_events
        where occurred_at
              < pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => s.audit_retention_days)
        order by id
        limit 1000
        for update skip locked)
      delete from public.audit_events a using doomed d where a.id = d.id;
      get diagnostics v_audit = row_count;
      perform pg_catalog.set_config('cp.audit_retention', 'off', true);
      if v_audit > 0 then
        perform app_private.append_audit(
          'SYSTEM', null, 'RETENTION_DELETED', 'RETENTION', 'audit_events', null,
          pg_catalog.jsonb_build_object('kind', 'AUDIT', 'count', v_audit));
      end if;
    exception
      when others then
        v_audit := 0;
        raise warning 'run_maintenance: audit expiry failed (%)', sqlerrm;
    end;
  end if;

  -- 3. Expired rate buckets. A bucket still inside its window has not expired and is never touched.
  if s.rate_limit_retention_days is null then
    v_skipped := pg_catalog.array_append(v_skipped, 'RATE_LIMITS');
  else
    begin
      delete from public.rate_limit_buckets
      where ctid in (
        select ctid from public.rate_limit_buckets
        where expires_at
              < pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => s.rate_limit_retention_days)
        limit 5000);
      get diagnostics v_buckets = row_count;
    exception
      when others then
        v_buckets := 0;
        raise warning 'run_maintenance: rate bucket expiry failed (%)', sqlerrm;
    end;
  end if;

  -- 4. Deleted profiles nothing refers to any more. The orphaned Auth identity
  --    is removed afterwards through supported Auth administration, not here.
  if s.inactive_profile_retention_days is null then
    v_skipped := pg_catalog.array_append(v_skipped, 'PROFILES');
  else
    for r in
      select p.id from public.profiles p
      where p.status = 'DELETED'
        and p.deleted_at
            < pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => s.inactive_profile_retention_days)
        and not exists (select 1 from public.households h where h.representative_profile_id = p.id)
        and not exists (select 1 from public.electorate e where e.representative_profile_id = p.id)
        and not exists (select 1 from public.votes v where v.created_by_profile_id = p.id)
        and not exists (select 1 from public.audit_events a where a.actor_profile_id = p.id)
      order by p.deleted_at, p.id
      limit 50
      for update of p skip locked
    loop
      begin
        delete from public.profiles where id = r.id;
        perform app_private.append_audit(
          'SYSTEM', null, 'RETENTION_DELETED', 'PROFILE', r.id::text, null,
          pg_catalog.jsonb_build_object('kind', 'PROFILE'));
        v_profiles := v_profiles + 1;
      exception
        when others then
          v_profile_failures := v_profile_failures + 1;
          raise warning 'run_maintenance: profile % was not deleted (%)', r.id, sqlerrm;
      end;
    end loop;
  end if;

  return pg_catalog.jsonb_build_object(
    'skipped', pg_catalog.to_jsonb(v_skipped),
    'votesDeleted', v_votes,
    'voteFailures', v_vote_failures,
    'auditDeleted', v_audit,
    'rateBucketsDeleted', v_buckets,
    'profilesDeleted', v_profiles,
    'profileFailures', v_profile_failures);
end
$$;

-- ---------------------------------------------------------------------------
-- Monitoring: counts only, never identities, choices or secrets
-- ---------------------------------------------------------------------------

create function public.health_ping()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select true
$$;

create function public.operational_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.rwa_settings;
  r record;
  v_failures integer := 0;
  v_present boolean;
begin
  perform app_private.require_service_role();
  select * into s from public.rwa_settings where id = 1;
  v_present := found;

  -- Every started vote must still reconcile (participation, responses, counters).
  for r in select id from public.votes where status <> 'DRAFT' loop
    begin
      perform app_private.verify_vote_invariants(r.id);
    exception
      when others then v_failures := v_failures + 1;
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'settingsPresent', v_present,
    'policyReady', coalesce(
      s.vote_retention_days is not null and s.audit_retention_days is not null
      and s.inactive_profile_retention_days is not null
      and s.rate_limit_retention_days is not null and s.backup_retention_days is not null, false),
    'activeVotes', (select count(*) from public.votes where status = 'ACTIVE'),
    -- Past the deadline by more than Cron should ever allow: the scheduler is late or stopped.
    'overdueActiveVotes', (
      select count(*) from public.votes
      where status = 'ACTIVE'
        and closes_at < pg_catalog.clock_timestamp() - interval '5 minutes'),
    'invariantFailures', v_failures,
    'expiredVotesPending', (
      select count(*) from public.votes v
      where coalesce(app_private.vote_retention_expired(v), false)),
    'expiredAuditPending', (
      select count(*) from public.audit_events a
      where s.audit_retention_days is not null
        and a.occurred_at
            < pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => s.audit_retention_days)),
    'expiredRateBucketsPending', (
      select count(*) from public.rate_limit_buckets b
      where s.rate_limit_retention_days is not null
        and b.expires_at
            < pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => s.rate_limit_retention_days)));
end
$$;

-- The audit history shows only keys this application writes; retention adds two.
create or replace function public.list_audit_events(
  p_limit integer default 50,
  p_after_id bigint default null,
  p_action text default null,
  p_target_type text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_has_more boolean := false;
begin
  perform app_private.require_enabled_admin();
  if p_limit is null or p_limit < 1 or p_limit > 100
     or (p_from is not null and p_to is not null and p_from >= p_to) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  select coalesce(pg_catalog.jsonb_agg(t.row_json order by t.id desc), '[]'::jsonb)
  into v_rows
  from (
    select
      a.id,
      pg_catalog.jsonb_build_object(
        'id', a.id::text,
        'actorKind', a.actor_kind,
        'actorProfileId', a.actor_profile_id,
        'actorName', p.representative_name,
        'action', a.action,
        'targetType', a.target_type,
        'targetId', a.target_id,
        'occurredAt', a.occurred_at,
        'reason', a.reason,
        'details', coalesce((
          select pg_catalog.jsonb_object_agg(d.key, d.value)
          from pg_catalog.jsonb_each(a.details) d
          where d.key = any (array[
            'timezone', 'key', 'version', 'invalidated', 'fields', 'isAdmin', 'from', 'to',
            'isEligible', 'votingType', 'draftRevision', 'completionMode', 'effectiveAt',
            'processedAt', 'electorate', 'closesAt', 'kind', 'count', 'status'])), '{}'::jsonb)) as row_json
    from public.audit_events a
    left join public.profiles p on p.id = a.actor_profile_id
    where (p_after_id is null or a.id < p_after_id)
      and (p_action is null or a.action = p_action)
      and (p_target_type is null or a.target_type = p_target_type)
      and (p_from is null or a.occurred_at >= p_from)
      and (p_to is null or a.occurred_at < p_to)
    order by a.id desc
    limit p_limit + 1
  ) t;

  if pg_catalog.jsonb_array_length(v_rows) > p_limit then
    v_has_more := true;
    v_rows := v_rows - p_limit;
  end if;
  return pg_catalog.jsonb_build_object('rows', v_rows, 'hasMore', v_has_more);
end
$$;

revoke all on function public.run_maintenance()
from public, anon, authenticated, service_role;
grant execute on function public.run_maintenance() to cp_scheduler;

revoke all on function public.health_ping(), public.operational_status()
from public, anon, authenticated;
grant execute on function public.health_ping(), public.operational_status() to service_role;

reset role;

-- ---------------------------------------------------------------------------
-- Supabase Cron: daily, off-peak (03:00 India time). Skipped where pg_cron is
-- not available. Completion is a separate job and never depends on this one.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'civic-pulse-maintenance',
      '30 21 * * *',
      $job$set role cp_scheduler; select public.run_maintenance()$job$);
  else
    raise notice 'pg_cron is not available here: retention maintenance is not scheduled.';
  end if;
end
$$;
