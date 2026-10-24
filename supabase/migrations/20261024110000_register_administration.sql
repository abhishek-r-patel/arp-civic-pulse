-- Register administration (docs/DATABASE.md sections 3.2-3.3 and 7; docs/API.md section 4.3).
--
-- Household and profile maintenance runs as guarded routines called with the
-- administrator's own session. Each routine re-derives the caller from the
-- verified JWT, requires a CURRENT enabled administrator, validates its input,
-- commits its audit event in the same transaction, and never touches frozen
-- electorate snapshots. Auth-side steps (email, bans) happen in the
-- application's retry-safe workflow and are not part of these transactions.

set local role cp_owner;

-- Trimmed plain text within a bound, or a stable validation error.
create function app_private.clean_text(p_value text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text := pg_catalog.btrim(p_value);
begin
  if v_value is null or v_value = ''
     or pg_catalog.char_length(v_value) > p_max
     or v_value ~ '[\x00-\x1f\x7f-\x9f]'
     or v_value ~* '</?[a-z!][^>]*>' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  return v_value;
end
$$;

-- Same normalisation the register uses, so exact-identifier filters match the unique key.
create function public.normalize_household_identifier(p_identifier text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.normalize_key(p_identifier)
$$;

create function app_private.household_json(h public.households)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', h.id,
    'identifier', h.identifier,
    'representativeAccountId', h.representative_profile_id,
    'isEligible', h.is_eligible,
    'updatedAt', h.updated_at)
$$;

create function app_private.profile_json(p public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p.id,
    'representativeName', p.representative_name,
    'status', p.status,
    'isAdmin', p.is_admin,
    'updatedAt', p.updated_at)
$$;

-- A representative must exist and not be soft-deleted.
create function app_private.assert_assignable_profile(p_profile_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.profiles where id = p_profile_id for share;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status = 'DELETED' then
    raise exception 'REGISTER_CONFLICT' using errcode = 'P0001', detail = 'REPRESENTATIVE_DELETED';
  end if;
end
$$;

create function public.create_household(
  p_identifier text,
  p_representative_account_id uuid,
  p_is_eligible boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v_identifier text := app_private.clean_text(p_identifier, 100);
  v_household public.households;
  v_constraint text;
begin
  if p_representative_account_id is null then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform app_private.assert_assignable_profile(p_representative_account_id);

  begin
    insert into public.households
      (identifier, identifier_normalized, representative_profile_id, is_eligible)
    values
      (v_identifier, app_private.normalize_key(v_identifier), p_representative_account_id,
       coalesce(p_is_eligible, false))
    returning * into v_household;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      raise exception 'REGISTER_CONFLICT' using errcode = 'P0001',
        detail = case v_constraint
          when 'households_identifier_normalized_key' then 'DUPLICATE_IDENTIFIER'
          when 'households_representative_profile_id_key' then 'REPRESENTATIVE_ASSIGNED'
          else 'CONFLICT' end;
  end;

  perform app_private.append_audit(
    'PROFILE', v_actor, 'HOUSEHOLD_CREATED', 'HOUSEHOLD', v_household.id::text, null,
    pg_catalog.jsonb_build_object('isEligible', v_household.is_eligible));

  return app_private.household_json(v_household);
end
$$;

-- Omitted keys stay unchanged. Frozen electorates are never rewritten.
create function public.update_household(p_household_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v_key text;
  v_household public.households;
  v_identifier text;
  v_representative uuid;
  v_eligible boolean;
  v_fields text[] := '{}';
  v_constraint text;
begin
  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_changes) loop
    if v_key not in ('identifier', 'representativeAccountId', 'isEligible') then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;

  select * into v_household from public.households where id = p_household_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_identifier := v_household.identifier;
  v_representative := v_household.representative_profile_id;
  v_eligible := v_household.is_eligible;

  if p_changes ? 'identifier' then
    if pg_catalog.jsonb_typeof(p_changes -> 'identifier') <> 'string' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_identifier := app_private.clean_text(p_changes ->> 'identifier', 100);
    v_fields := pg_catalog.array_append(v_fields, 'identifier');
  end if;

  if p_changes ? 'representativeAccountId' then
    if pg_catalog.jsonb_typeof(p_changes -> 'representativeAccountId') <> 'string' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    begin
      v_representative := (p_changes ->> 'representativeAccountId')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end;
    perform app_private.assert_assignable_profile(v_representative);
    v_fields := pg_catalog.array_append(v_fields, 'representativeAccountId');
  end if;

  if p_changes ? 'isEligible' then
    if pg_catalog.jsonb_typeof(p_changes -> 'isEligible') <> 'boolean' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_eligible := (p_changes ->> 'isEligible')::boolean;
    v_fields := pg_catalog.array_append(v_fields, 'isEligible');
  end if;

  begin
    update public.households
    set identifier = v_identifier,
        identifier_normalized = app_private.normalize_key(v_identifier),
        representative_profile_id = v_representative,
        is_eligible = v_eligible
    where id = p_household_id
    returning * into v_household;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      raise exception 'REGISTER_CONFLICT' using errcode = 'P0001',
        detail = case v_constraint
          when 'households_identifier_normalized_key' then 'DUPLICATE_IDENTIFIER'
          when 'households_representative_profile_id_key' then 'REPRESENTATIVE_ASSIGNED'
          else 'CONFLICT' end;
  end;

  perform app_private.append_audit(
    'PROFILE', v_actor, 'HOUSEHOLD_UPDATED', 'HOUSEHOLD', p_household_id::text, null,
    pg_catalog.jsonb_build_object('fields', pg_catalog.to_jsonb(v_fields)));

  return app_private.household_json(v_household);
end
$$;

-- Name, status and administrator flag. Changes to the set of enabled
-- administrators are serialised, and the last enabled administrator can never
-- be removed. Residents are enabled only with a household assignment.
create function public.update_profile(p_profile_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v_key text;
  v_profile public.profiles;
  v_name text;
  v_status text;
  v_is_admin boolean;
begin
  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_changes) loop
    if v_key not in ('representativeName', 'status', 'isAdmin') then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(727002);

  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_profile.status = 'DELETED' then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = 'DELETED_PROFILE';
  end if;

  v_name := v_profile.representative_name;
  v_status := v_profile.status;
  v_is_admin := v_profile.is_admin;

  if p_changes ? 'representativeName' then
    if pg_catalog.jsonb_typeof(p_changes -> 'representativeName') <> 'string' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_name := app_private.clean_text(p_changes ->> 'representativeName', 200);
  end if;
  if p_changes ? 'status' then
    if pg_catalog.jsonb_typeof(p_changes -> 'status') <> 'string'
       or (p_changes ->> 'status') not in ('ENABLED', 'SUSPENDED', 'DELETED') then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_status := p_changes ->> 'status';
  end if;
  if p_changes ? 'isAdmin' then
    if pg_catalog.jsonb_typeof(p_changes -> 'isAdmin') <> 'boolean' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    v_is_admin := (p_changes ->> 'isAdmin')::boolean;
  end if;

  if v_status = 'ENABLED' and v_profile.status <> 'ENABLED' and not v_is_admin
     and not exists (
       select 1 from public.households where representative_profile_id = p_profile_id) then
    raise exception 'PROVISIONING_INCOMPLETE' using errcode = 'P0001',
      detail = 'A household assignment is required before enabling a resident.';
  end if;

  if v_profile.status = 'ENABLED' and v_profile.is_admin
     and not (v_status = 'ENABLED' and v_is_admin)
     and not exists (
       select 1 from public.profiles
       where status = 'ENABLED' and is_admin and id <> p_profile_id) then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = 'LAST_ADMIN';
  end if;

  update public.profiles
  set representative_name = v_name,
      status = v_status,
      is_admin = v_is_admin,
      deleted_at = case when v_status = 'DELETED' then pg_catalog.now() else null end
  where id = p_profile_id
  returning * into v_profile;

  if p_changes ? 'representativeName' then
    perform app_private.append_audit('PROFILE', v_actor, 'PROFILE_UPDATED', 'PROFILE',
      p_profile_id::text, null, pg_catalog.jsonb_build_object('fields', pg_catalog.jsonb_build_array('representativeName')));
  end if;
  if p_changes ? 'status' then
    perform app_private.append_audit('PROFILE', v_actor, 'PROFILE_STATUS_CHANGED', 'PROFILE',
      p_profile_id::text, null, pg_catalog.jsonb_build_object('to', v_status));
  end if;
  if p_changes ? 'isAdmin' then
    perform app_private.append_audit('PROFILE', v_actor, 'PROFILE_ROLE_CHANGED', 'PROFILE',
      p_profile_id::text, null, pg_catalog.jsonb_build_object('isAdmin', v_is_admin));
  end if;

  return app_private.profile_json(v_profile);
end
$$;

revoke all on function
  public.normalize_household_identifier(text),
  public.create_household(text, uuid, boolean),
  public.update_household(uuid, jsonb),
  public.update_profile(uuid, jsonb)
from public, anon;
grant execute on function
  public.normalize_household_identifier(text),
  public.create_household(text, uuid, boolean),
  public.update_household(uuid, jsonb),
  public.update_profile(uuid, jsonb)
to authenticated;

reset role;
