# Supabase operations (Civic Pulse)

Everything here is for **local, test and staging** work first. Production changes need the approvals
listed in `docs/IMPLEMENTATION_PLAN.md`; nothing below records or implies an approval.

## Migrations

Ordered, immutable SQL in `supabase/migrations`, applied with the Supabase CLI and deployment-only
credentials (`SUPABASE_ACCESS_TOKEN`, `MIGRATION_DATABASE_URL`). The application never runs migrations
at start-up, and never uses the migration credentials.

| Migration                                 | Purpose                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `20261024100000_core_schema`              | Restricted owner role `cp_owner`, tables, constraints, indexes                                                |
| `20261024100100_guards_and_helpers`       | Authorization helpers, lifecycle/freeze guards, ad hoc write guards, deferred invariant checks               |
| `20261024100200_rls_and_grants`           | RLS on every table, safe read-only policies and grants, no write grants                                       |
| `20261024100300_audit_settings_provisioning` | Audit append, deployment procedures (settings, approvals, retention, first admin), provisioning routines |
| `20261024100400_rate_limiting`            | Supplemental application rate-limit routine                                                                   |
| `20261024110000_register_administration`  | Guarded household and account maintenance routines (audited, last-administrator guard)                        |
| `20261024120000_vote_drafts`              | Revision-checked draft routines, deferrable position uniqueness, preview, RWA display                          |
| `20261024130000_activation_lifecycle`     | Activation freeze, early completion/cancellation, due completion, `cp_scheduler` role and the Cron job        |
| `20261024130100_deferred_trigger_definer` | Deferred invariant triggers made `SECURITY DEFINER` (PostgreSQL 17/18 behave differently otherwise)           |
| `20261024140000_cast_vote`                | `cast_vote` and `get_my_participation`; fixes the activation guard and preview blockers that looked at other votes |
| `20261024150000_member_votes_results`      | Member vote list/detail, authorized `get_vote_results`, admin participation monitor, audit history                 |
| `20261024160000_retention_maintenance`     | Retention execution (`run_maintenance`, Cron daily), operational status and health ping, retention guard exceptions |
| `20261026100000_open_poll_live_results_and_changes` | Active PUBLIC aggregates and guarded PUBLIC response replacement; PRIVATE finality unchanged |
| `20261027100000_open_multi_select` | Configurable PUBLIC single/multi-select, normalized option responses and household-grouped completed results |
| `20261028100000_nota_closed_elections` | Uses NOTA for PRIVATE null-candidate tallies and exposes the NOTA count in result projections |
| `20261029100000_live_closed_turnout` | Exposes aggregate turnout during active PRIVATE elections without candidate/NOTA totals; household participation remains admin-only |
| `20261030100000_configurable_identifier_label` | RWA identifier display label, enabled-member read RPC and audited admin update RPC |
| `20261031100000_rwa_profile_settings` | RWA identity/contact columns, audited admin profile RPCs and default values |
| `20261101100000_rwa_branding_and_public_identity` | Accent palette and welcome message, member branding projection, service-role-only public identity routine; replaces the alias-only read |
| `20261102100000_optional_rwa_contact_fields` | Makes RWA address, email and phone optional (empty text allowed and hidden); full name, alias and identifier label stay required |
| `20261103100000_public_private_voting` | Renames voting types `OPEN`/`CLOSED` to `PUBLIC`/`PRIVATE` in data, checks and routines; internal names, error codes and audit history unchanged |
| `20261103110000_household_label_and_identifier_kind` | Replaces the identifier label with a household label and a Number/ID identifier kind (backfilled), drops the old label RPCs, and returns the new values from the profile, branding and public identity routines |

All objects are owned by `cp_owner` (non-login, no superuser, no BYPASSRLS, no access to the Supabase `auth`
schema). `anon` and `authenticated` hold no write privileges; `service_role` can only execute the three
server-only routines (`provision_profile`, `enable_profile`, `consume_rate_limit`, `reconcile_vote`). The
Cron job runs through the non-login `cp_scheduler` role, which can execute `public.complete_due_votes()` and nothing else.
Scheduling needs the `pg_cron` extension (available on Supabase); where it is missing the migration skips scheduling
and says so.

## Deployment procedures (run as the migration role, never exposed over the API)

These live in the `app_private` schema and write an audit event in the same transaction.

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
