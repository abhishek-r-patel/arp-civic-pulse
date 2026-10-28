-- Combined resident directory for the administrator Residents screen (docs/DATABASE.md section 3.2).
--
-- Each profile with its optional household, sorted by household identifier then
-- name. security_invoker makes the caller's own profiles/households RLS apply,
-- so committee members see everyone and members see nothing beyond their own row.
set local role cp_owner;

create view public.resident_directory with (security_invoker = true) as
select
  p.id,
  p.representative_name,
  p.status,
  p.is_admin,
  p.is_readonly,
  p.self_registered,
  p.updated_at,
  h.id as household_id,
  h.identifier as household_identifier,
  h.identifier_normalized as household_identifier_normalized,
  h.is_eligible as household_is_eligible,
  -- One keyset column: people with a household first, by identifier, then name.
  -- U+001F cannot occur in identifiers or names (both reject control characters).
  (case when h.id is null then '1' else '0' end)
    || coalesce(h.identifier_normalized, '') || pg_catalog.chr(31)
    || pg_catalog.lower(p.representative_name) as sort_key
from public.profiles p
left join public.households h on h.representative_profile_id = p.id;

revoke all on public.resident_directory from public, anon, authenticated, service_role;
grant select on public.resident_directory to authenticated;

reset role;
