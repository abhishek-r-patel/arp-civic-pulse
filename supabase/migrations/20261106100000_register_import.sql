-- Guarded, retry-safe register import. Existing records are never overwritten.
set local role cp_owner;

create function public.check_register_import(
  p_identifier text, p_name text, p_account_id uuid, p_is_eligible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v_identifier text := app_private.clean_text(p_identifier, 100);
  v_name text := app_private.clean_text(p_name, 200);
  h public.households;
  p public.profiles;
begin
  select * into h from public.households
  where identifier_normalized = app_private.normalize_key(v_identifier);
  if h.id is not null then
    select * into p from public.profiles where id = h.representative_profile_id;
    if h.representative_profile_id = p_account_id and p.representative_name = v_name
       and h.is_eligible = p_is_eligible and p.status <> 'DELETED' then
      return pg_catalog.jsonb_build_object('state', 'EXISTING', 'accountId', p.id);
    end if;
    return pg_catalog.jsonb_build_object('state', 'CONFLICT');
  end if;
  if p_account_id is not null then
    select * into p from public.profiles where id = p_account_id;
    if p.id is not null and (p.representative_name <> v_name or p.is_admin
       or p.status <> 'SUSPENDED'
       or exists (select 1 from public.households where representative_profile_id = p.id)) then
      return pg_catalog.jsonb_build_object('state', 'CONFLICT');
    end if;
  end if;
  return pg_catalog.jsonb_build_object('state', 'READY');
end
$$;

create function public.import_register_household(
  p_identifier text, p_name text, p_account_id uuid, p_is_eligible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v_check jsonb;
  v_created jsonb;
begin
  -- The profile lock also serializes assignment and access changes for this representative.
  perform 1 from public.profiles where id = p_account_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_check := public.check_register_import(p_identifier, p_name, p_account_id, p_is_eligible);
  if v_check ->> 'state' <> 'READY' then
    return v_check;
  end if;
  begin
    v_created := public.create_household(p_identifier, p_account_id, p_is_eligible);
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'REGISTER_CONFLICT' then raise; end if;
    return public.check_register_import(p_identifier, p_name, p_account_id, p_is_eligible);
  end;
  return pg_catalog.jsonb_build_object('state', 'IMPORTED', 'accountId', p_account_id);
end
$$;

revoke all on function public.check_register_import(text, text, uuid, boolean) from public, anon, service_role;
revoke all on function public.import_register_household(text, text, uuid, boolean) from public, anon, service_role;
grant execute on function public.check_register_import(text, text, uuid, boolean) to authenticated;
grant execute on function public.import_register_household(text, text, uuid, boolean) to authenticated;

reset role;