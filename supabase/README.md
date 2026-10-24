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

All objects are owned by `cp_owner` (non-login, no superuser, no BYPASSRLS, no access to the Supabase `auth`
schema). `anon` and `authenticated` hold no write privileges; `service_role` can only execute the three
server-only routines (`provision_profile`, `enable_profile`, `consume_rate_limit`).

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

```powershell
$env:INTEGRATION_DATABASE_URL = "postgres://supabase_admin@127.0.0.1:54399/postgres"   # superuser URL of a throwaway server
npm run test:integration
```

Without `INTEGRATION_DATABASE_URL` the suites are skipped. Never point it at a shared, linked or production
database. This proves the schema, RLS, grants, guards, routines and limiter. The suites were run on PostgreSQL
18.6 while `config.toml` targets Supabase's PostgreSQL 17; re-run them against the real stack before release. It
does **not** prove Supabase
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
