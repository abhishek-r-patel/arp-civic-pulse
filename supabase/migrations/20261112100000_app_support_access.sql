-- App Support Access: an RWA-controlled, read-only support observer (docs/DATABASE.md section 3.2).
--
-- The support account is an rwa-readonly profile marked is_app_support. It is
-- the only committee observer allowed without a household, and it can never be
-- given one, so it never gains a voting entitlement. Its identity comes from
-- server-only deployment configuration (APP_SUPPORT_EMAIL). Only
-- public.set_app_support_access, called by the server on behalf of a current
-- enabled administrator, may create, enable or suspend it; every change is
-- audited. Ordinary account routines and household assignment refuse it.
set local role cp_owner;

alter table public.profiles add column is_app_support boolean not null default false;
alter table public.profiles add constraint profiles_app_support_readonly
  check (not is_app_support or (is_readonly and not is_admin and not self_registered));

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'BOOTSTRAP_ADMIN', 'SETTINGS_INITIALIZED', 'POLICY_APPROVAL_RECORDED', 'RETENTION_UPDATED',
  'RWA_IDENTIFIER_LABEL_UPDATED', 'RWA_PROFILE_UPDATED', 'PROFILE_PROVISIONED', 'PROFILE_UPDATED',
  'PROFILE_STATUS_CHANGED', 'PROFILE_ROLE_CHANGED', 'HOUSEHOLD_CREATED', 'HOUSEHOLD_UPDATED',
  'DRAFT_CREATED', 'DRAFT_UPDATED', 'VOTE_ACTIVATED', 'VOTE_COMPLETED', 'VOTE_CANCELLED',
  'VOTE_DEADLINE_CHANGED', 'RETENTION_DELETED', 'VOTE_SCHEDULED', 'VOTE_SCHEDULE_WITHDRAWN',
  'PROFILE_SELF_REGISTERED', 'APP_SUPPORT_ACCESS_ENABLED', 'APP_SUPPORT_ACCESS_DISABLED'
));

-- Support profiles change only inside set_app_support_access, which sets this
-- transaction-local marker. update_profile, enable_profile and the other
-- account routines therefore cannot promote, enable, rename or re-role them.
create function app_private.guard_app_support_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.is_app_support)
     or (tg_op = 'UPDATE' and (old.is_app_support or new.is_app_support)) then
    if coalesce(pg_catalog.current_setting('app.app_support_change', true), '') <> 'on' then
      raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = 'APP_SUPPORT_MANAGED';
    end if;
  end if;
  return new;
end
$$;
create trigger profiles_app_support_guard before insert or update on public.profiles
  for each row execute function app_private.guard_app_support_profile();

-- Refuse support profiles before the ordinary household and role checks run,
-- so callers get the specific reason. Fails the migration if the anchor moved.
do $$
declare routine record; definition text; anchor constant text := '''NOT_FOUND'' using errcode = ''P0001'';';
begin
  for routine in select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('update_profile', 'enable_profile')
  loop
    definition := pg_catalog.pg_get_functiondef(routine.oid);
    if pg_catalog.array_length(pg_catalog.string_to_array(definition, anchor), 1) <> 2 then
      raise exception 'app support guard anchor not found exactly once in %', routine.oid::regprocedure;
    end if;
    execute pg_catalog.replace(definition, anchor, anchor
      || ' end if; if v_profile.is_app_support then raise exception ''LIFECYCLE_CONFLICT'' using errcode = ''P0001'', detail = ''APP_SUPPORT_MANAGED'';');
  end loop;
end
$$;

-- A support account never represents a household, so it can never vote.
create function app_private.guard_app_support_household()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles
             where id = new.representative_profile_id and is_app_support) then
    raise exception 'REGISTER_CONFLICT' using errcode = 'P0001', detail = 'APP_SUPPORT_ACCOUNT';
  end if;
  return new;
end
$$;
create trigger households_app_support_guard
  before insert or update of representative_profile_id on public.households
  for each row execute function app_private.guard_app_support_household();

revoke all on function app_private.guard_app_support_profile(), app_private.guard_app_support_household()
  from public, anon, authenticated, service_role;

/*
 * Enables (p_enabled) the support profile for p_auth_user_id, creating it on
 * first use, or disables support access. Either way every OTHER support
 * profile is suspended, so changing APP_SUPPORT_EMAIL never leaves a previous
 * identity enabled. revokedProfileIds lists every non-deleted support profile
 * that must stay blocked, so the caller can (re)apply Auth bans retry-safely.
 */
create function public.set_app_support_access(
  p_auth_user_id uuid, p_enabled boolean, p_actor_profile_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles;
  v_other public.profiles;
  v_keep uuid;
  v_changed boolean := false;
  v_revoked uuid[];
begin
  perform app_private.require_service_role();
  if p_actor_profile_id is null or p_enabled is null or (p_enabled and p_auth_user_id is null) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  perform app_private.resolve_actor(p_actor_profile_id);
  perform pg_catalog.pg_advisory_xact_lock(727002);
  perform pg_catalog.set_config('app.app_support_change', 'on', true);

  if p_enabled then
    v_keep := p_auth_user_id;
    select * into v_profile from public.profiles where id = p_auth_user_id for update;
    if not found then
      begin
        insert into public.profiles (id, representative_name, status, is_admin, is_readonly, is_app_support)
        values (p_auth_user_id, 'App Support', 'ENABLED', false, true, true)
        returning * into v_profile;
      exception when foreign_key_violation then
        raise exception 'AUTH_IDENTITY_MISSING' using errcode = 'P0001';
      end;
      v_changed := true;
      perform app_private.append_audit('PROFILE', p_actor_profile_id, 'APP_SUPPORT_ACCESS_ENABLED',
        'PROFILE', p_auth_user_id::text, null, pg_catalog.jsonb_build_object('created', true));
    elsif not v_profile.is_app_support then
      raise exception 'REGISTER_CONFLICT' using errcode = 'P0001', detail = 'APP_SUPPORT_EMAIL_IN_USE';
    elsif v_profile.status = 'DELETED' then
      raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = 'DELETED_PROFILE';
    elsif v_profile.status <> 'ENABLED' then
      update public.profiles set status = 'ENABLED' where id = p_auth_user_id;
      v_changed := true;
      perform app_private.append_audit('PROFILE', p_actor_profile_id, 'APP_SUPPORT_ACCESS_ENABLED',
        'PROFILE', p_auth_user_id::text, null, pg_catalog.jsonb_build_object('created', false));
    end if;
  end if;

  for v_other in
    select * from public.profiles
    where is_app_support and status = 'ENABLED' and id is distinct from v_keep
    order by id for update
  loop
    update public.profiles set status = 'SUSPENDED' where id = v_other.id;
    v_changed := true;
    perform app_private.append_audit('PROFILE', p_actor_profile_id, 'APP_SUPPORT_ACCESS_DISABLED',
      'PROFILE', v_other.id::text, null, '{}'::jsonb);
  end loop;

  select coalesce(pg_catalog.array_agg(id order by id), '{}') into v_revoked
  from public.profiles
  where is_app_support and status <> 'DELETED' and id is distinct from v_keep;

  perform pg_catalog.set_config('app.app_support_change', '', true);
  return pg_catalog.jsonb_build_object(
    'enabled', p_enabled, 'changed', v_changed, 'revokedProfileIds', pg_catalog.to_jsonb(v_revoked));
end
$$;
revoke all on function public.set_app_support_access(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_app_support_access(uuid, boolean, uuid) to service_role;

reset role;
