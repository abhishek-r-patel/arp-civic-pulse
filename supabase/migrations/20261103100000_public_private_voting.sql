-- Renames the voting types: OPEN becomes PUBLIC (named, changeable choices)
-- and CLOSED becomes PRIVATE (secret ballot). Every routine that compared the
-- old literals is replaced with an otherwise identical body, existing votes are
-- converted, and the check constraints accept only the new values. Error codes
-- such as VOTING_CLOSED are unrelated and keep their names. Append-only audit
-- history keeps the values recorded at the time; the app labels them with the
-- new names when displaying them. Column and routine names that contain
-- "open"/"closed" (for example open_selection_mode, guard_open_response) are
-- internal identifiers and stay unchanged.

set local role cp_owner;

alter table public.votes
  drop constraint votes_voting_type_check,
  drop constraint votes_closed_single_select;

-- app_private.assert_structurally_activatable
CREATE OR REPLACE FUNCTION app_private.assert_structurally_activatable(v votes)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if v.title = '' then
    raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001', detail = 'A title is required.';
  end if;
  if v.closes_at is null or v.closes_at <= pg_catalog.clock_timestamp() then
    raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
      detail = 'The deadline must be in the future.';
  end if;
  if not exists (select 1 from public.electorate where vote_id = v.id) then
    raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
      detail = 'Select at least one eligible household.';
  end if;
  if exists (
    select 1 from public.electorate where vote_id = v.id and representative_profile_id is null
  ) then
    raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
      detail = 'The electorate snapshot is incomplete.';
  end if;

  if v.voting_type = 'PUBLIC' then
    if exists (select 1 from public.offices where vote_id = v.id) then
      raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
        detail = 'PUBLIC votes cannot have offices.';
    end if;
    if (select count(*) from public.poll_options where vote_id = v.id) < 2
       or (select count(*) <> count(distinct app_private.normalize_key(label))
           from public.poll_options where vote_id = v.id) then
      raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
        detail = 'At least two distinct options are required.';
    end if;
  else
    if coalesce(v.instructions, '') = '' then
      raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
        detail = 'Instructions are required.';
    end if;
    if exists (select 1 from public.poll_options where vote_id = v.id) then
      raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
        detail = 'PRIVATE votes cannot have poll options.';
    end if;
    if not exists (select 1 from public.offices where vote_id = v.id)
       or (select count(*) <> count(distinct app_private.normalize_key(name))
           from public.offices where vote_id = v.id)
       or exists (
         select 1 from public.offices o
         where o.vote_id = v.id
           and (not exists (select 1 from public.candidates c where c.office_id = o.id)
             or (select count(*) <> count(distinct app_private.normalize_key(c.name))
                 from public.candidates c where c.office_id = o.id))
       ) then
      raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
        detail = 'Every office needs distinct names and at least one candidate.';
    end if;
    -- One zero counter per candidate plus one abstention counter per office.
    if exists (
      select 1 from public.offices o
      where o.vote_id = v.id
        and ((select count(*) from public.closed_tallies t where t.office_id = o.id)
               <> (select count(*) from public.candidates c where c.office_id = o.id) + 1
          or (select count(*) from public.closed_tallies t
              where t.office_id = o.id and t.candidate_id is null) <> 1
          or exists (select 1 from public.closed_tallies t
                     where t.office_id = o.id and t.accepted_count <> 0))
    ) then
      raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
        detail = 'Counters were not initialized.';
    end if;
  end if;
end
$function$;

-- app_private.cast_open_vote_multiple
CREATE OR REPLACE FUNCTION app_private.cast_open_vote_multiple(p_vote_id uuid, p_submission jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v.voting_type <> 'PUBLIC' or v.open_selection_mode <> 'MULTIPLE' then
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
$function$;

-- app_private.cast_vote_single_selection
CREATE OR REPLACE FUNCTION app_private.cast_vote_single_selection(p_vote_id uuid, p_submission jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_has_participation and v.voting_type = 'PRIVATE' then
    raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
  end if;

  if v.voting_type = 'PUBLIC' then
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

  if v.voting_type = 'PUBLIC' then
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
$function$;

-- app_private.draft_blockers
CREATE OR REPLACE FUNCTION app_private.draft_blockers(v votes)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  b jsonb := '[]'::jsonb;
  s public.rwa_settings;
  v_has_settings boolean;
  v_missing text;
  v_count integer;
begin
  if v.title = '' then
    b := b || app_private.blocker('TITLE_REQUIRED', 'details', 'Add a title.');
  end if;

  select * into s from public.rwa_settings where id = 1;
  v_has_settings := found;
  if not v_has_settings then
    b := b || app_private.blocker('SETTINGS_MISSING', 'deadline',
      'The RWA name and time zone have not been set up.');
  end if;

  if v.closes_at is null then
    b := b || app_private.blocker('DEADLINE_REQUIRED', 'deadline', 'Set a deadline.');
  elsif v.closes_at <= pg_catalog.clock_timestamp() then
    b := b || app_private.blocker('DEADLINE_PAST', 'deadline', 'The deadline must be in the future.');
  end if;

  select count(*) into v_count from public.electorate where vote_id = v.id;
  if v_count = 0 then
    b := b || app_private.blocker('ELECTORATE_EMPTY', 'electorate',
      'Select at least one eligible household.');
  else
    select count(*) into v_count
    from public.electorate e
    join public.households h on h.id = e.household_id
    join public.profiles p on p.id = h.representative_profile_id
    where e.vote_id = v.id and (not h.is_eligible or p.status <> 'ENABLED');
    if v_count > 0 then
      b := b || app_private.blocker('ELECTORATE_NOT_READY', 'electorate',
        pg_catalog.format(
          '%s selected %s no longer eligible or %s a representative who is not enabled. Fix the register or remove %s.',
          v_count, case when v_count = 1 then 'household is' else 'households are' end,
          case when v_count = 1 then 'has' else 'have' end,
          case when v_count = 1 then 'it' else 'them' end));
    end if;
  end if;

  if v.voting_type = 'PUBLIC' then
    select count(*) into v_count from public.poll_options where vote_id = v.id;
    if v_count < 2 then
      b := b || app_private.blocker('OPTIONS_REQUIRED', 'ballot', 'Add at least two options.');
    end if;
  else
    if coalesce(v.instructions, '') = '' then
      b := b || app_private.blocker('INSTRUCTIONS_REQUIRED', 'details',
        'Add instructions for voters.');
    end if;
    select count(*) into v_count from public.offices where vote_id = v.id;
    if v_count = 0 then
      b := b || app_private.blocker('OFFICES_REQUIRED', 'ballot', 'Add at least one office.');
    elsif exists (
      select 1 from public.offices o
      where o.vote_id = v.id
        and not exists (select 1 from public.candidates c where c.office_id = o.id)
    ) then
      b := b || app_private.blocker('CANDIDATES_REQUIRED', 'ballot',
        'Every office needs at least one candidate.');
    end if;
  end if;

  if v_has_settings then
    select string_agg(k, ', ' order by k) into v_missing
    from unnest(array['A1','A2','A3','A4','A5','A6','A7']) as k
    where not (s.policy_approvals ? k);
    if v_missing is not null
       or s.vote_retention_days is null or s.audit_retention_days is null
       or s.inactive_profile_retention_days is null or s.rate_limit_retention_days is null
       or s.backup_retention_days is null then
      b := b || app_private.blocker('POLICY_NOT_READY', 'settings',
        'Policy approvals and retention periods are not all recorded'
        || coalesce(' (missing approvals: ' || v_missing || ')', '')
        || '. They are recorded by the deployment owner before a real vote can start.');
    end if;
  end if;

  return b;
end
$function$;

-- app_private.guard_ballot_config
CREATE OR REPLACE FUNCTION app_private.guard_ballot_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if tg_table_name in ('offices', 'candidates') and v.voting_type <> 'PRIVATE' then
    raise exception 'BALLOT_TYPE_MISMATCH' using errcode = 'P0001',
      detail = 'Offices and candidates belong to PRIVATE votes.';
  end if;
  if tg_table_name = 'poll_options' and v.voting_type <> 'PUBLIC' then
    raise exception 'BALLOT_TYPE_MISMATCH' using errcode = 'P0001',
      detail = 'Options belong to PUBLIC votes.';
  end if;

  return coalesce(new, old);
end
$function$;

-- app_private.guard_closed_tally
CREATE OR REPLACE FUNCTION app_private.guard_closed_tally()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v public.votes;
begin
  v := app_private.lock_vote(coalesce(new.vote_id, old.vote_id));
  if v.voting_type <> 'PRIVATE' then
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
$function$;

-- app_private.guard_open_response
CREATE OR REPLACE FUNCTION app_private.guard_open_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       or v.voting_type <> 'PUBLIC' or v.status <> 'ACTIVE'
       or v.closes_at <= pg_catalog.clock_timestamp() then
      raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
    end if;
    return old;
  end if;

  v := app_private.lock_vote(new.vote_id);
  if v.voting_type <> 'PUBLIC' or v.status <> 'ACTIVE'
     or v.closes_at <= pg_catalog.clock_timestamp() then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end
$function$;

-- app_private.verify_vote_invariants
CREATE OR REPLACE FUNCTION app_private.verify_vote_invariants(p_vote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if v.voting_type = 'PUBLIC' then
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
$function$;

-- public.activate_vote
CREATE OR REPLACE FUNCTION public.activate_vote(p_vote_id uuid, p_expected_revision integer, p_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v public.votes;
  s public.rwa_settings;
  v_blockers jsonb;
  v_versions jsonb;
  v_electorate integer;
begin
  if p_confirmed is distinct from true
     or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v := app_private.lock_vote(p_vote_id);
  if v.status <> 'DRAFT' then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = v.status;
  end if;
  if v.draft_revision <> p_expected_revision then
    raise exception 'STALE_REVISION' using errcode = 'P0001';
  end if;

  -- Re-read the register and settings under lock, in the documented order, so
  -- nothing the snapshot depends on can change until this transaction ends.
  perform 1 from public.households h
  where h.id in (select e.household_id from public.electorate e where e.vote_id = p_vote_id)
  order by h.id for share;
  perform 1 from public.profiles p
  where p.id in (
    select h.representative_profile_id
    from public.households h
    join public.electorate e on e.household_id = h.id
    where e.vote_id = p_vote_id)
  order by p.id for share;
  select * into s from public.rwa_settings where id = 1 for share;
  if not found then
    raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
      detail = 'The RWA name and time zone have not been set up.';
  end if;

  perform app_private.assert_policy_ready();
  v_blockers := app_private.draft_blockers(v);
  if pg_catalog.jsonb_array_length(v_blockers) > 0 then
    raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
      detail = v_blockers -> 0 ->> 'message';
  end if;

  perform pg_catalog.set_config('cp.activation', 'on', true);

  -- Freeze each household's representative as the register stands right now.
  update public.electorate e
  set representative_profile_id = h.representative_profile_id,
      representative_name_snapshot = p.representative_name,
      household_identifier_snapshot = h.identifier
  from public.households h
  join public.profiles p on p.id = h.representative_profile_id
  where e.vote_id = p_vote_id and h.id = e.household_id;
  get diagnostics v_electorate = row_count;

  -- One zero counter per candidate plus one abstention counter per office.
  if v.voting_type = 'PRIVATE' then
    insert into public.closed_tallies (vote_id, office_id, candidate_id)
    select o.vote_id, o.id, c.id
    from public.offices o join public.candidates c on c.office_id = o.id
    where o.vote_id = p_vote_id
    union all
    select o.vote_id, o.id, null
    from public.offices o where o.vote_id = p_vote_id;
  end if;

  select pg_catalog.jsonb_object_agg(k, s.policy_approvals -> k ->> 'version')
  into v_versions
  from pg_catalog.unnest(array['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']) as k;

  update public.votes
  set status = 'ACTIVE',
      activated_at = pg_catalog.clock_timestamp(),
      rwa_name_snapshot = s.name,
      timezone_snapshot = s.timezone,
      policy_versions_snapshot = v_versions
  where id = p_vote_id
  returning * into v;

  perform pg_catalog.set_config('cp.activation', 'off', true);

  perform app_private.append_audit(
    'PROFILE', v_actor, 'VOTE_ACTIVATED', 'VOTE', p_vote_id::text, null,
    pg_catalog.jsonb_build_object(
      'votingType', v.voting_type,
      'draftRevision', v.draft_revision,
      'electorate', v_electorate,
      'closesAt', v.closes_at));

  return app_private.vote_detail_json(v);
end
$function$;

-- public.cast_vote
CREATE OR REPLACE FUNCTION public.cast_vote(p_vote_id uuid, p_submission jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_type = 'PUBLIC' and v_mode = 'MULTIPLE' then
    return app_private.cast_open_vote_multiple(p_vote_id, p_submission);
  end if;
  return app_private.cast_vote_single_selection(p_vote_id, p_submission);
end
$function$;

-- public.create_draft
CREATE OR REPLACE FUNCTION public.create_draft(p_voting_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v public.votes;
begin
  if p_voting_type is null or p_voting_type not in ('PUBLIC', 'PRIVATE') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  insert into public.votes (voting_type, created_by_profile_id)
  values (p_voting_type, v_actor)
  returning * into v;

  perform app_private.append_audit(
    'PROFILE', v_actor, 'DRAFT_CREATED', 'VOTE', v.id::text, null,
    pg_catalog.jsonb_build_object('votingType', v.voting_type));

  return app_private.vote_detail_json(v);
end
$function$;

-- public.get_member_vote
CREATE OR REPLACE FUNCTION public.get_member_vote(p_vote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      and (v.voting_type = 'PUBLIC' or not coalesce(v_submitted, false)),
    'exportFormats', case when v.status = 'COMPLETED'
      then '["csv"]'::jsonb else '[]'::jsonb end);
end
$function$;

-- public.get_vote_results
CREATE OR REPLACE FUNCTION public.get_vote_results(p_vote_id uuid, p_limit integer DEFAULT 50, p_after_key text DEFAULT NULL::text, p_after_household uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if v.voting_type = 'PUBLIC' then
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
    'namedResponses', case when v.voting_type = 'PUBLIC' and v.status = 'COMPLETED'
      then v_named else null end,
    'namedPage', case when v.voting_type = 'PUBLIC' and v.status = 'COMPLETED'
      then pg_catalog.jsonb_build_object('hasMore', v_has_more) else null end);
end
$function$;

-- public.list_member_votes
CREATE OR REPLACE FUNCTION public.list_member_votes(p_status text DEFAULT NULL::text, p_voting_type text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_after_rank integer DEFAULT NULL::integer, p_after_key bigint DEFAULT NULL::bigint, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := app_private.require_enabled_member();
  v_rows jsonb;
  v_has_more boolean;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or (p_status is not null and p_status not in ('ACTIVE', 'COMPLETED', 'CANCELLED'))
     or (p_voting_type is not null and p_voting_type not in ('PUBLIC', 'PRIVATE'))
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
$function$;

-- public.update_draft
CREATE OR REPLACE FUNCTION public.update_draft(p_vote_id uuid, p_expected_revision integer, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if v_type not in ('PUBLIC', 'PRIVATE') then
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
  if v_type = 'PRIVATE' then
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

  if p_changes ? 'offices' and v_type <> 'PRIVATE'
     and pg_catalog.jsonb_typeof(p_changes -> 'offices') = 'array'
     and pg_catalog.jsonb_array_length(p_changes -> 'offices') > 0 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if p_changes ? 'options' and v_type <> 'PUBLIC'
     and pg_catalog.jsonb_typeof(p_changes -> 'options') = 'array'
     and pg_catalog.jsonb_array_length(p_changes -> 'options') > 0 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  if v_type <> v.voting_type then
    if v_type = 'PUBLIC' then
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
$function$;

-- The update guard forbids changing a vote's type; disable the user triggers
-- only for this one-time relabelling inside the migration transaction.
alter table public.votes disable trigger user;

update public.votes
set voting_type = case voting_type when 'OPEN' then 'PUBLIC' else 'PRIVATE' end
where voting_type in ('OPEN', 'CLOSED');

alter table public.votes enable trigger user;

alter table public.votes
  add constraint votes_voting_type_check
    check (voting_type in ('PUBLIC', 'PRIVATE')),
  add constraint votes_private_single_select check (
    voting_type <> 'PRIVATE'
    or (open_selection_mode = 'SINGLE' and open_selection_limit = 1)
  );

reset role;
