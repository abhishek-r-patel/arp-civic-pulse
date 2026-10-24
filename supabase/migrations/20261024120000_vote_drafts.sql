-- Revision-safe drafts and resident preview (docs/API.md section 4.4, docs/IMPLEMENTATION_PLAN.md phase 9).
--
-- Drafts are written only through these guarded routines, called with the
-- administrator's own session. Each routine re-derives the caller from the
-- verified JWT, requires a CURRENT enabled administrator, validates every
-- field itself (the database, not the web tier, is the authority), locks the
-- parent vote before any child, checks the expected revision, applies the
-- change and its audit event in one transaction, and increments the revision
-- exactly once per edit. Preview is read-only: it never changes the revision.

set local role cp_owner;

-- Reordering or swapping positions inside one atomic replace needs the
-- uniqueness check to run at the end of the statement batch, not per row.
alter table public.offices
  drop constraint offices_vote_id_position_key,
  add constraint offices_vote_id_position_key unique (vote_id, position)
    deferrable initially immediate;
alter table public.candidates
  drop constraint candidates_office_id_position_key,
  add constraint candidates_office_id_position_key unique (office_id, position)
    deferrable initially immediate;
alter table public.poll_options
  drop constraint poll_options_vote_id_position_key,
  add constraint poll_options_vote_id_position_key unique (vote_id, position)
    deferrable initially immediate;

-- ---------------------------------------------------------------------------
-- input helpers
-- ---------------------------------------------------------------------------

create function app_private.clean_label(p_value text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select app_private.clean_text(normalize(p_value, nfc), p_max)
$$;

-- Multi-line plain text: tab and line feed are allowed; carriage returns are normalised.
create function app_private.clean_multiline(p_value text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text := pg_catalog.btrim(
    normalize(
      pg_catalog.replace(pg_catalog.replace(p_value, E'\r\n', E'\n'), E'\r', E'\n'),
      nfc));
begin
  if v_value is null or v_value = ''
     or pg_catalog.char_length(v_value) > p_max
     or v_value ~ '[\x01-\x08\x0b-\x1f\x7f-\x9f]'
     or v_value ~* '</?[a-z!][^>]*>' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  return v_value;
end
$$;

create function app_private.json_text(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) <> 'string' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  return p_value #>> '{}';
end
$$;

create function app_private.json_uuid(p_value jsonb)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return app_private.json_text(p_value)::uuid;
exception
  when invalid_text_representation then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
end
$$;

create function app_private.json_position(p_value jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) <> 'number'
     or (p_value #>> '{}') !~ '^[1-9][0-9]{0,9}$'
     or (p_value #>> '{}')::bigint > 2147483647 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  return (p_value #>> '{}')::integer;
end
$$;

create function app_private.assert_keys(p_value jsonb, p_allowed text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) <> 'object' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_value) loop
    if not (v_key = any (p_allowed)) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- projections
-- ---------------------------------------------------------------------------

create function app_private.vote_detail_json(v public.votes)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', v.id,
    'votingType', v.voting_type,
    'status', v.status,
    'title', v.title,
    'instructions', v.instructions,
    'closesAt', v.closes_at,
    'draftRevision', v.draft_revision,
    'createdAt', v.created_at,
    'updatedAt', v.updated_at,
    'activatedAt', v.activated_at,
    'completedAt', v.completed_at,
    'completionMode', v.completion_mode,
    'completionReason', v.completion_reason,
    'cancelledAt', v.cancelled_at,
    'cancellationReason', v.cancellation_reason,
    'rwaName', coalesce(v.rwa_name_snapshot, (select s.name from public.rwa_settings s where s.id = 1)),
    'timezone', coalesce(v.timezone_snapshot, (select s.timezone from public.rwa_settings s where s.id = 1)),
    'offices', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', o.id, 'name', o.name, 'position', o.position,
          'candidates', coalesce((
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object('id', c.id, 'name', c.name, 'position', c.position)
              order by c.position)
            from public.candidates c where c.office_id = o.id), '[]'::jsonb))
        order by o.position)
      from public.offices o where o.vote_id = v.id), '[]'::jsonb),
    'options', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', p.id, 'label', p.label, 'position', p.position)
        order by p.position)
      from public.poll_options p where p.vote_id = v.id), '[]'::jsonb),
    'eligibleHouseholdIds', coalesce((
      select pg_catalog.jsonb_agg(e.household_id order by e.household_id)
      from public.electorate e where e.vote_id = v.id), '[]'::jsonb))
$$;

create function app_private.blocker(p_code text, p_section text, p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('code', p_code, 'section', p_section, 'message', p_message)
$$;

-- Safe, human-readable reasons a draft cannot be activated right now. Mirrors
-- the structural freeze guard and adds the register and settings checks that
-- activation re-reads under lock. A clear list is advice, never a guarantee.
create function app_private.draft_blockers(v public.votes)
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
      where not exists (select 1 from public.candidates c where c.office_id = o.id)
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
-- collection replacement (validate everything, then apply)
-- ---------------------------------------------------------------------------

create function app_private.apply_offices(p_vote_id uuid, p_offices jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_office jsonb;
  v_cand jsonb;
  v_office_id uuid;
  v_cand_id uuid;
  v_name text;
  v_pos integer;
  v_office_ids uuid[] := '{}';
  v_office_pos integer[] := '{}';
  v_office_keys text[] := '{}';
  v_cand_pos integer[];
  v_cand_keys text[];
  v_cand_all uuid[] := '{}';
  v_kept_offices uuid[] := '{}';
  v_kept_cands uuid[] := '{}';
begin
  if p_offices is null or pg_catalog.jsonb_typeof(p_offices) <> 'array'
     or pg_catalog.jsonb_array_length(p_offices) > 50 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  -- Pass 1: validate every entry before changing anything.
  for v_office in select value from pg_catalog.jsonb_array_elements(p_offices) loop
    perform app_private.assert_keys(v_office, array['id', 'name', 'position', 'candidates']);
    v_name := app_private.clean_label(app_private.json_text(v_office -> 'name'), 200);
    v_pos := app_private.json_position(v_office -> 'position');
    v_office_id := null;
    if v_office ? 'id' then
      v_office_id := app_private.json_uuid(v_office -> 'id');
      if not exists (select 1 from public.offices where id = v_office_id and vote_id = p_vote_id)
         or v_office_id = any (v_office_ids) then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;
      v_office_ids := pg_catalog.array_append(v_office_ids, v_office_id);
    end if;
    if v_pos = any (v_office_pos) or app_private.normalize_key(v_name) = any (v_office_keys) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_office_pos := pg_catalog.array_append(v_office_pos, v_pos);
    v_office_keys := pg_catalog.array_append(v_office_keys, app_private.normalize_key(v_name));

    if not (v_office ? 'candidates')
       or pg_catalog.jsonb_typeof(v_office -> 'candidates') <> 'array'
       or pg_catalog.jsonb_array_length(v_office -> 'candidates') > 100 then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_cand_pos := '{}';
    v_cand_keys := '{}';
    for v_cand in select value from pg_catalog.jsonb_array_elements(v_office -> 'candidates') loop
      perform app_private.assert_keys(v_cand, array['id', 'name', 'position']);
      v_name := app_private.clean_label(app_private.json_text(v_cand -> 'name'), 200);
      v_pos := app_private.json_position(v_cand -> 'position');
      if v_cand ? 'id' then
        v_cand_id := app_private.json_uuid(v_cand -> 'id');
        -- A supplied candidate must already belong to this very office.
        if v_office_id is null
           or not exists (select 1 from public.candidates where id = v_cand_id and office_id = v_office_id)
           or v_cand_id = any (v_cand_all) then
          raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
        end if;
        v_cand_all := pg_catalog.array_append(v_cand_all, v_cand_id);
      end if;
      if v_pos = any (v_cand_pos) or app_private.normalize_key(v_name) = any (v_cand_keys) then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;
      v_cand_pos := pg_catalog.array_append(v_cand_pos, v_pos);
      v_cand_keys := pg_catalog.array_append(v_cand_keys, app_private.normalize_key(v_name));
    end loop;
  end loop;

  -- Pass 2: remove what is no longer listed, then upsert (positions may swap).
  delete from public.candidates
  where office_id in (select id from public.offices where vote_id = p_vote_id)
    and id <> all (v_cand_all);
  delete from public.offices where vote_id = p_vote_id and id <> all (v_office_ids);

  set constraints public.offices_vote_id_position_key,
    public.candidates_office_id_position_key deferred;

  for v_office in select value from pg_catalog.jsonb_array_elements(p_offices) loop
    v_name := app_private.clean_label(v_office ->> 'name', 200);
    v_pos := app_private.json_position(v_office -> 'position');
    if v_office ? 'id' then
      v_office_id := (v_office ->> 'id')::uuid;
      update public.offices set name = v_name, position = v_pos where id = v_office_id;
    else
      insert into public.offices (vote_id, name, position)
      values (p_vote_id, v_name, v_pos) returning id into v_office_id;
    end if;

    for v_cand in select value from pg_catalog.jsonb_array_elements(v_office -> 'candidates') loop
      v_name := app_private.clean_label(v_cand ->> 'name', 200);
      v_pos := app_private.json_position(v_cand -> 'position');
      if v_cand ? 'id' then
        update public.candidates set name = v_name, position = v_pos
        where id = (v_cand ->> 'id')::uuid;
      else
        insert into public.candidates (office_id, name, position) values (v_office_id, v_name, v_pos);
      end if;
    end loop;
  end loop;

  set constraints public.offices_vote_id_position_key,
    public.candidates_office_id_position_key immediate;
end
$$;

create function app_private.apply_options(p_vote_id uuid, p_options jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_option jsonb;
  v_option_id uuid;
  v_label text;
  v_pos integer;
  v_ids uuid[] := '{}';
  v_positions integer[] := '{}';
  v_keys text[] := '{}';
begin
  if p_options is null or pg_catalog.jsonb_typeof(p_options) <> 'array'
     or pg_catalog.jsonb_array_length(p_options) > 100 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  for v_option in select value from pg_catalog.jsonb_array_elements(p_options) loop
    perform app_private.assert_keys(v_option, array['id', 'label', 'position']);
    v_label := app_private.clean_label(app_private.json_text(v_option -> 'label'), 200);
    v_pos := app_private.json_position(v_option -> 'position');
    if v_option ? 'id' then
      v_option_id := app_private.json_uuid(v_option -> 'id');
      if not exists (select 1 from public.poll_options where id = v_option_id and vote_id = p_vote_id)
         or v_option_id = any (v_ids) then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;
      v_ids := pg_catalog.array_append(v_ids, v_option_id);
    end if;
    if v_pos = any (v_positions) or app_private.normalize_key(v_label) = any (v_keys) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_positions := pg_catalog.array_append(v_positions, v_pos);
    v_keys := pg_catalog.array_append(v_keys, app_private.normalize_key(v_label));
  end loop;

  delete from public.poll_options where vote_id = p_vote_id and id <> all (v_ids);

  set constraints public.poll_options_vote_id_position_key deferred;
  for v_option in select value from pg_catalog.jsonb_array_elements(p_options) loop
    v_label := app_private.clean_label(v_option ->> 'label', 200);
    v_pos := app_private.json_position(v_option -> 'position');
    if v_option ? 'id' then
      update public.poll_options set label = v_label, position = v_pos
      where id = (v_option ->> 'id')::uuid;
    else
      insert into public.poll_options (vote_id, label, position) values (p_vote_id, v_label, v_pos);
    end if;
  end loop;
  set constraints public.poll_options_vote_id_position_key immediate;
end
$$;

-- The supplied list is the complete selected set. Newly added households must
-- be eligible now; households that already were selected may stay (preview
-- flags them) so an admin can see and fix what changed in the register.
create function app_private.apply_electorate(p_vote_id uuid, p_ids jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  if p_ids is null or pg_catalog.jsonb_typeof(p_ids) <> 'array'
     or pg_catalog.jsonb_array_length(p_ids) > 1000 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_ids) loop
    v_id := app_private.json_uuid(v_item);
    if v_id = any (v_ids) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_ids := pg_catalog.array_append(v_ids, v_id);
    if not exists (select 1 from public.electorate where vote_id = p_vote_id and household_id = v_id)
       and not exists (select 1 from public.households where id = v_id and is_eligible) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;

  delete from public.electorate where vote_id = p_vote_id and household_id <> all (v_ids);
  insert into public.electorate (vote_id, household_id)
  select p_vote_id, x from pg_catalog.unnest(v_ids) as x
  on conflict (vote_id, household_id) do nothing;
end
$$;

-- ---------------------------------------------------------------------------
-- public routines (administrator session only)
-- ---------------------------------------------------------------------------

create function public.create_draft(p_voting_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v public.votes;
begin
  if p_voting_type is null or p_voting_type not in ('OPEN', 'CLOSED') then
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
$$;

create function public.get_admin_vote(p_vote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.votes;
begin
  perform app_private.require_enabled_admin();
  -- A share lock keeps an in-flight edit from committing between our reads.
  select * into v from public.votes where id = p_vote_id for share;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return app_private.vote_detail_json(v);
end
$$;

create function public.update_draft(
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
  v_fields text[] := '{}';
  v_key text;
begin
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform app_private.assert_keys(
    p_changes,
    array['votingType', 'title', 'instructions', 'closesAt', 'eligibleHouseholdIds', 'offices', 'options']);

  -- Parent first, then children: the same order every other writer uses.
  v := app_private.lock_vote(p_vote_id);
  if v.status <> 'DRAFT' then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;
  if v.draft_revision <> p_expected_revision then
    raise exception 'STALE_REVISION' using errcode = 'P0001';
  end if;
  -- Nothing to apply is not an edit: no revision change and no audit event.
  if p_changes = '{}'::jsonb then
    return app_private.vote_detail_json(v);
  end if;

  v_type := v.voting_type;
  v_title := v.title;
  v_instructions := v.instructions;
  v_closes := v.closes_at;

  if p_changes ? 'votingType' then
    v_type := app_private.json_text(p_changes -> 'votingType');
    if v_type not in ('OPEN', 'CLOSED') then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
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
      -- An explicit UTC offset is mandatory: a local time is never guessed.
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

  -- Never reinterpret one shape as another: reject children of the wrong type.
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

  -- A type change atomically removes the incompatible children.
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

-- Read-only validation of the exact revision the administrator is looking at.
create function public.preview_draft(p_vote_id uuid, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.votes;
  v_blockers jsonb;
  v_selected integer;
  v_ready integer;
begin
  perform app_private.require_enabled_admin();
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  select * into v from public.votes where id = p_vote_id for share;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status <> 'DRAFT' then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001';
  end if;
  if v.draft_revision <> p_expected_revision then
    raise exception 'STALE_REVISION' using errcode = 'P0001';
  end if;

  v_blockers := app_private.draft_blockers(v);
  select count(*) into v_selected from public.electorate where vote_id = v.id;
  select count(*) into v_ready
  from public.electorate e
  join public.households h on h.id = e.household_id
  join public.profiles p on p.id = h.representative_profile_id
  where e.vote_id = v.id and h.is_eligible and p.status = 'ENABLED';

  return pg_catalog.jsonb_build_object(
    'revision', v.draft_revision,
    'readyToActivate', pg_catalog.jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'electorate', pg_catalog.jsonb_build_object(
      'selected', v_selected, 'eligibleWithEnabledRepresentative', v_ready),
    'vote', app_private.vote_detail_json(v));
end
$$;

create function public.get_rwa_display()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.rwa_settings;
begin
  perform app_private.require_enabled_member();
  select * into s from public.rwa_settings where id = 1;
  if not found then
    return pg_catalog.jsonb_build_object('name', null, 'timezone', null);
  end if;
  -- Only what members already see on every deadline: never approvals or retention.
  return pg_catalog.jsonb_build_object('name', s.name, 'timezone', s.timezone);
end
$$;

revoke all on function
  public.create_draft(text),
  public.get_admin_vote(uuid),
  public.update_draft(uuid, integer, jsonb),
  public.preview_draft(uuid, integer),
  public.get_rwa_display()
from public, anon;
grant execute on function
  public.create_draft(text),
  public.get_admin_vote(uuid),
  public.update_draft(uuid, integer, jsonb),
  public.preview_draft(uuid, integer),
  public.get_rwa_display()
to authenticated;

reset role;
