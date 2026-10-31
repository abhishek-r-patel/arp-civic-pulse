# Supabase operations (Civic Pulse)

Everything here is for **local, test and staging** work first. Production changes need the approvals
listed in `docs/IMPLEMENTATION_PLAN.md`; nothing below records or implies an approval.

## SQL files at a glance

| Path | What it is | Where it runs |
| --- | --- | --- |
| `supabase/migrations/*.sql` (44 files) | The database itself: tables, rules, security and routines, applied in version order | Every customer, demo and test Supabase project, through the Supabase CLI or `npm run ops -- provision --apply-migrations` |
| `supabase/seed.sql` | Intentionally empty; Civic Pulse seeds no data | Only a local `supabase db reset`; it loads nothing |
| `tests/integration/support/roles.sql` | Test-only copies of Supabase's database roles | Only a disposable local PostgreSQL used by `npm run test:integration` |
| `tests/integration/support/supabase-stub.sql` | Test-only stand-in for Supabase's `auth` schema and default grants | Same disposable local PostgreSQL; never a real project |
| `supabase/config.toml` | Supabase CLI settings for local work (PostgreSQL 17, Auth) | Local CLI only |
| `supabase/templates/magic_link.html` | The sign-in code email template | Supabase Auth |

Operational scripts in `scripts/ops` also send short SQL statements (status checks, backups, demo reset). They call
the routines defined by the migrations and never change the schema.

**Never edit, rename, reorder, combine or delete a migration that has been applied to any hosted project.** Each
project records applied versions in its history; changing a file makes new projects differ from existing ones and
can break future pushes. Make every change, including a removal, in a new migration with a later version.

To find where a table or routine is defined, which migration last changed it and what calls it, see the
[object map in the database document](../docs/DATABASE.md#where-each-database-object-is-defined).

## Migrations

Ordered, immutable SQL in `supabase/migrations`, applied with the Supabase CLI and deployment-only
credentials (`SUPABASE_ACCESS_TOKEN`, `MIGRATION_DATABASE_URL`). The application never runs migrations
at start-up, and never uses the migration credentials.

The migrations are grouped below by area so you can find the one you need. Within each area they are listed in the
order they run. The number prefix is a date and time (`YYYYMMDDhhmmss`); the CLI always applies files in that order,
whatever their area.

### Foundation and security

Tables, owner role, helper and guard functions, row-level security, audit log, deployment procedures and the rate limiter. Almost everything else builds on these.

| Migration | Purpose |
| --- | --- |
| `20261024100000_core_schema` | Restricted owner role `cp_owner`, tables, constraints, indexes |
| `20261024100100_guards_and_helpers` | Authorization helpers, lifecycle/freeze guards, ad hoc write guards, deferred invariant checks |
| `20261024100200_rls_and_grants` | RLS on every table, safe read-only policies and grants, no write grants |
| `20261024100300_audit_settings_provisioning` | Audit append, deployment procedures (settings, approvals, retention, first admin), provisioning routines |
| `20261024100400_rate_limiting` | Supplemental application rate-limit routine |
| `20261024130100_deferred_trigger_definer` | Deferred invariant triggers made `SECURITY DEFINER` (PostgreSQL 17/18 behave differently otherwise) |

### Vote drafts, lifecycle and ballots

Creating and editing drafts, scheduling, opening, deadlines, completing/cancelling votes, and casting ballots.

| Migration | Purpose |
| --- | --- |
| `20261024120000_vote_drafts` | Revision-checked draft routines, deferrable position uniqueness, preview, RWA display |
| `20261024130000_activation_lifecycle` | Activation freeze, early completion/cancellation, due completion, `cp_scheduler` role and the Cron job |
| `20261024140000_cast_vote` | `cast_vote` and `get_my_participation`; fixes the activation guard and preview blockers that looked at other votes |
| `20261026100000_open_poll_live_results_and_changes` | Active PUBLIC aggregates and guarded PUBLIC response replacement; PRIVATE finality unchanged |
| `20261027100000_open_multi_select` | Configurable PUBLIC single/multi-select, normalized option responses and household-grouped completed results |
| `20261103100000_public_private_voting` | Renames voting types `OPEN`/`CLOSED` to `PUBLIC`/`PRIVATE` in data, checks and routines; internal names, error codes and audit history unchanged |
| `20261105100000_change_vote_deadline` | Guarded, audited active deadline changes |
| `20261107100000_scheduled_opening` | Frozen scheduled state, database-clock opening, direct-read ballot privacy, pre-opening withdrawal and existing Cron integration |
| `20261121100000_vote_draft_opening` | Stores a planned opening time in a draft without scheduling or freezing it |
| `20261121110000_draft_opening_public_private_types` | Keeps draft updates aligned with the PUBLIC/PRIVATE voting type values |
| `20261122100000_delete_drafts` | Adds revision-checked, confirmed and audited draft deletion |

### Results and privacy

What members and administrators may see while a vote runs and after it ends.

| Migration | Purpose |
| --- | --- |
| `20261024150000_member_votes_results` | Member vote list/detail, authorized `get_vote_results`, admin participation monitor, audit history |
| `20261028100000_nota_closed_elections` | Uses NOTA for PRIVATE null-candidate tallies and exposes the NOTA count in result projections |
| `20261029100000_live_closed_turnout` | Exposes aggregate turnout during active PRIVATE elections without candidate/NOTA totals; household participation remains admin-only |

### RWA settings and branding

The single RWA settings row: name, contact details, household wording, colours and suggestion lists.

| Migration | Purpose |
| --- | --- |
| `20261030100000_configurable_identifier_label` | RWA identifier display label, enabled-member read RPC and audited admin update RPC |
| `20261031100000_rwa_profile_settings` | RWA identity/contact columns, audited admin profile RPCs and default values |
| `20261101100000_rwa_branding_and_public_identity` | Accent palette and welcome message, member branding projection, service-role-only public identity routine; replaces the alias-only read |
| `20261102100000_optional_rwa_contact_fields` | Makes RWA address, email and phone optional (empty text allowed and hidden); full name, alias and identifier label stay required |
| `20261103110000_household_label_and_identifier_kind` | Replaces the identifier label with a household label and a Number/ID identifier kind (backfilled), drops the old label RPCs, and returns the new values from the profile, branding and public identity routines |
| `20261104100000_rwa_default_lists` | Administrator-only household and office suggestion lists |
| `20261124100000_add_amber_accent_palette` | Adds the Amber accent to the RWA settings constraint and guarded update validation |

### Residents, accounts and roles

Households, profiles, imports, self-registration, the read-only committee role and directories.

| Migration | Purpose |
| --- | --- |
| `20261024110000_register_administration` | Guarded household and account maintenance routines (audited, last-administrator guard) |
| `20261106100000_register_import` | Current-admin import checks and retry-safe household assignment without overwriting records or enabling accounts |
| `20261108100000_readonly_committee_role` | Exclusive `rwa-readonly` profile flag, admin-equivalent authorized reads, admin-only mutations/role assignment and household-voting compatibility |
| `20261109100000_resident_self_registration` | `profiles.self_registered`, `PROFILE_SELF_REGISTERED` audit action, service-role-only `get_self_registration_households` and `self_register_resident` (suspended profile + ineligible household, duplicate email/household rejected, limited to configured Default Households when set) |
| `20261110100000_account_with_household` | Service-role-only `provision_profile_with_household`: an administrator-created suspended profile and its household in one audited transaction |
| `20261111100000_resident_directory` | Existing security-invoker profile/household view now used for the unified Residents directory's filtered flat/name-ordered IDs |
| `20261113100000_readonly_household_optional` | Household-free management-role enablement without voting entitlement |
| `20261123100000_enabled_rwa_admin_names` | Adds an enabled-member-only, names-only RWA Admin directory projection for Contact |

### Admin tables, search and pagination

Read-only page, filter and sort routines behind the administrator tables. They change no data.

| Migration | Purpose |
| --- | --- |
| `20261114100000_numbered_pagination` | Authenticated, guarded filtered totals and bounded page-anchor lookup for numbered UI navigation; existing list/result routines and cursor APIs are unchanged |
| `20261115100000_resident_table_controls` | Committee-only globally sorted/filtered resident page IDs with exact metadata; existing HTTP cursor APIs and write routines unchanged |
| `20261116100000_resident_identifier_contains` | Literal normalized identifier substring filter in the table RPC; existing exact identifier filter retained |
| `20261117100000_resident_source_sort` | Adds global Source ordering to the committee table RPC; boolean filtering and grants unchanged |
| `20261118100000_audit_text_filters` | Adds bounded actor and combined Details/reason substring filters and matching numbered audit totals |
| `20261119100000_admin_vote_table_controls` | Committee-only global Manage Votes table filters, sorting and exact page IDs; existing HTTP cursor list unchanged |
| `20261120100000_admin_vote_turnout` | Adds page-bounded frozen-electorate and participation aggregates for Active/Completed Manage Votes rows only |

### Operations and support access

Retention clean-up, health/status checks for monitoring, and RWA-controlled App Support Access.

| Migration | Purpose |
| --- | --- |
| `20261024160000_retention_maintenance` | Retention execution (`run_maintenance`, Cron daily), operational status and health ping, retention guard exceptions |
| `20261112100000_app_support_access` | RWA-controlled, household-free read-only App Support Access |

### Application history

The notes below record how individual migrations reached the disposable hosted projects. They are history, not
instructions; use the deployment runbook for new work.

The Amber palette migration was originally named with the already-applied
`20261105100000` version. It was assigned the unused forward version
`20261124100000`; the already-applied deadline migration and remote history were
left unchanged. The new migration was applied by the normal Supabase CLI after
a dry run showed it as the only pending migration.

The separately authorized audit-filter migration `20261118100000` and draft
deletion migration `20261122100000` were applied to the verified
`civic-pulse-disposable` project in one verified-TLS transaction with matching
ledger entries and a PostgREST schema reload. The same disposable project is
used by the staging host. These database changes did not deploy the staging
application and did not change a separate production database.

The Source column requires `20261117100000` before its sort links are used.
It passed local PostgreSQL tests and was applied with separate explicit
authorization only to the verified disposable project, together with its
ledger entry in one verified-TLS transaction and a PostgREST schema reload.
Authenticated execute is present; anon/service-role execute is absent.

Manage Votes table controls migration `20261119100000` adds a guarded,
authenticated-only page-ID routine. After separate authorization, it was applied
only to the verified `civic-pulse-disposable` project in one verified-TLS
transaction that executed the exact migration, recorded its ledger entry and
notified PostgREST to reload the schema. Function ownership and authenticated
execution were verified; anon/service-role execution is absent. This is the
disposable project also used by the staging host; no separate production
database was touched and no staging app deployment occurred. The old version
collision was later resolved by assigning the unapplied Amber migration a unique
forward version; the existing deadline history was not rewritten.

The Manage Votes Turnout column adds follow-up migration `20261120100000`,
which replaces only the already-guarded table-page routine and returns
aggregate counts for Active/Completed page rows. After separate authorization,
it was applied only to the verified `civic-pulse-disposable` project in one
verified-TLS transaction with its exact ledger entry and a PostgREST schema
notification. Function ownership and authenticated-only execution were
verified; anon/service-role execution is absent. Local PostgreSQL integration
coverage passed. This is the disposable project also used by the staging host;
no separate production database was touched and no staging app deployment
occurred. The later migration-history reconciliation is recorded below.

The planned-opening migration `20261121100000` and its type-check correction
`20261121110000` were applied only to the user-confirmed disposable project in
separate TLS-verified transactions with their exact ledger entries. The
correction keeps `update_draft` ballot validation aligned with PUBLIC/PRIVATE.
The same project is used by the staging host; no separate production database
was changed and no staging application deployment was performed.

The Contact admin-name migration `20261123100000` was separately authorized
and applied only to the confirmed `civic-pulse-disposable` project (also used by
the staging host). Its exact SQL and matching ledger entry were committed in
one verified-TLS transaction, followed by a PostgREST schema reload. The
preflight found no active or scheduled votes. Function ownership, fixed search
path and authenticated-only execution were verified; anon and service-role
execution are absent. The local RWA-profile and security integration suites
passed (28 tests), and the signed-in Contact page loaded the admin directory.
No separate production database was changed and no staging application
deployment was performed. The audit-filter and draft-deletion migrations were
subsequently applied as recorded above.

That file originally omitted its trailing `reset role;`, so a fresh CLI push
failed when `cp_owner` tried to record the history entry (the transaction rolled
back). `reset role;` was later appended; it changes no created objects, grants
or ownership. The disposable project's recorded entry is unaffected and was not
repaired. The second disposable tenant-test project (`hnqajjjemqepxuoqbsqx`)
then received the full migration set through the normal CLI push.

The separately authorized numbered-pagination follow-up applied
`20261114100000` to the same disposable project, now also used by the
Production-target-only staging host. A CLI dry run listed only this migration
before application. Local PostgreSQL tests exercise counts, ordering, filters,
page anchors and permissions; synthetic browser checks use the local app against
that disposable database. The pagination application revision has not been
deployed by this task, and no real-production project was migrated.

The Residents-tab experiment applied `20261111100000` to that disposable project.
The earlier application rollback preserved this additive view and its
migration/test files. The current Residents consolidation consumes the existing
view with page-scoped current-profile enrichment, including App Support flags.
It adds no migration and changes no RLS, grants or voting permissions. No
database rollback, data deletion, history repair or hosted deployment is part
of this local consolidation.

For the separately authorized 27 October screenshot capture, the `20261106100000`
and `20261107100000` migrations were applied to the confirmed disposable hosted project through the
CLI, with a preceding dry run and `--skip-vault`; production was untouched.
They end with `RESET ROLE` so the deployment role, not `cp_owner`, records the
CLI history entry. The initial failed attempt rolled back fully, verified
read-only before correcting the then-unapplied files. Never manually repair
history or rewrite an already-recorded migration to reproduce that fix.

## Ownership and permissions

All objects are owned by `cp_owner` (non-login, no superuser, no BYPASSRLS, no access to the Supabase `auth`
schema). Every table has row-level security enabled; it is deliberately not *forced*, because the guarded
`SECURITY DEFINER` routines run as `cp_owner` and do their own checks (see
[DATABASE.md section 7](../docs/DATABASE.md#7-ownership-authorization-and-row-level-security)).
`anon` and `authenticated` hold no table write privileges. `authenticated` may execute the `app_private` helpers
that row-level security policies call (`current_uid`, `is_enabled_member`, `is_enabled_admin`,
`is_enabled_committee`, `has_entitlement`, `can_view_vote`, `can_view_office`, `can_view_ballot`,
`owns_participation`). `service_role` can only execute the server-only routines (`provision_profile`,
`enable_profile`, `consume_rate_limit`, `reconcile_vote`, `self_register_resident`,
`get_self_registration_households`, `provision_profile_with_household`, `set_app_support_access`, plus the
read-only `get_public_rwa_identity`, `health_ping` and `operational_status`). The two Cron jobs run through the
non-login `cp_scheduler` role, which can execute exactly two routines: `public.complete_due_votes()` (every minute)
and `public.run_maintenance()` (daily at 21:30 UTC).
Scheduling needs the `pg_cron` extension (available on Supabase); where it is missing the migration skips scheduling
and says so.

### Objects created by Supabase, not by these migrations

Newer Supabase projects include `public.rls_auto_enable()` and its `ensure_rls` event trigger, which switch on
row-level security for any new table in `public`. Supabase owns them (as `postgres`); they are not part of this
repository and need no action. Because the function returns `event_trigger`, it cannot be called directly even
though `anon` holds the default execute grant. Older projects may not have it. Other Supabase-managed event
triggers (`pgrst_*`, `issue_*`) are likewise provider objects.

### Schema health check: 31 October 2026

A read-only review compared the 44 migrations with the application, the operations scripts and both hosted
synthetic projects (customer A and the demo), using read-only transactions over verified TLS. No data or schema was
changed.

- Both projects record 44/44 migrations (latest `20261124100000`) and contain exactly the repository's 13 tables,
  1 view and routines, plus the Supabase-managed `rls_auto_enable` on the demo project.
- Every table has row-level security and is owned by `cp_owner`; no table is readable or writable by `anon`, and
  none is writable by `authenticated`. Every `SECURITY DEFINER` routine fixes its `search_path`. Both Cron jobs are
  active.
- Every routine the application calls exists, and every live routine has a caller (application, server key,
  operations script, Cron, operator procedure, trigger or another routine). Nothing unused was found, so no removal
  migration is proposed.
- A plain search for routine names gives false "unused" results, so confirm by hand before treating anything as
  removable. `public.import_register_household` is passed through a helper in `src/server/register/import.ts`
  rather than named in a direct call; `public.complete_due_votes` and `public.run_maintenance` are named only inside
  the Cron job text; `app_private.deployment_invalidate_policy_approval` and `app_private.deployment_set_retention`
  are run by hand from the deployment procedures below. All five also have integration tests.
- `npm run test:integration` on a disposable PostgreSQL 17.11 cluster: 20 files and 325 tests passed; the encrypted
  backup-restore file (7 tests) was skipped because it needs separate restore settings.

This is evidence about the synthetic projects and local tests only. It does not establish production readiness.

## Deployment procedures (run as the migration role, never exposed over the API)

These live in the `app_private` schema and write an audit event in the same transaction.
Before preparing a release, use
`npm run ops -- migration-status --confirm <ref>` with
`MIGRATION_PROJECT_REF` and `MIGRATION_DATABASE_URL` set in the restricted
operator environment. It only compares recorded migration versions; it does not
apply SQL or establish that the database has no schema drift.

```sql
select app_private.deployment_initialize_settings('<RWA name>', '<IANA timezone>');

-- Create the Auth identity first (Auth dashboard or admin API, email confirmed), then:
select app_private.deployment_bootstrap_admin('<auth user uuid>', '<representative name>');

-- Record only REAL approvals: key A1..A7, version, approval time, recording admin, authority, decision.
select app_private.deployment_record_policy_approval('A1', 'v1', '<timestamptz>', '<admin uuid>', '<authority>', '<decision>');
select app_private.deployment_invalidate_policy_approval('A1', '<reason>');

-- Unset (null) means "not approved", never unlimited.
select app_private.deployment_set_retention(<vote>, <audit>, <inactive profile>, <rate limit>, <backup>);
```

The first administrator still signs in with a normal emailed code. There is no public bootstrap, default
credential or HTTP settings endpoint.

## Real-database tests

Tests run against a **disposable** PostgreSQL server with a stand-in for Supabase's `auth` schema and API
roles (`tests/integration/support`). Each test file creates and drops its own database.

**Use PostgreSQL 17**, the major version Supabase runs (and `config.toml` targets). Version 18 behaves differently in
ways that matter here: for example it fires *deferred* triggers as the role that queued them, while 17 fires them as
the role current at commit. A suite that passes only on 18 can fail on Supabase.

One-time setup of a throwaway 17 cluster (superuser `supabase_admin`, trust authentication, local only), then start it
on port 54399 (start it as a background process; `pg_ctl -w` can hang a shell):

```powershell
$bin  = "C:\Users\<you>\Apps\Portable\postgresql-17.11-5\pgsql\bin"
$data = "C:\Users\<you>\Apps\Portable\temp\cp-pgdata17"
& "$bin\initdb.exe" -D $data -U supabase_admin -A trust -E UTF8
& "$bin\postgres.exe" -D $data -p 54399 -c listen_addresses=127.0.0.1 -c max_connections=60
```

```powershell
$env:INTEGRATION_DATABASE_URL = "postgres://supabase_admin@127.0.0.1:54399/postgres"   # superuser URL of a throwaway server
npm run test:integration
```

Without `INTEGRATION_DATABASE_URL` the suites are skipped. Never point it at a shared, linked or production
database. This proves the schema, RLS, grants, guards, routines and limiter; the suites pass on PostgreSQL 17.11. A bare
local server has no `pg_cron`, so Cron scheduling is skipped there (the completion routine itself is tested directly);
the scheduled job is verified on a hosted project. It does **not** prove Supabase
Auth (code delivery, expiry, sessions, cookies); verify those against a real Supabase project or the local
stack (`supabase start`, which needs Docker).

`tests/integration/migration-upgrade.test.ts` starts from the previous reviewed
migration baseline, applies `20261124100000` transactionally, and verifies
that existing RWA settings remain readable and the new profile behavior works.
It complements fresh-database migration tests; it does not replace the per-project
preflight and operator approval in the [deployment runbook](../docs/DEPLOYMENT.md).

## Verifying against a hosted Supabase project (real Auth)

Use a **disposable** project only. Created users cannot be deleted afterwards (profiles and audit events restrict
deletion by design), so delete or reset the project when finished. Fill in `.env.local` (see its comments), then:

```powershell
# Load .env.local into this shell session (values stay out of the command history).
Get-Content .env.local | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { Set-Item "env:$($matches[1])" $matches[2] } }

# Migrations go straight to the database with the session-pooler URL (no Management API needed).
npx supabase db push --db-url $env:LIVE_DATABASE_URL --dry-run   # review, then run again with --yes

npm run test:live                                                   # real Auth + Data API (service code)
$env:LIVE_AUTH = "1"; npx playwright test tests/e2e/auth-live.spec.ts   # real cookies/CSRF through the app
```

Notes from the first hosted run:

- **Auth settings** are not applied by the migrations. On a new project turn **off** "Allow new users to sign up"
  and set **Email OTP length to 6** (the hosted default is 8). `supabase config push` applies them from
  `config.toml` when the access token has the needed permissions (including API Keys read and project settings
  write); otherwise set them in the dashboard.
- **Email templates are locked on Supabase's built-in email service.** The default Magic Link email contains a
  link, not the code. Real emailed codes therefore need **custom SMTP** with the `{{ .Token }}` template
  (`templates/magic_link.html`). The live tests fetch codes through the Auth admin API and do not depend on this.
- **Corporate TLS inspection:** if Node or the CLI fails with a certificate error, export your organisation's root
  CA to a PEM file and set `NODE_EXTRA_CA_CERTS` (Node tools) and `SSL_CERT_FILE` (the Supabase CLI) to it. Do not
  disable certificate verification.
- The `sb_secret_` key works as the server-only credential: the routines' `service_role` claim check passes with it.

`LIVE_DATABASE_URL` (session pooler string) is required to push migrations this way and enables the tests that
suspend profiles or change roles.

## Auth configuration

`config.toml` disables public sign-up, uses six-digit email OTPs, and renders the code with `{{ .Token }}`
(`templates/magic_link.html`). `[auth.email] max_frequency` must match `CODE_RESEND_SECONDS` in
`src/shared/contracts/auth.ts`. Production SMTP, sender, expiry, cooldown and limits are provider settings that
must be approved and validated (A4) before real sign-in.
