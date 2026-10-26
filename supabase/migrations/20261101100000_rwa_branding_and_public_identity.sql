-- RWA branding (accent palette, welcome message) and the projections that let
-- pages show the current RWA values. Enabled members read a branding projection
-- (never the administrator settings page); public pages obtain a tiny identity
-- projection through the server-only service role, so `anon` still executes no
-- routine. Votes keep their historical `rwa_name_snapshot` column as an audit
-- record, but screens and exports now show the current RWA name.

set local role cp_owner;

alter table public.rwa_settings
  add column accent_palette text not null default 'TEAL'
    check (accent_palette in ('TEAL', 'BLUE', 'FOREST', 'PLUM', 'SLATE')),
  add column welcome_message text not null default ''
    check (
      char_length(welcome_message) <= 300
      and welcome_message = btrim(welcome_message)
      and welcome_message !~ '[\x00-\x08\x0b-\x1f\x7f-\x9f]'
      and welcome_message !~* '</?[a-z!][^>]*>'
    );

-- The alias-only projection is replaced by the fuller member branding read.
drop function public.get_rwa_alias();

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
  -- Only what members already see: never approvals or retention.
  return pg_catalog.jsonb_build_object('name', s.name, 'timezone', s.timezone);
end
$$;

create or replace function public.get_rwa_profile()
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
    'accentPalette', s.accent_palette,
    'welcomeMessage', s.welcome_message,
    'identifierLabel', s.identifier_label
  );
end
$$;

create function public.get_rwa_branding()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.rwa_settings;
begin
  if not app_private.is_enabled_member() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into s from public.rwa_settings where id = 1;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  -- Display values only: never approvals, retention or the identifier label.
  return pg_catalog.jsonb_build_object(
    'fullName', s.full_name,
    'alias', s.alias,
    'address', s.address,
    'email', s.email,
    'phone', s.phone,
    'website', s.website,
    'accentPalette', s.accent_palette,
    'welcomeMessage', s.welcome_message
  );
end
$$;

-- Public pages (sign-in, privacy) show the name, alias and address. The Next.js
-- server fetches them with the service role so anonymous callers still cannot
-- execute any database routine directly.
create function public.get_public_rwa_identity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.rwa_settings;
begin
  perform app_private.require_service_role();
  select * into s from public.rwa_settings where id = 1;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'fullName', s.full_name,
    'alias', s.alias,
    'address', s.address,
    'accentPalette', s.accent_palette
  );
end
$$;

create or replace function public.update_rwa_profile(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_keys constant text[] := array[
    'fullName', 'alias', 'address', 'email', 'phone', 'website',
    'accentPalette', 'welcomeMessage', 'identifierLabel'
  ];
  v_key text;
  v_settings jsonb;
  v_full_name text;
  v_alias text;
  v_address text;
  v_email text;
  v_phone text;
  v_website text;
  v_accent_palette text;
  v_welcome_message text;
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
     or p_settings - v_keys <> '{}'::jsonb
     or not (p_settings ?& v_keys) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  foreach v_key in array v_keys loop
    if pg_catalog.jsonb_typeof(p_settings -> v_key) <> 'string' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;

  v_full_name := p_settings ->> 'fullName';
  v_alias := p_settings ->> 'alias';
  v_address := p_settings ->> 'address';
  v_email := p_settings ->> 'email';
  v_phone := p_settings ->> 'phone';
  v_website := p_settings ->> 'website';
  v_accent_palette := p_settings ->> 'accentPalette';
  v_welcome_message := p_settings ->> 'welcomeMessage';
  v_identifier_label := p_settings ->> 'identifierLabel';

  if v_full_name <> pg_catalog.btrim(v_full_name)
     or pg_catalog.char_length(v_full_name) not between 1 and 200
     or v_full_name ~ '[\x00-\x1f\x7f-\x9f]'
     or v_full_name ~* '</?[a-z!][^>]*>'
     or v_alias <> pg_catalog.btrim(v_alias)
     or pg_catalog.char_length(v_alias) not between 1 and 80
     or v_alias ~ '[\x00-\x1f\x7f-\x9f]'
     or v_alias ~* '</?[a-z!][^>]*>'
     or v_address <> pg_catalog.btrim(v_address)
     or pg_catalog.char_length(v_address) not between 1 and 500
     or v_address ~ '[\x00-\x08\x0b-\x1f\x7f-\x9f]'
     or v_address ~* '</?[a-z!][^>]*>'
     or pg_catalog.char_length(v_email) not between 3 and 254
     or v_email <> pg_catalog.btrim(v_email)
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or v_email ~ '[\x00-\x1f\x7f-\x9f]'
     or v_phone <> pg_catalog.btrim(v_phone)
     or pg_catalog.char_length(v_phone) not between 1 and 40
     or v_phone ~ '[\x00-\x1f\x7f-\x9f]'
     or v_phone ~* '</?[a-z!][^>]*>'
     or v_website <> pg_catalog.btrim(v_website)
     or pg_catalog.char_length(v_website) > 200
     or v_website ~ '[\x00-\x1f\x7f-\x9f]'
     or (v_website <> '' and v_website !~* '^https?://[^[:space:]]+$')
     or v_accent_palette not in ('TEAL', 'BLUE', 'FOREST', 'PLUM', 'SLATE')
     or v_welcome_message <> pg_catalog.btrim(v_welcome_message)
     or pg_catalog.char_length(v_welcome_message) > 300
     or v_welcome_message ~ '[\x00-\x08\x0b-\x1f\x7f-\x9f]'
     or v_welcome_message ~* '</?[a-z!][^>]*>'
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
    'accentPalette', v_accent_palette,
    'welcomeMessage', v_welcome_message,
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
  if s.accent_palette is distinct from v_accent_palette then
    v_changed_fields := pg_catalog.array_append(
      v_changed_fields, 'accentPalette'
    );
  end if;
  if s.welcome_message is distinct from v_welcome_message then
    v_changed_fields := pg_catalog.array_append(
      v_changed_fields, 'welcomeMessage'
    );
  end if;
  if s.identifier_label is distinct from v_identifier_label then
    v_changed_fields := pg_catalog.array_append(
      v_changed_fields, 'identifierLabel'
    );
  end if;

  update public.rwa_settings
  set full_name = v_full_name,
      -- `name` is the official name shown on screens and exports.
      name = v_full_name,
      alias = v_alias,
      address = v_address,
      email = v_email,
      phone = v_phone,
      website = v_website,
      accent_palette = v_accent_palette,
      welcome_message = v_welcome_message,
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

revoke all on function public.get_rwa_branding()
from public, anon;
grant execute on function public.get_rwa_branding() to authenticated;

revoke all on function public.get_public_rwa_identity()
from public, anon, authenticated;
grant execute on function public.get_public_rwa_identity() to service_role;

reset role;
