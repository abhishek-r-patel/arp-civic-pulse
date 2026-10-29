# Production deployment runbook

## 1. Status and approval boundary

This repository is **deployed to staging using Vercel's Production target, not real production or approved for real voting**. The architecture prefers Vercel for Next.js and Supabase PostgreSQL/Auth/Cron. The staging account is recorded below; no production Supabase project, production hosting plan, region, domain, budget or trusted ingress is approved by this configuration. No existing hosted project is assumed to be production.

Do not promote a deployment or admit real residents until the open gates in [PILOT_READINESS.md](./PILOT_READINESS.md) are closed. In particular, `TRUSTED_PROXY_CONFIG` is reserved and **does not implement trusted-client-IP limiting**. Approve ingress, implement and test spoof-resistant IP enforcement before release; setting the variable is not a workaround. This guide does not grant approval of A1-A7, providers, regions, retention or recovery objectives.

### Current staging configuration: Production target only

As of 28 October 2026, the operator approved this permanent staging setup:

**Numbered-pagination follow-up:** with explicit authorization, migration
`20261114100000_numbered_pagination.sql` was applied to the same disposable
Supabase project after a CLI dry run listed only that pending migration.
This adds guarded count/page-anchor metadata, not new voting permissions.
The pagination application changes have not been deployed by this task; database
application and local browser verification are not hosted application verification.

**Residents table-control follow-up:** migration `20261115100000` is applied only
to the verified disposable database after explicit authorization. Its CLI dry run
found duplicate local version `20261105100000`; a separately approved transaction
applied only the new routine and its ledger entry. See
[migration status](../supabase/README.md) for the unresolved duplicate-file issue.
Local Chromium table/phone/observer checks are not a hosted application rollout.

- Canonical URL and Production `APP_ORIGIN`:
  <https://arp-civic-pulse-staging.vercel.app>, without a trailing slash in the
  environment value. Use this origin for sign-in and all browser mutations.
  Switching Vercel environments or protection does not rewrite `APP_ORIGIN`.
- Vercel project `arp-civic-pulse-staging` remains connected to `main` as its
  Production branch, with `previewDeploymentsDisabled=true`. All eight
  Preview-only environment entries were removed; the nine Production entries
  remain. No credentials were transferred to a different project.
- [vercel.json](../vercel.json) adds a durable Git policy:
  `git.deploymentEnabled` disables `**` and enables `main`. Vercel enables a
  branch when any matching rule is true, so `main` still builds while feature
  branches/PRs do not. This repository change is local until committed/pushed;
  the hosted project-level Preview disable is already saved independently.
  Preview remains a provider environment type, not an active app deployment
  workflow. Existing deployment history/aliases were not deleted; do not use
  the old git-main or per-deployment URLs for mutations.
- The database remains `civic-pulse-disposable`. Supabase Auth Site URL was
  changed from `http://localhost:3000` to the canonical staging origin and
  verified after reload. The redirect allowlist remains empty: the app uses
  six-digit codes, not a new redirect/magic-link flow. No data reset, migration,
  SMTP, OTP policy or database credential change was performed.
- Current Vercel protection was preserved exactly:
  `ssoProtection.deploymentType=all_except_custom_domains`. The canonical site
  and health endpoint were reachable without Vercel login in the verification
  below; do not infer universal SSO coverage from the historical records.
- Deployment `dpl_6cEy2UQrC2ZDFxupXbhy14VMWR5x` is **Ready**, Production,
  using the existing committed revision
  `a0823d884309b3c3f7cd867038084c00b5e3e06b` and the updated project settings.
  The uncommitted Residents/modal work was not uploaded, committed or pushed.
- Hosted checks: sign-in returns 200 with the new canonical URL; a same-origin,
  cookie/token-bound request with an empty body reaches validation
  (`422 VALIDATION_FAILED`), while a wrong-origin request is rejected
  (`403 CSRF_FAILED`). No email was requested by these probes. Health returns
  `200` with `data.status="ok"`. Fresh OTP delivery/authenticated voting were
  not rerun and these checks do not close production readiness gates.

Real production must be a **separate Vercel project and non-disposable Supabase
project**, with separate credentials, approved origin, provider/region,
verification and release gates. Never repoint this staging project at real
resident data. Changes to `APP_ORIGIN` require a new deployment; align Supabase's
Site URL too. The records below are historical and superseded where they differ.

### Historical protected staging: 27 October 2026

- Project: [arp-civic-pulse-staging](https://vercel.com/arp-e93d/arp-civic-pulse-staging), Vercel team `arp-e93d`, Hobby, Node.js 24.x, actual function region `iad1`. This is not approval of a production plan or region.
- Canonical staging origin: <https://arp-civic-pulse-staging-git-main-arp-e93d.vercel.app>. `APP_ORIGIN` matches it at build and runtime; use this hostname for staging mutations.
- Artifact: GitHub commit `8ac9d1c6f6724c5e10e80e4203a2d960a39a216c`, deployment `dpl_BNBFMs6wHRMuDXck8299oRq5aJBf`, created 27 October 2026. The operator selected the committed GitHub version, not the additional uncommitted local features.
- The operator confirmed that the Supabase project in ignored `.env.local` is disposable and staging-only. Only the four required app credentials were transferred, alongside `APP_ORIGIN`, `LOG_LEVEL=info`, `MAINTENANCE_MODE=0` and `PDF_EXPORT_ENABLED=0`. All eight variables are scoped to **Preview only**; privileged app secrets are non-revealable. No database URL, password, management token or live-test email was uploaded.
- Vercel Authentication is enabled (`all_except_custom_domains`). An unauthenticated HTTPS request to staging health was redirected to Vercel SSO (302); no public custom domain was added.
- Verified on the hosted artifact: initial maintenance health was 503; after the controlled staging-only rebuild, health was 200 with exactly `data.status="ok"` and `requestId`, and `private, no-store`. Sign-in rendered with CSP, `/admin` navigated to `/sign-in`, protected member/admin APIs returned 401, and an empty wrong-Origin authentication mutation returned 403 without sending email. Protected API responses had `private, no-store` and no cross-origin allow header.
- The build fix retains the placeholder-only `.env.example` needed by guide rendering. Its isolated local build, lint, guide generation/link checks and all 10 documentation tests passed; the hosted build is Ready.
- Still unverified here: email/OTP delivery and authenticated voting/export journeys on this host, full schema/migration history, load and recovery. The read-only SQL verification failed certificate-chain verification; TLS was not weakened and no migrations or database writes were performed. Hosted health proves the narrow `health_ping` RPC, not full schema compatibility. PDF stays disabled pending hosted acceptance.
- The API deployment target used here is `staging`, which consumes Preview variables. Verify the returned target before rollout: the first `preview` request was classified as Production and was cancelled. Git integration still identifies `main` as its Production branch; pushes can create automatic Production builds independently of Preview. The automatic Production build from the fix push was also cancelled, and Production has no app variables. Configure approvals before any future production work; never promote this staging build.

### Staging OTP verification: 28 October 2026

Brevo SMTP was configured in the disposable project's Supabase Auth settings:
host `smtp-relay.brevo.com`, TLS port `465`, a verified operator-controlled Gmail
sender and display name `Civic Pulse`. Credentials remain in the provider
configuration, not app environment variables. The saved template uses
`{{ .Token }}` with subject `Your Civic Pulse sign-in code`; saved OTP length is
six, expiry remains 3,600 seconds, and the sending limit remains 30 emails/hour.
No expiry/rate policy was relaxed.

The initial Gmail and Outlook requests did not establish an SMTP failure:
neither address existed in the project's Auth users, and the app does not create
users when requesting a code. After explicit operator approval, one confirmed
Outlook Auth identity was created and an enabled staging administrator was
provisioned through `provision_profile` and `enable_profile`, with deployment
audit attribution. One normal OTP email request was accepted. The operator
confirmed inbox receipt and successful sign-in; the hosted browser independently
showed the Votes page and RWA Admin navigation. No OTP or SMTP key was recorded.

This supersedes only the earlier unverified email/OTP sign-in item. Brevo delivery
event/message IDs were not captured. Freemail sender limitations, production
provider/domain/policy/capacity approval, schema verification, authenticated
voting/export acceptance, load and recovery remain open. No application rebuild
or production deployment was needed for these Supabase-only settings. See
[local SMTP setup](./LOCAL_SETUP.md#8-make-sign-in-codes-arrive).

### Staging promoted to the Production target: 28 October 2026

The operator chose to treat this staging host as Vercel's **Production**
environment so that `main`-branch builds carry application variables, superseding
only the earlier "Preview only" / "Production has no app variables" notes above.
The host remains protected staging; this is not production approval.

- Database migrations were applied to the disposable staging Supabase project over
  its IPv4 session pooler (`aws-0-ap-south-1.pooler.supabase.com:5432`,
  `sslmode=require`) with `supabase db push --db-url`, because the management API
  and the IPv6 direct host were unreachable on this network. Remote history was at
  `20261111100000_resident_directory`; the two unapplied migrations
  `20261112100000_app_support_access` and `20261113100000_readonly_household_optional`
  were pushed and recorded. Verified afterwards: `set_app_support_access` exists and
  the `HOUSEHOLD_REQUIRED` guard is present. TLS verification was not weakened and no
  ad-hoc data writes were made; migrations ran before the new code deployed.
- Nine variables were set on the **Production** scope: the four required app
  credentials, `APP_ORIGIN` (the canonical git-main origin), `LOG_LEVEL=info`,
  `MAINTENANCE_MODE=0`, `PDF_EXPORT_ENABLED=0`, and the new
  `APP_SUPPORT_EMAIL` for App Support Access. The eight Preview variables are
  unchanged. No database URL, password, management token or live-test email was
  uploaded; privileged values were piped without being echoed.
- The latest `main` production build, which had errored only with
  `deploy:check` "is required in production" for the missing variables, was
  redeployed. Deployment `dpl_6VB2hgPz11qwV6MFDJiJ7Z4H3zLv`
  (`arp-civic-pulse-staging-k3go9kc8f-arp-e93d.vercel.app`) from commit
  `5f2dd96128374a9f2fd33eddff6113a7d4b7b6c2` is Ready, and the canonical
  `-git-main-` alias resolves to it.
- Vercel Authentication still covers production: unauthenticated HTTPS requests to
  both the canonical git-main origin and the deployment URL were redirected to
  Vercel SSO (302). No public custom domain was added.
- Still open: authenticated voting/export acceptance and the App Support Access
  toggle remain unverified on this host; email/OTP, load and recovery are
  unchanged; real production must be a separate Vercel project and a non-disposable
  Supabase project. The [PILOT_READINESS.md](./PILOT_READINESS.md) gates stay open;
  never admit real residents on this host.

## 2. Hosting configuration

- Confirm Vercel plan eligibility, cost, region and runtime/memory/export limits. Do not assume Hobby permits the RWA's use.
- Use Node.js **24.x**, repository root as the project root, and the Next.js framework preset. Node major 24 is already constrained by `package.json` and `.nvmrc`.
- `vercel.json` installs with `npm ci`, builds with `npm run deploy:check && npm run build`, and allows automatic Git deployments only for `main`. The staging project's Preview disable and Production-scoped variables are managed separately in Vercel. Keep Next.js's managed output directory; this is not a static export or Edge-runtime application.
- Vercel manages server startup; do not configure `next dev` as a production command. On an approved self-managed Node host, run `npm run build`, then `npm run start -- --hostname 127.0.0.1 --port 3000` behind an HTTPS reverse proxy and process supervisor. That alternative requires separate ingress approval.
- `.vercelignore` excludes local environment files, local build output, dumps, encrypted backups, keys and test artifacts from CLI uploads. Its `!.env.example` exception retains only the tracked, placeholder-only example: the prebuild guide renderer validates a link to it. Never put real values in that example or remove the exclusions for `.env` and `.env.*`. `.gitignore` excludes `.vercel` metadata. Review the upload/repository before sending it to an approved host.
- Choose the application region near the approved database region (Mumbai is an architectural preference, not an approval). Region is intentionally not hard-coded.
- Keep the existing PDFKit/fontkit externalization and font tracing in `next.config.ts`. Validate a complete multi-page PDF on the actual host before enabling PDF exports; set `PDF_EXPORT_ENABLED=0` if deferring this optional feature.

Vercel settings documentation: [project configuration](https://vercel.com/docs/project-configuration), [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## 3. Secrets and environment separation

Create a **new, isolated production Supabase project** in the approved region, or explicitly approve and inventory an existing production project. Never reuse the development/test project, test users, test database login, or development keys. Keep Preview deployments on a separate staging Supabase project with synthetic data. Protect previews and do not inject production secrets into preview builds or pull-request CI.

Configure these in the hosting environment manager, scoped separately to Production and Preview:

| Variable | Requirement |
|---|---|
| `APP_ORIGIN` | Exact canonical HTTPS origin, e.g. `https://vote.example.org`, without path, query, credentials or trailing route. Match the domain users actually visit. |
| `NEXT_PUBLIC_SUPABASE_URL` | Approved project's bare HTTPS API origin, not a database connection URL or `/rest/v1` URL. Public/build-time value. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same project's publishable key or legacy **anon** key. Public/build-time value, never a secret/service-role/user token. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same project's server-only privileged credential, accessible only to the application runtime/build environment that requires it. Never prefix it with `NEXT_PUBLIC_`. |
| `RATE_LIMIT_HMAC_KEY` | Independent random production secret, at least 32 characters. Store in the approved secret manager; generate separately for each environment. |
| `APP_SUPPORT_EMAIL` | Optional server-only developer/support contact for RWA-controlled App Support Access. Leave unset unless the RWA wants in-app developer help; setting it grants nothing until an RWA Admin turns access on. Never prefix with `NEXT_PUBLIC_`. |
| `LOG_LEVEL` | Normally `info`; logs remain allowlisted and must not capture bodies, selections, OTPs, tokens or cookies. |
| `MAINTENANCE_MODE` | `1` for initial restricted deployment/recovery; `0` only for an authorized validation or release window. |
| `PDF_EXPORT_ENABLED` | `0` to defer optional PDF; `1` only after hosted font/render/runtime checks. |
| `TRUSTED_PROXY_CONFIG` | Reserved; not an enabled security control. Remains a release blocker as described above. |

Use the secret manager's generator for `RATE_LIMIT_HMAC_KEY` or generate 32 random bytes on an approved workstation; do not put its value in command arguments, logs, chat or version control.

The following belong **only** to an approved deployment/operations runner, not Vercel's application environment:

- `SUPABASE_ACCESS_TOKEN`: least-privilege management token only if using management/CLI operations.
- `MIGRATION_DATABASE_URL`: approved production direct or supported session-pooler migration connection, with `sslmode=verify-full` and the provider CA; never transaction pooling. Restrict database access to the migration operator/runner. Never use a backup login to migrate.
- Backup runner: `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_DIR`, `BACKUP_MAX_AGE_HOURS`, optionally `PG_BIN_DIR` and approved CA configuration. Follow [OPERATIONS.md](./OPERATIONS.md).
- Recovery rehearsal runner: `RESTORE_DATABASE_URL`, pointing to an isolated, already-migrated recovery environment, never production.
- Configuration inspection workstation/runner: `CONFIG_DATABASE_URL` for `npm run ops -- config-check`, using approved operator database access over verified TLS. No app login is required, but database authentication is; never expose this credential through Vercel, a public route or browser. See [read-only inspection](./OPERATIONS.md#read-only-rwa-configuration-inspection).

SMTP credentials belong in Supabase's provider settings, not application/public variables.

`npm run deploy:check` reads **only injected environment variables**, does not auto-load `.env.local`, and forces production validation. It exits nonzero on unsafe/missing configuration and reports names/rules without printing values. It does not authenticate keys, prove project isolation, validate approvals or enable IP limiting. Startup independently rechecks configuration through instrumentation. Never use CI's synthetic placeholders for a real deployment.

`config-check` additionally reads RWA configuration and aggregate setup health
from the independently confirmed target database. Its production environment
validation concerns the runner's injected values (or optional `.env.local`), not
the hosted configuration. A passing report does not verify Auth/SMTP, real
delivery, ingress, actual Cron execution, backups/restores or genuine approvals.
It makes no remote configuration or database changes.

`NEXT_PUBLIC_*` values and the CSP origin are bound when building. Rebuild for the final environment/domain; do not promote a staging build with staging public values or only edit runtime variables after building.

### Public site integrations

Set `APP_ORIGIN` to the final canonical origin at **build and runtime**: metadata,
robots and sitemap must not publish localhost or a preview domain. Rebuild after
changing it or the optional Google settings. Protect preview deployments from
public crawlers at the hosting access layer; do not assume robots is access control.

1. Contact: approve Resend and its processing region/retention, verify a sender
   domain including SPF/DKIM and applicable DMARC, and configure server-only
   `RESEND_API_KEY`, `CONTACT_EMAIL_FROM` and `CONTACT_EMAIL_TO` together. Addresses
   must be bare emails, not display-name forms. Use a controlled test recipient
   in staging. The sender is fixed; user email becomes Reply-To. Supabase OTP
   SMTP remains separate. Without these settings the contact page clearly states
   that online contact is unavailable.
2. Submit a uniquely identifiable **synthetic** enquiry through the real staging
   form. Record the support ID, provider acceptance ID/status and receipt in the
   intended inbox, including reply routing and spam handling. A `202` or a mocked
   test alone does not prove delivery. Test provider rejection/rate exhaustion and
   visible retry guidance without putting real resident content into evidence.
3. Analytics: approve the provider and notice, create a GA4 web stream and set
   `GOOGLE_ANALYTICS_ID=G-...`. **Disable all Enhanced Measurement**, including
   history page views, form interactions, site search, scroll and outbound events;
   disable Google Signals/advertising features. The application sends manual,
   sanitized privacy/contact page views only after a visitor opts in. Do not add
   Tag Manager containers, auto-event tags, replay or tracking to auth/voting.
   Verify consent refusal, withdrawal and a full navigation back to sign-in with
   no Google script. The CSP admits only the configured Google script/collection
   hosts when this setting is enabled; approve any regional endpoint changes
   explicitly rather than adding wildcard hosts.
4. Search Console: choose URL-prefix HTML-tag verification for the canonical
   property and set only the token in `GOOGLE_SITE_VERIFICATION`. Deploy/rebuild,
   inspect the `google-site-verification` tag and complete verification in Google.
   Submit `/sitemap.xml` there; code cannot prove property ownership or submission.
5. Review `/privacy` with the actual legal operator, contact details, approved
   providers/regions and retention periods before admitting residents. The current
   notice describes behavior and refers deployment-specific policy requests to
   the RWA; it is not evidence of legal approval. Organization schema uses the
   public service name Civic Pulse, not an invented legal RWA identity.
6. No URLs were renamed by this launch work, so there is no 301 mapping to invent.
   Inventory historical deployed URLs before changing any. Use explicit permanent
   redirects for verified old-to-new mappings and test a **301** response (Next.js
   `permanent: true` conventionally emits **308**, not 301). Domain aliases require
   equivalent canonical-domain redirects at the approved host.

Only `/sign-in`, `/privacy` and `/contact` belong in the sitemap. Private routes
inherit no-index directives; their canonical tags do not make them crawlable.
Private detail titles use the URL's record reference rather than resident names
or ballot content. Invalid identifiers receive no canonical tag. Keep existing
private/no-store caching and do not publish private URLs in social metadata.
Voting/access screens have no content images to convert or lazy-load. The public
user guide reuses the existing embedded PNG/SVG documentation illustrations;
screenshots are preserved without recapture/conversion for this footer-only
change and use lazy loading/async decoding in the web edition. Future content images
must use Next.js Image with meaningful alt text (empty only for genuinely
decorative images), WebP/AVIF negotiation and default lazy loading below the fold;
the share card is PNG for social crawler compatibility.

The footer serves public help at `/user-guide.html`. The `predev`/`prebuild`
lifecycle runs `node scripts/docs/render.mjs`, which regenerates both offline
guides and `public/user-guide.html`. Keep the Markdown, guide images, scripts and
locked development dependencies available during the build; do not deploy a
hand-edited or stale public HTML copy. Only the user guide is published: repository
links become non-clickable text, the technical guide/source are not exposed,
and the web edition contains no tracking/scripts. It has `noindex, follow` and
is intentionally absent from the sitemap. Smoke-test the footer link, Contents,
embedded images, print layout and **Back to Civic Pulse** on the deployed host.

## 4. Production database and migrations

The appearance review slice adds no database migration or account preference
service. Include the locked `next-themes` dependency and allow Next's build-time
Sora/Manrope preparation; the browser must load fonts from this application, not
Google. Keep the existing CSP rather than adding remote font/script permissions.
Check saved and System startup modes, both RWA accent variants, blocked storage,
cross-tab changes and light print in staging. Theme foundation inheritance is
not itself approval to redesign layouts or close manual accessibility gates. The
user subsequently approved the remaining screen rollout; that approval changes
presentation scope only, not production readiness or voting guarantees.

Guide updates are authorized and persona screenshots are kept in
`docs/images/user-guide/voter`, `rwa-admin` and `rwa-readonly`. The normal
`predev`/`prebuild` hooks regenerate current HTML from Markdown and images.
Use `PLAYWRIGHT_PRESERVE_GUIDE=1` when a browser run should preserve already
rendered guide output; use direct Next commands when intentionally avoiding the
hooks. The capture suite uses only synthetic data on the approved disposable
project and never on production.

Apply the complete ordered migration set from `20261024100000_core_schema.sql` through `20261116100000_resident_identifier_contains.sql`. Migrations `20261109100000` and `20261110100000` add resident self-registration (`profiles.self_registered` and the service-role-only `self_register_resident` routine) and administrator account creation together with a household (`provision_profile_with_household`). Migration `20261111100000` supplies the existing security-invoker directory view; `20261115100000` adds the committee-only globally sorted/filtered page-ID/count routine required by the new Residents table. Migration `20261116100000` adds identifier substring matching while retaining exact filters for older callers. Both table migrations are applied only to the separately authorized disposable project, not real production. Resolve the duplicate local migration-version issue described above before relying on a complete CLI push. Do not drop the view or rewrite applied history. Migrations `20261112100000` and `20261113100000` preserve App Support Access and household-free management-role enablement. Earlier disposable/staging application evidence is recorded above, not production approval. Deploy reviewed migrations before the corresponding application revision, outside voting windows. The Residents list depends on the directory view, table-window routine and current profile columns; Add Resident and `/register` depend on their provisioning routines. See [supabase/README.md](../supabase/README.md) and [DATABASE.md](./DATABASE.md). The app never migrates at startup or during the Vercel build.

Before rollout, verify a 500-row synthetic import's Auth-provider quota behavior,
partial-failure/retry handling and suspended-account review. Verify scheduled
opening/withdrawal, direct pre-opening candidate/option denial and the existing
completion Cron job in disposable staging. Both start and closure must remain
database-clock enforced if Cron is delayed. Discard old finished-vote list cursors
after deployment because scheduled discovery adds a pagination rank. Refresh
affected guide screenshots only on the migrated disposable fixture project.

The 27 October screenshot run applied the two follow-up migrations only to the
user-confirmed disposable project and exercised the focused browser capture.
That is not a production rollout. Migrations using `SET LOCAL ROLE` must restore
the deployment role before the CLI records history; the first failed attempt
was verified fully rolled back before correcting the unapplied files and retrying.
Browser fixture connections now require the provider CA via `PGSSLROOTCERT` and
retain certificate/hostname verification.

Before any write:

1. Independently verify the destination project reference, hostname, PostgreSQL major version, owner and environment in the Supabase dashboard. Supabase PostgreSQL **17** is the tested target. Do not print the connection URL.
2. For an existing database, take a verified encrypted backup, preserve configuration/Auth recovery material, and confirm a restore rehearsal. Schedule an approved maintenance window outside active votes.
3. Use an approved installed Supabase CLI version, authenticated from the deployment-only secret store. With `MIGRATION_DATABASE_URL` injected, run these read-only planning commands in a trusted operator session:

   ```powershell
   supabase migration list --db-url $env:MIGRATION_DATABASE_URL
   supabase db push --db-url $env:MIGRATION_DATABASE_URL --dry-run
   ```

   The CLI accepts the database URL as an argument: use an isolated trusted runner because same-machine process inspection can reveal it. Do not echo command expansion, enable debug logs, paste URLs into tickets, or run on a shared workstation. Follow the provider's verified TLS/CA instructions; never disable verification.

4. Review pending SQL and migration history. Stop for unexpected remote-only migrations, drift, incompatible versions or existing data. Do not repair migration history automatically.
5. **Manual approval required:** only then apply the reviewed pending migrations:

   ```powershell
   supabase db push --db-url $env:MIGRATION_DATABASE_URL
   supabase migration list --db-url $env:MIGRATION_DATABASE_URL
   ```

6. Confirm every reviewed local migration version appears remotely, RLS/grants match the migrations, and the supported Auth/Data API access checks pass in staging. Never run the destructive test fixtures or live test suites against production.
7. Enable/verify `pg_cron` using supported provider controls. Migrations can skip scheduling when it is absent; a successful push is not proof of scheduling. Verify both jobs and recent run status read-only:

   ```sql
   select jobname, schedule, active, username, command
   from cron.job
   where jobname in ('civic-pulse-complete-due-votes', 'civic-pulse-maintenance');
   select status, start_time, end_time
   from cron.job_run_details
   order by start_time desc limit 10;
   ```

   The scheduling username is the migration role; verify the command explicitly starts with `set role cp_scheduler` before calling the narrowly scoped routine. There is no public HTTP cron endpoint. A disabled/unavailable extension is an unresolved operational gate.
8. Initialize settings and the first administrator through the documented `app_private.deployment_*` procedures, using real authorities/approved retention values. Record actual A1-A7 approvals, never test approvals. Do not copy test settings/registers into production.

**Never** run `db reset`, use remote reset flags, recreate application schemas, rewrite applied migrations, seed test fixtures, or restore an older database merely to undo a deployment. Preserve acknowledged ballots. A rollback is schema-compatible application code or an approved forward fix.

Production migration status is **unverified until an authorized operator completes these checks**; local migration tests do not imply the production project was inspected.

## 5. Auth, SMTP, domain, HTTPS and CORS

In the production Supabase dashboard:

- Disable public signup, including provider-specific signup paths; keep only approved authentication providers enabled.
- Set Site URL to the exact canonical `APP_ORIGIN`; allow only explicit required redirect URLs, not wildcard production/preview domains.
- Configure six-digit email OTP and the `{{ .Token }}` email template, with the approved expiry, resend and verification limits under A4. Do not blindly push `supabase/config.toml`: it contains local URLs/defaults and can overwrite hosted settings.
- Configure the approved custom SMTP account, sender and DNS authentication (SPF/DKIM/DMARC where supported). Gmail SMTP was discussed but is not configured or approved here. Verify provider limits and delivery capacity for the actual peak; a built-in/test email service is not production delivery.
- Validate login, expiry, refresh, sign-out, suspension and role changes end to end in staging. Disable sensitive Auth/request payload capture.

Add the approved domain in the hosting dashboard and apply **only that dashboard's** DNS records after DNS-owner approval. Wait for verified ownership and an issued HTTPS certificate. Redirect HTTP and alternate hostnames to the single canonical HTTPS host, without credentialed cross-origin redirects.

The application intentionally has **no cross-origin credential CORS allowlist**. Keep browser API calls same-origin; do not add `Access-Control-Allow-Origin: *` or broadly permit preview domains. Mutations validate exact Origin plus CSRF. Verify Supabase authentication configuration separately; do not weaken application Origin checks to accommodate a wrong domain.

Existing production headers include HSTS (`includeSubDomains`), CSP, frame denial, MIME protection and no-referrer. Review ownership/HTTPS of all affected subdomains before enabling the canonical domain. Session cookies are HttpOnly, SameSite=Lax and Secure in production. Restrict access while the ingress/IP gate remains open.

## 6. Validation, rollout and monitoring

The GitHub workflow runs locked install, formatting, types, lint, unit tests, non-restore integration tests on an **ephemeral PostgreSQL 17** service, a production build with synthetic environment values, and signed-out Chromium foundation journeys. The external-provider health test is excluded from that browser job and remains a staging/production check. The workflow has read-only repository permission and no production deployment secrets. No automatic deployment or database migration is configured here.

Before connecting hosting to Git, require the validation workflow on the release branch and configure deployment approvals/protection in the repository and host. Vercel's Git integration can otherwise publish independently of this workflow; do not assume adding the workflow gates a deployment.

The restore suite is intentionally separate because it requires matching PostgreSQL client tools and recovery fixtures. Before release, run it on an isolated approved runner, plus staging browser/live checks, load tests, real-device checks and an off-site restore. The CI workflow must itself pass in the repository host before it is treated as evidence.

Local candidate checks:

```powershell
npm run format:check
npm run typecheck
npm run lint
npm test
npm run deploy:check       # production variables injected; never load dev credentials
npm run build
```

Deployment sequence:

1. Validate in a staging project using synthetic data and staging secrets; run the supported integration/live/browser suites there only.
2. Apply approved production migrations separately; verify history, policies, jobs, backup and recovery readiness.
3. Configure production environment with `MAINTENANCE_MODE=1`. Deploy through the approved Vercel project/dashboard, without sending local secrets. A protected preview is not automatically a public production release.
4. Verify DNS/TLS and the exact built configuration. The initial health response must be **503 unavailable** during maintenance.
5. Only after release gates close, open a controlled validation window with `MAINTENANCE_MODE=0` and redeploy as required by the host. Verify `GET /api/internal/health` is **200** with only `data.status` and `requestId`; otherwise do not admit voters.
6. Confirm signed-out pages redirect to sign-in, protected APIs deny access, wrong-Origin mutations fail, no wildcard credential CORS exists, and protected responses use `private, no-store`. Verify actual secure cookie attributes and refresh/logout over HTTPS.
7. Validate SMTP with approved operator accounts; perform ballot/export acceptance checks in staging rather than generating fake production votes.
8. Enable privacy-safe monitoring and alert delivery: health availability, Cron lag, database capacity, invariant/submission failures, email errors, exports and backup freshness. Do not use monitoring as a free-tier keep-alive. Configure the external backup scheduler/off-site destination separately; Vercel's ephemeral filesystem is not backup storage.
9. Record deployment URL, artifact/revision, time, environment, migration versions and approving operator in the approved release record. Never include secrets.

For HTTPS checks, use a trusted shell without disabling certificate validation:

```powershell
Invoke-WebRequest -Uri "$env:APP_ORIGIN/sign-in"
Invoke-RestMethod -Uri "$env:APP_ORIGIN/api/internal/health"
```

Check status codes and headers, not just a successful TCP connection. A public TLS certificate, healthy database response, and successful OTP delivery on the actual domain cannot be proven by a local build.

## 7. Rollback and incident response

Retain the previous schema-compatible application artifact and its matching public configuration. Re-enable maintenance on incidents, preserve logs/support IDs without payloads, and use [OPERATIONS.md](./OPERATIONS.md) for reconciliation/recovery. Never roll back accepted-data completeness by restoring a pre-deployment backup after accepting votes.

Stop rollout for incorrect totals, lost/duplicate/partial/late ballots, unauthorized disclosure, failed health/TLS/SMTP, missing approvals, unverified ingress, or recovery uncertainty. Resume only under the approved incident/release process.
