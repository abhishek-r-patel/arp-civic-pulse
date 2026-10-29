-- Add bounded aggregate turnout to the authorized Manage Votes table page.
set local role cp_owner;

create or replace function public.get_admin_vote_table_page(
  p_page integer default 1,
  p_limit integer default 25,
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'updated',
  p_direction text default 'desc'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order text;
  v_result jsonb;
begin
  perform app_private.require_enabled_committee();
  if p_page is null or p_page not between 1 and 1000000
    or p_limit is null or p_limit not between 1 and 100
    or p_sort is null or p_sort not in ('title','type','status','deadline','updated')
    or p_direction is null or p_direction not in ('asc','desc')
    or p_filters is null or pg_catalog.jsonb_typeof(p_filters) <> 'object' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_catalog.jsonb_each(p_filters) f
    where f.key not in ('status','votingType','titleContains','deadlineFrom','deadlineTo','changedFrom','changedTo')
      or pg_catalog.jsonb_typeof(f.value) <> 'string')
    or (p_filters ? 'status' and p_filters->>'status' not in ('DRAFT','SCHEDULED','ACTIVE','COMPLETED','CANCELLED'))
    or (p_filters ? 'votingType' and p_filters->>'votingType' not in ('PUBLIC','PRIVATE'))
    or (p_filters ? 'titleContains' and pg_catalog.length(p_filters->>'titleContains') not between 1 and 100)
    or (p_filters ? 'deadlineFrom' and p_filters ? 'deadlineTo'
      and (p_filters->>'deadlineFrom')::timestamptz >= (p_filters->>'deadlineTo')::timestamptz)
    or (p_filters ? 'changedFrom' and p_filters ? 'changedTo'
      and (p_filters->>'changedFrom')::timestamptz >= (p_filters->>'changedTo')::timestamptz) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v_order := case p_sort
    when 'title' then 'f.title'
    when 'type' then 'f.voting_type'
    when 'status' then 'f.status'
    when 'deadline' then 'f.closes_at'
    else 'f.updated_at' end;
  execute pg_catalog.format($query$
    with filtered as materialized (
      select v.id, v.title, v.voting_type, v.status, v.closes_at, v.updated_at
      from public.votes v
      where (not ($1 ? 'status') or v.status::text = $1->>'status')
        and (not ($1 ? 'votingType') or v.voting_type::text = $1->>'votingType')
        and (not ($1 ? 'titleContains') or pg_catalog.strpos(
          pg_catalog.lower(v.title), pg_catalog.lower($1->>'titleContains')) > 0)
        and (not ($1 ? 'deadlineFrom') or v.closes_at >= ($1->>'deadlineFrom')::timestamptz)
        and (not ($1 ? 'deadlineTo') or v.closes_at < ($1->>'deadlineTo')::timestamptz)
        and (not ($1 ? 'changedFrom') or v.updated_at >= ($1->>'changedFrom')::timestamptz)
        and (not ($1 ? 'changedTo') or v.updated_at < ($1->>'changedTo')::timestamptz)
    ), bounds as (
      select count(*) n, greatest(1, (count(*) + $3 - 1) / $3) pages
      from filtered
    ), page_window as (
      select n, pages, least($2::bigint, pages) page from bounds
    ), ordered as materialized (
      select f.id, f.status,
        row_number() over (order by %s %s nulls last, f.id %s) rn
      from filtered f
    ), page_rows as materialized (
      select o.id, o.status, o.rn
      from ordered o cross join page_window w
      where o.rn > (w.page - 1) * $3 and o.rn <= w.page * $3
    )
    select pg_catalog.jsonb_build_object(
      'totalCount', w.n::text, 'currentPage', w.page, 'totalPages', w.pages,
      'ids', coalesce((select pg_catalog.jsonb_agg(p.id order by p.rn)
        from page_rows p), '[]'::jsonb),
      'turnout', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', p.id,
          'eligibleCount', (select count(*)::text
            from public.electorate e where e.vote_id = p.id),
          'submittedCount', (select count(*)::text
            from public.participation pt where pt.vote_id = p.id)
        ) order by p.rn)
        from page_rows p
        where p.status in ('ACTIVE', 'COMPLETED')
      ), '[]'::jsonb)
    ) from page_window w
  $query$, v_order, p_direction, p_direction)
  into v_result using p_filters, p_page, p_limit;
  return v_result;
end;
$$;

revoke all on function public.get_admin_vote_table_page(integer, integer, jsonb, text, text)
  from public, anon, service_role;
grant execute on function public.get_admin_vote_table_page(integer, integer, jsonb, text, text)
  to authenticated;

reset role;
