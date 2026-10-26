-- RWA identity and contact details are administrator-only. The compact alias
-- is the sole new branding value exposed to enabled members.

set local role cp_owner;

alter table public.rwa_settings
  add column full_name text not null default 'Residents Welfare Association'
    check (
      full_name = btrim(full_name)
      and char_length(full_name) between 1 and 200
      and full_name !~ '[\x00-\x1f\x7f-\x9f]'
      and full_name !~* '</?[a-z!][^>]*>'
    ),
  add column alias text not null default 'RWA'
    check (
      alias = btrim(alias)
      and char_length(alias) between 1 and 80
      and alias !~ '[\x00-\x1f\x7f-\x9f]'
      and alias !~* '</?[a-z!][^>]*>'
    ),
  add column address text not null default 'RWA Address'
    check (
      address = btrim(address)
      and char_length(address) between 1 and 500
      and address !~ '[\x00-\x08\x0b-\x1f\x7f-\x9f]'
      and address !~* '</?[a-z!][^>]*>'
    ),
  add column email text not null default 'rwa@email.com'
    check (
      char_length(email) between 3 and 254
      and email = btrim(email)
      and email !~ '[\x00-\x1f\x7f-\x9f]'
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  add column phone text not null default '+91 123 456 7890'
    check (
      phone = btrim(phone)
      and char_length(phone) between 1 and 40
      and phone !~ '[\x00-\x1f\x7f-\x9f]'
      and phone !~* '</?[a-z!][^>]*>'
    ),
  add column website text not null default ''
    check (
      char_length(website) <= 200
      and website = btrim(website)
      and website !~ '[\x00-\x1f\x7f-\x9f]'
      and (website = '' or website ~* '^https?://[^[:space:]]+$')
    );

-- Preserve the deployment-provided official name in the new profile column.
update public.rwa_settings
set full_name = case
  when name !~* '</?[a-z!][^>]*>' then name
  else 'Residents Welfare Association'
end
where id = 1;

create or replace function app_private.deployment_initialize_settings(
  p_name text,
  p_timezone text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.rwa_settings) then
    raise exception 'REGISTER_CONFLICT' using errcode = 'P0001',
      detail = 'Settings are already initialized.';
  end if;

  insert into public.rwa_settings (id, name, full_name, timezone)
  values (1, p_name, p_name, p_timezone);

  perform app_private.append_audit(
    'DEPLOYMENT', null, 'SETTINGS_INITIALIZED', 'SETTINGS', '1', null,
    pg_catalog.jsonb_build_object('timezone', p_timezone)
  );
end
$$;

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events
  add constraint audit_events_action_check check (action in (
    'BOOTSTRAP_ADMIN', 'SETTINGS_INITIALIZED', 'POLICY_APPROVAL_RECORDED',
    'RETENTION_UPDATED', 'RWA_IDENTIFIER_LABEL_UPDATED', 'RWA_PROFILE_UPDATED',
    'PROFILE_PROVISIONED', 'PROFILE_UPDATED', 'PROFILE_STATUS_CHANGED',
    'PROFILE_ROLE_CHANGED', 'HOUSEHOLD_CREATED', 'HOUSEHOLD_UPDATED',
    'DRAFT_CREATED', 'DRAFT_UPDATED', 'VOTE_ACTIVATED', 'VOTE_COMPLETED',
    'VOTE_CANCELLED', 'RETENTION_DELETED'
  ));

create or replace function public.get_rwa_display()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.rwa_settings;
begin
  perform app_private.require_enabled_member();
  select * into s from public.rwa_settings where id = 1;
  if not found then
    return pg_catalog.jsonb_build_object('name', null, 'timezone', null);
  end if;
  -- Current organization identity is admin-only; votes expose their frozen
  -- activation-time name through the authorized vote projection instead.
  return pg_catalog.jsonb_build_object('name', null, 'timezone', s.timezone);
end
$$;

create function public.get_rwa_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.rwa_settings;
begin
  perform app_private.require_enabled_admin();
  select * into s from public.rwa_settings where id = 1;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'fullName', s.full_name,
    'alias', s.alias,
    'address', s.address,
    'email', s.email,
    'phone', s.phone,
    'website', s.website,
    'identifierLabel', s.identifier_label
  );
end
$$;

create function public.get_rwa_alias()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_alias text;
begin
  if not app_private.is_enabled_member() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select alias into v_alias from public.rwa_settings where id = 1;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_alias;
end
$$;

create function public.update_rwa_profile(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_settings jsonb;
  v_full_name text;
  v_alias text;
  v_address text;
  v_email text;
  v_phone text;
  v_website text;
  v_identifier_label text;
  v_changed_fields text[] := array[]::text[];
  s public.rwa_settings;
begin
  v_actor := app_private.current_uid();
  if not app_private.is_enabled_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_settings is null
     or pg_catalog.jsonb_typeof(p_settings) <> 'object'
     or p_settings - array[
       'fullName', 'alias', 'address', 'email', 'phone', 'website',
       'identifierLabel'
     ] <> '{}'::jsonb
     or not (p_settings ?& array[
       'fullName', 'alias', 'address', 'email', 'phone', 'website',
       'identifierLabel'
     ])
     or pg_catalog.jsonb_typeof(p_settings -> 'fullName') <> 'string'
     or pg_catalog.jsonb_typeof(p_settings -> 'alias') <> 'string'
     or pg_catalog.jsonb_typeof(p_settings -> 'address') <> 'string'
     or pg_catalog.jsonb_typeof(p_settings -> 'email') <> 'string'
     or pg_catalog.jsonb_typeof(p_settings -> 'phone') <> 'string'
     or pg_catalog.jsonb_typeof(p_settings -> 'website') <> 'string'
     or pg_catalog.jsonb_typeof(p_settings -> 'identifierLabel') <> 'string' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v_full_name := p_settings ->> 'fullName';
  v_alias := p_settings ->> 'alias';
  v_address := p_settings ->> 'address';
  v_email := p_settings ->> 'email';
  v_phone := p_settings ->> 'phone';
  v_website := p_settings ->> 'website';
  v_identifier_label := p_settings ->> 'identifierLabel';

  if v_full_name is null or v_full_name <> pg_catalog.btrim(v_full_name)
     or pg_catalog.char_length(v_full_name) not between 1 and 200
     or v_full_name ~ '[\x00-\x1f\x7f-\x9f]'
     or v_full_name ~* '</?[a-z!][^>]*>'
     or v_alias is null or v_alias <> pg_catalog.btrim(v_alias)
     or pg_catalog.char_length(v_alias) not between 1 and 80
     or v_alias ~ '[\x00-\x1f\x7f-\x9f]'
     or v_alias ~* '</?[a-z!][^>]*>'
     or v_address is null or v_address <> pg_catalog.btrim(v_address)
     or pg_catalog.char_length(v_address) not between 1 and 500
     or v_address ~ '[\x00-\x08\x0b-\x1f\x7f-\x9f]'
     or v_address ~* '</?[a-z!][^>]*>'
     or v_email is null or pg_catalog.char_length(v_email) not between 3 and 254
     or v_email <> pg_catalog.btrim(v_email)
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or v_phone is null or v_phone <> pg_catalog.btrim(v_phone)
     or pg_catalog.char_length(v_phone) not between 1 and 40
     or v_phone ~ '[\x00-\x1f\x7f-\x9f]'
     or v_phone ~* '</?[a-z!][^>]*>'
     or v_website is null or v_website <> pg_catalog.btrim(v_website)
     or pg_catalog.char_length(v_website) > 200
     or v_website ~ '[\x00-\x1f\x7f-\x9f]'
     or (v_website <> '' and v_website !~* '^https?://[^[:space:]]+$')
     or v_identifier_label is null
     or v_identifier_label <> pg_catalog.btrim(v_identifier_label)
     or pg_catalog.char_length(v_identifier_label) not between 1 and 80
     or v_identifier_label ~ '[\x00-\x1f\x7f-\x9f]'
     or v_identifier_label ~* '</?[a-z!][^>]*>' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v_settings := pg_catalog.jsonb_build_object(
    'fullName', v_full_name,
    'alias', v_alias,
    'address', v_address,
    'email', v_email,
    'phone', v_phone,
    'website', v_website,
    'identifierLabel', v_identifier_label
  );

  select * into s from public.rwa_settings where id = 1 for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if s.full_name is distinct from v_full_name then
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'fullName');
  end if;
  if s.alias is distinct from v_alias then
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'alias');
  end if;
  if s.address is distinct from v_address then
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'address');
  end if;
  if s.email is distinct from v_email then
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'email');
  end if;
  if s.phone is distinct from v_phone then
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'phone');
  end if;
  if s.website is distinct from v_website then
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'website');
  end if;
  if s.identifier_label is distinct from v_identifier_label then
    v_changed_fields := pg_catalog.array_append(
      v_changed_fields, 'identifierLabel'
    );
  end if;

  update public.rwa_settings
  set full_name = v_full_name,
      name = case
        when s.full_name is distinct from v_full_name then v_full_name
        else name
      end,
      alias = v_alias,
      address = v_address,
      email = v_email,
      phone = v_phone,
      website = v_website,
      identifier_label = v_identifier_label
  where id = 1;

  if pg_catalog.cardinality(v_changed_fields) > 0 then
    perform app_private.append_audit(
      'PROFILE', v_actor, 'RWA_PROFILE_UPDATED', 'SETTINGS', '1', null,
      pg_catalog.jsonb_build_object(
        'fields', pg_catalog.to_jsonb(v_changed_fields)
      )
    );
  end if;
  return v_settings;
end
$$;

revoke all on function
  public.get_rwa_profile(),
  public.get_rwa_alias(),
  public.update_rwa_profile(jsonb)
from public, anon;
grant execute on function
  public.get_rwa_profile(),
  public.get_rwa_alias(),
  public.update_rwa_profile(jsonb)
to authenticated;

reset role;
