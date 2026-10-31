# Civic Pulse operations runbook

Who does what when the service is running, being maintained, or has to be recovered. Everything here has a command or a test behind it unless it says **manual** or **not decided**.

Commands run from the project root with Node on `PATH`:

```powershell
npm run ops -- <command> [options]      # Node uses --conditions=react-server and loads .env.local if present
```

## 1. Settings that belong to operations

The staging host uses only Vercel's Production target at
<https://staging.arp-civic-pulse.vercel.app> (the former
`arp-civic-pulse-staging.vercel.app` host permanently redirects there), backed by the disposable Supabase
project. Preview deployments and Preview-only app variables are disabled/removed.
The renamed project-name host
<https://staging-arp-civic-pulse.vercel.app> also permanently redirects (308)
to this canonical origin.
Keep Production `APP_ORIGIN` and Supabase Auth Site URL aligned with this exact
origin and redeploy after origin changes; protection settings do not rewrite it.
See the [current deployment record](./DEPLOYMENT.md#current-staging-configuration-production-target-only).
Real production requires separate projects and credentials; never turn this
disposable database into the real register.

| Variable                                | Used by                | Meaning                                                                                                                                                                                  |
| --------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKUP_DATABASE_URL`                   | `backup`, `auth-orphans`, `recovery-record` | A **direct** (not transaction-pooled) connection for a dedicated backup login. See 3.1.                                                                          |
| `CONFIG_DATABASE_URL`                   | `config-check` | Operator-only direct/session PostgreSQL connection for read-only inspection. Requires unfiltered application reads and existing private-helper/status execution privileges; normally use the approved database-owner operator credential. Never put it in the application host or browser. |
| `MIGRATION_PROJECT_REF` / `MIGRATION_DATABASE_URL` | `migration-status` | Operator-only project reference and verified-TLS database connection. The command is read-only and refuses a URL that does not match `--confirm`; never put this credential in Vercel. |
| `BACKUP_ENCRYPTION_KEY`                 | all backup commands    | 64 hex characters (`npm run ops -- generate-key`). Keep it in the approved secret store, **never beside the backups or in the database**. Lose it and every backup is unreadable.          |
| `BACKUP_DIR`                            | `backup`, `prune`, `status` | The destination folder. The operator makes it off-site (a synced/mounted folder, an object-store mount, a removable drive that leaves the building). **Which one is not decided.** |
| `BACKUP_MAX_AGE_HOURS`                  | `status`               | Alert if the newest backup is older than this.                                                                                                                                           |
| `RESTORE_DATABASE_URL`                  | `restore`              | An **isolated** database that already has the reviewed migrations applied. Never the live one.                                                                                           |
| `MAINTENANCE_MODE=1`                    | the app                | Pages show a maintenance notice (HTTP 503), every API route answers 503, and `/api/internal/health` reports `unavailable`.                                                                |
| `PDF_EXPORT_ENABLED=0`                  | the app                | Switches the PDF download off (the control disappears; the endpoint answers `EXPORT_FORMAT_UNAVAILABLE`). On by default.                                                                  |
| `TRUSTED_PROXY_CONFIG=vercel`           | the app                | Production OTP code requests/verification use Vercel's overwritten `X-Forwarded-For` for per-RWA HMAC budgets (30/100 per 15 minutes). Requires Vercel system variables (`VERCEL=1`); missing or invalid input fails closed. Do not place another proxy in front of Vercel; hosted spoof/burst checks and pilot threshold validation remain open. |
| `PG_BIN_DIR`                            | backup tools           | Folder holding `pg_dump`/`pg_restore` (PostgreSQL 17 client tools, matching Supabase). Optional if they are on `PATH`.                                                                     |
| `RESEND_API_KEY`, `CONTACT_EMAIL_FROM`, `CONTACT_EMAIL_TO` | contact route | Optional server-only support-mail settings; set all three together. Separate from Supabase OTP SMTP. Restore from the secret/configuration store, not a database backup. |
| `APP_SUPPORT_EMAIL`                     | the app, `config-check` | Optional server-only developer/support contact eligible for RWA-controlled App Support Access. Setting it does **not** grant access; an enabled RWA Admin must turn it on from Settings and can turn it off at any time. When on, the identity signs in through normal email OTP with household-free, read-only (`rwa-readonly`) access. Never browser-visible. |
| `GOOGLE_ANALYTICS_ID`, `GOOGLE_SITE_VERIFICATION` | public pages | Optional public identifiers. GA4 is consent-gated on privacy/contact only; verification is not proof of Google property ownership. Set at build/runtime and rebuild after changes. |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | the app, build | Optional Sentry error monitoring with 10% sampled tracing, active only on Vercel Production/Preview. Events are scrubbed in `src/shared/observability/sentry.ts`, including tag values. System faults (`type: system`), unexpected errors, page crashes and invalid API replies are reported. Each report is tagged with the error ID (`error_id`) plus `area`, `error_code`, `error_category`, `cause_*`, `route`, `host` and `tenant`. Search Sentry for `error_id:<ID>` using the ID a person quotes; see [Debug a reported error ID](#debug-a-reported-error-id). The auth token is a build-only secret for source maps. |

### Tenant routing configuration (demo project only)

S03 implements a server-only `TENANT_DIRECTORY_JSON` host allowlist and separate
`TENANT_<UUID32>_SUPABASE_SERVICE_ROLE_KEY` variables for tenant credentials.
`TENANT_ROUTING_ENABLED` defaults to `false`. The staging project has no tenant
directory, host entries or tenant secrets configured. Only the separate
`demo-arp-civic-pulse` Vercel project (formerly `arp-civic-pulse-tenant-test`)
routes hosts, all synthetic:
`arp-civic-pulse.vercel.app` (main product website),
`demo.arp-civic-pulse.vercel.app` (demo, disposable project B) and
`tenant-a.arp-civic-pulse.vercel.app` (customer, disposable project A).
The former `site.arp-civic-pulse.vercel.app` permanently redirects (308) to
the bare main-site host, preserving paths. Main-site canonical metadata,
sitemap and demo backlinks follow the `main` directory entry; do not add the
redirect host as a second `main` entry (only one is permitted).
The renamed project-name host
<https://demo-arp-civic-pulse.vercel.app> permanently redirects (308) to the
canonical demo host. The project is configured for Node.js 24.x. The former
`tenant-b.arp-civic-pulse.vercel.app` domain was detached on 31 October 2026
and now returns 404. The two-customer hosted isolation specs need a second
customer project before they can run again. Do not enable routing for real
customers or treat the staging database as a real tenant until the actual
domain is approved and the remaining release gates close.

Each version-1 directory entry binds one exact lowercase hostname to a
`main`/`demo`/`customer` environment kind and explicit
provisioning/active/unavailable state. `main` has no RWA backend; demo and each
customer require distinct canonical HTTPS `*.supabase.co` origins, a publishable
key and a service-role reference derived from the immutable UUID. Unknown hosts,
invalid entries, incomplete credentials and unavailable tenants fail closed;
no fallback is permitted. With routing off, Vercel Preview runtimes also accept
their own `VERCEL_URL`/`VERCEL_BRANCH_URL` hosts; Production does not. An invalid envelope or empty/all-invalid directory
prevents startup; an invalid entry only disables its associated host when other
valid entries remain.

Vercel Secret values are readable by deployed function code. In this shared
deployment every configured tenant credential is within the application's
runtime reach; operators with deployment access are technically able to deploy
code that accesses all tenants. Keep deployment and environment-variable
permissions limited to named operators and audit changes, but do not describe
that policy as technical tenant isolation. Changes take effect only in new
deployments; confirm successful deployment and host-specific health before
activating a tenant. The 64 KB total Node deployment environment limit is shared
by the directory and all credentials. The approved pilot cap is **10 customer
hosts** plus one main and one demo host (`MAX_CUSTOMER_TENANTS` in
`src/server/config/tenant-directory.ts`); a directory over a limit is rejected
as a whole. See
[Vercel environment variables](https://vercel.com/docs/environment-variables).

The main host has no RWA backend: it serves the product website only, every
`/api/*` route except `/api/internal/health` answers `NOT_FOUND`, and RWA pages
such as `/sign-in` are 404. The demo host is shared and writable: visitors may
change anything until the next reset, except the email-sending routes
(`POST /api/auth/code`, `/api/auth/verify`, `/api/register` and `/api/contact`),
which answer `DEMO_EMAIL_DISABLED` (403) because the demo has no email delivery.

### Demo site

The demo host shows a fictional association, Green Meadows, from its own
dedicated Supabase project. Visitors pick **Sample resident**, **Sample
committee member** or **Sample RWA admin** on the sign-in page; no email or code
is involved. Everyone shares the same data and can change it, including the RWA
profile, accounts, settings and votes (decision of 31 October 2026, S01), so
reset it before every planned demo, weekly (active votes close 2 to 28 days
after a reset and the scheduled vote opens after 7 days) and after any
suspected tampering:

```powershell
npm run demo:reset
```

Its settings live in a separate `.env.demo.local` file (ignored by Git) at the
repo root: `DEMO_PROJECT_REF`, `DEMO_SUPABASE_URL`, `DEMO_SERVICE_ROLE_KEY`,
`DEMO_DATABASE_URL`, and `PGSSLROOTCERT=.certs/supabase-db-ca.crt`. Only
`npm run ops` and `npm run demo:reset` load it; the app, Playwright and live
tests read `.env.local` (staging/test) only, so demo credentials never reach
them. `npm run demo:reset` also loads `.env.local` (so it can refuse the main
app project) and uses the Windows certificate store (`--use-system-ca`). The
demo project reference `hnqajjjemqepxuoqbsqx` is fixed in its `--confirm`
argument in `package.json`, so a file pointing at another project is refused;
if the demo project is ever replaced, change both. The longer form still
works: `npm run ops --silent -- demo-reset --confirm <DEMO_PROJECT_REF>`.

The `TENANT_TEST_*` settings in `.env.local` also point at the demo project:
the free tier allows only two projects, so the cross-customer paired live test
(`tests/live/auth.live.test.ts`) uses staging as project A and the demo as
project B. That test leaves Auth users, profiles and audit rows in the demo, so
`npm run test:live` (`scripts/test/live.mjs`) runs `npm run demo:reset`
automatically when it finishes, even if tests failed (the reset deletes every
Auth user and app row, so it removes them). It skips the reset only when
`TENANT_TEST_*` is empty or you pass file filters that exclude the auth suite.
If the reset fails, the command exits non-zero with a warning; rerun
`npm run demo:reset` before any demo. The reset takes about two minutes and
needs `.env.demo.local`; never run live tests during a demo.

It erases every app table and Auth user in that project and reseeds a fresh copy
(about two minutes; it waits for one vote's short deadline to pass). The seed
(`demoSeedPlan` in `scripts/ops/demo.ts`) covers every state the app shows:

| Area | Seeded |
| --- | --- |
| RWA profile | Full name, alias, address, email, phone, website, Forest accent, welcome message, Flat label, 22 listed flats, three committee positions |
| Accounts | Seed admin and RWA admin persona; committee (read-only) persona; resident persona plus 14 more enabled residents; one resident whose flat is ineligible; one suspended; one deleted; two pending self-registrations (flats D-101, D-102); D-201 and D-202 listed but unclaimed |
| Open votes | Single choice (resident persona not yet voted); up to two choices (persona voted, then changed it); any number of choices; Block A only (partial electorate); deadline extended with a reason; secret election with none of the above (persona voted); secret by-election closing in two days |
| Finished votes | Completed early with a leader; tie completed at its deadline; completed with no responses; secret election with a leader, a tie and no winner (all none of the above); cancelled with a reason |
| Not started | Scheduled; schedule withdrawn back to draft with a reason; draft ready to start; unfinished draft |

The electorate is the 15 enabled residents with eligible flats. Output is counts
only: profiles, households, votes by status and ballots. A successful run prints
23 profiles, 20 households, 16 votes (7 active, 4 completed, 1 scheduled, 3
draft, 1 cancelled) and 65 ballots.

It refuses unless `--confirm`
matches, every credential points at that project, the project is not
`NEXT_PUBLIC_SUPABASE_URL`, and the database carries the demo marker. Use
`--initialize` once, only for a new, dedicated demo project. Known limits: any
visitor can deface the profile and branding, create or suspend accounts
(including the personas), import registers, start, end or cancel votes, turn on
App Support Access or fill the database; a copied persona session can also call
the database directly. The next reset repairs all of it. The seed
administrator, which records the approvals and owns the seeded votes, cannot
sign in; visitors use the RWA admin persona instead.

All visitors share each persona. The server signs them in with a password it
derives from the demo project's service-role key, so simultaneous visitors never
cancel each other (one-time codes did). The password never leaves the server.
After a reset or key rotation the first sign-in finds a mismatch, sets the
password through the Auth admin API, logs `demo.persona_password_set` and
signs in again; no manual step is needed. A `DEMO-` error ID whose log shows
`DEMO_PERSONA_MISSING` means the demo needs a reset; `AUTH_UNAVAILABLE` with an
Auth cause (for example `over_request_rate_limit`) means Supabase Auth refused
the sign-in. Keep the Email provider's password sign-in enabled in the demo
project.

### Check a customer's migration version

Set `MIGRATION_PROJECT_REF` and `MIGRATION_DATABASE_URL` only in the approved
operator environment. `MIGRATION_DATABASE_URL` must use verified TLS and point
to that exact Supabase project; on Windows, set `PGSSLROOTCERT` to the approved
Supabase database CA. Run:

```powershell
npm run ops -- migration-status --confirm $env:MIGRATION_PROJECT_REF
```

The read-only report compares the repository migration versions with
`supabase_migrations.schema_migrations` for that one project. It prints only
the project reference, version counts/latest versions, pending versions and
unknown remote versions—not the database URL or credentials. `current` exits
zero; an uninitialized/untracked project, pending migrations or unknown remote
versions exits nonzero. Run once per RWA during a fleet release and retain the
sanitized reports in the approved release record. This is a migration-history
check, not proof of schema drift absence, policy correctness or active-vote
compatibility; continue the required dry-run, SQL review and staging checks.

### Provision a customer RWA

Each customer gets a **new, empty** Supabase project; never copy data from the
demo or another RWA. Pick a new tenant UUID once and reuse it on every retry.

```powershell
# PROVISION_PROJECT_REF/SUPABASE_URL/SERVICE_ROLE_KEY/DATABASE_URL/PUBLISHABLE_KEY
# and PROVISION_ADMIN_EMAIL for that project; SUPABASE_ACCESS_TOKEN (optional) to
# apply and verify Auth settings. Set them in the shell, never on the command line.
$env:PGSSLROOTCERT = "$PWD\.certs\supabase-db-ca.crt"
npm run ops --silent -- provision --confirm <ref> --tenant-id <uuid> `
  --host <rwa host> --rwa-name "<association name>" --admin-name "<name>" `
  [--timezone Asia/Kolkata] [--apply-migrations] [--activate]
```

Every step checks before it writes, so re-run after any failure:

1. **Guards.** Refuses the demo project (by `DEMO_PROJECT_REF`, the directory or
   the database marker), a project or host that `TENANT_DIRECTORY_JSON` gives to
   another tenant, a secret key passed as the publishable key, and a project with
   app tables but no migration history or with migrations this release does not
   know.
2. **Migrations.** Reports pending migrations; with `--apply-migrations` it runs
   `supabase db push` and re-checks the history. Run it through `npm run ops`:
   the push starts `npx` directly (no shell), so the database URL never appears
   in a command line.
3. **Settings.** Initializes the association name and time zone once; a project
   already holding another name is blocked.
4. **First administrator.** Finds or creates the Auth identity, then enables it
   through `deployment_bootstrap_admin`. A different enabled administrator means
   the project was already handed over and is blocked.
5. **Auth.** With `SUPABASE_ACCESS_TOKEN` it sets sign-up off, email sign-in
   on, Site URL and the only redirect URL to the RWA host and six-digit codes,
   then verifies them. Supabase refuses email-template changes until the
   project has custom SMTP (free projects return 400), so the repository
   sign-in subject and template are set only after SMTP exists; until then the
   step is `blocked` and activation is refused. Add SMTP in the Supabase
   dashboard, then re-run. Without a token the step is reported as manual. The
   token needs Organization Projects, Project Settings and Auth Config
   read-write plus Organizations, Projects, API Keys and API Key Secrets read;
   give it a short expiry and revoke it after use.

The JSON report lists each step, `blockers`, `handover` tasks and the
`directoryEntry`. The entry is `provisioning` unless `--activate` is passed and
there are no blockers; activation with blockers exits 1. Then: set the Vercel
sensitive secret named by `serviceRoleKeyRef`, add the host as a Vercel domain,
add the entry to `TENANT_DIRECTORY_JSON`, redeploy, check
`https://<host>/api/internal/health`, and have the administrator sign in. The
RWA's real policy approvals and retention periods are recorded with them before
the first vote; provisioning never records approvals.

## 2. Monitoring

All six paginated UI lists now request exact authorized filtered totals and a
bounded page anchor through `get_list_page`, then read the existing bounded
projection, except Residents: migration `20261115100000` supplies its
`get_resident_table_page` ordered-ID/count projection for global column controls.
Apply both reviewed migrations before their application revisions.
The subsequent identifier-contains filter needs `20261116100000`; existing
exact filters remain available for older applications. Measure substring query
cost at approved scale rather than treating local functional tests as capacity evidence.
Monitor list latency and database load with this additional count/anchor work;
old list timings do not establish its production capacity. Metadata failures
remain explicit errors, never a zero-result fallback. Counts are live
observations: concurrent edits can change rows between navigation requests.
Cursor HTTP API envelopes and complete-result downloads remain unchanged.

The all-screen visual rollout changes shared UI surfaces, not operational
endpoints, rates, retention, permissions or counting. Native ballot submission,
unknown-outcome recovery and export routes are unchanged. The User Guide now
documents Resident (`voter`), RWA Admin (`rwa-admin`) and RWA ReadOnly (`rwa-readonly`) separately. Its screenshots are
persona-grouped.
Capture tests use synthetic records on the approved disposable project with
redacted email/code fields. Captures demonstrate those fixtures only and do not
prove production readiness or real email delivery.

The concept-aligned Votes overview adds three exact RLS head-count reads per
authorized page, plus bounded-concurrency existing-result reads for active-card
turnout. Standard read budgets still apply; measure the added latency and quotas
on the approved host rather than claiming the previous page timing covers it.
Count/turnout read failures show unavailable, not fabricated zero. No choice
payloads, identity data or unsafe provider details are logged by this helper.
The UI change adds no migration or write operation.

Appearance choice is a non-sensitive browser-local key, not an operational RWA
setting. Clearing `civic-pulse-theme` restores System; blocked storage keeps a
choice only in memory until reload. Do not copy identity/vote information into
this key or log browser storage. RWA accent settings, Auth cookies, backups and
results remain independent. Fonts are self-hosted; a theme outage must not add
external font/analytics calls to sign-in or voting. Print/PDF stay light.

The existing minute-based due-vote job also opens scheduled votes under the vote
lock. Authorized member list/detail/submission and administrator detail reads
reconcile openings as well; neither Cron nor the UI countdown permits early
admission. If a database resumes after an entire window elapsed, the schedule
completes at its original deadline without accepting a late ballot. Verify this
job in the chosen hosted environment; local PostgreSQL tests invoke the routine
but do not prove hosted scheduling. Do not manually update scheduled states.

Bulk import uses a separate provisional 1200-request/hour budget per admin and
independent provider quotas. On a partial/unknown outcome, stop and recheck rows;
do not delete Auth identities as rollback or enable a partially assigned profile.
New import entries remain suspended until reviewed and explicitly enabled, either
individually or through the Residents table's page-local Enable Selected action.
Make Eligible is separate and never enables sign-in. Residents are the default
role filter; administrators require explicit inclusion and an access warning.
The same per-record audit, current-admin checks and 60-mutation/minute budget
apply; a bulk UI action is not one transaction. The exclusive `rwa-readonly`
role can inspect authorized management data but cannot change roles or register
state; assign it only to an account with a household before enabling it. Role
transitions are audited and retain the final-enabled-admin safeguard. Stop on
failure, preserve completed outcomes and refresh before retrying an uncertain row. Existing
records and frozen scheduled/active electorates are never overwritten by import.

`npm run ops -- status` prints **counts only** (no names, no choices) and exits non-zero on any of:

| Alert               | Meaning                                                                                             | Action                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `CRON_LATE`         | An active vote is more than five minutes past its deadline.                                         | Supabase Cron is paused or failing. Resident screens still refuse late ballots by the database clock and finalise on first view, but fix Cron. |
| `INVARIANT_FAILURE` | A started vote's participation, responses or counters no longer reconcile.                          | **Stop.** Results for that vote are already withheld (`RESULTS_INTEGRITY_ERROR`). Go to 6, do not repair by hand. |
| `POLICY_INCOMPLETE` | Approvals or retention values are missing.                                                          | Record them (docs/LOCAL_SETUP.md 7.3). Votes cannot be activated meanwhile.            |
| `BACKUP_STALE`      | No backup newer than `--max-backup-age-hours`.                                                      | Run a backup, then find out why the schedule did not.                                  |

`GET /api/internal/health` returns `{"data":{"status":"ok"|"unavailable"},"requestId":"..."}` (200 / 503) and nothing else: no versions, quotas or provider detail. It checks that the database answers a trivial call. It is for a monitor, **not** a keep-alive; do not poll it to stop a free-tier project pausing.

The probe aborts its outstanding database HTTP request after three seconds and clears its timer when the check finishes. Failures are reported through allowlisted operational logging without provider messages or credentials; the public response remains only a status and support ID.

Run `status` and the health check from a scheduler you control (Windows Task Scheduler, cron, or a monitoring service) and alert on a non-zero exit. **Manual: no scheduler is configured by this repository.**

### Debug a reported error ID

Every failure screen shows an **Error ID** that residents and RWA administrators can quote. Admin bulk actions show it in their stop message. The ID's prefix tells you which part of the product failed:

| Prefix | Area | Source to look in |
|---|---|---|
| `AUTH-` | Sign-in code, verify, sign-out | `src/server/auth/`, `src/app/api/auth/` |
| `VOTE-` | Resident vote list/detail, submission, participation, results | `src/server/votes/`, `src/app/api/votes/` |
| `EXPORT-` | CSV/PDF result downloads | `src/server/exports/` |
| `VOTEADMIN-` | Admin drafts, preview, schedule, activate, deadline, complete, cancel, participation | `src/server/votes/drafts.ts`, `lifecycle.ts`, `src/app/api/admin/votes/` |
| `REGISTER-` | Admin accounts, households and import | `src/server/register/`, `src/app/api/admin/{accounts,households}/` |
| `SIGNUP-` | Public resident self-registration | `src/server/register/self-registration.ts` |
| `SETTINGS-` | RWA settings and App Support Access | `src/server/settings/` |
| `AUDIT-` | Audit history | `src/app/api/admin/audit/` |
| `CONTACT-` | Public contact form and email delivery | `src/server/contact.ts` |
| `DEMO-` | Demo persona sign-in | `src/server/demo/session.ts`, `src/app/api/demo/session/` |
| `HEALTH-` | Health probe | `src/app/api/internal/health/` |
| `API-` | Any other API route | `src/app/api/` |
| `PAGE-` | A page crashed while loading (browser error boundary) | Sentry only; follow its `digest` tag to the server log |
| `BROWSER-` or `iad1::…`-style | The server or platform sent a non-JSON reply (timeout, crash page) | Sentry `api.invalid_response`; a Vercel-style ID is searchable in Vercel logs |

Steps:

1. **Find the log lines.** Go to Vercel → project → **Logs**, choose the time range and search for the ID. API IDs appear on every line of that request:
   - `request.failed` is a known error; `request.unhandled` is an unexpected crash.
   - Any earlier lines from deeper code, such as `provisioning.auth_stage_failed` or `auth.code.provider_unavailable`, carry the same `requestId`.
2. **Read the line.** Each one gives:
   - `errorCode`, `errorCategory` and `errorType`. `user` means expected behaviour such as a wrong code or no access; `system` means a fault you must look at.
   - `hint`: a plain-English meaning and first check.
   - `causeSource`/`causeCode`/`causeStatus`: which dependency failed and its identifier, for example `database` `57014` for a statement timeout, `supabase_auth` with an HTTP status, `trusted_proxy` with `CLIENT_IP_MISSING`/`CLIENT_IP_INVALID`, or `tenant_config` `SERVICE_KEY_MISSING`.
   - `reason`, for conflicts.
   - `route`, `method`, `host`, `tenant` and `durationMs`.
3. **Open Sentry for system faults.** Search `error_id:<ID>` in the project's Issues. The event shows the exact code location (source maps) and the same tags. Issues are grouped by error code and route, so the event count shows how many people hit the same fault.
4. **Act on the category:**
   - `dependency`: check the named provider (Supabase status and usage, Resend, Vercel variables), then retry.
   - `data_integrity`: stop and follow [6. Incidents](#6-incidents).
   - `internal`: fix the code at the Sentry stack location.
   - `security`/`rate_limit`: repeated hits from one host or tenant may be abuse.

Logs never contain emails, names, codes, cookies, request bodies, query strings, choices or provider messages. The error ID alone cannot identify a person; ask the reporter for the time and the screen they were on if you need more context. Vercel keeps runtime logs only for a limited plan-dependent period, so look up reported IDs promptly. Sentry keeps system faults longer. Ordinary `user`-type errors are not sent to Sentry.

### Read-only RWA configuration inspection

Use this when an authorized developer needs to review RWA Admin setup without
signing into the application:

```powershell
# Store CONFIG_DATABASE_URL in an approved secret store or ignored .env.local.
# Never paste its value into chat, command arguments, screenshots or commits.
npm run ops -- config-check
```

`CONFIG_DATABASE_URL` is deliberately separate from app/API and backup
credentials. Independently confirm the database hostname/project and the intended
deployment before running. Use an approved operator database-owner connection
with current migrations, either direct or session-pooled, **not transaction
pooling**. The report needs unfiltered reads of application configuration/register
and vote-setup tables and execution of existing `app_private` validation/blocker
helpers and `public.operational_status()`. A normal resident/admin JWT or
SELECT-only backup login is not sufficient. The command creates no login, role,
grant, migration, HTTP endpoint or login bypass. Database access remains the
authentication boundary; guard the operator credential accordingly.

The command opens one repeatable-read, **read-only** transaction, sets
`row_security=off` so insufficient privileges fail instead of returning filtered
zeroes, and rolls it back on both success and failure. A transaction-local
service-role claim authorizes only the existing count-only status call; it does
not create an app session. Existing preview blockers and invariant checks are
reused. No vote is opened/completed, no setting is changed, and no resident,
participation or audit record is written. Connection, statement and lock waits
are bounded. Remote TLS verification follows the connection-security rules below.

The version-1 JSON report contains:

- RWA name/alias, timezone, configured household wording and palette; optional
  contact/welcome **presence flags**, known migration-placeholder field names,
  suggestion-list counts/validation, retention periods and missing A1-A7 keys.
  Blank optional contacts and empty suggestion lists are valid; placeholder
  warnings need review, not automatic replacement.
- Exact aggregate account/status/role and register counts, missing enabled
  representatives, exclusive management-role checks and enabled-admin presence.
  These reflect setup, not successful logins or actual active-user counts.
  Observer counts exclude any App Support identity, which is reported separately
  as `enabledAppSupport`; an enabled App Support grant raises a non-failing
  `APP_SUPPORT_ACCESS` warning so an operator can confirm the RWA still wants it.
- Vote totals by type/status, ready/incomplete draft counts and blocker-code
  frequencies, scheduled openings delayed by more than five minutes, and existing
  operational overdue-completion, invariant and retention-backlog counts.
- Production **shape validation of the injected application environment**, local
  maintenance/PDF flags and an explicit list of external checks still unverified.
  `npm run ops` optionally loads `.env.local`; to inspect only injected values,
  use `node --conditions=react-server scripts\ops\cli.ts config-check` instead.

Exit `0` means no automated **fail** check; warnings (including unfinished drafts
and no votes yet) do not change that exit status. Exit `1` means a failed check or
an unavailable report. Failures never fabricate zero counts or expose raw
database/provider errors. `ok: true` is **not launch approval**:
`productionReady` is always `false`. Approval presence is checked separately
because the existing status routine's `policyReady` field checks retention only.
Review approval authority/applicability, deployment/project matching, provider
and Auth/SMTP settings, real delivery, ingress/IP enforcement, Cron execution,
capacity, backup age/automation and recovery evidence separately. A database
report cannot prove hosted environment values or third-party configuration.

The report deliberately does not reproduce every RWA Admin screen: no resident
details, identifier lists, vote titles/IDs, candidate/NOTA totals, ballot choices,
credentials or last-seen data are printed. It adds no visitor tracking. Keep the
organizational settings/count report private. Existing app roles, RLS/grants and
authenticated management access are unchanged.

### App Support Access (developer help, RWA-controlled)

When a deploying RWA wants the developer to inspect configuration from inside the
app during onboarding, set the server-only `APP_SUPPORT_EMAIL` to the developer's
address and apply migration `20261112100000`. Setting the variable grants nothing
on its own. An enabled RWA Admin turns **App Support Access** on from
Settings (`/admin/settings#app-support`); only then is a household-free,
read-only (`rwa-readonly`) support profile created for that address, which signs
in through the normal email OTP flow. The support identity has no household, so it
cannot vote, and ordinary account tools cannot edit or assign it a household. The
RWA Admin can turn access off at any time without the developer; doing so suspends
the support profile immediately. Both actions are audited as
`APP_SUPPORT_ACCESS_ENABLED`/`APP_SUPPORT_ACCESS_DISABLED`, and `config-check`
surfaces an active grant as the `APP_SUPPORT_ACCESS` warning. This is consented
support access, not a hidden login or standing default administrator.

### Public contact and discovery checks (manual)

The health probe checks the database, **not** Resend, inbox receipt, Google
collection/ownership or policy approval. Periodically check the public privacy
and contact pages, the footer's `/user-guide` index, both persona pages and their
lazy/full-size screenshot links, contents anchors and phone reflow,
canonical `APP_ORIGIN`, robots/sitemap and the share image on
the approved deployment. Do not add private record URLs to crawler checks.
Check `/tech-guide` directly for the developer reference; it must stay unlinked
from the footer, noindex/nofollow and outside the sitemap. It is intentionally
public, not a protected operator console. Ordinary deployments do not recapture
images. Never run the opted-in screenshot suite against production: it creates
synthetic Auth/voting/policy fixtures and temporarily changes RWA display settings.

When contact is enabled, verify a synthetic enquiry reaches the approved test
inbox and Reply-To works; a `202` only proves provider acceptance. Watch provider
rejections, quotas, spam handling and the shared email/global budgets without
capturing messages or addresses in application logs. A send timeout is uncertain:
do not retry automatically. A contact outage does not invalidate an accepted
ballot and must not introduce a provider dependency into vote acceptance.

If Google settings are enabled, check consent refusal/withdrawal and a fresh
sign-in document without tracking, and keep Enhanced Measurement/advertising
disabled in GA4. Treat analytics, Search Console, mailbox retention and legal
operator details as external configuration requiring named owners. No provider
alerts or delivery webhooks are implemented by this manual checklist. Activation
and actual delivery evidence are in
[Deployment](./DEPLOYMENT.md#public-site-integrations).

## 3. Retention (automatic)

Migration `20261024160000` schedules a Supabase Cron job, `civic-pulse-maintenance`, daily at 21:30 UTC (03:00 India). It runs `public.run_maintenance()` as the `cp_scheduler` role, which can run exactly two routines: due completion and this one. There is no HTTP endpoint and nothing to override.

Each run, in bounded batches and using the **current** approved settings (a missing value skips that task):

1. **Votes:** up to 10 completed/cancelled votes older than `vote_retention_days` are deleted coherently (responses or counters, participation, electorate, ballot, then the vote) in one transaction each, with a minimal audit event (`kind`, voting type, status). A failure rolls back that vote only and is reported.
2. **Audit events** older than `audit_retention_days` (up to 1000), leaving one count-only trace.
3. **Rate-limit buckets** expired for longer than `rate_limit_retention_days` (up to 5000). A bucket still inside its window is never touched.
4. **Deleted profiles** older than `inactive_profile_retention_days` that nothing refers to (no household, electorate row, authored vote or audit event). The profile is removed; its **Auth identity is then an orphan**.

Scheduled and active votes are never deleted. An enabled administrator may permanently delete a draft through the guarded `delete_draft` routine; it checks the draft status and expected revision, deletes its related data atomically, and leaves a `DRAFT_DELETED` audit event. Retention deletion remains restricted to eligible terminal votes and is re-checked row by row by the database guards.

**Removing orphaned Auth identities (manual, periodic):**

```powershell
npm run ops -- auth-orphans            # dry run: how many
npm run ops -- auth-orphans --apply    # delete through supported Auth administration
```

It never touches an identity younger than 24 hours (provisioning creates the Auth user before the profile). If an individual delete fails it is counted and reported; re-run later. A failed resident self-registration deletes the identity it just created; if that best-effort cleanup itself fails (logged as `self_registration.identity_cleanup_failed`), the leftover identity has no profile and grants no access, and this command removes it. Self-registered profiles that an administrator leaves suspended are not deleted automatically; review them on **Residents → Source: Self-registered** and set unwanted ones to Deleted.

Deletion from the live database does **not** erase copies in existing backups; they leave when their own expiry passes (`backup_retention_days`).

## 4. Backups

### 4.1 One-time set-up (manual)

1. `npm run ops -- generate-key`, store the result in the approved secret store, and set `BACKUP_ENCRYPTION_KEY` where the backup runs. Keep a second copy of the key somewhere separate from the backups. **Test restoring with the stored copy, not the one in your shell.**
2. Create a dedicated login for backups, with only what it needs (run once as the database owner; choose the password yourself and do not put it in the repository):

   ```sql
   create role cp_backup login password '<choose one>' noinherit;
   grant usage on schema public, app_private to cp_backup;
   grant select on all tables in schema public to cp_backup;
   grant select on auth.users, auth.identities to cp_backup;  -- Auth identities
   ```

   On Supabase's hosted project use the **direct** connection string (not the transaction pooler: the snapshot needs one session). If the platform refuses a grant, use the project's database owner role instead and record why.
3. Choose and approve the off-site destination and its expiry. **Not decided.** Supabase Free does not include automatic backups or point-in-time recovery, and Supabase Cron is not an off-site backup.

### Operational connection security

All operational PostgreSQL connections (configuration inspection, backup, recovery record, restore/reconciliation and orphan cleanup) and native dump/restore tools require **certificate and hostname verification** for remote hosts. Use a PostgreSQL URL with `?sslmode=verify-full`; omitted TLS mode also selects `verify-full` remotely. Insecure or weaker explicit modes are rejected, not silently upgraded or retried without TLS. Plaintext is permitted only for the literal loopback hosts `localhost`, `127.0.0.1` and `::1`, for local development.

For a provider-specific CA, use `sslrootcert=<URL-encoded path to the approved CA file>` or set `PGSSLROOTCERT` to that file. Otherwise system certificate roots are used. `NODE_EXTRA_CA_CERTS` can extend Node's system roots, but does not configure libpq; set the approved `PGSSLROOTCERT` when the native tools need a custom CA. Optional client certificates use `sslcert`/`sslkey` (or `PGSSLCERT`/`PGSSLKEY`). These four TLS parameters are the only supported connection-URL query options; duplicates and host/SSL override parameters are rejected. Do not disable certificate validation to work around a connection failure.

Credentials reach native tools through their environment, never command-line arguments. Inherited `PGSERVICE`, `PGSERVICEFILE` and `PGHOSTADDR` cannot redirect these connections. Use the same approved CA and hostname for Node and PostgreSQL tools, and confirm the real hosted backup/restore connection before release.

Backup manifests are bounded, strictly validated metadata: each must name exactly its own application, Auth and counts files, with unique roles, valid hashes, matching timestamps and expiry. Traversal paths, alternate streams, cross-set filenames and symbolic-link manifests/data reads are refused. Failed same-timestamp backups preserve the existing set. AES-GCM authenticates encrypted file contents; it does **not** authenticate the plaintext manifest or prevent rollback of a whole valid backup. Protect the destination and retain a trusted inventory/recovery point separately.

### 4.2 Taking a backup

```powershell
npm run ops -- backup
```

It opens one consistent snapshot and, from that snapshot, writes **four files** into `BACKUP_DIR`:

| File                      | Content                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `cp-backup-<time>.app.enc`    | `pg_dump` (custom format) of the `public` and `app_private` schemas: data, tables, grants, policies, routines. |
| `cp-backup-<time>.auth.enc`   | Data of `auth.users`, `auth.identities`, the migration history and the Cron schedules (where they exist). |
| `cp-backup-<time>.counts.enc` | Row counts of every table and a digest per started vote (participation, choices, counters, electorate), taken at the same snapshot. |
| `cp-backup-<time>.manifest.json` | Names, sizes, SHA-256 hashes, creation and expiry. No data.                                |

Everything with data is AES-256-GCM encrypted with a fresh random IV per file. Plaintext is never written to disk by the backup. Expiry is `backup_retention_days` from the settings; **a backup refuses to run if it is not approved**. The command then verifies the set (hashes, decryption, and that the dump has a data section for every table, the Auth tables and the application routines) and deletes sets past their expiry, always keeping the newest.

Run it on a schedule you choose (daily is typical) from a machine that is not the database host. **Manual: no schedule is configured here.** Check `npm run ops -- verify --manifest <path>` any time.

### 4.3 What a backup does not contain (recover these separately)

- **Secrets and keys:** the Supabase service-role key, `RATE_LIMIT_HMAC_KEY`, `BACKUP_ENCRYPTION_KEY` and optional `RESEND_API_KEY`. Recover from the secret store.
- **External configuration:** the Auth settings (disabled signup, six-digit code, expiry), the custom SMTP provider and its templates, allowed redirect URLs, and any Cron job outside the database. Keep these in your configuration notes; the checklist in docs/LOCAL_SETUP.md section 4.2 and 8 lists them.
- **Public integrations:** contact sender/recipient, verified domain/DNS, Resend access and mailbox retention; Google identifiers/property settings, disabled Enhanced Measurement, consent behavior and Search Console verification. Recover from approved configuration notes and recheck after deployment; database restore does not restore them.
- **The application itself:** redeploy the reviewed build; never use a database restore as an application rollback.

## 5. Restore rehearsal and real restore

A restore is always into an **isolated** database first.

1. Create a new project/database. Apply the reviewed migrations (`npx supabase db push`). Leave the application tables empty. Put the app in maintenance mode (`MAINTENANCE_MODE=1`) so nobody reaches it.
2. `npm run ops -- restore --manifest <path>` with `RESTORE_DATABASE_URL` pointing at it. It restores the Auth identities and then the application data in one transaction each (guard triggers are not fired during a data restore) and **reconciles**:
   - every table's row count equals the count taken at backup time;
   - every started vote reproduces its recorded participation, choices, counters and electorate (digest);
   - every started vote passes the same invariants that guard completion and publication;
   - every profile has an Auth identity; row-level security is on for every table; no anonymous caller can run any routine.
3. Read the result:
   - `consistent: false` → **stop**, the backup or the restore is damaged. Do not resume. Try an older backup.
   - **warnings** (active votes at backup time; votes already past their deadline) mean ballots acknowledged after the backup are **not** in it. They complete at their deadline with what was restored. Decide with the committee: usually **cancel and replace** (section 7).
   - `resumeAllowed` is `true` only when the restore is consistent, nothing is active or overdue, **and** you passed `--completeness-confirmed` to say you have independently established that nothing acknowledged is missing. A consistent but possibly incomplete backup never authorises resuming an election.
4. **Replay later administrative actions.** The database you restored lacks everything after the backup. Before the old database went away, `npm run ops -- recovery-record --since <backup time> --out recovery.enc` exports (encrypted, administrative facts only) the suspensions, role changes, household edits and deletions since then. Re-apply suspensions and removals first, so nobody whose access was revoked regains it.
5. Auth identities: existing sign-in sessions are not part of the backup and do not carry over; everybody signs in again with a fresh code. If the Auth service has to be rebuilt, use Supabase's supported recovery and then check every enabled profile still has its identity (the reconciliation does).
6. Only when the above is satisfied and a person has signed off: point the application at the restored database and clear maintenance mode.

**Tested:** this procedure is rehearsed automatically (`tests/integration/restore.test.ts`): a populated database is backed up with `pg_dump`, encrypted, verified, restored into a separately migrated database and reconciled, including a tampered file, a wrong key, a lost ballot, an elapsed deadline and the recovery record. A backup of the hosted project was also created and verified once (all four files, Auth identities included). **Not yet done:** a full restore of the hosted project into a second Supabase project, and a restore from the real off-site location with the stored key. Do both before the pilot (docs/PILOT_READINESS.md).

## 6. Incidents

| Situation                                                | Who                                | What                                                                                                                                                                                                  |
| -------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Results show "temporarily unavailable pending a review"  | The technical contact              | `INVARIANT_FAILURE`. Do **not** edit counters or responses. Preserve a backup first, then investigate from the audit history and a restore of the last good backup. Decide with the committee whether to cancel the vote. |
| Suspected leak of a backup file or key                   | The technical contact + committee  | Rotate `BACKUP_ENCRYPTION_KEY`, take a new backup, delete the old sets, and treat the contents (names, household identifiers, PUBLIC choices) as disclosed.                                              |
| Database or hosting outage                               | The technical contact              | Set `MAINTENANCE_MODE=1` if the app is misbehaving; otherwise leave it. Deadlines keep passing and are **never extended automatically**; the database clock decides who got in. If the committee agrees, an admin can move the deadline of a still-Active vote with **Change Deadline**. Tell residents what happened. |
| Lost or wrong ballots after a restore                    | The committee                      | Section 5 step 3: cancel and replace. Never discard votes silently, extend a deadline, or reopen a finished vote.                                                                                     |
| Member loses access mid-vote | An administrator | Suspend/enable the account in **Residents**; it takes effect on the next request even with a valid session. |

The technical contact, the committee decision-maker and the escalation route are people, not code. **Not decided: record them here before the pilot.**

## 7. Cancelling and replacing a vote

A finished vote cannot be reopened, and an active vote cannot be edited; only its deadline can be moved (**Change Deadline**, with a reason, while it is still Active). If a vote must be redone (wrong electorate, wrong ballot, lost data):

1. **Manage Votes → the vote → Cancel Vote**, with a written reason. Residents see "Cancelled; results not valid." and no results or download is possible.
2. Create a new draft with the corrected ballot and electorate, preview it, activate it with a new deadline, and tell residents. The cancelled vote's data is removed by retention at the normal time.

## 8. Releases and migrations

Apply migrations with deployment-only credentials (`npx supabase db push`) outside an active vote; they are ordered, immutable, and tested on PostgreSQL 17 and on the hosted project. Prefer backward-compatible changes. **Never** restore an old database to roll back a release once ballots have been accepted: roll back to a schema-compatible build of the application, or ship a forward fix.
