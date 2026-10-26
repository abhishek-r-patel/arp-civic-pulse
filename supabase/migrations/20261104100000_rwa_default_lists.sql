-- Adds two optional administrator-only RWA settings lists:
--   default_households  identifiers offered as type-ahead suggestions when an
--                       administrator adds a household (up to 1000 entries,
--                       each 1-100 characters, the household identifier limit).
--   rwa_positions       office names offered as suggestions, and through
--                       "Add All Positions", in PRIVATE vote drafts (up to 50
--                       entries, each 1-200 characters, the office name limit).
-- Both are suggestions only: they never create households or offices by
-- themselves. Entries are trimmed single-line plain text, unique after the
-- household key normalization (trim, NFKC, collapsed whitespace, case-fold).
-- get_rwa_profile and update_rwa_profile gain the two keys; member branding and
-- the public identity projection deliberately do not expose them.

set local role cp_owner;

create function app_private.is_valid_settings_list(
  p_items text[], p_max_items integer, p_max_length integer
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_items is not null
    and pg_catalog.cardinality(p_items) <= p_max_items
    and not exists (
      select 1
      from pg_catalog.unnest(p_items) as item
      where item is null
        or item <> pg_catalog.btrim(item)
        or pg_catalog.char_length(item) not between 1 and p_max_length
        or item ~ '[\x00-\x1f\x7f-\x9f]'
        or item ~* '</?[a-z!][^>]*>'
    )
    and (
      select pg_catalog.count(distinct app_private.normalize_key(item))
      from pg_catalog.unnest(p_items) as item
    ) = pg_catalog.cardinality(p_items)
$$;

alter table public.rwa_settings
  add column default_households text[] not null default '{}',
  add column rwa_positions text[] not null default
    '{President,Vice-President,Secretary,Joint-Secretary,Treasurer}';

alter table public.rwa_settings
  add constraint rwa_settings_default_households_check check (
    app_private.is_valid_settings_list(default_households, 1000, 100)
  ),
  add constraint rwa_settings_rwa_positions_check check (
    app_private.is_valid_settings_list(rwa_positions, 50, 200)
  );

CREATE OR REPLACE FUNCTION public.get_rwa_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'householdLabel', s.household_label,
    'identifierKind', s.identifier_kind,
    'defaultHouseholds', pg_catalog.to_jsonb(s.default_households),
    'rwaPositions', pg_catalog.to_jsonb(s.rwa_positions)
  );
end
$function$;

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
    'accentPalette', 'welcomeMessage', 'householdLabel', 'identifierKind'
  ];
  v_list_keys constant text[] := array['defaultHouseholds', 'rwaPositions'];
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
  v_household_label text;
  v_identifier_kind text;
  v_default_households text[];
  v_rwa_positions text[];
  v_changed_fields text[] := array[]::text[];
  s public.rwa_settings;
begin
  v_actor := app_private.current_uid();
  if not app_private.is_enabled_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_settings is null
     or pg_catalog.jsonb_typeof(p_settings) <> 'object'
     or p_settings - v_keys - v_list_keys <> '{}'::jsonb
     or not (p_settings ?& v_keys)
     or not (p_settings ?& v_list_keys) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  foreach v_key in array v_keys loop
    if pg_catalog.jsonb_typeof(p_settings -> v_key) <> 'string' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;
  foreach v_key in array v_list_keys loop
    if pg_catalog.jsonb_typeof(p_settings -> v_key) <> 'array'
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(p_settings -> v_key) as item
         where pg_catalog.jsonb_typeof(item) <> 'string'
       ) then
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
  v_household_label := p_settings ->> 'householdLabel';
  v_identifier_kind := p_settings ->> 'identifierKind';
  v_default_households := array(
    select pg_catalog.jsonb_array_elements_text(p_settings -> 'defaultHouseholds')
  );
  v_rwa_positions := array(
    select pg_catalog.jsonb_array_elements_text(p_settings -> 'rwaPositions')
  );

  if v_full_name <> pg_catalog.btrim(v_full_name)
     or pg_catalog.char_length(v_full_name) not between 1 and 200
     or v_full_name ~ '[\x00-\x1f\x7f-\x9f]'
     or v_full_name ~* '</?[a-z!][^>]*>'
     or v_alias <> pg_catalog.btrim(v_alias)
     or pg_catalog.char_length(v_alias) not between 1 and 80
     or v_alias ~ '[\x00-\x1f\x7f-\x9f]'
     or v_alias ~* '</?[a-z!][^>]*>'
     or v_address <> pg_catalog.btrim(v_address)
     or pg_catalog.char_length(v_address) > 500
     or v_address ~ '[\x00-\x08\x0b-\x1f\x7f-\x9f]'
     or v_address ~* '</?[a-z!][^>]*>'
     or pg_catalog.char_length(v_email) > 254
     or v_email <> pg_catalog.btrim(v_email)
     or (v_email <> ''
         and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
     or v_email ~ '[\x00-\x1f\x7f-\x9f]'
     or v_phone <> pg_catalog.btrim(v_phone)
     or pg_catalog.char_length(v_phone) > 40
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
     or v_household_label <> pg_catalog.btrim(v_household_label)
     or pg_catalog.char_length(v_household_label) not between 1 and 40
     or v_household_label ~ '[\x00-\x1f\x7f-\x9f]'
     or v_household_label ~* '</?[a-z!][^>]*>'
     or v_identifier_kind not in ('NUMBER', 'ID')
     or not app_private.is_valid_settings_list(v_default_households, 1000, 100)
     or not app_private.is_valid_settings_list(v_rwa_positions, 50, 200) then
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
    'householdLabel', v_household_label,
    'identifierKind', v_identifier_kind,
    'defaultHouseholds', pg_catalog.to_jsonb(v_default_households),
    'rwaPositions', pg_catalog.to_jsonb(v_rwa_positions)
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
  if s.household_label is distinct from v_household_label then
    v_changed_fields := pg_catalog.array_append(
      v_changed_fields, 'householdLabel'
    );
  end if;
  if s.identifier_kind is distinct from v_identifier_kind then
    v_changed_fields := pg_catalog.array_append(
      v_changed_fields, 'identifierKind'
    );
  end if;
  if s.default_households is distinct from v_default_households then
    v_changed_fields := pg_catalog.array_append(
      v_changed_fields, 'defaultHouseholds'
    );
  end if;
  if s.rwa_positions is distinct from v_rwa_positions then
    v_changed_fields := pg_catalog.array_append(
      v_changed_fields, 'rwaPositions'
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
      household_label = v_household_label,
      identifier_kind = v_identifier_kind,
      default_households = v_default_households,
      rwa_positions = v_rwa_positions
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

reset role;
