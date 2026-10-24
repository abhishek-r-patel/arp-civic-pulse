-- Row-level security, policies and grants (docs/DATABASE.md section 7).
--
-- Default deny: every application table has RLS enabled, no privileges are
-- left to PUBLIC, anon, authenticated or service_role, and only the safe reads
-- below are granted back. There are NO direct write grants anywhere; every
-- mutation goes through guarded routines owned by cp_owner.

set local role cp_owner;

revoke all on
  public.rwa_settings, public.profiles, public.households, public.votes,
  public.offices, public.candidates, public.poll_options, public.electorate,
  public.participation, public.open_responses, public.closed_tallies,
  public.audit_events, public.rate_limit_buckets
from public, anon, authenticated, service_role;

revoke all on sequence public.audit_events_id_seq from public, anon, authenticated, service_role;
revoke create on schema public from public, anon, authenticated;

alter table public.rwa_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.votes enable row level security;
alter table public.offices enable row level security;
alter table public.candidates enable row level security;
alter table public.poll_options enable row level security;
alter table public.electorate enable row level security;
alter table public.participation enable row level security;
alter table public.open_responses enable row level security;
alter table public.closed_tallies enable row level security;
alter table public.audit_events enable row level security;
alter table public.rate_limit_buckets enable row level security;

-- Policies call these helpers as the invoking role, so they need execute and
-- schema usage. The schema is not exposed through the Data API.
grant usage on schema app_private to authenticated;
grant execute on function
  app_private.current_uid(),
  app_private.is_enabled_member(),
  app_private.is_enabled_admin(),
  app_private.has_entitlement(uuid),
  app_private.can_view_vote(uuid),
  app_private.can_view_office(uuid),
  app_private.owns_participation(uuid, uuid)
to authenticated;

-- profiles: own enabled profile; enabled admins for register administration.
create policy profiles_read on public.profiles for select to authenticated
  using (
    (id = (select app_private.current_uid()) and status = 'ENABLED')
    or (select app_private.is_enabled_admin())
  );
grant select on public.profiles to authenticated;

-- households: enabled administrators only.
create policy households_read on public.households for select to authenticated
  using ((select app_private.is_enabled_admin()));
grant select on public.households to authenticated;

-- votes: admins see everything; members only non-drafts they are entitled to.
create policy votes_read on public.votes for select to authenticated
  using ((select app_private.can_view_vote(id)));
-- created_by_profile_id is deliberately not exposed to direct reads.
grant select (
  id, voting_type, status, title, instructions, closes_at, draft_revision,
  created_at, updated_at, activated_at, completed_at, completion_mode,
  completion_reason, cancelled_at, cancellation_reason, rwa_name_snapshot,
  timezone_snapshot, policy_versions_snapshot
) on public.votes to authenticated;

create policy offices_read on public.offices for select to authenticated
  using ((select app_private.can_view_vote(vote_id)));
grant select on public.offices to authenticated;

create policy candidates_read on public.candidates for select to authenticated
  using ((select app_private.can_view_office(office_id)));
grant select on public.candidates to authenticated;

create policy poll_options_read on public.poll_options for select to authenticated
  using ((select app_private.can_view_vote(vote_id)));
grant select on public.poll_options to authenticated;

-- electorate: own frozen entitlement, or enabled admin.
create policy electorate_read on public.electorate for select to authenticated
  using (
    (select app_private.is_enabled_admin())
    or (representative_profile_id = (select app_private.current_uid())
        and (select app_private.has_entitlement(vote_id)))
  );
grant select on public.electorate to authenticated;

-- participation: own status, or enabled admin (no choices are ever stored here).
create policy participation_read on public.participation for select to authenticated
  using (
    (select app_private.is_enabled_admin())
    or (select app_private.owns_participation(vote_id, household_id))
  );
grant select on public.participation to authenticated;

create policy audit_events_read on public.audit_events for select to authenticated
  using ((select app_private.is_enabled_admin()));
grant select on public.audit_events to authenticated;

-- rwa_settings, open_responses, closed_tallies and rate_limit_buckets have RLS
-- enabled, no policies and no grants: not readable by any API role.

-- Private tables must never appear in a Realtime/logical publication.
do $$
declare
  v_found text;
begin
  select string_agg(schemaname || '.' || tablename, ', ') into v_found
  from pg_publication_tables
  where schemaname = 'public'
    and tablename in (
      'rwa_settings', 'profiles', 'households', 'votes', 'offices', 'candidates',
      'poll_options', 'electorate', 'participation', 'open_responses',
      'closed_tallies', 'audit_events', 'rate_limit_buckets');
  if v_found is not null then
    raise exception 'Application tables must not be published: %', v_found;
  end if;
end
$$;

reset role;
