-- Public resident self-registration (docs/DATABASE.md section 9, docs/API.md section 4.6).
--
-- The server-only routine creates a SUSPENDED resident profile and an
-- INELIGIBLE household in one audited transaction. It grants no access: an
-- administrator must still enable the account and, separately, mark the
-- household eligible. One email per account and one representative per
-- household are the existing unique keys; this routine only reports which one
-- a repeat registration hit. When the RWA has configured Default Households,
-- a registration must name one of them and stores the configured spelling.
set local role cp_owner;

alter table public.profiles add column self_registered boolean not null default false;

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'BOOTSTRAP_ADMIN', 'SETTINGS_INITIALIZED', 'POLICY_APPROVAL_RECORDED', 'RETENTION_UPDATED',
  'RWA_IDENTIFIER_LABEL_UPDATED', 'RWA_PROFILE_UPDATED', 'PROFILE_PROVISIONED', 'PROFILE_UPDATED',
  'PROFILE_STATUS_CHANGED', 'PROFILE_ROLE_CHANGED', 'HOUSEHOLD_CREATED', 'HOUSEHOLD_UPDATED',
  'DRAFT_CREATED', 'DRAFT_UPDATED', 'VOTE_ACTIVATED', 'VOTE_COMPLETED', 'VOTE_CANCELLED',
  'VOTE_DEADLINE_CHANGED', 'RETENTION_DELETED', 'VOTE_SCHEDULED', 'VOTE_SCHEDULE_WITHDRAWN',
  'PROFILE_SELF_REGISTERED'
));

-- The public registration picker; an empty array means free-text entry.
create function public.get_self_registration_households()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_service_role();
  return coalesce(
    (select pg_catalog.to_jsonb(default_households) from public.rwa_settings where id = 1),
    '[]'::jsonb);
end
$$;

create function public.self_register_resident(
  p_auth_user_id uuid, p_representative_name text, p_identifier text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_identifier text;
  v_household public.households;
  v_constraint text;
  v_listed text[];
begin
  perform app_private.require_service_role();
  v_name := app_private.clean_text(p_representative_name, 200);
  v_identifier := app_private.clean_text(p_identifier, 100);
  if p_auth_user_id is null then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  -- Any existing profile (including suspended or deleted) means the email is already registered.
  if exists (select 1 from public.profiles where id = p_auth_user_id) then
    raise exception 'REGISTER_CONFLICT' using errcode = 'P0001', detail = 'DUPLICATE_EMAIL';
  end if;
  select default_households into v_listed from public.rwa_settings where id = 1;
  if pg_catalog.cardinality(coalesce(v_listed, '{}')) > 0 then
    select item into v_identifier from pg_catalog.unnest(v_listed) as item
    where app_private.normalize_key(item) = app_private.normalize_key(p_identifier);
    if v_identifier is null then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'UNKNOWN_HOUSEHOLD';
    end if;
  end if;
  if exists (select 1 from public.households
             where identifier_normalized = app_private.normalize_key(v_identifier)) then
    raise exception 'REGISTER_CONFLICT' using errcode = 'P0001', detail = 'DUPLICATE_IDENTIFIER';
  end if;

  -- The unique keys stay authoritative for concurrent registrations.
  begin
    insert into public.profiles (id, representative_name, status, is_admin, is_readonly, self_registered)
    values (p_auth_user_id, v_name, 'SUSPENDED', false, false, true);
    insert into public.households (identifier, identifier_normalized, representative_profile_id, is_eligible)
    values (v_identifier, app_private.normalize_key(v_identifier), p_auth_user_id, false)
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
    'SYSTEM', null, 'PROFILE_SELF_REGISTERED', 'PROFILE', p_auth_user_id::text, null,
    pg_catalog.jsonb_build_object('householdId', v_household.id, 'isEligible', false));

  return pg_catalog.jsonb_build_object(
    'id', p_auth_user_id, 'status', 'SUSPENDED', 'householdId', v_household.id);
end
$$;

revoke all on function public.self_register_resident(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_self_registration_households() from public, anon, authenticated, service_role;
grant execute on function public.self_register_resident(uuid, text, text) to service_role;
grant execute on function public.get_self_registration_households() to service_role;

reset role;
