# Production deployment runbook

## 1. Status and approval boundary

This repository is **prepared for deployment, not deployed or approved for real voting**. The architecture prefers Vercel for Next.js and Supabase PostgreSQL/Auth/Cron. No hosting account, production Supabase project, region, domain, budget or trusted ingress is selected by this configuration. No existing hosted project is assumed to be production.

Do not promote a deployment or admit real residents until the open gates in [PILOT_READINESS.md](./PILOT_READINESS.md) are closed. In particular, `TRUSTED_PROXY_CONFIG` is reserved and **does not implement trusted-client-IP limiting**. Approve ingress, implement and test spoof-resistant IP enforcement before release; setting the variable is not a workaround. This guide does not grant approval of A1-A7, providers, regions, retention or recovery objectives.

## 2. Hosting configuration

- Confirm Vercel plan eligibility, cost, region and runtime/memory/export limits. Do not assume Hobby permits the RWA's use.
- Use Node.js **24.x**, repository root as the project root, and the Next.js framework preset. Node major 24 is already constrained by `package.json` and `.nvmrc`.
- `vercel.json` installs with `npm ci` and builds with `npm run deploy:check && npm run build`. Keep Next.js's managed output directory; this is not a static export or Edge-runtime application.
- Vercel manages server startup; do not configure `next dev` as a production command. On an approved self-managed Node host, run `npm run build`, then `npm run start -- --hostname 127.0.0.1 --port 3000` behind an HTTPS reverse proxy and process supervisor. That alternative requires separate ingress approval.
- `.vercelignore` excludes local environment files, local build output, dumps, encrypted backups, keys and test artifacts from CLI uploads. `.gitignore` excludes `.vercel` metadata. Review the upload/repository before sending it to an approved host.
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

SMTP credentials belong in Supabase's provider settings, not application/public variables.

`npm run deploy:check` reads **only injected environment variables**, does not auto-load `.env.local`, and forces production validation. It exits nonzero on unsafe/missing configuration and reports names/rules without printing values. It does not authenticate keys, prove project isolation, validate approvals or enable IP limiting. Startup independently rechecks configuration through instrumentation. Never use CI's synthetic placeholders for a real deployment.

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

During the current User Guide hold, run `node node_modules/next/dist/bin/next build`
for the application gate, not `npm run build` (whose prebuild regenerates guides).
Use the analogous direct dev command for preview and
`PLAYWRIGHT_PRESERVE_GUIDE=1` for browser tests. Technical HTML can be regenerated
selectively with the renderer's exported `renderGuide('TECHNICAL_GUIDE')`.
Do not silently regenerate or recapture User Guide assets until the user resumes
that work; verify their content hashes before/after validation.

Apply the complete ordered migration set from `20261024100000_core_schema.sql` through `20261107100000_scheduled_opening.sql`. The final two migrations add guarded register import and frozen scheduled opening; deploy them before the corresponding application revision, outside voting windows. See [supabase/README.md](../supabase/README.md) and [DATABASE.md](./DATABASE.md). The app never migrates at startup or during the Vercel build.

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
