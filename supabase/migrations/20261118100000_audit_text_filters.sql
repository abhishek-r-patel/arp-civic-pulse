-- Add bounded literal actor and Details filters to the audit projection and
-- numbered-window query; Details includes the event reason and allowlisted keys.
set local role cp_owner;

drop function public.list_audit_events(
  integer, bigint, text, text, timestamptz, timestamptz
);

create function public.list_audit_events(
  p_limit integer default 50,
  p_after_id bigint default null,
  p_action text default null,
  p_target_type text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_who text default null,
  p_details text default null
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
  perform app_private.require_enabled_committee();
  if p_limit is null or p_limit < 1 or p_limit > 100
     or (p_from is not null and p_to is not null and p_from >= p_to)
     or (p_who is not null and (
       pg_catalog.length(pg_catalog.btrim(p_who)) < 1
       or pg_catalog.length(p_who) > 100))
     or (p_details is not null and (
       pg_catalog.length(pg_catalog.btrim(p_details)) < 1
       or pg_catalog.length(p_details) > 100)) then
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
            'processedAt', 'electorate', 'closesAt', 'kind', 'count', 'status'])), '{}'::jsonb)) as row_json
    from public.audit_events a
    left join public.profiles p on p.id = a.actor_profile_id
    where (p_after_id is null or a.id < p_after_id)
      and (p_action is null or a.action = p_action)
      and (p_target_type is null or a.target_type = p_target_type)
      and (p_from is null or a.occurred_at >= p_from)
      and (p_to is null or a.occurred_at < p_to)
      and (p_who is null
        or pg_catalog.strpos(pg_catalog.lower(a.actor_kind::text), pg_catalog.lower(pg_catalog.btrim(p_who))) > 0
        or pg_catalog.strpos(pg_catalog.lower(coalesce(p.representative_name, '')), pg_catalog.lower(pg_catalog.btrim(p_who))) > 0)
      and (p_details is null
        or pg_catalog.strpos(
          pg_catalog.lower(coalesce(a.reason, '')),
          pg_catalog.lower(pg_catalog.btrim(p_details))) > 0
        or exists (
          select 1
          from pg_catalog.jsonb_each(a.details) d
          where d.key = any (array[
            'timezone', 'key', 'version', 'invalidated', 'fields', 'isAdmin', 'from', 'to',
            'isEligible', 'votingType', 'draftRevision', 'completionMode', 'effectiveAt',
            'processedAt', 'electorate', 'closesAt', 'kind', 'count', 'status'])
            and pg_catalog.strpos(
              pg_catalog.lower(d.key || ': ' || d.value::text),
              pg_catalog.lower(pg_catalog.btrim(p_details))) > 0))
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
  public.list_audit_events(
    integer, bigint, text, text, timestamptz, timestamptz, text, text
  )
from public, anon;
grant execute on function
  public.list_audit_events(
    integer, bigint, text, text, timestamptz, timestamptz, text, text
  )
to authenticated;

create function public.get_audit_list_page(
  p_page integer default 1,
  p_limit integer default 25,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_page integer;
  v_pages bigint;
  v_offset bigint;
  v_position jsonb;
begin
  perform app_private.require_enabled_committee();
  if p_page is null or p_page < 1 or p_page > 1000000
     or p_limit is null or p_limit < 1 or p_limit > 100
     or p_filters is null or pg_catalog.jsonb_typeof(p_filters) <> 'object'
     or exists (
       select 1 from pg_catalog.jsonb_each(p_filters) f
       where not (f.key = any (array[
           'action', 'targetType', 'from', 'to', 'who', 'details']))
         or pg_catalog.jsonb_typeof(f.value) <> 'string'
         or (f.key in ('who', 'details') and (
           pg_catalog.length(pg_catalog.btrim(f.value #>> '{}')) < 1
           or pg_catalog.length(f.value #>> '{}') > 100))
     ) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if p_filters ? 'from' and p_filters ? 'to'
     and (p_filters->>'from')::timestamptz >= (p_filters->>'to')::timestamptz then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  with filtered as materialized (
    select a.id
    from public.audit_events a
    left join public.profiles p on p.id = a.actor_profile_id
    where (not (p_filters ? 'action') or a.action = p_filters->>'action')
      and (not (p_filters ? 'targetType') or a.target_type = p_filters->>'targetType')
      and (not (p_filters ? 'from') or a.occurred_at >= (p_filters->>'from')::timestamptz)
      and (not (p_filters ? 'to') or a.occurred_at < (p_filters->>'to')::timestamptz)
      and (not (p_filters ? 'who')
        or pg_catalog.strpos(pg_catalog.lower(a.actor_kind::text), pg_catalog.lower(pg_catalog.btrim(p_filters->>'who'))) > 0
        or pg_catalog.strpos(pg_catalog.lower(coalesce(p.representative_name, '')), pg_catalog.lower(pg_catalog.btrim(p_filters->>'who'))) > 0)
      and (not (p_filters ? 'details')
        or pg_catalog.strpos(
          pg_catalog.lower(coalesce(a.reason, '')),
          pg_catalog.lower(pg_catalog.btrim(p_filters->>'details'))) > 0
        or exists (
        select 1
        from pg_catalog.jsonb_each(a.details) d
        where d.key = any (array[
          'timezone', 'key', 'version', 'invalidated', 'fields', 'isAdmin', 'from', 'to',
          'isEligible', 'votingType', 'draftRevision', 'completionMode', 'effectiveAt',
          'processedAt', 'electorate', 'closesAt', 'kind', 'count', 'status'])
          and pg_catalog.strpos(
            pg_catalog.lower(d.key || ': ' || d.value::text),
            pg_catalog.lower(pg_catalog.btrim(p_filters->>'details'))) > 0))
  ), bounds as (select count(*) n from filtered)
  select b.n, (
    select pg_catalog.jsonb_build_object('id', f.id::text)
    from filtered f order by f.id desc
    offset greatest(0, least(p_page::bigint - 1, greatest(0, (b.n - 1) / p_limit)) * p_limit - 1)
    limit 1
  ) into v_total, v_position from bounds b;

  v_pages := greatest(1, (v_total + p_limit - 1) / p_limit);
  v_page := least(p_page::bigint, v_pages)::integer;
  v_offset := (v_page::bigint - 1) * p_limit;
  return pg_catalog.jsonb_build_object(
    'totalCount', v_total::text, 'currentPage', v_page, 'totalPages', v_pages,
    'position', case when v_offset = 0 then null else v_position end);
end
$$;

revoke all on function public.get_audit_list_page(integer, integer, jsonb)
from public, anon;
grant execute on function public.get_audit_list_page(integer, integer, jsonb)
to authenticated;

reset role;
