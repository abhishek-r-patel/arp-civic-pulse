-- Exact filtered page totals and bounded keyset anchors for numbered UI navigation.
-- Existing list routines, projections and cursor API contracts remain unchanged.
set local role cp_owner;

create function public.get_list_page(
  p_dataset text,
  p_page integer default 1,
  p_limit integer default 25,
  p_filters jsonb default '{}'::jsonb,
  p_vote_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_enabled_member();
  v_total bigint;
  v_page integer;
  v_pages bigint;
  v_offset bigint;
  v_position jsonb;
  v_identifier text;
  v_probe jsonb;
  v_filters text[];
begin
  if p_dataset is null or p_dataset not in
      ('residents', 'admin-votes', 'member-votes', 'participation', 'audit', 'responses')
     or p_page is null or p_page < 1 or p_page > 1000000
     or p_limit is null or p_limit < 1 or p_limit > 100
     or p_filters is null or pg_catalog.jsonb_typeof(p_filters) <> 'object' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  v_filters := case p_dataset
    when 'residents' then array['status','isAdmin','isReadonly','selfRegistered','identifier','isEligible','hasHousehold']
    when 'admin-votes' then array['status','votingType']
    when 'member-votes' then array['status','votingType']
    when 'participation' then array['submitted']
    when 'audit' then array['action','targetType','from','to']
    else array[]::text[] end;
  if exists (select 1 from pg_catalog.jsonb_each(p_filters) f
    where not (f.key = any(v_filters))
      or pg_catalog.jsonb_typeof(f.value) <> case
        when f.key in ('isAdmin','isReadonly','selfRegistered','isEligible','hasHousehold','submitted')
          then 'boolean' else 'string' end) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  if p_dataset in ('residents', 'admin-votes', 'participation', 'audit') then
    perform app_private.require_enabled_committee();
  end if;

  -- The existing routines enforce parent access, lifecycle and result integrity
  -- before even counts or anchors can be observed through this endpoint.
  if p_dataset = 'participation' then
    perform public.get_vote_participation(p_vote_id, null, 1);
  elsif p_dataset = 'responses' then
    v_probe := public.get_vote_results(p_vote_id, 1);
    if v_probe->'namedPage' = 'null'::jsonb then
      raise exception 'RESULTS_UNAVAILABLE' using errcode = 'P0001';
    end if;
  elsif p_dataset = 'member-votes' then
    -- Preserve scheduled-opening reconciliation before counting/sorting.
    perform public.list_member_votes(null, null, 1);
  end if;
  if p_dataset = 'residents' and p_filters ? 'identifier' then
    v_identifier := public.normalize_household_identifier(p_filters->>'identifier');
  end if;

  -- Each branch materializes only authorized filtered sort keys. Count and
  -- anchor share one statement snapshot; no resident/ballot rows are returned.
  if p_dataset = 'residents' then
    with filtered as materialized (
      select d.id, d.sort_key from public.resident_directory d
      where (not (p_filters ? 'status') or d.status = p_filters->>'status')
        and (not (p_filters ? 'isAdmin') or d.is_admin = (p_filters->>'isAdmin')::boolean)
        and (not (p_filters ? 'isReadonly') or d.is_readonly = (p_filters->>'isReadonly')::boolean)
        and (not (p_filters ? 'selfRegistered') or d.self_registered = (p_filters->>'selfRegistered')::boolean)
        and (v_identifier is null or d.household_identifier_normalized = v_identifier)
        and (not (p_filters ? 'isEligible') or d.household_is_eligible = (p_filters->>'isEligible')::boolean)
        and (not (p_filters ? 'hasHousehold') or (d.household_id is not null) = (p_filters->>'hasHousehold')::boolean)
    ), bounds as (select count(*) n from filtered)
    select b.n, (
      select pg_catalog.jsonb_build_object('id', f.id)
      from filtered f order by f.sort_key, f.id
      offset greatest(0, least(p_page::bigint - 1, greatest(0, (b.n - 1) / p_limit)) * p_limit - 1) limit 1
    ) into v_total, v_position from bounds b;
  elsif p_dataset = 'admin-votes' then
    with filtered as materialized (
      select v.id, v.updated_at from public.votes v
      where (not (p_filters ? 'status') or v.status = p_filters->>'status')
        and (not (p_filters ? 'votingType') or v.voting_type = p_filters->>'votingType')
    ), bounds as (select count(*) n from filtered)
    select b.n, (
      select pg_catalog.jsonb_build_object('key', f.updated_at, 'id', f.id)
      from filtered f order by f.updated_at desc, f.id desc
      offset greatest(0, least(p_page::bigint - 1, greatest(0, (b.n - 1) / p_limit)) * p_limit - 1) limit 1
    ) into v_total, v_position from bounds b;
  elsif p_dataset = 'member-votes' then
    with filtered as materialized (
      select v.id,
        case when v.status = 'ACTIVE' then 0 when v.status = 'SCHEDULED' then 1 else 2 end rank,
        case when v.status = 'ACTIVE' then (extract(epoch from v.closes_at) * 1000000)::bigint
          when v.status = 'SCHEDULED' then (extract(epoch from v.opens_at) * 1000000)::bigint
          else -(extract(epoch from coalesce(v.completed_at, v.cancelled_at)) * 1000000)::bigint end skey
      from public.votes v join public.electorate e on e.vote_id = v.id
      where e.representative_profile_id = v_uid and v.status <> 'DRAFT'
        and (not (p_filters ? 'status') or v.status = p_filters->>'status')
        and (not (p_filters ? 'votingType') or v.voting_type = p_filters->>'votingType')
    ), bounds as (select count(*) n from filtered)
    select b.n, (
      select pg_catalog.jsonb_build_object('rank', f.rank::text, 'key', f.skey::text, 'id', f.id)
      from filtered f order by f.rank, f.skey, f.id
      offset greatest(0, least(p_page::bigint - 1, greatest(0, (b.n - 1) / p_limit)) * p_limit - 1) limit 1
    ) into v_total, v_position from bounds b;
  elsif p_dataset = 'participation' then
    with filtered as materialized (
      select e.household_id id, e.household_identifier_snapshot skey from public.electorate e
      where e.vote_id = p_vote_id and (not (p_filters ? 'submitted') or
        (p_filters->>'submitted')::boolean = exists (
          select 1 from public.participation pt where pt.vote_id = e.vote_id and pt.household_id = e.household_id))
    ), bounds as (select count(*) n from filtered)
    select b.n, (
      select pg_catalog.jsonb_build_object('key', f.skey, 'id', f.id)
      from filtered f order by f.skey, f.id
      offset greatest(0, least(p_page::bigint - 1, greatest(0, (b.n - 1) / p_limit)) * p_limit - 1) limit 1
    ) into v_total, v_position from bounds b;
  elsif p_dataset = 'audit' then
    if (p_filters->>'from')::timestamptz >= (p_filters->>'to')::timestamptz then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    with filtered as materialized (
      select a.id from public.audit_events a
      where (not (p_filters ? 'action') or a.action = p_filters->>'action')
        and (not (p_filters ? 'targetType') or a.target_type = p_filters->>'targetType')
        and (not (p_filters ? 'from') or a.occurred_at >= (p_filters->>'from')::timestamptz)
        and (not (p_filters ? 'to') or a.occurred_at < (p_filters->>'to')::timestamptz)
    ), bounds as (select count(*) n from filtered)
    select b.n, (
      select pg_catalog.jsonb_build_object('id', f.id::text)
      from filtered f order by f.id desc
      offset greatest(0, least(p_page::bigint - 1, greatest(0, (b.n - 1) / p_limit)) * p_limit - 1) limit 1
    ) into v_total, v_position from bounds b;
  else
    with filtered as materialized (
      select e.household_id id, e.household_identifier_snapshot skey
      from public.electorate e where e.vote_id = p_vote_id
        and exists (select 1 from public.open_responses r
          where r.vote_id = e.vote_id and r.household_id = e.household_id)
    ), bounds as (select count(*) n from filtered)
    select b.n, (
      select pg_catalog.jsonb_build_object('key', f.skey, 'id', f.id)
      from filtered f order by f.skey, f.id
      offset greatest(0, least(p_page::bigint - 1, greatest(0, (b.n - 1) / p_limit)) * p_limit - 1) limit 1
    ) into v_total, v_position from bounds b;
  end if;
  v_pages := greatest(1, (v_total + p_limit - 1) / p_limit);
  v_page := least(p_page::bigint, v_pages)::integer;
  v_offset := (v_page::bigint - 1) * p_limit;
  return pg_catalog.jsonb_build_object(
    'totalCount', v_total::text, 'currentPage', v_page, 'totalPages', v_pages,
    'position', case when v_offset = 0 then null else v_position end);
end
$$;

revoke all on function public.get_list_page(text, integer, integer, jsonb, uuid) from public, anon;
grant execute on function public.get_list_page(text, integer, integer, jsonb, uuid) to authenticated;
reset role;
