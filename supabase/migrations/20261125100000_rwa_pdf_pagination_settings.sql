-- Persist bounded per-RWA PDF result pagination preferences.

set local role cp_owner;

alter table public.rwa_settings
  add column pdf_cards_per_page smallint not null default 8,
  add column pdf_voters_per_page smallint not null default 50,
  add constraint rwa_settings_pdf_cards_per_page_check
    check (pdf_cards_per_page between 1 and 8),
  add constraint rwa_settings_pdf_voters_per_page_check
    check (pdf_voters_per_page between 1 and 50);

create or replace function public.get_rwa_profile()
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  s public.rwa_settings;
begin
  perform app_private.require_enabled_committee();
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
    'pdfCardsPerPage', s.pdf_cards_per_page,
    'pdfVotersPerPage', s.pdf_voters_per_page,
    'defaultHouseholds', pg_catalog.to_jsonb(s.default_households),
    'rwaPositions', pg_catalog.to_jsonb(s.rwa_positions)
  );
end
$$;

create or replace function public.get_rwa_branding()
returns jsonb
language plpgsql
stable security definer
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
  -- Display preferences only: never approvals or retention settings.
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
    'pdfCardsPerPage', s.pdf_cards_per_page,
    'pdfVotersPerPage', s.pdf_voters_per_page
  );
end
$$;

do $migration$
declare
  v_definition text;
  v_needles text[] := array[
    $needle$  v_list_keys constant text[] := array['defaultHouseholds', 'rwaPositions'];$needle$,
    $needle$p_settings - v_keys - v_list_keys$needle$,
    $needle$not (p_settings ?& v_list_keys)$needle$,
    $needle$  v_rwa_positions text[];$needle$,
    $needle$  v_full_name := p_settings ->> 'fullName';$needle$,
    $needle$  v_identifier_kind := p_settings ->> 'identifierKind';$needle$,
    $needle$     or v_identifier_kind not in ('NUMBER', 'ID')$needle$,
    $needle$    'identifierKind', v_identifier_kind,$needle$,
    $needle$  if s.default_households is distinct from v_default_households then$needle$,
    $needle$identifier_kind = v_identifier_kind,$needle$
  ];
  v_replacements text[] := array[
    $replacement$  v_list_keys constant text[] := array['defaultHouseholds', 'rwaPositions'];
  v_number_keys constant text[] := array['pdfCardsPerPage', 'pdfVotersPerPage'];$replacement$,
    $replacement$p_settings - v_keys - v_list_keys - v_number_keys$replacement$,
    $replacement$not (p_settings ?& v_list_keys)
     or not (p_settings ?& v_number_keys)$replacement$,
    $replacement$  v_rwa_positions text[];
  v_pdf_cards_per_page numeric;
  v_pdf_voters_per_page numeric;$replacement$,
    $replacement$  if pg_catalog.jsonb_typeof(p_settings -> 'pdfCardsPerPage') <> 'number'
     or pg_catalog.jsonb_typeof(p_settings -> 'pdfVotersPerPage') <> 'number' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v_full_name := p_settings ->> 'fullName';$replacement$,
    $replacement$  v_identifier_kind := p_settings ->> 'identifierKind';
  v_pdf_cards_per_page := (p_settings ->> 'pdfCardsPerPage')::numeric;
  v_pdf_voters_per_page := (p_settings ->> 'pdfVotersPerPage')::numeric;$replacement$,
    $replacement$     or v_identifier_kind not in ('NUMBER', 'ID')
     or v_pdf_cards_per_page <> pg_catalog.trunc(v_pdf_cards_per_page)
     or v_pdf_cards_per_page not between 1 and 8
     or v_pdf_voters_per_page <> pg_catalog.trunc(v_pdf_voters_per_page)
     or v_pdf_voters_per_page not between 1 and 50$replacement$,
    $replacement$    'identifierKind', v_identifier_kind,
    'pdfCardsPerPage', v_pdf_cards_per_page,
    'pdfVotersPerPage', v_pdf_voters_per_page,$replacement$,
    $replacement$  if s.pdf_cards_per_page is distinct from v_pdf_cards_per_page::smallint then
    v_changed_fields := pg_catalog.array_append(
      v_changed_fields, 'pdfCardsPerPage'
    );
  end if;
  if s.pdf_voters_per_page is distinct from v_pdf_voters_per_page::smallint then
    v_changed_fields := pg_catalog.array_append(
      v_changed_fields, 'pdfVotersPerPage'
    );
  end if;
  if s.default_households is distinct from v_default_households then$replacement$,
    $replacement$identifier_kind = v_identifier_kind,
      pdf_cards_per_page = v_pdf_cards_per_page::smallint,
      pdf_voters_per_page = v_pdf_voters_per_page::smallint,$replacement$
  ];
  v_index integer;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.update_rwa_profile(jsonb)'::regprocedure
  );
  for v_index in 1..pg_catalog.cardinality(v_needles) loop
    if pg_catalog.strpos(v_definition, v_needles[v_index]) = 0 then
      raise exception
        'Could not find expected update_rwa_profile fragment %', v_index;
    end if;
    v_definition := pg_catalog.replace(
      v_definition,
      v_needles[v_index],
      v_replacements[v_index]
    );
  end loop;
  execute v_definition;
end
$migration$;

reset role;