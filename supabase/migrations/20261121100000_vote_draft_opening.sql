-- Persist a planned opening time in drafts without activating or freezing them.
set local role cp_owner;

alter table public.votes add column planned_opens_at timestamptz;
alter table public.votes add constraint votes_planned_opening_window check (
  planned_opens_at is null or (
    pg_catalog.isfinite(planned_opens_at)
    and (closes_at is null or planned_opens_at < closes_at)
  )
);

create or replace function app_private.vote_detail_json(v public.votes)
returns jsonb language sql stable set search_path = '' as $$
  select app_private.vote_detail_json_before_scheduling(v)
    || pg_catalog.jsonb_build_object(
      'opensAt', coalesce(v.opens_at, v.planned_opens_at),
      'scheduledAt', v.scheduled_at)
$$;

create or replace function app_private.guard_vote_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.created_by_profile_id <> old.created_by_profile_id
     or new.created_at <> old.created_at then
    raise exception 'IMMUTABLE_IDENTITY' using errcode = 'P0001';
  end if;
  if old.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001';
  end if;
  if old.status = 'SCHEDULED' and new.status = 'DRAFT'
     and app_private.flag_is_on('cp.schedule_withdraw') then
    if old.opens_at <= pg_catalog.clock_timestamp()
       or exists (select 1 from public.participation where vote_id = old.id) then
      raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001';
    end if;
    new.updated_at := pg_catalog.now();
    return new;
  end if;
  if new.status <> old.status and not (
    (old.status = 'DRAFT' and new.status = 'ACTIVE')
    or (old.status = 'DRAFT' and new.status = 'SCHEDULED' and app_private.flag_is_on('cp.activation'))
    or (old.status = 'SCHEDULED' and new.status = 'ACTIVE' and app_private.flag_is_on('cp.scheduled_opening'))
    or (old.status = 'ACTIVE' and new.status in ('COMPLETED', 'CANCELLED'))
  ) then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001';
  end if;
  if old.status in ('ACTIVE', 'SCHEDULED') and (
    new.voting_type is distinct from old.voting_type or new.title is distinct from old.title
    or new.instructions is distinct from old.instructions
    or (new.closes_at is distinct from old.closes_at and not (
      old.status = 'ACTIVE' and new.status = 'ACTIVE' and new.closes_at is not null
      and app_private.flag_is_on('cp.deadline_change')))
    or new.draft_revision is distinct from old.draft_revision
    or new.activated_at is distinct from old.activated_at
    or new.opens_at is distinct from old.opens_at or new.scheduled_at is distinct from old.scheduled_at
    or new.planned_opens_at is distinct from old.planned_opens_at
    or new.rwa_name_snapshot is distinct from old.rwa_name_snapshot
    or new.timezone_snapshot is distinct from old.timezone_snapshot
    or new.policy_versions_snapshot is distinct from old.policy_versions_snapshot
  ) then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;
  if old.status = 'SCHEDULED' and new.status = 'ACTIVE' and old.opens_at > pg_catalog.clock_timestamp() then
    raise exception 'VOTING_CLOSED' using errcode = 'P0001';
  end if;
  if old.status = 'DRAFT' then
    if new.status = 'DRAFT' and new.draft_revision not in (old.draft_revision, old.draft_revision + 1) then
      raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001';
    end if;
    if new.status in ('ACTIVE', 'SCHEDULED') then
      if new.draft_revision <> old.draft_revision or new.voting_type <> old.voting_type then
        raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001';
      end if;
      perform app_private.assert_structurally_activatable(new);
    end if;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

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
  v_opens timestamptz;
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
          'title', 'instructions', 'opensAt', 'closesAt', 'eligibleHouseholdIds',
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
  v_opens := v.planned_opens_at;
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
  if p_changes ? 'opensAt' then
    if pg_catalog.jsonb_typeof(p_changes -> 'opensAt') = 'null' then
      v_opens := null;
    else
      if (p_changes ->> 'opensAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$' then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;
      begin
        v_opens := (p_changes ->> 'opensAt')::timestamptz;
      exception
        when others then
          raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end;
      if not pg_catalog.isfinite(v_opens)
         or v_opens <= pg_catalog.clock_timestamp() then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
      end if;
    end if;
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
  if v_opens is not null and v_closes is not null and v_opens >= v_closes then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
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
      planned_opens_at = v_opens,
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

create or replace function app_private.freeze_vote(
  p_vote_id uuid,
  p_expected_revision integer,
  p_confirmed boolean,
  p_opens_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v public.votes;
  s public.rwa_settings;
  v_blockers jsonb;
  v_versions jsonb;
begin
  if p_confirmed is distinct from true or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  v := app_private.lock_vote(p_vote_id);
  if v.status <> 'DRAFT' then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = v.status;
  end if;
  if v.draft_revision <> p_expected_revision then
    raise exception 'STALE_REVISION' using errcode = 'P0001';
  end if;
  perform 1 from public.households h
    where h.id in (select household_id from public.electorate where vote_id = p_vote_id) order by h.id for share;
  perform 1 from public.profiles p where p.id in (
    select h.representative_profile_id from public.households h join public.electorate e on e.household_id = h.id
    where e.vote_id = p_vote_id) order by p.id for share;
  select * into s from public.rwa_settings where id = 1 for share;
  perform app_private.assert_policy_ready();
  v_blockers := app_private.draft_blockers(v);
  if pg_catalog.jsonb_array_length(v_blockers) > 0 then
    raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001', detail = v_blockers -> 0 ->> 'message';
  end if;
  if p_opens_at is not null and (
    not pg_catalog.isfinite(p_opens_at) or p_opens_at <= pg_catalog.clock_timestamp()
    or p_opens_at >= v.closes_at
  ) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('cp.activation', 'on', true);
  update public.electorate e set representative_profile_id = h.representative_profile_id,
    representative_name_snapshot = p.representative_name, household_identifier_snapshot = h.identifier
  from public.households h join public.profiles p on p.id = h.representative_profile_id
  where e.vote_id = p_vote_id and h.id = e.household_id;
  if v.voting_type = 'PRIVATE' then
    insert into public.closed_tallies (vote_id, office_id, candidate_id)
      select o.vote_id, o.id, c.id from public.offices o join public.candidates c on c.office_id = o.id where o.vote_id = p_vote_id
      union all select o.vote_id, o.id, null from public.offices o where o.vote_id = p_vote_id;
  end if;
  select pg_catalog.jsonb_object_agg(k, s.policy_approvals -> k ->> 'version') into v_versions
    from pg_catalog.unnest(array['A1','A2','A3','A4','A5','A6','A7']) k;
  update public.votes set status = case when p_opens_at is null then 'ACTIVE' else 'SCHEDULED' end,
    activated_at = coalesce(p_opens_at, pg_catalog.clock_timestamp()), opens_at = p_opens_at,
    planned_opens_at = p_opens_at,
    scheduled_at = case when p_opens_at is not null then pg_catalog.clock_timestamp() else null end,
    rwa_name_snapshot = s.name, timezone_snapshot = s.timezone, policy_versions_snapshot = v_versions
  where id = p_vote_id returning * into v;
  perform pg_catalog.set_config('cp.activation', 'off', true);
  perform app_private.append_audit('PROFILE', v_actor,
    case when p_opens_at is null then 'VOTE_ACTIVATED' else 'VOTE_SCHEDULED' end,
    'VOTE', p_vote_id::text, null, pg_catalog.jsonb_build_object(
      'votingType', v.voting_type, 'draftRevision', v.draft_revision, 'opensAt', p_opens_at, 'closesAt', v.closes_at,
      'electorate', (select count(*) from public.electorate where vote_id = p_vote_id)));
  return app_private.vote_detail_json(v);
end
$$;

reset role;
