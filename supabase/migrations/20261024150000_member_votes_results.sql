-- Member vote discovery, completed results, participation monitoring and audit history
-- (docs/API.md sections 4.2, 4.4 and 5; docs/IMPLEMENTATION_PLAN.md phases 12-13).
--
-- Every routine runs with the caller's own session and re-derives identity from
-- the verified JWT. Members see only votes in their own FROZEN electorate; the
-- completed-result routine is the single source for the screen, the API and the
-- CSV export, and it refuses anything that is not COMPLETED, so no active or
-- cancelled choice or total can leave the database. Counts are returned as
-- decimal strings; percentages and outcomes are computed once, in the
-- application, by the shared tested helpers.

set local role cp_owner;

-- ---------------------------------------------------------------------------
-- member projection (never includes the electorate, counters or anyone else's status)
-- ---------------------------------------------------------------------------

create function app_private.member_vote_json(v public.votes)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', v.id,
    'votingType', v.voting_type,
    'status', v.status,
    'title', v.title,
    'instructions', v.instructions,
    'closesAt', v.closes_at,
    'timezone', v.timezone_snapshot,
    'rwaName', v.rwa_name_snapshot,
    'policyVersions', v.policy_versions_snapshot,
    'activatedAt', v.activated_at,
    'completedAt', v.completed_at,
    'completionMode', v.completion_mode,
    'completionReason', v.completion_reason,
    'cancelledAt', v.cancelled_at,
    'cancellationReason', v.cancellation_reason,
    'offices', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', o.id, 'name', o.name, 'position', o.position,
          'candidates', coalesce((
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object('id', c.id, 'name', c.name, 'position', c.position)
              order by c.position)
            from public.candidates c where c.office_id = o.id), '[]'::jsonb))
        order by o.position)
      from public.offices o where o.vote_id = v.id), '[]'::jsonb),
    'options', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', p.id, 'label', p.label, 'position', p.position)
        order by p.position)
      from public.poll_options p where p.vote_id = v.id), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- GET /api/votes: the caller's own frozen entitlements
-- ---------------------------------------------------------------------------

-- Active votes first (soonest deadline first), then finished ones (newest first).
-- The cursor is (rank, sortKey, id); it only changes where listing resumes.
create function public.list_member_votes(
  p_status text default null,
  p_voting_type text default null,
  p_limit integer default 25,
  p_after_rank integer default null,
  p_after_key bigint default null,
  p_after_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_enabled_member();
  v_rows jsonb;
  v_has_more boolean;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or (p_status is not null and p_status not in ('ACTIVE', 'COMPLETED', 'CANCELLED'))
     or (p_voting_type is not null and p_voting_type not in ('OPEN', 'CLOSED'))
     or ((p_after_rank is null) <> (p_after_key is null))
     or ((p_after_rank is null) <> (p_after_id is null)) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  select pg_catalog.jsonb_agg(t.row_json order by t.rank, t.skey, t.id)
  into v_rows
  from (
    select
      x.id, x.rank, x.skey,
      pg_catalog.jsonb_build_object(
        'id', x.id,
        'votingType', x.voting_type,
        'status', x.status,
        'title', x.title,
        'closesAt', x.closes_at,
        'timezone', x.timezone_snapshot,
        'activatedAt', x.activated_at,
        'completedAt', x.completed_at,
        'cancelledAt', x.cancelled_at,
        'submitted', exists (
          select 1 from public.participation pt
          where pt.vote_id = x.id and pt.household_id = x.household_id),
        'cursor', pg_catalog.jsonb_build_object(
          'rank', x.rank, 'key', x.skey::text, 'id', x.id)) as row_json
    from (
      select
        v.*, e.household_id,
        case when v.status = 'ACTIVE' then 0 else 1 end as rank,
        case when v.status = 'ACTIVE'
             then (extract(epoch from v.closes_at) * 1000000)::bigint
             else -(extract(epoch from coalesce(v.completed_at, v.cancelled_at)) * 1000000)::bigint
        end as skey
      from public.votes v
      join public.electorate e
        on e.vote_id = v.id and e.representative_profile_id = v_uid
      where v.status <> 'DRAFT'
        and (p_status is null or v.status = p_status)
        and (p_voting_type is null or v.voting_type = p_voting_type)
    ) x
    where p_after_rank is null
       or (x.rank, x.skey, x.id) > (p_after_rank, p_after_key, p_after_id)
    order by x.rank, x.skey, x.id
    limit p_limit + 1
  ) t;

  v_rows := coalesce(v_rows, '[]'::jsonb);
  v_has_more := pg_catalog.jsonb_array_length(v_rows) > p_limit;
  if v_has_more then
    v_rows := v_rows - p_limit;
  end if;
  return pg_catalog.jsonb_build_object('rows', v_rows, 'hasMore', v_has_more);
end
$$;

-- ---------------------------------------------------------------------------
-- GET /api/votes/{id}: ballot and own submission state
-- ---------------------------------------------------------------------------

-- Members need an entitlement. An administrator may read any non-draft ballot
-- but receives NO fabricated submission state outside their own entitlement.
create function public.get_member_vote(p_vote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_enabled_member();
  v public.votes;
  v_household uuid;
  v_submitted boolean;
  v_entitled boolean;
begin
  select * into v from public.votes where id = p_vote_id and status <> 'DRAFT';
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select e.household_id into v_household
  from public.electorate e
  where e.vote_id = p_vote_id and e.representative_profile_id = v_uid;
  v_entitled := v_household is not null;
  if not v_entitled and not app_private.is_enabled_admin() then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_entitled then
    v_submitted := exists (
      select 1 from public.participation
      where vote_id = p_vote_id and household_id = v_household);
  end if;

  return app_private.member_vote_json(v) || pg_catalog.jsonb_build_object(
    'entitled', v_entitled,
    'submitted', v_submitted,
    'canSubmit', v_entitled and v.status = 'ACTIVE'
      and v.closes_at > pg_catalog.clock_timestamp() and not coalesce(v_submitted, false),
    'exportFormats', case when v.status = 'COMPLETED'
      then '["csv"]'::jsonb else '[]'::jsonb end);
end
$$;

-- ---------------------------------------------------------------------------
-- completed results: the one projection for screen, API and CSV
-- ---------------------------------------------------------------------------

-- Readable by a frozen eligible representative or an enabled administrator, and
-- ONLY for a COMPLETED vote: active and cancelled choices never leave here, not
-- even as partial totals for an administrator. A completed vote is immutable,
-- and the share lock keeps retention deletion out while we read, so every part
-- below describes the same data. A counter/participation mismatch blocks
-- publication instead of being repaired or hidden.
-- p_limit null returns every named response (the export); otherwise a bounded page.
create function public.get_vote_results(
  p_vote_id uuid,
  p_limit integer default 50,
  p_after_key text default null,
  p_after_household uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_enabled_member();
  v public.votes;
  v_entitled boolean;
  v_eligible bigint;
  v_submitted bigint;
  v_options jsonb;
  v_offices jsonb;
  v_named jsonb := '[]'::jsonb;
  v_has_more boolean := false;
begin
  if p_limit is not null and (p_limit < 1 or p_limit > 1000)
     or ((p_after_key is null) <> (p_after_household is null)) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  select * into v from public.votes where id = p_vote_id and status <> 'DRAFT' for share;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_entitled := exists (
    select 1 from public.electorate e
    where e.vote_id = p_vote_id and e.representative_profile_id = v_uid);
  if not v_entitled and not app_private.is_enabled_admin() then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v.status <> 'COMPLETED' then
    raise exception 'RESULTS_UNAVAILABLE' using errcode = 'P0001', detail = v.status;
  end if;

  begin
    perform app_private.verify_vote_invariants(p_vote_id);
  exception
    when others then
      raise exception 'RESULTS_INTEGRITY_ERROR' using errcode = 'P0001';
  end;

  -- Frozen denominator: includes households whose representative was suspended later.
  select count(*) into v_eligible from public.electorate where vote_id = p_vote_id;
  select count(*) into v_submitted from public.participation where vote_id = p_vote_id;

  if v.voting_type = 'OPEN' then
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', o.id, 'label', o.label, 'position', o.position,
        'count', (select count(*) from public.open_responses r
                  where r.vote_id = p_vote_id and r.option_id = o.id)::text)
      order by o.position), '[]'::jsonb)
    into v_options
    from public.poll_options o where o.vote_id = p_vote_id;

    -- Frozen identities and the configured labels, never the current register.
    select coalesce(pg_catalog.jsonb_agg(n.row_json order by n.ident, n.household_id), '[]'::jsonb)
    into v_named
    from (
      select
        e.household_identifier_snapshot as ident,
        e.household_id,
        pg_catalog.jsonb_build_object(
          'representativeName', e.representative_name_snapshot,
          'householdIdentifier', e.household_identifier_snapshot,
          'optionId', o.id,
          'optionLabel', o.label,
          'cursor', pg_catalog.jsonb_build_object(
            'key', e.household_identifier_snapshot, 'householdId', e.household_id)) as row_json
      from public.open_responses r
      join public.electorate e
        on e.vote_id = r.vote_id and e.household_id = r.household_id
      join public.poll_options o on o.id = r.option_id
      where r.vote_id = p_vote_id
        and (p_after_key is null
             or (e.household_identifier_snapshot, e.household_id) > (p_after_key, p_after_household))
      order by e.household_identifier_snapshot, e.household_id
      limit coalesce(p_limit + 1, 2147483647)
    ) n;

    if p_limit is not null and pg_catalog.jsonb_array_length(v_named) > p_limit then
      v_has_more := true;
      v_named := v_named - p_limit;
    end if;
  else
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', o.id, 'name', o.name, 'position', o.position,
        'abstentionCount', (select coalesce(sum(t.accepted_count), 0) from public.closed_tallies t
                            where t.office_id = o.id and t.candidate_id is null)::text,
        'candidates', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', c.id, 'name', c.name, 'position', c.position,
              'count', (select coalesce(sum(t.accepted_count), 0) from public.closed_tallies t
                        where t.office_id = o.id and t.candidate_id = c.id)::text)
            order by c.position)
          from public.candidates c where c.office_id = o.id), '[]'::jsonb))
      order by o.position), '[]'::jsonb)
    into v_offices
    from public.offices o where o.vote_id = p_vote_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'vote', app_private.member_vote_json(v) - 'offices' - 'options' - 'cancelledAt' - 'cancellationReason',
    'eligibleCount', v_eligible::text,
    'submittedCount', v_submitted::text,
    'options', coalesce(v_options, '[]'::jsonb),
    'offices', coalesce(v_offices, '[]'::jsonb),
    'namedResponses', case when v.voting_type = 'OPEN' then v_named else null end,
    'namedPage', case when v.voting_type = 'OPEN'
      then pg_catalog.jsonb_build_object('hasMore', v_has_more) else null end);
end
$$;

-- ---------------------------------------------------------------------------
-- administrator participation monitoring (never choices, emails or timestamps)
-- ---------------------------------------------------------------------------

create function public.get_vote_participation(
  p_vote_id uuid,
  p_submitted boolean default null,
  p_limit integer default 50,
  p_after_key text default null,
  p_after_household uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.votes;
  v_eligible bigint;
  v_submitted bigint;
  v_rows jsonb;
  v_has_more boolean := false;
begin
  perform app_private.require_enabled_admin();
  if p_limit is null or p_limit < 1 or p_limit > 100
     or ((p_after_key is null) <> (p_after_household is null)) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  select * into v from public.votes where id = p_vote_id for share;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status = 'DRAFT' then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = 'DRAFT';
  end if;

  select count(*) into v_eligible from public.electorate where vote_id = p_vote_id;
  select count(*) into v_submitted from public.participation where vote_id = p_vote_id;

  select coalesce(pg_catalog.jsonb_agg(t.row_json order by t.ident, t.household_id), '[]'::jsonb)
  into v_rows
  from (
    select
      e.household_identifier_snapshot as ident,
      e.household_id,
      pg_catalog.jsonb_build_object(
        'representativeName', e.representative_name_snapshot,
        'householdIdentifier', e.household_identifier_snapshot,
        'submitted', exists (
          select 1 from public.participation pt
          where pt.vote_id = e.vote_id and pt.household_id = e.household_id),
        'cursor', pg_catalog.jsonb_build_object(
          'key', e.household_identifier_snapshot, 'householdId', e.household_id)) as row_json
    from public.electorate e
    where e.vote_id = p_vote_id
      and (p_submitted is null or p_submitted = exists (
            select 1 from public.participation pt
            where pt.vote_id = e.vote_id and pt.household_id = e.household_id))
      and (p_after_key is null
           or (e.household_identifier_snapshot, e.household_id) > (p_after_key, p_after_household))
    order by e.household_identifier_snapshot, e.household_id
    limit p_limit + 1
  ) t;

  if pg_catalog.jsonb_array_length(v_rows) > p_limit then
    v_has_more := true;
    v_rows := v_rows - p_limit;
  end if;

  return pg_catalog.jsonb_build_object(
    'voteId', p_vote_id,
    'status', v.status,
    'eligibleCount', v_eligible::text,
    'submittedCount', v_submitted::text,
    'rows', v_rows,
    'hasMore', v_has_more);
end
$$;

-- ---------------------------------------------------------------------------
-- administrator audit history (allowlisted fields only)
-- ---------------------------------------------------------------------------

create function public.list_audit_events(
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
        -- Only keys this application writes; anything else is dropped, never passed through.
        'details', coalesce((
          select pg_catalog.jsonb_object_agg(d.key, d.value)
          from pg_catalog.jsonb_each(a.details) d
          where d.key = any (array[
            'timezone', 'key', 'version', 'invalidated', 'fields', 'isAdmin', 'from', 'to',
            'isEligible', 'votingType', 'draftRevision', 'completionMode', 'effectiveAt',
            'processedAt', 'electorate', 'closesAt'])), '{}'::jsonb)) as row_json
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

revoke all on function
  public.list_member_votes(text, text, integer, integer, bigint, uuid),
  public.get_member_vote(uuid),
  public.get_vote_results(uuid, integer, text, uuid),
  public.get_vote_participation(uuid, boolean, integer, text, uuid),
  public.list_audit_events(integer, bigint, text, text, timestamptz, timestamptz)
from public, anon;
grant execute on function
  public.list_member_votes(text, text, integer, integer, bigint, uuid),
  public.get_member_vote(uuid),
  public.get_vote_results(uuid, integer, text, uuid),
  public.get_vote_participation(uuid, boolean, integer, text, uuid),
  public.list_audit_events(integer, bigint, text, text, timestamptz, timestamptz)
to authenticated;

reset role;
