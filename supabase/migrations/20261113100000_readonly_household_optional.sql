-- Makes the household optional for rwa-readonly committee observers, matching
-- rwa-admin: management roles never confer voting; only an assigned household
-- (the "voter" capability) does. An observer without a household can read the
-- committee scope but has no electorate row and therefore cannot vote.
--
-- Also requires a household when an enabled rwa-admin or rwa-readonly account
-- is changed to an ordinary resident, so no enabled resident is left without
-- the household that residents exist to represent. Both refusals now carry the
-- machine-readable DETAIL `HOUSEHOLD_REQUIRED` instead of free text.
--
-- Patches the current definitions in place (same pattern as
-- 20261108100000/20261112100000) and fails unless each anchor occurs exactly once.

do $migration$
declare
  v_def text;
begin
  create function pg_temp.patch_once(p_def text, p_old text, p_new text) returns text
    language plpgsql as $p$
  begin
    if (pg_catalog.length(p_def) - pg_catalog.length(pg_catalog.replace(p_def, p_old, ''))) / pg_catalog.length(p_old) <> 1 then
      raise exception 'household anchor not found exactly once: %', p_old;
    end if;
    return pg_catalog.replace(p_def, p_old, p_new);
  end
  $p$;

  -- enable_profile: exempt readonly observers alongside administrators.
  v_def := pg_catalog.pg_get_functiondef('public.enable_profile(uuid,uuid)'::pg_catalog.regprocedure);
  v_def := pg_temp.patch_once(v_def,
    'if not v_profile.is_admin
     and not exists (',
    'if not v_profile.is_admin and not v_profile.is_readonly
     and not exists (');
  v_def := pg_temp.patch_once(v_def,
    'detail = ''A household assignment is required before enabling a resident.''',
    'detail = ''HOUSEHOLD_REQUIRED''');
  execute v_def;

  -- update_profile: residents (neither management role) need a household when
  -- being enabled or when an enabled management account becomes a resident.
  v_def := pg_catalog.pg_get_functiondef('public.update_profile(uuid,jsonb)'::pg_catalog.regprocedure);

  -- Evaluate the last-admin invariant before the household requirement so that
  -- demoting the final enabled administrator still reports LAST_ADMIN rather
  -- than HOUSEHOLD_REQUIRED.
  v_def := pg_temp.patch_once(v_def,
'  if v_status = ''ENABLED'' and not v_admin and (v_profile.status <> ''ENABLED'' or v_readonly)
    and not exists (select 1 from public.households where representative_profile_id = p_profile_id) then
    raise exception ''PROVISIONING_INCOMPLETE'' using errcode = ''P0001'', detail = ''A household assignment is required before enabling a resident or committee observer.'';
  end if;
  if v_profile.status = ''ENABLED'' and v_profile.is_admin and not (v_status = ''ENABLED'' and v_admin)
    and not exists (select 1 from public.profiles where status = ''ENABLED'' and is_admin and id <> p_profile_id) then
    raise exception ''LIFECYCLE_CONFLICT'' using errcode = ''P0001'', detail = ''LAST_ADMIN'';
  end if;',
'  if v_profile.status = ''ENABLED'' and v_profile.is_admin and not (v_status = ''ENABLED'' and v_admin)
    and not exists (select 1 from public.profiles where status = ''ENABLED'' and is_admin and id <> p_profile_id) then
    raise exception ''LIFECYCLE_CONFLICT'' using errcode = ''P0001'', detail = ''LAST_ADMIN'';
  end if;
  if v_status = ''ENABLED'' and not v_admin and (v_profile.status <> ''ENABLED'' or v_readonly)
    and not exists (select 1 from public.households where representative_profile_id = p_profile_id) then
    raise exception ''PROVISIONING_INCOMPLETE'' using errcode = ''P0001'', detail = ''A household assignment is required before enabling a resident or committee observer.'';
  end if;');

  v_def := pg_temp.patch_once(v_def,
    'if v_status = ''ENABLED'' and not v_admin and (v_profile.status <> ''ENABLED'' or v_readonly)',
    'if v_status = ''ENABLED'' and not v_admin and not v_readonly
    and (v_profile.status <> ''ENABLED'' or v_profile.is_admin or v_profile.is_readonly)');
  v_def := pg_temp.patch_once(v_def,
    'detail = ''A household assignment is required before enabling a resident or committee observer.''',
    'detail = ''HOUSEHOLD_REQUIRED''');
  execute v_def;

  drop function pg_temp.patch_once(text, text, text);
end
$migration$;

comment on column public.profiles.is_readonly is
  'rwa-readonly committee observer: authorized management reads only. Never grants voting; a household is optional and is the only source of a ballot.';
