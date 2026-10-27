-- Frozen scheduled votes: database-clock opening, summary-only discovery and audited withdrawal.
set local role cp_owner;

alter table public.votes add column opens_at timestamptz;
alter table public.votes add column scheduled_at timestamptz;
alter table public.votes drop constraint votes_status_check;
alter table public.votes add constraint votes_status_check
  check (status in ('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED'));
alter table public.votes drop constraint votes_lifecycle_state;
alter table public.votes add constraint votes_lifecycle_state check (
  (status = 'DRAFT' and activated_at is null and opens_at is null and scheduled_at is null
    and completed_at is null and completion_mode is null and completion_reason is null
    and cancelled_at is null and cancellation_reason is null
    and rwa_name_snapshot is null and timezone_snapshot is null and policy_versions_snapshot is null)
  or (status in ('SCHEDULED', 'ACTIVE') and activated_at is not null and closes_at is not null
    and rwa_name_snapshot is not null and timezone_snapshot is not null and policy_versions_snapshot is not null
    and completed_at is null and completion_mode is null and completion_reason is null
    and cancelled_at is null and cancellation_reason is null
    and (status <> 'SCHEDULED' or (opens_at is not null and scheduled_at is not null and activated_at = opens_at)))
  or (status = 'COMPLETED' and activated_at is not null and closes_at is not null
    and rwa_name_snapshot is not null and timezone_snapshot is not null and policy_versions_snapshot is not null
    and completed_at is not null and completion_mode is not null
    and cancelled_at is null and cancellation_reason is null
    and ((completion_mode = 'DEADLINE' and completed_at = closes_at and completion_reason is null)
      or (completion_mode = 'EARLY' and completion_reason is not null
        and completed_at >= activated_at and completed_at < closes_at)))
  or (status = 'CANCELLED' and activated_at is not null and closes_at is not null
    and rwa_name_snapshot is not null and timezone_snapshot is not null and policy_versions_snapshot is not null
    and cancelled_at is not null and cancellation_reason is not null
    and completed_at is null and completion_mode is null and completion_reason is null)
);
alter table public.votes add constraint votes_opening_window check (
  (opens_at is null and scheduled_at is null)
  or (opens_at is not null and scheduled_at is not null and scheduled_at < opens_at and opens_at < closes_at)
);
grant select (opens_at, scheduled_at) on public.votes to authenticated;
create index votes_scheduled_opening on public.votes (opens_at, id) where status = 'SCHEDULED';

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'BOOTSTRAP_ADMIN', 'SETTINGS_INITIALIZED', 'POLICY_APPROVAL_RECORDED', 'RETENTION_UPDATED',
  'RWA_IDENTIFIER_LABEL_UPDATED', 'RWA_PROFILE_UPDATED', 'PROFILE_PROVISIONED', 'PROFILE_UPDATED',
  'PROFILE_STATUS_CHANGED', 'PROFILE_ROLE_CHANGED', 'HOUSEHOLD_CREATED', 'HOUSEHOLD_UPDATED',
  'DRAFT_CREATED', 'DRAFT_UPDATED', 'VOTE_ACTIVATED', 'VOTE_COMPLETED', 'VOTE_CANCELLED',
  'VOTE_DEADLINE_CHANGED', 'RETENTION_DELETED', 'VOTE_SCHEDULED', 'VOTE_SCHEDULE_WITHDRAWN'
));

create or replace function app_private.guard_vote_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.created_by_profile_id <> old.created_by_profile_id
     or new.created_at <> old.created_at then
    raise exception 'IMMUTABLE_IDENTITY' using errcode = 'P0001';
  end if;
  if old.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001';
  end if;
  if old.status = 'SCHEDULED' and new.status = 'DRAFT'
     and app_private.flag_is_on('cp.schedule_withdraw') then
    if old.opens_at <= pg_catalog.clock_timestamp()
       or exists (select 1 from public.participation where vote_id = old.id) then
      raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001';
    end if;
    new.updated_at := pg_catalog.now();
    return new;
  end if;
  if new.status <> old.status and not (
    (old.status = 'DRAFT' and new.status = 'ACTIVE')
    or (old.status = 'DRAFT' and new.status = 'SCHEDULED' and app_private.flag_is_on('cp.activation'))
    or (old.status = 'SCHEDULED' and new.status = 'ACTIVE' and app_private.flag_is_on('cp.scheduled_opening'))
    or (old.status = 'ACTIVE' and new.status in ('COMPLETED', 'CANCELLED'))
  ) then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001';
  end if;
  if old.status in ('ACTIVE', 'SCHEDULED') and (
    new.voting_type is distinct from old.voting_type or new.title is distinct from old.title
    or new.instructions is distinct from old.instructions
    or (new.closes_at is distinct from old.closes_at and not (
      old.status = 'ACTIVE' and new.status = 'ACTIVE' and new.closes_at is not null
      and app_private.flag_is_on('cp.deadline_change')))
    or new.draft_revision is distinct from old.draft_revision
    or new.activated_at is distinct from old.activated_at
    or new.opens_at is distinct from old.opens_at or new.scheduled_at is distinct from old.scheduled_at
    or new.rwa_name_snapshot is distinct from old.rwa_name_snapshot
    or new.timezone_snapshot is distinct from old.timezone_snapshot
    or new.policy_versions_snapshot is distinct from old.policy_versions_snapshot
  ) then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;
  if old.status = 'SCHEDULED' and new.status = 'ACTIVE' and old.opens_at > pg_catalog.clock_timestamp() then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;
  if old.status = 'DRAFT' then
    if new.status = 'DRAFT' and new.draft_revision not in (old.draft_revision, old.draft_revision + 1) then
      raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
    end if;
    if new.status in ('ACTIVE', 'SCHEDULED') then
      if new.draft_revision <> old.draft_revision or new.voting_type <> old.voting_type then
        raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001';
      end if;
      perform app_private.assert_structurally_activatable(new);
    end if;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

alter function app_private.vote_detail_json(public.votes) rename to vote_detail_json_before_scheduling;
create function app_private.vote_detail_json(v public.votes)
returns jsonb language sql stable set search_path = '' as $$
  select app_private.vote_detail_json_before_scheduling(v)
    || pg_catalog.jsonb_build_object('opensAt', v.opens_at, 'scheduledAt', v.scheduled_at)
$$;
alter function app_private.member_vote_json(public.votes) rename to member_vote_json_before_scheduling;
create function app_private.member_vote_json(v public.votes)
returns jsonb language sql stable set search_path = '' as $$
  select app_private.member_vote_json_before_scheduling(v)
    || pg_catalog.jsonb_build_object('opensAt', v.opens_at, 'scheduledAt', v.scheduled_at)
    || case when v.status = 'SCHEDULED'
      then pg_catalog.jsonb_build_object('offices', '[]'::jsonb, 'options', '[]'::jsonb)
      else '{}'::jsonb end
$$;

create function app_private.freeze_vote(p_vote_id uuid, p_expected_revision integer, p_confirmed boolean, p_opens_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v public.votes;
  s public.rwa_settings;
  v_blockers jsonb;
  v_versions jsonb;
begin
  if p_confirmed is distinct from true or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  v := app_private.lock_vote(p_vote_id);
  if v.status <> 'DRAFT' then raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = v.status; end if;
  if v.draft_revision <> p_expected_revision then raise exception 'STALE_REVISION' using errcode = 'P0001'; end if;
  perform 1 from public.households h
    where h.id in (select household_id from public.electorate where vote_id = p_vote_id) order by h.id for share;
  perform 1 from public.profiles p where p.id in (
    select h.representative_profile_id from public.households h join public.electorate e on e.household_id = h.id
    where e.vote_id = p_vote_id) order by p.id for share;
  select * into s from public.rwa_settings where id = 1 for share;
  perform app_private.assert_policy_ready();
  v_blockers := app_private.draft_blockers(v);
  if pg_catalog.jsonb_array_length(v_blockers) > 0 then
    raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001', detail = v_blockers -> 0 ->> 'message';
  end if;
  if p_opens_at is not null and (
    not pg_catalog.isfinite(p_opens_at) or p_opens_at <= pg_catalog.clock_timestamp()
    or p_opens_at >= v.closes_at
  ) then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
  perform pg_catalog.set_config('cp.activation', 'on', true);
  update public.electorate e set representative_profile_id = h.representative_profile_id,
    representative_name_snapshot = p.representative_name, household_identifier_snapshot = h.identifier
  from public.households h join public.profiles p on p.id = h.representative_profile_id
  where e.vote_id = p_vote_id and h.id = e.household_id;
  if v.voting_type = 'PRIVATE' then
    insert into public.closed_tallies (vote_id, office_id, candidate_id)
      select o.vote_id, o.id, c.id from public.offices o join public.candidates c on c.office_id = o.id where o.vote_id = p_vote_id
      union all select o.vote_id, o.id, null from public.offices o where o.vote_id = p_vote_id;
  end if;
  select pg_catalog.jsonb_object_agg(k, s.policy_approvals -> k ->> 'version') into v_versions
    from pg_catalog.unnest(array['A1','A2','A3','A4','A5','A6','A7']) k;
  update public.votes set status = case when p_opens_at is null then 'ACTIVE' else 'SCHEDULED' end,
    activated_at = coalesce(p_opens_at, pg_catalog.clock_timestamp()), opens_at = p_opens_at,
    scheduled_at = case when p_opens_at is not null then pg_catalog.clock_timestamp() else null end,
    rwa_name_snapshot = s.name, timezone_snapshot = s.timezone, policy_versions_snapshot = v_versions
  where id = p_vote_id returning * into v;
  perform pg_catalog.set_config('cp.activation', 'off', true);
  perform app_private.append_audit('PROFILE', v_actor,
    case when p_opens_at is null then 'VOTE_ACTIVATED' else 'VOTE_SCHEDULED' end,
    'VOTE', p_vote_id::text, null, pg_catalog.jsonb_build_object(
      'votingType', v.voting_type, 'draftRevision', v.draft_revision, 'opensAt', p_opens_at, 'closesAt', v.closes_at,
      'electorate', (select count(*) from public.electorate where vote_id = p_vote_id)));
  return app_private.vote_detail_json(v);
end
$$;

create or replace function public.activate_vote(p_vote_id uuid, p_expected_revision integer, p_confirmed boolean)
returns jsonb language sql security definer set search_path = '' as $$
  select app_private.freeze_vote(p_vote_id, p_expected_revision, p_confirmed, null)
$$;
create function public.schedule_vote(p_vote_id uuid, p_expected_revision integer, p_confirmed boolean, p_opens_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_opens_at is null then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
  return app_private.freeze_vote(p_vote_id, p_expected_revision, p_confirmed, p_opens_at);
end
$$;

create function app_private.open_if_due(p_vote_id uuid)
returns boolean language plpgsql set search_path = '' as $$
declare v public.votes;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('statement_timeout', '15s', true);
  v := app_private.lock_vote(p_vote_id);
  if v.status <> 'SCHEDULED' or v.opens_at > pg_catalog.clock_timestamp() then return false; end if;
  perform app_private.verify_vote_invariants(p_vote_id);
  perform pg_catalog.set_config('cp.scheduled_opening', 'on', true);
  update public.votes set status = 'ACTIVE' where id = p_vote_id;
  perform pg_catalog.set_config('cp.scheduled_opening', 'off', true);
  perform app_private.append_audit('SYSTEM', null, 'VOTE_ACTIVATED', 'VOTE', p_vote_id::text, null,
    pg_catalog.jsonb_build_object('effectiveAt', v.opens_at, 'processedAt', pg_catalog.clock_timestamp()));
  perform app_private.complete_if_due(p_vote_id);
  return true;
end
$$;

create function public.withdraw_vote_schedule(p_vote_id uuid, p_confirmed boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := app_private.require_enabled_admin(); v public.votes; v_reason text;
begin
  if p_confirmed is distinct from true then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
  v_reason := app_private.clean_multiline(p_reason, 2000);
  v := app_private.lock_vote(p_vote_id);
  if v.status <> 'SCHEDULED' or v.opens_at <= pg_catalog.clock_timestamp() then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('cp.schedule_withdraw', 'on', true);
  update public.votes set status = 'DRAFT', opens_at = null, scheduled_at = null,
    activated_at = null, rwa_name_snapshot = null, timezone_snapshot = null, policy_versions_snapshot = null,
    draft_revision = draft_revision + 1 where id = p_vote_id;
  delete from public.closed_tallies where vote_id = p_vote_id;
  update public.electorate set representative_profile_id = null, representative_name_snapshot = null,
    household_identifier_snapshot = null where vote_id = p_vote_id;
  perform pg_catalog.set_config('cp.schedule_withdraw', 'off', true);
  perform app_private.append_audit('PROFILE', v_actor, 'VOTE_SCHEDULE_WITHDRAWN', 'VOTE', p_vote_id::text, v_reason,
    pg_catalog.jsonb_build_object('previousOpensAt', v.opens_at));
  select * into v from public.votes where id = p_vote_id;
  return app_private.vote_detail_json(v);
end
$$;

-- Ballot tables use a stricter policy than summary discovery, including direct PostgREST reads.
create function app_private.can_view_ballot(p_vote_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.is_enabled_admin() or (app_private.has_entitlement(p_vote_id)
    and exists (select 1 from public.votes where id = p_vote_id
      and (status <> 'SCHEDULED' or opens_at <= pg_catalog.clock_timestamp())))
$$;
create or replace function app_private.can_view_office(p_office_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.offices where id = p_office_id and app_private.can_view_ballot(vote_id))
$$;
drop policy offices_read on public.offices;
create policy offices_read on public.offices for select to authenticated using ((select app_private.can_view_ballot(vote_id)));
drop policy poll_options_read on public.poll_options;
create policy poll_options_read on public.poll_options for select to authenticated using ((select app_private.can_view_ballot(vote_id)));

alter function public.cast_vote(uuid, jsonb) rename to cast_vote_before_scheduling;
alter function public.cast_vote_before_scheduling(uuid, jsonb) set schema app_private;
create function public.cast_vote(p_vote_id uuid, p_submission jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_enabled_member();
  if not app_private.has_entitlement(p_vote_id) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform app_private.open_if_due(p_vote_id);
  return app_private.cast_vote_before_scheduling(p_vote_id, p_submission);
end
$$;

alter function public.get_member_vote(uuid) rename to get_member_vote_before_scheduling;
alter function public.get_member_vote_before_scheduling(uuid) set schema app_private;
create function public.get_member_vote(p_vote_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_enabled_member();
  if not app_private.can_view_vote(p_vote_id) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform app_private.open_if_due(p_vote_id);
  return app_private.get_member_vote_before_scheduling(p_vote_id);
end
$$;

alter function public.get_admin_vote(uuid) rename to get_admin_vote_before_scheduling;
alter function public.get_admin_vote_before_scheduling(uuid) set schema app_private;
create function public.get_admin_vote(p_vote_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_enabled_admin();
  perform app_private.open_if_due(p_vote_id);
  return app_private.get_admin_vote_before_scheduling(p_vote_id);
end
$$;

create or replace function public.list_member_votes(
  p_status text default null, p_voting_type text default null, p_limit integer default 25,
  p_after_rank integer default null, p_after_key bigint default null, p_after_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app_private.require_enabled_member(); v_rows jsonb; v_has_more boolean; r record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or (p_status is not null and p_status not in ('SCHEDULED','ACTIVE','COMPLETED','CANCELLED'))
     or (p_voting_type is not null and p_voting_type not in ('PUBLIC','PRIVATE'))
     or ((p_after_rank is null) <> (p_after_key is null)) or ((p_after_rank is null) <> (p_after_id is null)) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  for r in select v.id from public.votes v join public.electorate e on e.vote_id = v.id
    where e.representative_profile_id = v_uid and v.status = 'SCHEDULED' and v.opens_at <= pg_catalog.clock_timestamp()
    order by v.id limit 50 loop
    perform app_private.open_if_due(r.id);
  end loop;
  select coalesce(pg_catalog.jsonb_agg(t.j order by t.rank, t.skey, t.id), '[]'::jsonb) into v_rows
  from (
    select x.id, x.rank, x.skey, pg_catalog.jsonb_build_object(
      'id', x.id, 'votingType', x.voting_type, 'status', x.status, 'title', x.title,
      'opensAt', x.opens_at, 'scheduledAt', x.scheduled_at, 'closesAt', x.closes_at,
      'timezone', x.timezone_snapshot, 'activatedAt', x.activated_at,
      'completedAt', x.completed_at, 'cancelledAt', x.cancelled_at,
      'submitted', exists (select 1 from public.participation p where p.vote_id = x.id and p.household_id = x.household_id),
      'cursor', pg_catalog.jsonb_build_object('rank', x.rank, 'key', x.skey::text, 'id', x.id)) j
    from (
      select v.*, e.household_id, case when v.status = 'ACTIVE' then 0 when v.status = 'SCHEDULED' then 1 else 2 end rank,
        case when v.status = 'ACTIVE' then (extract(epoch from v.closes_at) * 1000000)::bigint
          when v.status = 'SCHEDULED' then (extract(epoch from v.opens_at) * 1000000)::bigint
          else -(extract(epoch from coalesce(v.completed_at, v.cancelled_at)) * 1000000)::bigint end skey
      from public.votes v join public.electorate e on e.vote_id = v.id and e.representative_profile_id = v_uid
      where v.status <> 'DRAFT' and (p_status is null or v.status = p_status)
        and (p_voting_type is null or v.voting_type = p_voting_type)
    ) x where p_after_rank is null or (x.rank, x.skey, x.id) > (p_after_rank, p_after_key, p_after_id)
    order by x.rank, x.skey, x.id limit p_limit + 1
  ) t;
  v_has_more := pg_catalog.jsonb_array_length(v_rows) > p_limit;
  if v_has_more then v_rows := v_rows - p_limit; end if;
  return pg_catalog.jsonb_build_object('rows', v_rows, 'hasMore', v_has_more);
end
$$;

alter function public.complete_due_votes() rename to complete_due_votes_before_scheduling;
alter function public.complete_due_votes_before_scheduling() set schema app_private;
create function public.complete_due_votes()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_completed integer := 0; v_blocked integer := 0; v_result jsonb;
begin
  for r in select id from public.votes where status = 'SCHEDULED' and opens_at <= pg_catalog.clock_timestamp()
    order by opens_at, id limit 50 loop
    begin
      if app_private.open_if_due(r.id) and exists (
        select 1 from public.votes where id = r.id and status = 'COMPLETED'
      ) then v_completed := v_completed + 1; end if;
    exception when others then
      v_blocked := v_blocked + 1;
      raise warning 'scheduled opening blocked for vote %', r.id;
    end;
  end loop;
  v_result := app_private.complete_due_votes_before_scheduling();
  return pg_catalog.jsonb_build_object('completed', v_completed + (v_result ->> 'completed')::integer,
    'blocked', v_blocked + (v_result ->> 'blocked')::integer);
end
$$;

revoke all on function app_private.vote_detail_json(public.votes), app_private.member_vote_json(public.votes),
  app_private.freeze_vote(uuid, integer, boolean, timestamptz), app_private.open_if_due(uuid),
  app_private.cast_vote_before_scheduling(uuid, jsonb), app_private.get_member_vote_before_scheduling(uuid),
  app_private.get_admin_vote_before_scheduling(uuid), app_private.complete_due_votes_before_scheduling()
from public, anon, authenticated, service_role, cp_scheduler;
revoke all on function app_private.can_view_ballot(uuid) from public, anon, service_role;
grant execute on function app_private.can_view_ballot(uuid) to authenticated;
revoke all on function public.schedule_vote(uuid, integer, boolean, timestamptz),
  public.withdraw_vote_schedule(uuid, boolean, text), public.cast_vote(uuid, jsonb),
  public.get_member_vote(uuid), public.get_admin_vote(uuid) from public, anon, service_role;
grant execute on function public.schedule_vote(uuid, integer, boolean, timestamptz),
  public.withdraw_vote_schedule(uuid, boolean, text), public.cast_vote(uuid, jsonb),
  public.get_member_vote(uuid), public.get_admin_vote(uuid) to authenticated;
revoke all on function public.complete_due_votes() from public, anon, authenticated, service_role;
grant execute on function public.complete_due_votes() to cp_scheduler;

reset role;