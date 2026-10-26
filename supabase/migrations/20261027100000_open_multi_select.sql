-- Configurable single- or multi-select ballots for OPEN polls.
-- Participation remains one row per household; response rows hold the selected options.

set local role cp_owner;

alter table public.votes
  add column open_selection_mode text not null default 'SINGLE',
  add column open_selection_limit integer default 1;

alter table public.votes
  add constraint votes_open_selection_mode_valid
    check (open_selection_mode in ('SINGLE', 'MULTIPLE')),
  add constraint votes_open_selection_limit_valid
    check (
      (open_selection_mode = 'SINGLE' and open_selection_limit = 1)
      or (open_selection_mode = 'MULTIPLE'
          and (open_selection_limit is null or open_selection_limit between 2 and 100))
    ),
  add constraint votes_closed_single_select
    check (voting_type <> 'CLOSED'
           or (open_selection_mode = 'SINGLE' and open_selection_limit = 1));

alter table public.open_responses
  drop constraint open_responses_pkey,
  add primary key (vote_id, household_id, option_id);

create or replace function app_private.guard_open_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.votes;
begin
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

  if tg_op = 'DELETE' then
    v := app_private.lock_vote(old.vote_id);
    if app_private.flag_is_on('cp.retention')
       and app_private.retention_delete_allowed(v) then
      return old;
    end if;
    if not app_private.flag_is_on('cp.submission')
       or v.voting_type <> 'OPEN' or v.status <> 'ACTIVE'
       or v.closes_at <= pg_catalog.clock_timestamp() then
      raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
    end if;
    return old;
  end if;

  v := app_private.lock_vote(new.vote_id);
  if v.voting_type <> 'OPEN' or v.status <> 'ACTIVE'
     or v.closes_at <= pg_catalog.clock_timestamp() then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create or replace function app_private.verify_vote_invariants(p_vote_id uuid)
returns void
language plpgsql
stable
security definer
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

  select count(*) into v_participants
  from public.participation where vote_id = p_vote_id;

  if v.status = 'DRAFT' then
    if v_participants > 0
       or exists (select 1 from public.open_responses where vote_id = p_vote_id)
       or exists (select 1 from public.closed_tallies where vote_id = p_vote_id) then
      raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
    end if;
    return;
  end if;

  if v.voting_type = 'OPEN' then
    if exists (
      select 1
      from public.participation p
      where p.vote_id = p_vote_id
        and not exists (
          select 1 from public.open_responses r
          where r.vote_id = p.vote_id and r.household_id = p.household_id)
    ) or exists (
      select 1
      from public.open_responses r
      where r.vote_id = p_vote_id
      group by r.household_id
      having v.open_selection_limit is not null
        and count(*) > v.open_selection_limit
    ) or exists (
      select 1 from public.closed_tallies where vote_id = p_vote_id
    ) then
      raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
    end if;
  else
    if exists (select 1 from public.open_responses where vote_id = p_vote_id) then
      raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
    end if;
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

create or replace function app_private.check_vote_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.verify_vote_invariants(
    case when tg_op = 'DELETE' then old.vote_id else new.vote_id end);
  return null;
end
$$;

drop trigger open_responses_guard on public.open_responses;
create trigger open_responses_guard
  before insert or update or delete on public.open_responses
  for each row execute function app_private.guard_open_response();

drop trigger open_responses_invariants on public.open_responses;
create constraint trigger open_responses_invariants
  after insert or update or delete on public.open_responses
  deferrable initially deferred for each row
  execute function app_private.check_vote_invariants();

alter function app_private.vote_detail_json(public.votes)
  rename to vote_detail_json_base;
create function app_private.vote_detail_json(v public.votes)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select app_private.vote_detail_json_base(v) || pg_catalog.jsonb_build_object(
    'openSelectionMode', v.open_selection_mode,
    'openSelectionLimit', v.open_selection_limit)
$$;
revoke all on function app_private.vote_detail_json(public.votes)
from public, anon, authenticated;

alter function app_private.member_vote_json(public.votes)
  rename to member_vote_json_base;
create function app_private.member_vote_json(v public.votes)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select app_private.member_vote_json_base(v) || pg_catalog.jsonb_build_object(
    'openSelectionMode', v.open_selection_mode,
    'openSelectionLimit', v.open_selection_limit)
$$;
revoke all on function app_private.member_vote_json(public.votes)
from public, anon, authenticated;

create or replace function public.update_draft(
  p_vote_id uuid,
  p_expected_revision integer,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v public.votes;
  v_type text;
  v_title text;
  v_instructions text;
  v_closes timestamptz;
  v_selection_mode text;
  v_selection_limit integer;
  v_fields text[] := '{}';
  v_key text;
begin
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform app_private.assert_keys(
    p_changes,
    array['votingType', 'openSelectionMode', 'openSelectionLimit',
          'title', 'instructions', 'closesAt', 'eligibleHouseholdIds',
          'offices', 'options']);

  v := app_private.lock_vote(p_vote_id);
  if v.status <> 'DRAFT' then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;
  if v.draft_revision <> p_expected_revision then
    raise exception 'STALE_REVISION' using errcode = 'P0001';
  end if;
  if p_changes = '{}'::jsonb then
    return app_private.vote_detail_json(v);
  end if;

  v_type := v.voting_type;
  v_title := v.title;
  v_instructions := v.instructions;
  v_closes := v.closes_at;
  v_selection_mode := v.open_selection_mode;
  v_selection_limit := v.open_selection_limit;

  if p_changes ? 'votingType' then
    v_type := app_private.json_text(p_changes -> 'votingType');
    if v_type not in ('OPEN', 'CLOSED') then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  end if;
  if (p_changes ? 'openSelectionMode') <> (p_changes ? 'openSelectionLimit') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if p_changes ? 'openSelectionMode' then
    v_selection_mode := app_private.json_text(p_changes -> 'openSelectionMode');
    if v_selection_mode not in ('SINGLE', 'MULTIPLE') then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    if pg_catalog.jsonb_typeof(p_changes -> 'openSelectionLimit') = 'null' then
      v_selection_limit := null;
    else
      v_selection_limit := app_private.json_position(p_changes -> 'openSelectionLimit');
    end if;
  end if;
  if v_type = 'CLOSED' then
    if p_changes ? 'openSelectionMode' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_selection_mode := 'SINGLE';
    v_selection_limit := 1;
  elsif v_selection_mode = 'SINGLE' then
    if v_selection_limit is distinct from 1 then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  elsif v_selection_mode = 'MULTIPLE' then
    if v_selection_limit is not null
       and v_selection_limit not between 2 and 100 then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  else
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  if p_changes ? 'title' then
    v_title := app_private.json_text(p_changes -> 'title');
    v_title := case when pg_catalog.btrim(v_title) = '' then '' else app_private.clean_label(v_title, 300) end;
  end if;
  if p_changes ? 'instructions' then
    v_instructions := case
      when pg_catalog.jsonb_typeof(p_changes -> 'instructions') = 'null' then null
      else app_private.clean_multiline(app_private.json_text(p_changes -> 'instructions'), 10000) end;
  end if;
  if p_changes ? 'closesAt' then
    if pg_catalog.jsonb_typeof(p_changes -> 'closesAt') = 'null' then
      v_closes := null;
    else
      if (p_changes ->> 'closesAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$' then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;
      begin
        v_closes := (p_changes ->> 'closesAt')::timestamptz;
      exception
        when others then
          raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end;
    end if;
  end if;

  if p_changes ? 'offices' and v_type <> 'CLOSED'
     and pg_catalog.jsonb_typeof(p_changes -> 'offices') = 'array'
     and pg_catalog.jsonb_array_length(p_changes -> 'offices') > 0 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if p_changes ? 'options' and v_type <> 'OPEN'
     and pg_catalog.jsonb_typeof(p_changes -> 'options') = 'array'
     and pg_catalog.jsonb_array_length(p_changes -> 'options') > 0 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  if v_type <> v.voting_type then
    if v_type = 'OPEN' then
      delete from public.candidates
      where office_id in (select id from public.offices where vote_id = p_vote_id);
      delete from public.offices where vote_id = p_vote_id;
    else
      delete from public.poll_options where vote_id = p_vote_id;
    end if;
  end if;

  update public.votes
  set voting_type = v_type,
      open_selection_mode = v_selection_mode,
      open_selection_limit = v_selection_limit,
      title = v_title,
      instructions = v_instructions,
      closes_at = v_closes,
      draft_revision = draft_revision + 1
  where id = p_vote_id
  returning * into v;

  if p_changes ? 'offices' then
    perform app_private.apply_offices(p_vote_id, p_changes -> 'offices');
  end if;
  if p_changes ? 'options' then
    perform app_private.apply_options(p_vote_id, p_changes -> 'options');
  end if;
  if p_changes ? 'eligibleHouseholdIds' then
    perform app_private.apply_electorate(p_vote_id, p_changes -> 'eligibleHouseholdIds');
  end if;

  for v_key in select pg_catalog.jsonb_object_keys(p_changes) order by 1 loop
    v_fields := pg_catalog.array_append(v_fields, v_key);
  end loop;
  perform app_private.append_audit(
    'PROFILE', v_actor, 'DRAFT_UPDATED', 'VOTE', p_vote_id::text, null,
    pg_catalog.jsonb_build_object(
      'fields', pg_catalog.to_jsonb(v_fields), 'draftRevision', v.draft_revision));

  select * into v from public.votes where id = p_vote_id;
  return app_private.vote_detail_json(v);
end
$$;

alter function public.cast_vote(uuid, jsonb) set schema app_private;
alter function app_private.cast_vote(uuid, jsonb)
  rename to cast_vote_single_selection;
revoke all on function
  app_private.cast_vote_single_selection(uuid, jsonb)
from public, anon, authenticated;

create function app_private.cast_open_vote_multiple(
  p_vote_id uuid,
  p_submission jsonb
)
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
  v_item jsonb;
  v_option uuid;
  v_options uuid[] := '{}';
  v_existing_count bigint;
  v_has_participation boolean;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('statement_timeout', '15s', true);
  perform pg_catalog.set_config('synchronous_commit', 'on', true);

  perform app_private.assert_keys(p_submission, array['confirmed', 'optionIds']);
  if not (p_submission ? 'confirmed') or not (p_submission ? 'optionIds')
     or p_submission -> 'confirmed' is distinct from 'true'::jsonb
     or pg_catalog.jsonb_typeof(p_submission -> 'optionIds') <> 'array'
     or pg_catalog.jsonb_array_length(p_submission -> 'optionIds') < 1
     or pg_catalog.jsonb_array_length(p_submission -> 'optionIds') > 100 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

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
  select p.status into v_status
  from public.profiles p where p.id = v_uid for share;
  if v_status is distinct from 'ENABLED' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v.voting_type <> 'OPEN' or v.open_selection_mode <> 'MULTIPLE' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if v.status = 'ACTIVE' and v.closes_at <= pg_catalog.clock_timestamp() then
    perform app_private.complete_if_due(p_vote_id);
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'VOTING_CLOSED');
  end if;
  if v.status <> 'ACTIVE' then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;

  for v_item in
    select value from pg_catalog.jsonb_array_elements(p_submission -> 'optionIds')
  loop
    v_option := app_private.json_uuid(v_item);
    if v_option = any(v_options)
       or not exists (
         select 1 from public.poll_options
         where id = v_option and vote_id = p_vote_id) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_options := pg_catalog.array_append(v_options, v_option);
  end loop;
  if v.open_selection_limit is not null
     and pg_catalog.cardinality(v_options) > v.open_selection_limit then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  select exists (
    select 1 from public.participation
    where vote_id = p_vote_id and household_id = v_household
  ) into v_has_participation;
  select count(*) into v_existing_count
  from public.open_responses
  where vote_id = p_vote_id and household_id = v_household;
  if (v_has_participation and v_existing_count = 0)
     or (not v_has_participation and v_existing_count > 0)
     or (v.open_selection_limit is not null
         and v_existing_count > v.open_selection_limit) then
    raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
  end if;

  if v.closes_at <= pg_catalog.clock_timestamp() then
    perform app_private.complete_if_due(p_vote_id);
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'VOTING_CLOSED');
  end if;

  perform pg_catalog.set_config('cp.submission', 'on', true);
  if v_has_participation then
    delete from public.open_responses
    where vote_id = p_vote_id and household_id = v_household;
  else
    insert into public.participation (vote_id, household_id)
    values (p_vote_id, v_household);
  end if;

  insert into public.open_responses (vote_id, household_id, option_id)
  select p_vote_id, v_household, selected.option_id
  from pg_catalog.unnest(v_options) as selected(option_id);

  perform pg_catalog.set_config('cp.submission', 'off', true);
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'voteId', p_vote_id, 'submitted', true);
end
$$;
revoke all on function app_private.cast_open_vote_multiple(uuid, jsonb)
from public, anon, authenticated;

create function public.cast_vote(p_vote_id uuid, p_submission jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_enabled_member();
  v_type text;
  v_mode text;
begin
  select voting_type, open_selection_mode into v_type, v_mode
  from public.votes where id = p_vote_id and status <> 'DRAFT';
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_type = 'OPEN' and v_mode = 'MULTIPLE' then
    return app_private.cast_open_vote_multiple(p_vote_id, p_submission);
  end if;
  return app_private.cast_vote_single_selection(p_vote_id, p_submission);
end
$$;

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

revoke all on function public.cast_vote(uuid, jsonb) from public, anon;
grant execute on function public.cast_vote(uuid, jsonb) to authenticated;
revoke all on function public.update_draft(uuid, integer, jsonb) from public, anon;
grant execute on function public.update_draft(uuid, integer, jsonb) to authenticated;

reset role;
