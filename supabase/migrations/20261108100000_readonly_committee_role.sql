-- Committee observers have admin-equivalent reads, never management writes or extra voting entitlement.
set local role cp_owner;

alter table public.profiles add column is_readonly boolean not null default false;
alter table public.profiles add constraint profiles_management_role_exclusive check (not (is_admin and is_readonly));

create function app_private.is_enabled_committee()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = app_private.current_uid()
    and status = 'ENABLED' and (is_admin or is_readonly))
$$;
create function app_private.require_enabled_committee()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app_private.current_uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not app_private.is_enabled_committee() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  return v_uid;
end
$$;
revoke all on function app_private.is_enabled_committee(), app_private.require_enabled_committee() from public, anon, authenticated, service_role;
grant execute on function app_private.is_enabled_committee() to authenticated;

-- Restrict replacement to reviewed READ routines, including historical wrappers still used internally.
-- Mutation guards (require_enabled_admin/is_enabled_admin) are deliberately left unchanged.
do $$
declare routine record; definition text;
begin
  for routine in select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
      ('app_private','can_view_vote'), ('app_private','can_view_ballot'),
      ('app_private','get_admin_vote_before_scheduling'), ('app_private','get_member_vote_before_scheduling'),
      ('public','get_admin_vote'), ('public','get_member_vote'), ('public','get_vote_results'),
      ('public','preview_draft'), ('public','get_rwa_profile'), ('public','get_rwa_display'),
      ('public','get_vote_participation'), ('public','list_audit_events')
    )
  loop
    definition := pg_catalog.pg_get_functiondef(routine.oid);
    definition := pg_catalog.replace(definition, 'app_private.require_enabled_admin()', 'app_private.require_enabled_committee()');
    definition := pg_catalog.replace(definition, 'app_private.is_enabled_admin()', 'app_private.is_enabled_committee()');
    execute definition;
  end loop;
end
$$;

drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  (id = (select app_private.current_uid()) and status = 'ENABLED') or (select app_private.is_enabled_committee()));
drop policy households_read on public.households;
create policy households_read on public.households for select to authenticated using ((select app_private.is_enabled_committee()));
drop policy electorate_read on public.electorate;
create policy electorate_read on public.electorate for select to authenticated using (
  (select app_private.is_enabled_committee()) or (representative_profile_id = (select app_private.current_uid()) and (select app_private.has_entitlement(vote_id))));
drop policy participation_read on public.participation;
create policy participation_read on public.participation for select to authenticated using (
  (select app_private.is_enabled_committee()) or (select app_private.owns_participation(vote_id, household_id)));
drop policy audit_events_read on public.audit_events;
create policy audit_events_read on public.audit_events for select to authenticated using ((select app_private.is_enabled_committee()));

create or replace function app_private.profile_json(p public.profiles)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('id',p.id,'representativeName',p.representative_name,
    'status',p.status,'isAdmin',p.is_admin,'isReadonly',p.is_readonly,'updatedAt',p.updated_at)
$$;

create or replace function public.update_profile(p_profile_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v_key text; v_profile public.profiles; v_name text; v_status text; v_admin boolean; v_readonly boolean;
begin
  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_changes) loop
    if v_key not in ('representativeName','status','isAdmin','isReadonly') then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(727002);
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_profile.status = 'DELETED' then raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = 'DELETED_PROFILE'; end if;
  v_name := v_profile.representative_name; v_status := v_profile.status;
  v_admin := v_profile.is_admin; v_readonly := v_profile.is_readonly;
  if p_changes ? 'representativeName' then
    if pg_catalog.jsonb_typeof(p_changes->'representativeName') <> 'string' then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
    v_name := app_private.clean_text(p_changes->>'representativeName',200);
  end if;
  if p_changes ? 'status' then
    if pg_catalog.jsonb_typeof(p_changes->'status') <> 'string' or p_changes->>'status' not in ('ENABLED','SUSPENDED','DELETED') then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
    v_status := p_changes->>'status';
  end if;
  if p_changes ? 'isAdmin' then
    if pg_catalog.jsonb_typeof(p_changes->'isAdmin') <> 'boolean' then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
    v_admin := (p_changes->>'isAdmin')::boolean;
    if v_admin and not (p_changes ? 'isReadonly') then v_readonly := false; end if;
  end if;
  if p_changes ? 'isReadonly' then
    if pg_catalog.jsonb_typeof(p_changes->'isReadonly') <> 'boolean' then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
    v_readonly := (p_changes->>'isReadonly')::boolean;
    if v_readonly and not (p_changes ? 'isAdmin') then v_admin := false; end if;
  end if;
  if v_admin and v_readonly then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
  if v_status = 'ENABLED' and not v_admin and (v_profile.status <> 'ENABLED' or v_readonly)
    and not exists (select 1 from public.households where representative_profile_id = p_profile_id) then
    raise exception 'PROVISIONING_INCOMPLETE' using errcode = 'P0001', detail = 'A household assignment is required before enabling a resident or committee observer.';
  end if;
  if v_profile.status = 'ENABLED' and v_profile.is_admin and not (v_status = 'ENABLED' and v_admin)
    and not exists (select 1 from public.profiles where status = 'ENABLED' and is_admin and id <> p_profile_id) then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = 'LAST_ADMIN';
  end if;
  update public.profiles set representative_name=v_name,status=v_status,is_admin=v_admin,is_readonly=v_readonly,
    deleted_at=case when v_status='DELETED' then pg_catalog.now() else null end where id=p_profile_id returning * into v_profile;
  if p_changes ? 'representativeName' then perform app_private.append_audit('PROFILE',v_actor,'PROFILE_UPDATED','PROFILE',p_profile_id::text,null,pg_catalog.jsonb_build_object('fields',pg_catalog.jsonb_build_array('representativeName'))); end if;
  if p_changes ? 'status' then perform app_private.append_audit('PROFILE',v_actor,'PROFILE_STATUS_CHANGED','PROFILE',p_profile_id::text,null,pg_catalog.jsonb_build_object('to',v_status)); end if;
  if p_changes ? 'isAdmin' or p_changes ? 'isReadonly' then perform app_private.append_audit('PROFILE',v_actor,'PROFILE_ROLE_CHANGED','PROFILE',p_profile_id::text,null,pg_catalog.jsonb_build_object('isAdmin',v_admin,'isReadonly',v_readonly)); end if;
  return app_private.profile_json(v_profile);
end
$$;

-- Import cannot silently reuse a privileged observer as an ordinary new resident.
create or replace function public.check_register_import(p_identifier text,p_name text,p_account_id uuid,p_is_eligible boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := app_private.require_enabled_admin(); v_identifier text := app_private.clean_text(p_identifier,100);
  v_name text := app_private.clean_text(p_name,200); h public.households; p public.profiles;
begin
  select * into h from public.households where identifier_normalized=app_private.normalize_key(v_identifier);
  if h.id is not null then
    select * into p from public.profiles where id=h.representative_profile_id;
    if h.representative_profile_id=p_account_id and p.representative_name=v_name and h.is_eligible=p_is_eligible and p.status<>'DELETED' then
      return pg_catalog.jsonb_build_object('state','EXISTING','accountId',p.id);
    end if;
    return pg_catalog.jsonb_build_object('state','CONFLICT');
  end if;
  if p_account_id is not null then
    select * into p from public.profiles where id=p_account_id;
    if p.id is not null and (p.representative_name<>v_name or p.is_admin or p.is_readonly or p.status<>'SUSPENDED'
      or exists(select 1 from public.households where representative_profile_id=p.id)) then return pg_catalog.jsonb_build_object('state','CONFLICT'); end if;
  end if;
  return pg_catalog.jsonb_build_object('state','READY');
end
$$;

-- Preserve four-argument callers via a defaulted final flag, without ambiguous overloads.
drop function public.provision_profile(uuid,text,boolean,uuid);
create function public.provision_profile(
  p_auth_user_id uuid, p_representative_name text, p_is_admin boolean default false,
  p_actor_profile_id uuid default null, p_is_readonly boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_kind text; v_profile public.profiles;
begin
  perform app_private.require_service_role();
  v_actor_kind := app_private.resolve_actor(p_actor_profile_id);
  if coalesce(p_is_admin,false) and coalesce(p_is_readonly,false) then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
  begin
    insert into public.profiles(id,representative_name,status,is_admin,is_readonly)
      values(p_auth_user_id,btrim(p_representative_name),'SUSPENDED',coalesce(p_is_admin,false),coalesce(p_is_readonly,false))
      on conflict(id) do nothing returning * into v_profile;
  exception when foreign_key_violation then raise exception 'AUTH_IDENTITY_MISSING' using errcode = 'P0001'; end;
  if v_profile.id is not null then
    perform app_private.append_audit(v_actor_kind,p_actor_profile_id,'PROFILE_PROVISIONED','PROFILE',p_auth_user_id::text,null,
      pg_catalog.jsonb_build_object('isAdmin',v_profile.is_admin,'isReadonly',v_profile.is_readonly));
    return pg_catalog.jsonb_build_object('id',v_profile.id,'status',v_profile.status,'created',true);
  end if;
  select * into v_profile from public.profiles where id=p_auth_user_id;
  if v_profile.representative_name<>btrim(p_representative_name) or v_profile.is_admin<>coalesce(p_is_admin,false)
    or v_profile.is_readonly<>coalesce(p_is_readonly,false) or v_profile.status='DELETED' then
    raise exception 'REGISTER_CONFLICT' using errcode = 'P0001', detail = 'A different profile already exists for this identity.';
  end if;
  return pg_catalog.jsonb_build_object('id',v_profile.id,'status',v_profile.status,'created',false);
end
$$;
revoke all on function public.provision_profile(uuid,text,boolean,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.provision_profile(uuid,text,boolean,uuid,boolean) to service_role;

reset role;