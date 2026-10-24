-- Audit, controlled settings/approvals and retry-safe provisioning (docs/DATABASE.md
-- sections 3.1, 3.2, 3.13 and 9; docs/IMPLEMENTATION_PLAN.md Phase 5).
--
-- Deployment procedures live in app_private (not exposed by the Data API) and
-- run only under the deployment/migration role. Server-only provisioning
-- routines live in public and are executable by service_role alone. Neither
-- bypasses audit: every mutation appends its audit event in the same
-- transaction. Auth-side steps are NOT part of this transaction; the
-- coordinator in the application handles that retry-safety explicitly.

set local role cp_owner;

-- ---------------------------------------------------------------------------
-- Audit insertion (internal only)
-- ---------------------------------------------------------------------------

create function app_private.append_audit(
  p_actor_kind text,
  p_actor_profile_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_reason text default null,
  p_details jsonb default '{}'::jsonb
)
returns bigint
language sql
set search_path = ''
as $$
  insert into public.audit_events
    (actor_kind, actor_profile_id, action, target_type, target_id, reason, details)
  values
    (p_actor_kind, p_actor_profile_id, p_action, p_target_type, p_target_id, p_reason, p_details)
  returning id
$$;

-- An actor is either an enabled administrator profile or the deployment itself.
create function app_private.resolve_actor(p_actor_profile_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_actor_profile_id is null then
    return 'DEPLOYMENT';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_profile_id and status = 'ENABLED' and is_admin
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return 'PROFILE';
end
$$;

-- ---------------------------------------------------------------------------
-- Deployment procedures: singleton settings, approvals, retention, first admin
-- ---------------------------------------------------------------------------

create function app_private.deployment_initialize_settings(p_name text, p_timezone text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.rwa_settings) then
    raise exception 'REGISTER_CONFLICT' using errcode = 'P0001',
      detail = 'Settings are already initialized.';
  end if;

  insert into public.rwa_settings (id, name, timezone) values (1, p_name, p_timezone);

  perform app_private.append_audit(
    'DEPLOYMENT', null, 'SETTINGS_INITIALIZED', 'SETTINGS', '1', null,
    jsonb_build_object('timezone', p_timezone));
end
$$;

-- Records the actual approval. A new record replaces the previous one, so a
-- changed decision or version never inherits an earlier approval.
create function app_private.deployment_record_policy_approval(
  p_key text,
  p_version text,
  p_approved_at timestamptz,
  p_approved_by_profile_id uuid,
  p_approving_authority text,
  p_decision text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^A[1-7]$' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'Unknown approval key.';
  end if;
  if coalesce(btrim(p_version), '') = '' or char_length(p_version) > 100
     or coalesce(btrim(p_approving_authority), '') = '' or char_length(p_approving_authority) > 200
     or coalesce(btrim(p_decision), '') = '' or char_length(p_decision) > 2000
     or p_approved_at is null then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001',
      detail = 'Version, approval time, authority and decision are required.';
  end if;
  -- The recording profile is attribution only (not a foreign key), but must be real.
  if p_approved_by_profile_id is null
     or not exists (
       select 1 from public.profiles
       where id = p_approved_by_profile_id and status = 'ENABLED' and is_admin) then
    raise exception 'FORBIDDEN' using errcode = 'P0001',
      detail = 'The recording profile must be an enabled administrator.';
  end if;
  if not exists (select 1 from public.rwa_settings where id = 1) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'Settings are not initialized.';
  end if;

  update public.rwa_settings
  set policy_approvals = policy_approvals || jsonb_build_object(
    p_key, jsonb_build_object(
      'version', btrim(p_version),
      'approved_at', p_approved_at,
      'approved_by_profile_id', p_approved_by_profile_id,
      'approving_authority', btrim(p_approving_authority),
      'decision', btrim(p_decision)))
  where id = 1;

  perform app_private.append_audit(
    'PROFILE', p_approved_by_profile_id, 'POLICY_APPROVAL_RECORDED', 'SETTINGS', '1', null,
    jsonb_build_object('key', p_key, 'version', btrim(p_version)));
end
$$;

create function app_private.deployment_invalidate_policy_approval(p_key text, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^A[1-7]$' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'Unknown approval key.';
  end if;
  update public.rwa_settings set policy_approvals = policy_approvals - p_key where id = 1;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app_private.append_audit(
    'DEPLOYMENT', null, 'POLICY_APPROVAL_RECORDED', 'SETTINGS', '1', p_reason,
    jsonb_build_object('key', p_key, 'invalidated', true));
end
$$;

-- Unset (null) means "not approved", never unlimited.
create function app_private.deployment_set_retention(
  p_vote_days integer,
  p_audit_days integer,
  p_inactive_profile_days integer,
  p_rate_limit_days integer,
  p_backup_days integer
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.rwa_settings
  set vote_retention_days = p_vote_days,
      audit_retention_days = p_audit_days,
      inactive_profile_retention_days = p_inactive_profile_days,
      rate_limit_retention_days = p_rate_limit_days,
      backup_retention_days = p_backup_days
  where id = 1;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app_private.append_audit(
    'DEPLOYMENT', null, 'RETENTION_UPDATED', 'SETTINGS', '1', null,
    jsonb_build_object('fields', jsonb_build_array(
      'vote_retention_days', 'audit_retention_days', 'inactive_profile_retention_days',
      'rate_limit_retention_days', 'backup_retention_days')));
end
$$;

-- Activation precondition: all seven approvals and every retention value.
create function app_private.assert_policy_ready()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  s public.rwa_settings;
begin
  select * into s from public.rwa_settings where id = 1;
  if not found
     or not (s.policy_approvals ?& array['A1','A2','A3','A4','A5','A6','A7'])
     or s.vote_retention_days is null or s.audit_retention_days is null
     or s.inactive_profile_retention_days is null or s.rate_limit_retention_days is null
     or s.backup_retention_days is null then
    raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
      detail = 'Policy approvals A1-A7 and all retention periods must be recorded.';
  end if;
end
$$;

-- First administrator: only while no enabled administrator exists. The Auth
-- identity must already exist; normal OTP sign-in is still required afterwards.
create function app_private.deployment_bootstrap_admin(
  p_auth_user_id uuid,
  p_representative_name text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles where status = 'ENABLED' and is_admin) then
    raise exception 'REGISTER_CONFLICT' using errcode = 'P0001',
      detail = 'An enabled administrator already exists.';
  end if;

  begin
    insert into public.profiles (id, representative_name, status, is_admin)
    values (p_auth_user_id, p_representative_name, 'ENABLED', true);
  exception
    when foreign_key_violation then
      raise exception 'AUTH_IDENTITY_MISSING' using errcode = 'P0001';
    when unique_violation then
      raise exception 'REGISTER_CONFLICT' using errcode = 'P0001',
        detail = 'A profile already exists for this identity.';
  end;

  perform app_private.append_audit(
    'DEPLOYMENT', null, 'BOOTSTRAP_ADMIN', 'PROFILE', p_auth_user_id::text, null, '{}'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Server-only provisioning (service_role): retry-safe, suspended by default
-- ---------------------------------------------------------------------------

create function app_private.require_service_role()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(app_private.jwt_claims() ->> 'role', '') <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
end
$$;

-- Creates or re-validates the application profile for an existing Auth identity.
-- Safe to repeat: an existing profile is returned only when it matches exactly.
create function public.provision_profile(
  p_auth_user_id uuid,
  p_representative_name text,
  p_is_admin boolean default false,
  p_actor_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_kind text;
  v_profile public.profiles;
begin
  perform app_private.require_service_role();
  v_actor_kind := app_private.resolve_actor(p_actor_profile_id);

  begin
    insert into public.profiles (id, representative_name, status, is_admin)
    values (p_auth_user_id, btrim(p_representative_name), 'SUSPENDED', coalesce(p_is_admin, false))
    on conflict (id) do nothing
    returning * into v_profile;
  exception
    when foreign_key_violation then
      raise exception 'AUTH_IDENTITY_MISSING' using errcode = 'P0001';
  end;

  if v_profile.id is not null then
    perform app_private.append_audit(
      v_actor_kind, p_actor_profile_id, 'PROFILE_PROVISIONED', 'PROFILE',
      p_auth_user_id::text, null, jsonb_build_object('isAdmin', coalesce(p_is_admin, false)));
    return jsonb_build_object('id', v_profile.id, 'status', v_profile.status, 'created', true);
  end if;

  select * into v_profile from public.profiles where id = p_auth_user_id;
  if v_profile.representative_name <> btrim(p_representative_name)
     or v_profile.is_admin <> coalesce(p_is_admin, false)
     or v_profile.status = 'DELETED' then
    raise exception 'REGISTER_CONFLICT' using errcode = 'P0001',
      detail = 'A different profile already exists for this identity.';
  end if;
  return jsonb_build_object('id', v_profile.id, 'status', v_profile.status, 'created', false);
end
$$;

-- Enables a consistent profile. Residents need a household assignment first;
-- an administrator may intentionally have none.
create function public.enable_profile(p_profile_id uuid, p_actor_profile_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_kind text;
  v_profile public.profiles;
begin
  perform app_private.require_service_role();
  v_actor_kind := app_private.resolve_actor(p_actor_profile_id);

  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_profile.status = 'DELETED' then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001';
  end if;
  if v_profile.status = 'ENABLED' then
    return jsonb_build_object('id', v_profile.id, 'status', v_profile.status, 'changed', false);
  end if;

  if not v_profile.is_admin
     and not exists (
       select 1 from public.households where representative_profile_id = p_profile_id) then
    raise exception 'PROVISIONING_INCOMPLETE' using errcode = 'P0001',
      detail = 'A household assignment is required before enabling a resident.';
  end if;

  update public.profiles set status = 'ENABLED' where id = p_profile_id;
  perform app_private.append_audit(
    v_actor_kind, p_actor_profile_id, 'PROFILE_STATUS_CHANGED', 'PROFILE',
    p_profile_id::text, null, jsonb_build_object('from', v_profile.status, 'to', 'ENABLED'));

  return jsonb_build_object('id', p_profile_id, 'status', 'ENABLED', 'changed', true);
end
$$;

revoke all on function
  public.provision_profile(uuid, text, boolean, uuid),
  public.enable_profile(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.provision_profile(uuid, text, boolean, uuid),
  public.enable_profile(uuid, uuid)
to service_role;

reset role;
