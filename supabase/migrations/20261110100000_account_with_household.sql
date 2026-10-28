-- Administrator account creation with its household in one audited transaction (docs/API.md section 4.3).
--
-- The Auth identity is created first by the application; this routine then
-- creates the SUSPENDED profile and its household together, so an account is
-- never left without the household the administrator chose. Enabling remains
-- the separate guarded update_profile workflow.
set local role cp_owner;

create function public.provision_profile_with_household(
  p_auth_user_id uuid, p_representative_name text, p_is_admin boolean, p_is_readonly boolean,
  p_identifier text, p_is_eligible boolean, p_actor_profile_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_identifier text;
  v_household public.households;
  v_constraint text;
begin
  perform app_private.require_service_role();
  -- Only a current enabled administrator may create accounts this way.
  if p_actor_profile_id is null or app_private.resolve_actor(p_actor_profile_id) <> 'PROFILE' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_name := app_private.clean_text(p_representative_name, 200);
  v_identifier := app_private.clean_text(p_identifier, 100);
  if p_auth_user_id is null or (coalesce(p_is_admin, false) and coalesce(p_is_readonly, false)) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where id = p_auth_user_id) then
    raise exception 'REGISTER_CONFLICT' using errcode = 'P0001', detail = 'DUPLICATE_EMAIL';
  end if;

  begin
    insert into public.profiles (id, representative_name, status, is_admin, is_readonly)
    values (p_auth_user_id, v_name, 'SUSPENDED', coalesce(p_is_admin, false), coalesce(p_is_readonly, false));
    insert into public.households (identifier, identifier_normalized, representative_profile_id, is_eligible)
    values (v_identifier, app_private.normalize_key(v_identifier), p_auth_user_id, coalesce(p_is_eligible, false))
    returning * into v_household;
  exception
    when foreign_key_violation then
      raise exception 'AUTH_IDENTITY_MISSING' using errcode = 'P0001';
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      raise exception 'REGISTER_CONFLICT' using errcode = 'P0001',
        detail = case v_constraint
          when 'profiles_pkey' then 'DUPLICATE_EMAIL'
          when 'households_identifier_normalized_key' then 'DUPLICATE_IDENTIFIER'
          else 'CONFLICT' end;
  end;

  perform app_private.append_audit(
    'PROFILE', p_actor_profile_id, 'PROFILE_PROVISIONED', 'PROFILE', p_auth_user_id::text, null,
    pg_catalog.jsonb_build_object('isAdmin', coalesce(p_is_admin, false), 'isReadonly', coalesce(p_is_readonly, false)));
  perform app_private.append_audit(
    'PROFILE', p_actor_profile_id, 'HOUSEHOLD_CREATED', 'HOUSEHOLD', v_household.id::text, null,
    pg_catalog.jsonb_build_object('isEligible', v_household.is_eligible));

  return pg_catalog.jsonb_build_object('id', p_auth_user_id, 'householdId', v_household.id);
end
$$;

revoke all on function public.provision_profile_with_household(uuid, text, boolean, boolean, text, boolean, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.provision_profile_with_household(uuid, text, boolean, boolean, text, boolean, uuid)
  to service_role;

reset role;
