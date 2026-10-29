-- Keep draft updates aligned with the PUBLIC/PRIVATE values introduced earlier.
set local role cp_owner;

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

notify pgrst, 'reload schema';
reset role;
