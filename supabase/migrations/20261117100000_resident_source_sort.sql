-- Sort registration source globally before the resident table page is selected.
set local role cp_owner;

create or replace function public.get_resident_table_page(
  p_page integer default 1,
  p_limit integer default 25,
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'household',
  p_direction text default 'asc'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order text;
  v_identifier text;
  v_contains text;
  v_result jsonb;
begin
  perform app_private.require_enabled_committee();
  if p_page is null or p_page not between 1 and 1000000
    or p_limit is null or p_limit not between 1 and 100
    or p_sort is null or p_sort not in ('representative','household','status','source','role','eligibility','updated')
    or p_direction is null or p_direction not in ('asc','desc')
    or p_filters is null or pg_catalog.jsonb_typeof(p_filters) <> 'object' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_catalog.jsonb_each(p_filters) f
    where f.key not in ('status','isAdmin','isReadonly','selfRegistered','identifier','identifierContains','isEligible','hasHousehold','representative','changedFrom','changedTo')
    or pg_catalog.jsonb_typeof(f.value) <> case
      when f.key in ('isAdmin','isReadonly','selfRegistered','isEligible','hasHousehold') then 'boolean'
      else 'string' end)
    or (p_filters ? 'status' and p_filters->>'status' not in ('ENABLED','SUSPENDED','DELETED'))
    or pg_catalog.length(p_filters->>'representative') > 200
    or (p_filters->>'changedFrom')::timestamptz >= (p_filters->>'changedTo')::timestamptz then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if p_filters ? 'identifier' then
    v_identifier := public.normalize_household_identifier(p_filters->>'identifier');
  end if;
  if p_filters ? 'identifierContains' then
    v_contains := public.normalize_household_identifier(p_filters->>'identifierContains');
    if pg_catalog.length(v_contains) not between 1 and 100 then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  end if;
  -- Only constant allowlisted expressions and the validated direction enter SQL.
  v_order := case p_sort
    when 'representative' then 'pg_catalog.lower(d.representative_name)'
    when 'household' then 'd.household_identifier_normalized'
    when 'status' then 'd.status'
    when 'source' then 'd.self_registered'
    when 'role' then 'case when d.is_admin then ''RWA Admin'' when p.is_app_support then ''App Support'' when d.is_readonly then ''RWA ReadOnly'' else ''Voter'' end'
    when 'eligibility' then 'd.household_is_eligible'
    else 'd.updated_at' end;
  execute pg_catalog.format($query$
    with filtered as materialized (
      select d.id,
        row_number() over (order by %s %s nulls last,
          pg_catalog.lower(d.representative_name), d.id) rn
      from public.resident_directory d join public.profiles p on p.id = d.id
      where (not ($1 ? 'status') or d.status = $1->>'status')
        and (not ($1 ? 'isAdmin') or d.is_admin = ($1->>'isAdmin')::boolean)
        and (not ($1 ? 'isReadonly') or d.is_readonly = ($1->>'isReadonly')::boolean)
        and (not ($1 ? 'selfRegistered') or d.self_registered = ($1->>'selfRegistered')::boolean)
        and ($2 is null or d.household_identifier_normalized = $2)
        and ($5 is null or pg_catalog.strpos(d.household_identifier_normalized, $5) > 0)
        and (not ($1 ? 'isEligible') or d.household_is_eligible = ($1->>'isEligible')::boolean)
        and (not ($1 ? 'hasHousehold') or (d.household_id is not null) = ($1->>'hasHousehold')::boolean)
        and (not ($1 ? 'representative') or pg_catalog.strpos(
          pg_catalog.lower(d.representative_name), pg_catalog.lower($1->>'representative')) > 0)
        and (not ($1 ? 'changedFrom') or d.updated_at >= ($1->>'changedFrom')::timestamptz)
        and (not ($1 ? 'changedTo') or d.updated_at < ($1->>'changedTo')::timestamptz)
    ), bounds as (
      select count(*) n, greatest(1, (count(*) + $4 - 1) / $4) pages from filtered
    ), page_window as (
      select n, pages, least($3::bigint, pages) page from bounds
    )
    select pg_catalog.jsonb_build_object(
      'totalCount', w.n::text, 'currentPage', w.page, 'totalPages', w.pages,
      'ids', coalesce((select pg_catalog.jsonb_agg(f.id order by f.rn)
        from filtered f where f.rn > (w.page - 1) * $4 and f.rn <= w.page * $4), '[]'::jsonb)
    ) from page_window w
  $query$, v_order, p_direction)
  into v_result using p_filters, v_identifier, p_page, p_limit, v_contains;
  return v_result;
end;
$$;

revoke all on function public.get_resident_table_page(integer, integer, jsonb, text, text)
  from public, anon, service_role;
grant execute on function public.get_resident_table_page(integer, integer, jsonb, text, text)
  to authenticated;

reset role;
