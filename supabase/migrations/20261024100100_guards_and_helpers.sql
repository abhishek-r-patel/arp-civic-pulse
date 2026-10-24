-- Guards, authorization helpers and invariant checks (docs/DATABASE.md sections 5 and 7).
--
-- Error convention: protected routines raise an exception whose MESSAGE is a
-- stable uppercase code (VOTE_FROZEN, FORBIDDEN, ...) with SQLSTATE P0001, so
-- the server can map it to the API error vocabulary without parsing prose.
-- DETAIL, when present, is a safe human-readable blocker and never a value.

set local role cp_owner;

-- ---------------------------------------------------------------------------
-- Authorization helpers (security definer, non-recursive, fixed search_path)
-- ---------------------------------------------------------------------------

create function app_private.is_enabled_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = app_private.current_uid() and p.status = 'ENABLED'
  )
$$;

create function app_private.is_enabled_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = app_private.current_uid() and p.status = 'ENABLED' and p.is_admin
  )
$$;

-- Own frozen entitlement to a vote (never a draft, never historical reassignment).
create function app_private.has_entitlement(p_vote_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.electorate e
    join public.votes v on v.id = e.vote_id
    join public.profiles p on p.id = e.representative_profile_id
    where e.vote_id = p_vote_id
      and e.representative_profile_id = app_private.current_uid()
      and p.status = 'ENABLED'
      and v.status <> 'DRAFT'
  )
$$;

create function app_private.can_view_vote(p_vote_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_enabled_admin() or app_private.has_entitlement(p_vote_id)
$$;

create function app_private.can_view_office(p_office_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.offices o
    where o.id = p_office_id and app_private.can_view_vote(o.vote_id)
  )
$$;

create function app_private.owns_participation(p_vote_id uuid, p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.electorate e
    join public.profiles p on p.id = e.representative_profile_id
    where e.vote_id = p_vote_id
      and e.household_id = p_household_id
      and e.representative_profile_id = app_private.current_uid()
      and p.status = 'ENABLED'
  )
$$;

-- Guards for protected routines: identity comes only from the verified JWT.
create function app_private.require_enabled_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.current_uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ENABLED') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return v_uid;
end
$$;

create function app_private.require_enabled_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.current_uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles where id = v_uid and status = 'ENABLED' and is_admin
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return v_uid;
end
$$;

-- ---------------------------------------------------------------------------
-- Generic helpers and triggers
-- ---------------------------------------------------------------------------

create function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

create trigger rwa_settings_touch before update on public.rwa_settings
  for each row execute function app_private.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function app_private.touch_updated_at();
create trigger households_touch before update on public.households
  for each row execute function app_private.touch_updated_at();

-- Profile identity is stable; DELETED is terminal so frozen references stay meaningful.
create function app_private.guard_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'IMMUTABLE_IDENTITY' using errcode = 'P0001';
  end if;
  if old.status = 'DELETED' and new.status <> 'DELETED' then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001',
      detail = 'A deleted profile cannot be restored.';
  end if;
  return new;
end
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function app_private.guard_profile();

-- Append-only and protected tables cannot be truncated or edited ad hoc.
create function app_private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
end
$$;

create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function app_private.forbid_mutation();

create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function app_private.forbid_mutation();
create trigger participation_no_truncate before truncate on public.participation
  for each statement execute function app_private.forbid_mutation();
create trigger open_responses_no_truncate before truncate on public.open_responses
  for each statement execute function app_private.forbid_mutation();
create trigger closed_tallies_no_truncate before truncate on public.closed_tallies
  for each statement execute function app_private.forbid_mutation();
create trigger votes_no_truncate before truncate on public.votes
  for each statement execute function app_private.forbid_mutation();

-- Submission and activation routines mark their own transaction. These flags
-- guard against ad hoc writes; they are not an authorization mechanism.
create function app_private.flag_is_on(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.current_setting(p_name, true), '') = 'on'
$$;

-- ---------------------------------------------------------------------------
-- Activation readiness (structural freeze guard on DRAFT -> ACTIVE)
-- ---------------------------------------------------------------------------

create function app_private.assert_structurally_activatable(v public.votes)
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
         where not exists (select 1 from public.candidates c where c.office_id = o.id)
            or (select count(*) <> count(distinct app_private.normalize_key(c.name))
                from public.candidates c where c.office_id = o.id)
       ) then
      raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
        detail = 'Every office needs distinct names and at least one candidate.';
    end if;
    -- One zero counter per candidate plus one abstention counter per office.
    if exists (
      select 1 from public.offices o
      where (select count(*) from public.closed_tallies t where t.office_id = o.id)
              <> (select count(*) from public.candidates c where c.office_id = o.id) + 1
         or (select count(*) from public.closed_tallies t
             where t.office_id = o.id and t.candidate_id is null) <> 1
         or exists (select 1 from public.closed_tallies t
                    where t.office_id = o.id and t.accepted_count <> 0)
    ) then
      raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
        detail = 'Counters were not initialized.';
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- votes: lifecycle transitions and freezing
-- ---------------------------------------------------------------------------

create function app_private.guard_vote_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'IMMUTABLE_IDENTITY' using errcode = 'P0001';
  end if;

  if old.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001',
      detail = 'Terminal votes cannot change.';
  end if;

  if new.status <> old.status
     and not ((old.status = 'DRAFT' and new.status = 'ACTIVE')
           or (old.status = 'ACTIVE' and new.status in ('COMPLETED', 'CANCELLED'))) then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001',
      detail = 'That status transition is not allowed.';
  end if;

  if old.status = 'ACTIVE'
     and (new.voting_type is distinct from old.voting_type
       or new.title is distinct from old.title
       or new.instructions is distinct from old.instructions
       or new.closes_at is distinct from old.closes_at
       or new.draft_revision is distinct from old.draft_revision
       or new.created_by_profile_id is distinct from old.created_by_profile_id
       or new.created_at is distinct from old.created_at
       or new.activated_at is distinct from old.activated_at
       or new.rwa_name_snapshot is distinct from old.rwa_name_snapshot
       or new.timezone_snapshot is distinct from old.timezone_snapshot
       or new.policy_versions_snapshot is distinct from old.policy_versions_snapshot) then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;

  if old.status = 'DRAFT' then
    if new.created_by_profile_id is distinct from old.created_by_profile_id
       or new.created_at is distinct from old.created_at then
      raise exception 'IMMUTABLE_IDENTITY' using errcode = 'P0001';
    end if;
    -- Every draft edit advances the revision by exactly one; lifecycle changes may not.
    if new.status = 'DRAFT'
       and new.draft_revision not in (old.draft_revision, old.draft_revision + 1) then
      raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001',
        detail = 'The draft revision can only advance by one.';
    end if;
    if new.status = 'ACTIVE' then
      if new.draft_revision is distinct from old.draft_revision
         or new.voting_type is distinct from old.voting_type then
        raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
          detail = 'Activation cannot change the draft.';
      end if;
      perform app_private.assert_structurally_activatable(new);
    end if;
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end
$$;

create trigger votes_guard before update on public.votes
  for each row execute function app_private.guard_vote_update();

-- Live and terminal votes are never deleted here; retention deletion is a
-- separately reviewed operation.
create function app_private.guard_vote_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'DRAFT' then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;
  return old;
end
$$;

create trigger votes_guard_delete before delete on public.votes
  for each row execute function app_private.guard_vote_delete();

-- Votes are always born as revision-1 drafts; activation is the only way in.
create function app_private.guard_vote_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'DRAFT' or new.draft_revision <> 1 then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001',
      detail = 'Votes are created as drafts.';
  end if;
  return new;
end
$$;

create trigger votes_guard_insert before insert on public.votes
  for each row execute function app_private.guard_vote_insert();

-- ---------------------------------------------------------------------------
-- Child guards: lock the parent vote first, then check type and state
-- ---------------------------------------------------------------------------

create function app_private.lock_vote(p_vote_id uuid)
returns public.votes
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
begin
  select * into v from public.votes where id = p_vote_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v;
end
$$;

create function app_private.guard_ballot_config()
returns trigger
language plpgsql
set search_path = ''
as $$
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

  if v.status <> 'DRAFT' then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;
  if tg_table_name in ('offices', 'candidates') and v.voting_type <> 'CLOSED' then
    raise exception 'BALLOT_TYPE_MISMATCH' using errcode = 'P0001',
      detail = 'Offices and candidates belong to CLOSED votes.';
  end if;
  if tg_table_name = 'poll_options' and v.voting_type <> 'OPEN' then
    raise exception 'BALLOT_TYPE_MISMATCH' using errcode = 'P0001',
      detail = 'Options belong to OPEN votes.';
  end if;

  return coalesce(new, old);
end
$$;

create trigger offices_guard before insert or update or delete on public.offices
  for each row execute function app_private.guard_ballot_config();
create trigger candidates_guard before insert or update or delete on public.candidates
  for each row execute function app_private.guard_ballot_config();
create trigger poll_options_guard before insert or update or delete on public.poll_options
  for each row execute function app_private.guard_ballot_config();

-- Electorate rows are editable only while drafting. Snapshots must match the
-- current register at the moment they are taken (activation locks both).
create function app_private.guard_electorate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
  h public.households;
  p public.profiles;
begin
  v := app_private.lock_vote(coalesce(new.vote_id, old.vote_id));
  if v.status <> 'DRAFT' then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.vote_id <> old.vote_id or new.household_id <> old.household_id) then
    raise exception 'IMMUTABLE_IDENTITY' using errcode = 'P0001';
  end if;

  if new.representative_profile_id is not null then
    select * into h from public.households where id = new.household_id;
    select * into p from public.profiles where id = new.representative_profile_id;
    if not h.is_eligible
       or h.representative_profile_id is distinct from new.representative_profile_id
       or p.status <> 'ENABLED'
       or new.representative_name_snapshot is distinct from p.representative_name
       or new.household_identifier_snapshot is distinct from h.identifier then
      raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
        detail = 'Snapshots must match an eligible household with an enabled representative.';
    end if;
  end if;

  return new;
end
$$;

create trigger electorate_guard before insert or update or delete on public.electorate
  for each row execute function app_private.guard_electorate();

-- Participation: submission routine only, active vote, strictly before the deadline.
create function app_private.guard_participation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
begin
  if tg_op <> 'INSERT' then
    raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
  end if;
  if not app_private.flag_is_on('cp.submission') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v := app_private.lock_vote(new.vote_id);
  if v.status <> 'ACTIVE' or v.closes_at <= pg_catalog.clock_timestamp() then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger participation_guard before insert or update or delete on public.participation
  for each row execute function app_private.guard_participation();

create function app_private.guard_open_response()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
begin
  if tg_op <> 'INSERT' then
    raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
  end if;
  if not app_private.flag_is_on('cp.submission') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v := app_private.lock_vote(new.vote_id);
  if v.voting_type <> 'OPEN' or v.status <> 'ACTIVE' then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger open_responses_guard before insert or update or delete on public.open_responses
  for each row execute function app_private.guard_open_response();

-- Counters: created at activation, then only incremented by one per submission.
create function app_private.guard_closed_tally()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v public.votes;
begin
  v := app_private.lock_vote(coalesce(new.vote_id, old.vote_id));
  if v.voting_type <> 'CLOSED' then
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

  if v.status <> 'DRAFT' then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;
  return old;
end
$$;

create trigger closed_tallies_guard before insert or update or delete on public.closed_tallies
  for each row execute function app_private.guard_closed_tally();

-- ---------------------------------------------------------------------------
-- Invariant verification (deferred at commit; reused at completion/publication)
-- ---------------------------------------------------------------------------

create function app_private.verify_vote_invariants(p_vote_id uuid)
returns void
language plpgsql
stable
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

  select count(*) into v_participants from public.participation where vote_id = p_vote_id;

  if v.status = 'DRAFT' then
    if v_participants > 0
       or exists (select 1 from public.open_responses where vote_id = p_vote_id)
       or exists (select 1 from public.closed_tallies where vote_id = p_vote_id) then
      raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
    end if;
    return;
  end if;

  if v.voting_type = 'OPEN' then
    if v_participants <> (select count(*) from public.open_responses where vote_id = p_vote_id)
       or exists (select 1 from public.closed_tallies where vote_id = p_vote_id) then
      raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
    end if;
  else
    if exists (select 1 from public.open_responses where vote_id = p_vote_id) then
      raise exception 'INVARIANT_VIOLATION' using errcode = 'P0001';
    end if;
    -- Counter membership matches the frozen candidates plus one abstention per office.
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

create function app_private.check_vote_invariants()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app_private.verify_vote_invariants(new.vote_id);
  return null;
end
$$;

create function app_private.check_vote_invariants_on_vote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app_private.verify_vote_invariants(new.id);
  return null;
end
$$;

create constraint trigger participation_invariants
  after insert on public.participation
  deferrable initially deferred for each row
  execute function app_private.check_vote_invariants();
create constraint trigger open_responses_invariants
  after insert on public.open_responses
  deferrable initially deferred for each row
  execute function app_private.check_vote_invariants();
create constraint trigger closed_tallies_invariants
  after insert or update on public.closed_tallies
  deferrable initially deferred for each row
  execute function app_private.check_vote_invariants();
create constraint trigger votes_invariants
  after update of status on public.votes
  deferrable initially deferred for each row
  execute function app_private.check_vote_invariants_on_vote();

reset role;
