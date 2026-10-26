-- Publish aggregate turnout for active CLOSED elections without exposing choices.
-- Household-level participation remains limited to the administrator monitor.

set local role cp_owner;

create or replace function public.get_vote_results(
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

  select * into v from public.votes
  where id = p_vote_id and status <> 'DRAFT' for share;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_entitled := exists (
    select 1 from public.electorate e
    where e.vote_id = p_vote_id and e.representative_profile_id = v_uid);
  if not v_entitled and not app_private.is_enabled_admin() then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v.status <> 'COMPLETED'
     and not (v.status = 'ACTIVE'
       and v.closes_at > pg_catalog.clock_timestamp()
       and p_limit is not null) then
    raise exception 'RESULTS_UNAVAILABLE' using errcode = 'P0001', detail = v.status;
  end if;

  begin
    perform app_private.verify_vote_invariants(p_vote_id);
  exception
    when others then
      raise exception 'RESULTS_INTEGRITY_ERROR' using errcode = 'P0001';
  end;

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

    if v.status = 'COMPLETED' then
      select coalesce(pg_catalog.jsonb_agg(n.row_json order by n.ident, n.household_id), '[]'::jsonb)
      into v_named
      from (
        select
          e.household_identifier_snapshot as ident,
          e.household_id,
          pg_catalog.jsonb_build_object(
            'representativeName', e.representative_name_snapshot,
            'householdIdentifier', e.household_identifier_snapshot,
            'optionLabels', pg_catalog.jsonb_agg(o.label order by o.position),
            'cursor', pg_catalog.jsonb_build_object(
              'key', e.household_identifier_snapshot, 'householdId', e.household_id)) as row_json
        from public.open_responses r
        join public.electorate e
          on e.vote_id = r.vote_id and e.household_id = r.household_id
        join public.poll_options o on o.id = r.option_id
        where r.vote_id = p_vote_id
          and (p_after_key is null
               or (e.household_identifier_snapshot, e.household_id)
                  > (p_after_key, p_after_household))
        group by e.household_identifier_snapshot, e.household_id,
                 e.representative_name_snapshot
        order by e.household_identifier_snapshot, e.household_id
        limit coalesce(p_limit + 1, 2147483647)
      ) n;

      if p_limit is not null and pg_catalog.jsonb_array_length(v_named) > p_limit then
        v_has_more := true;
        v_named := v_named - p_limit;
      end if;
    end if;
  elsif v.status = 'COMPLETED' then
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', o.id, 'name', o.name, 'position', o.position,
        'notaCount', (select coalesce(sum(t.accepted_count), 0) from public.closed_tallies t
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
    'namedResponses', case when v.voting_type = 'OPEN' and v.status = 'COMPLETED'
      then v_named else null end,
    'namedPage', case when v.voting_type = 'OPEN' and v.status = 'COMPLETED'
      then pg_catalog.jsonb_build_object('hasMore', v_has_more) else null end);
end
$$;

reset role;
