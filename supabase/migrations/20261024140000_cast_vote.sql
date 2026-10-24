-- Atomic, guarded submission (docs/API.md section 4.2, docs/DATABASE.md "Submission",
-- docs/IMPLEMENTATION_PLAN.md phase 11).
--
-- cast_vote runs with the signed-in member's own session. Identity comes only
-- from the verified JWT; the household comes only from the frozen electorate.
-- Participation and the choice (one OPEN response, or every CLOSED counter
-- increment) commit together or not at all. The deadline is judged by the
-- database clock after every admission lock is held, immediately before
-- acceptance. A transaction admitted strictly before the deadline may commit
-- afterwards; one that waited past it is refused.
--
-- Nothing here returns, logs or audits a selection, and no per-ballot record
-- exists for CLOSED votes: only aggregate counters change.

set local role cp_owner;

-- The structural activation guard must look only at the vote being activated.
-- It previously inspected EVERY office and counter in the database, so one
-- CLOSED vote with non-zero counters (or any other draft with an empty office)
-- would have blocked the activation of every other CLOSED vote.
create or replace function app_private.assert_structurally_activatable(v public.votes)
returns void
language plpgsql
stable
set search_path = ''
as $$
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

  if v.voting_type = 'OPEN' then
    if exists (select 1 from public.offices where vote_id = v.id) then
      raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
        detail = 'OPEN votes cannot have offices.';
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
        detail = 'CLOSED votes cannot have poll options.';
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
$$;

-- Same defect in the Phase 9 preview blockers: "every office needs a candidate"
-- looked at offices of every vote, so another draft's empty office showed up as
-- a blocker here and (through activate_vote) refused this vote's activation.
create or replace function app_private.draft_blockers(v public.votes)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
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

  if v.voting_type = 'OPEN' then
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
$$;

-- ---------------------------------------------------------------------------
-- submission
-- ---------------------------------------------------------------------------

create function public.cast_vote(p_vote_id uuid, p_submission jsonb)
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
  r record;
begin
  -- Bounded waits: a stuck lock or runaway statement becomes a retryable 503,
  -- never an unbounded hang. Accepted submissions are always durably committed.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('statement_timeout', '15s', true);
  perform pg_catalog.set_config('synchronous_commit', 'on', true);

  -- Shape first (cheap, and nothing is locked yet). Identity, timestamps,
  -- counts and idempotency identifiers are never accepted.
  if p_submission is null or pg_catalog.jsonb_typeof(p_submission) <> 'object'
     or p_submission -> 'confirmed' is distinct from 'true'::jsonb then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_submission) loop
    if v_key not in ('confirmed', 'optionId', 'selections') then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;

  -- Entitlement is read without locking, so a caller who is not in this vote's
  -- frozen electorate (or names a draft or unknown vote) cannot contend for its
  -- lock, and cannot tell which of those it was.
  select e.household_id into v_household
  from public.electorate e
  join public.votes vv on vv.id = e.vote_id
  where e.vote_id = p_vote_id
    and e.representative_profile_id = v_uid
    and vv.status <> 'DRAFT';
  if v_household is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Lock order: the vote, then the caller's profile.
  v := app_private.lock_vote(p_vote_id);
  select p.status into v_status from public.profiles p where p.id = v_uid for share;
  if v_status is distinct from 'ENABLED' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Overdue: complete the vote at its deadline and COMMIT that, then refuse.
  -- Raising here would roll the reconciliation back.
  if v.status = 'ACTIVE' and v.closes_at <= pg_catalog.clock_timestamp() then
    perform app_private.complete_if_due(p_vote_id);
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'VOTING_CLOSED');
  end if;
  if v.status <> 'ACTIVE' then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.participation
    where vote_id = p_vote_id and household_id = v_household
  ) then
    raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
  end if;

  -- Validate the complete, type-specific ballot against the frozen configuration.
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
      -- Count matches and every office is distinct and ours, so none is missing.
      if v_office = any (v_offices)
         or not exists (select 1 from public.offices where id = v_office and vote_id = p_vote_id) then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;

      -- Explicit null is an abstention; a UUID must be a candidate of THIS office.
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

  -- Authoritative deadline check: after every admission lock, immediately
  -- before acceptance. A request that waited past the cutoff is refused.
  if v.closes_at <= pg_catalog.clock_timestamp() then
    perform app_private.complete_if_due(p_vote_id);
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'VOTING_CLOSED');
  end if;

  perform pg_catalog.set_config('cp.submission', 'on', true);

  begin
    insert into public.participation (vote_id, household_id) values (p_vote_id, v_household);
  exception
    when unique_violation then
      raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
  end;

  if v.voting_type = 'OPEN' then
    insert into public.open_responses (vote_id, household_id, option_id)
    values (p_vote_id, v_household, v_option);
  else
    -- Counters are updated in stable office-id order, one increment each.
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

  -- Participation only: never the selection, a timestamp, or a receipt.
  return pg_catalog.jsonb_build_object('accepted', true, 'voteId', p_vote_id, 'submitted', true);
end
$$;

-- Own submission status, for recovering from an uncertain network outcome.
create function public.get_my_participation(p_vote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_enabled_member();
  v_household uuid;
  v_status text;
begin
  select e.household_id, vv.status into v_household, v_status
  from public.electorate e
  join public.votes vv on vv.id = e.vote_id
  where e.vote_id = p_vote_id
    and e.representative_profile_id = v_uid
    and vv.status <> 'DRAFT';
  if v_household is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'voteId', p_vote_id,
    'status', v_status,
    'submitted', exists (
      select 1 from public.participation
      where vote_id = p_vote_id and household_id = v_household));
end
$$;

revoke all on function
  public.cast_vote(uuid, jsonb),
  public.get_my_participation(uuid)
from public, anon;
grant execute on function
  public.cast_vote(uuid, jsonb),
  public.get_my_participation(uuid)
to authenticated;

reset role;
