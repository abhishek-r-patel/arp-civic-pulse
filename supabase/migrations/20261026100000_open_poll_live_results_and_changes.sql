-- OPEN polls expose active aggregate results and allow a voter to replace their
-- own response until the locked database deadline. CLOSED elections remain
-- immutable after their first accepted submission.

set local role cp_owner;

create or replace function app_private.guard_open_response()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and not app_private.flag_is_on('cp.submission') then
    raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and not app_private.flag_is_on('cp.submission') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE'
     and (new.vote_id is distinct from old.vote_id
       or new.household_id is distinct from old.household_id) then
    raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
  end if;

  v := app_private.lock_vote(new.vote_id);
  if v.voting_type <> 'OPEN' or v.status <> 'ACTIVE'
     or v.closes_at <= pg_catalog.clock_timestamp() then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create or replace function public.get_member_vote(p_vote_id uuid)
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
      and v.closes_at > pg_catalog.clock_timestamp()
      and (v.voting_type = 'OPEN' or not coalesce(v_submitted, false)),
    'exportFormats', case when v.status = 'COMPLETED'
      then '["csv"]'::jsonb else '[]'::jsonb end);
end
$$;

create or replace function public.cast_vote(p_vote_id uuid, p_submission jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_enabled_member();
  v public.votes;
  v_household uuid;
  v_status text;
  v_key text;
  v_option uuid;
  v_item jsonb;
  v_office uuid;
  v_candidate uuid;
  v_offices uuid[] := '{}';
  v_candidates uuid[] := '{}';
  v_expected integer;
  v_rows integer;
  v_has_participation boolean;
  r record;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('statement_timeout', '15s', true);
  perform pg_catalog.set_config('synchronous_commit', 'on', true);

  if p_submission is null or pg_catalog.jsonb_typeof(p_submission) <> 'object'
     or p_submission -> 'confirmed' is distinct from 'true'::jsonb then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_submission) loop
    if v_key not in ('confirmed', 'optionId', 'selections') then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;

  select e.household_id into v_household
  from public.electorate e
  join public.votes vv on vv.id = e.vote_id
  where e.vote_id = p_vote_id
    and e.representative_profile_id = v_uid
    and vv.status <> 'DRAFT';
  if v_household is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v := app_private.lock_vote(p_vote_id);
  select p.status into v_status from public.profiles p where p.id = v_uid for share;
  if v_status is distinct from 'ENABLED' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v.status = 'ACTIVE' and v.closes_at <= pg_catalog.clock_timestamp() then
    perform app_private.complete_if_due(p_vote_id);
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'VOTING_CLOSED');
  end if;
  if v.status <> 'ACTIVE' then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.participation
    where vote_id = p_vote_id and household_id = v_household
  ) into v_has_participation;
  if v_has_participation and v.voting_type = 'CLOSED' then
    raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
  end if;

  if v.voting_type = 'OPEN' then
    if p_submission ? 'selections' or not (p_submission ? 'optionId') then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_option := app_private.json_uuid(p_submission -> 'optionId');
    if not exists (
      select 1 from public.poll_options where id = v_option and vote_id = p_vote_id
    ) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  else
    if p_submission ? 'optionId' or not (p_submission ? 'selections')
       or pg_catalog.jsonb_typeof(p_submission -> 'selections') <> 'array' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    select count(*) into v_expected from public.offices where vote_id = p_vote_id;
    if pg_catalog.jsonb_array_length(p_submission -> 'selections') <> v_expected then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;

    for v_item in select value from pg_catalog.jsonb_array_elements(p_submission -> 'selections') loop
      if pg_catalog.jsonb_typeof(v_item) <> 'object'
         or not (v_item ? 'officeId') or not (v_item ? 'candidateId') then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;
      for v_key in select pg_catalog.jsonb_object_keys(v_item) loop
        if v_key not in ('officeId', 'candidateId') then
          raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
        end if;
      end loop;

      v_office := app_private.json_uuid(v_item -> 'officeId');
      if v_office = any (v_offices)
         or not exists (select 1 from public.offices where id = v_office and vote_id = p_vote_id) then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;

      if pg_catalog.jsonb_typeof(v_item -> 'candidateId') = 'null' then
        v_candidate := null;
      else
        v_candidate := app_private.json_uuid(v_item -> 'candidateId');
        if not exists (
          select 1 from public.candidates where id = v_candidate and office_id = v_office
        ) then
          raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
        end if;
      end if;
      v_offices := pg_catalog.array_append(v_offices, v_office);
      v_candidates := pg_catalog.array_append(v_candidates, v_candidate);
    end loop;
  end if;

  if v.closes_at <= pg_catalog.clock_timestamp() then
    perform app_private.complete_if_due(p_vote_id);
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'VOTING_CLOSED');
  end if;

  perform pg_catalog.set_config('cp.submission', 'on', true);

  if v.voting_type = 'OPEN' then
    if v_has_participation then
      update public.open_responses
      set option_id = v_option
      where vote_id = p_vote_id and household_id = v_household
        and option_id is distinct from v_option;
      get diagnostics v_rows = row_count;
      if v_rows = 0 and not exists (
        select 1 from public.open_responses
        where vote_id = p_vote_id and household_id = v_household and option_id = v_option
      ) then
        raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
      end if;
    else
      insert into public.participation (vote_id, household_id)
      values (p_vote_id, v_household);
      insert into public.open_responses (vote_id, household_id, option_id)
      values (p_vote_id, v_household, v_option);
    end if;
  else
    insert into public.participation (vote_id, household_id) values (p_vote_id, v_household);
    for r in
      select t.office_id, t.candidate_id
      from rows from (pg_catalog.unnest(v_offices), pg_catalog.unnest(v_candidates))
        as t(office_id, candidate_id)
      order by t.office_id
    loop
      update public.closed_tallies
      set accepted_count = accepted_count + 1
      where vote_id = p_vote_id
        and office_id = r.office_id
        and candidate_id is not distinct from r.candidate_id;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  perform pg_catalog.set_config('cp.submission', 'off', true);
  return pg_catalog.jsonb_build_object('accepted', true, 'voteId', p_vote_id, 'submitted', true);
end
$$;

drop trigger open_responses_invariants on public.open_responses;
create constraint trigger open_responses_invariants
  after insert or update on public.open_responses
  deferrable initially deferred for each row
  execute function app_private.check_vote_invariants();

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

  if v.status <> 'COMPLETED'
     and not (v.status = 'ACTIVE' and v.voting_type = 'OPEN'
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
    'namedResponses', case when v.voting_type = 'OPEN' and v.status = 'COMPLETED'
      then v_named else null end,
    'namedPage', case when v.voting_type = 'OPEN' and v.status = 'COMPLETED'
      then pg_catalog.jsonb_build_object('hasMore', v_has_more) else null end);
end
$$;

reset role;
