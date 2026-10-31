# Civic Pulse

Mobile-first voting and polls for a single Resident Welfare Association (RWA).

The application implements registered-member email OTP access, household/account administration with reviewed CSV import, PUBLIC polls and PRIVATE elections with immediate or scheduled opening, protected results, CSV/PDF exports, and operational backup/recovery tooling. Production use remains blocked by the approvals and external-environment checks in [pilot readiness](./docs/PILOT_READINESS.md).

The [SaaS action plan](./docs/IMPLEMENTATION_PLAN.md#saas-action-plan---31-october-2026)
tracks the planned shared application, separate Supabase projects per RWA,
customer subdomains and synthetic-only `demo.yourapp.in` environment. It contains
confirmed S01 starting policies and unresolved decisions, not a deployed SaaS
offering or production approval. S01 is partially complete: operator-assisted
onboarding, a read-only synthetic demo, manual annual billing and responsibility
boundaries are confirmed. Resolve the remaining commercial, capacity and
voting-scope decisions before marking S01 complete. S02's fail-closed tenant
resolution/configuration design is specified, including Vercel's shared-secret
limits. S03 adds locally tested, request-scoped tenant routing behind
`TENANT_ROUTING_ENABLED`, which defaults to false. No directory, tenant secrets
or customer hosts are configured or deployed; the actual domain, proposed
three-customer cap and Vercel ingress remain unconfirmed. S03 is not release
approval; S04-S12 remain pending.

The [staging site](https://arp-civic-pulse-staging.vercel.app) uses Vercel's
**Production target only**, backed by the disposable Supabase project. Automatic
Preview deployments are disabled; only `main` deploys automatically. This is not
real production: that requires separate Vercel/Supabase projects and approvals.
See the [current hosting setup](./docs/DEPLOYMENT.md#current-staging-configuration-production-target-only).

Accounts use one of three lowercase role codes: `voter`, `rwa-admin`, or
`rwa-readonly`. Their personas are Resident, RWA Admin, and RWA ReadOnly.
Administrators alone assign roles and make management changes; readonly
observers have the same authorized management reads and downloads, with visible
disabled controls. Both management roles can also vote through their own enabled
household entitlement. The management roles are exclusive, and an observer must
have a household assignment to vote, but can be enabled without one.

Administrators manage accounts and flats together on **Residents → Add Resident**.
A household is required when creating a voter in this form, optional for management
roles; eligibility and "Enable account now" remain separate optional approvals.
Settings → Default Households defines allowed identifiers, not assignments:
only unassigned listed households can be chosen when configured; without a list,
type the identifier. A resident's details page can assign or move its household
and edit its eligibility inline with Save/Cancel, without leaving the page.
Existing direct eligibility-editor links still work. Residents includes status, role, source, exact
identifier-contains and eligibility filters plus CSV import. Residents is the only register
UI route; former Accounts/Households pages return 404, with no redirects. Existing
account and household APIs remain unchanged. Residents
defaults to flat/name sorting with unassigned people last, with sortable/filterable
column headings and a compact Source toolbar (**Sort & Filter** on phones).
Controls cover all matching residents before pagination, including name and
Last Changed range filters. This also needs the reviewed
`20261115100000_resident_table_controls` read-only RPC migration before deployment.
It is applied only to the authorized disposable database, not real production.
The identifier-contains follow-up additionally needs
`20261116100000_resident_identifier_contains`: both name and identifier searches
match anywhere, ignoring case, without wildcard syntax. Exact API filters remain unchanged.

All paginated screens (Votes, Residents, Manage Votes, Audit History,
participation and completed PUBLIC named responses) show filtered result totals,
icon-only **First / Previous / Next / Last**, **Page X of Y · N results**,
and **Per page** options 10/25/50/100. Selecting a page size applies it
immediately and restarts at page 1 while retaining filters.
This needs `20261114100000_numbered_pagination`; cursor-based HTTP list APIs and
full-result downloads remain unchanged.
The sortable and filterable Manage Votes table additionally requires the
read-only `20261119100000_admin_vote_table_controls` migration before deploying
this UI revision; it is applied only to the verified disposable project, not
staging or production. The application does not apply it at startup.
The approved Turnout column requires the follow-up
`20261120100000_admin_vote_turnout` migration, which extends that guarded RPC
with aggregate submitted/eligible counts for Active and Completed votes only.
It was applied only to the verified `civic-pulse-disposable` project after
separate authorization; staging and production are untouched.

Administrators can open **Import CSV** from the register: upload at most 500 rows
(256 KiB), check conflicts, confirm import, then review and enable suspended
accounts using individual controls or the Residents table's separate **Enable Selected**
and **Make Eligible** actions. The table defaults to Voters; explicitly select
All Roles to include administrators. Selections cover only the current page.
Existing records are never overwritten. From a ready
ballot preview, **Schedule Vote** freezes the ballot and electorate immediately;
residents see only the summary and opening countdown until database time permits
voting. A confirmed, reasoned **Return to Draft** is allowed only before opening.
Apply the reviewed `20261106100000`, `20261107100000` and
`20261108100000` migrations to a verified disposable/staging environment
before exercising these flows; the app never migrates at startup. The latest
migration adds the committee read-only role. See the in-app User Guide at `/user-guide`.

Residents can also onboard themselves at `/register` (linked from sign-in and the
footer) with their name, email and household identifier, chosen from the
admin-configured Default Households when any are set (free text otherwise). Each registration is
created **suspended** with an **ineligible** household; a repeated email or an
already registered household is rejected with a specific error. Administrators
find them on **Residents** with the **Source: Self-registered** filter and use the
same enable/eligibility actions. This needs the reviewed
`20261109100000_resident_self_registration` migration; see
[API.md](./docs/API.md#public-resident-self-registration-endpoint).

## Source of truth

Commit titles use scoped Conventional Commits: `type(scope): imperative summary`
(for example `feat(admin): add resident source sorting`). Generate one message
with one title, a blank line and ordinary `- ` bullet points, not multiple
Conventional Commit titles. The workspace
[VS Code settings](./.vscode/settings.json) configure Source Control's
**Generate Commit Message** action with this rule; review generated messages
before committing. Shared agent guidance lives in [docs/AGENTS.md](./docs/AGENTS.md).

### Appearance Review Slice

Platinum light and Obsidian dark appearance are available through the header's
sun/moon/monitor menu: **Light**, **Dark** or **System** (default). The preference
is browser-local, not an account setting, and contains no resident/voting data.
Sora headings and Manrope body fonts are self-hosted through `next/font` in both
modes. RWA accent choices stay independent, with contrast-checked dark variants.
Print remains light and bundled PDF typography is unchanged. The shared foundation
now extends across resident ballots/review/results, account/household administration,
vote setup/preview/lifecycle/participation, settings/audit and public access/information
screens following approval of Votes and Accounts. Existing top navigation, voting
logic, permissions, exports and recovery flows are retained.

The native User Guide has separate Resident and RWA Admin pages with
end-to-end instructions, contents anchors and current synthetic illustrations.
Only curated referenced screenshots are published in `public/guides/`.

The Votes correction now follows the approved concept: compact logo/alias branding,
three own-entitlement totals, status navigation, a compact type menu and history
action, richer vote cards with real turnout, and an upcoming-vote row. Guide
screenshots are captures of the actual application, not the original mockup.
Active/Scheduled/Your Responses totals span the signed-in user's
frozen entitlements across pages/filters; administrators do not receive association-
wide counts by role. Unavailable data is labelled, never replaced with sample totals.

| Document                                                             | Authority                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------ |
| [AGENTS.md](./AGENTS.md)                                             | Root instructions and automatic documentation-sync checklist |
| [docs/AGENTS.md](./docs/AGENTS.md)                                   | Workspace-wide engineering rules                             |
| [docs/PRD.md](./docs/PRD.md)                                         | Scope, behaviour and acceptance criteria                     |
| [docs/DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md)                     | Visual tokens, accessibility and responsive behaviour        |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)                       | Stack, boundaries, privacy and operations                    |
| [docs/API.md](./docs/API.md), [docs/DATABASE.md](./docs/DATABASE.md) | Supporting contracts                                         |
| [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md)         | Sequencing                                                   |
| [docs/OPERATIONS.md](./docs/OPERATIONS.md)                           | Backups, restore, retention, monitoring, incidents           |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)                           | Production deployment, secrets, migrations and verification  |
| [docs/PILOT_READINESS.md](./docs/PILOT_READINESS.md)                 | Evidence gathered and gates still open                       |

## Learning and user documentation

- Open `/tech-guide` directly on the app host for the public junior-developer guide: file/route map, feature traces, ERD, invariants, deployment, tests and safe debugging. It is intentionally unlinked from app navigation, noindex/nofollow and outside the sitemap; an unlisted URL is not access control.
- Open `/user-guide` from the footer, then `/user-guide/resident` or `/user-guide/rwa-admin`. Each public page has a table of contents and bookmarkable sections, including registration-to-results and RWA-setup-to-audit workflows. Dedicated ReadOnly pages are outside this migration's selected scope; the role remains supported by the app.
- Developers/operators can run `npm run ops -- config-check` to inspect RWA configuration without an app login. This is a local, read-only database report, **not an unauthenticated web entry**. It requires the separately protected `CONFIG_DATABASE_URL`; see [operator setup and report limits](./docs/OPERATIONS.md#read-only-rwa-configuration-inspection).
- For live, in-app developer help, an RWA Admin can turn **App Support Access** on or off from RWA Settings. When on, the server-only `APP_SUPPORT_EMAIL` identity gets household-free, read-only (`rwa-readonly`) access through the normal email OTP flow; it cannot vote, is RWA-controlled and audited, and is **not** a hidden login or default administrator. See [App Support Access](./docs/OPERATIONS.md#app-support-access-developer-help-rwa-controlled).
- Legacy Markdown/HTML guides, embedded-image outputs and old screenshots have been removed. Guides are server-rendered app pages; `npm run dev`/`npm run build` no longer generate documents. User-guide pages are included in public discovery; the technical guide is not. Analytics stays restricted to consented privacy/contact visits.
- Run `node --test scripts\docs\check.test.mjs` for native-guide assets/source references and `npx playwright test tests/e2e/guides.spec.ts --project=chromium` for browser navigation, images, accessibility and layout.
- Screenshot capture is separate from ordinary tests: confirm the disposable target, set `LIVE_AUTH=1`, `DOC_SCREENSHOTS=1` and `DOC_DISPOSABLE_CONFIRMED=1`, then run `npx playwright test -c playwright.docs.config.ts`. It creates synthetic accounts, households, votes and submissions and supplies fixture-only policies. Never use production. The curated inventory is `src/shared/guides/screenshots.ts`; only referenced Resident/Admin images and their intrinsic dimensions are published. Emails/codes are masked; confirmations are dialog-only, and unchanged dropdown variants are omitted.
- To refresh only import/scheduling pictures, add `--grep "bulk import and scheduled opening"`. The shared browser fixture database helper now verifies TLS using the approved provider CA in `PGSSLROOTCERT`; it never disables certificate/hostname checks. The user-confirmed disposable project received the two new migrations for the 27 October capture, not a production deployment.
- To refresh only account-review pictures, use `--grep "bulk account review"` with the same disposable-project safeguards. This checks separate eligibility and multi-account enablement, explicit administrator inclusion and a controlled failed request.
- Temporary RWA profile changes are restored and active examples are safely cancelled during cleanup. Historical synthetic fixture records remain for the disposable-project cleanup procedure; the capture does not reset a shared database. Screenshots do not prove SMTP delivery, scheduled Cron execution or production readiness. Normal theme tests remain separate: `npx playwright test tests/e2e/theme.spec.ts --project=chromium`.

## Stack

Next.js (App Router), React, TypeScript (strict), Tailwind CSS, Lucide React, Zod, and Supabase (Auth, PostgreSQL, RLS, SQL functions, Cron) through `@supabase/supabase-js` and `@supabase/ssr`. Tests use Vitest, Playwright and axe. PDF export uses PDFKit with bundled, openly licensed fonts (Inter and Noto Sans Devanagari).

## Prerequisites

- Node.js 24 LTS and npm (see `.nvmrc`)
- Docker and the Supabase CLI are required only for the local Supabase stack (`npx supabase start`), which later phases need

## Getting started

```powershell
npm ci
Copy-Item .env.example .env.local   # fill with isolated development settings
npm run dev
```

Open <http://localhost:3000>. Use synthetic data only; never copy production registers, ballots or backups into development.

## Scripts

| Command                                   | Purpose                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | Development server                                                                                              |
| `npm run build` / `npm run start`         | Production build and server                                                                                     |
| `npm run deploy:check`                    | Validate injected production configuration without loading local environment files or printing values           |
| `npm run lint`                            | ESLint (Next.js core-web-vitals and TypeScript rules)                                                           |
| `npm run format` / `npm run format:check` | Prettier with the Tailwind class-order plugin                                                                   |
| `npm run typecheck`                       | `tsc --noEmit` under strict settings                                                                            |
| `npm test`                                | Vitest unit tests in `tests/unit`                                                                               |
| `npm run test:integration`                | Real-PostgreSQL tests in `tests/integration` (needs `INTEGRATION_DATABASE_URL`, see `supabase/README.md`)       |
| `npm run test:live`                       | Real hosted Supabase Auth/PostgREST tests in `tests/live` (needs a disposable project in `.env.local`)          |
| `npm run test:e2e`                        | Playwright and axe checks in `tests/e2e` (run `npx playwright install` first)                                   |
| `npm run ops -- <command>`                | Backup, verify, restore rehearsal, status, orphan Auth cleanup (see [docs/OPERATIONS.md](./docs/OPERATIONS.md)) |

Browser journeys that sign in for real (`tests/e2e/*-live.spec.ts`) run only with `LIVE_AUTH=1`. On managed Windows machines, system policy can close Microsoft Edge shortly after Playwright starts it ("DevTools remote debugging is disallowed by the system admin"); use Playwright's own Chromium (`npx playwright install chromium`) instead of `PLAYWRIGHT_CHROMIUM_CHANNEL=msedge`.

## GitHub security automation

- [Dependabot](./.github/dependabot.yml) checks npm dependencies and GitHub Actions weekly on Mondays. Minor/patch npm updates are grouped; major npm updates remain separate. Update PRs are not automatically merged.
- [CodeQL](./.github/workflows/codeql.yml) scans JavaScript/TypeScript on pushes, pull requests, manual runs and a weekly schedule. It uses extended security queries without building the app or accessing Supabase; no application secrets are needed.
- This CodeQL workflow uses **advanced setup**. If CodeQL **default setup** is already enabled in GitHub, disable it before using this workflow; default setup blocks advanced workflow uploads. Keep GitHub Actions enabled and allow the referenced actions under repository/organization policy.
- Enable Dependabot alerts and security updates in repository security settings separately. Commit both configuration files to the default branch for scheduled scans and version updates to take effect. Review the first runs in Actions/Security and configure required status checks separately.

## Configuration

New here? Follow the step-by-step [local setup guide](./docs/LOCAL_SETUP.md).

Server configuration is validated when the server starts (`src/instrumentation.ts` → `src/server/config/environment.ts`); production fails clearly on missing or unsafe values. The same startup hook and `src/instrumentation-client.ts` initialize optional, scrubbed Sentry error monitoring on Vercel Production/Preview only (see [Operations](./docs/OPERATIONS.md)). See [.env.example](./.env.example) for placeholder-only variables.

- `NEXT_PUBLIC_*` values are visible in browsers and must never hold a secret.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and reserved for controlled Auth provisioning and resident self-registration, never ballots, results or exports.
- Host-based routing is disabled by default. `TENANT_ROUTING_ENABLED`,
  `TENANT_DIRECTORY_JSON` and UUID-keyed tenant secrets must not be configured
  until the domain, pilot cap, S04 origin/session behavior and Vercel ingress
  trust are approved and verified. See the [S03 implementation status](./docs/IMPLEMENTATION_PLAN.md#working-checklist).
- `APP_SUPPORT_EMAIL` is an optional server-only developer/support contact; it only becomes usable when an RWA Admin turns App Support Access on, and never appears in a browser.
- `SUPABASE_ACCESS_TOKEN` and `MIGRATION_DATABASE_URL` are deployment-only and not read by the running application.
- SMTP, OTP settings and Cron are configured in Supabase/provider settings and reviewed migrations.

## Layout

Public `/sign-in`, `/privacy` and `/contact` pages are server-rendered and have
canonical metadata, social cards and structured data. `/robots.txt` and
`/sitemap.xml` list only the public surface; resident and administrator screens
default to `noindex, nofollow`. The public `/register` self-registration page is
also `noindex` and outside the sitemap. Contact email (Resend), opt-in public-page GA4 and
Search Console verification require the optional settings in `.env.example`.
See the [launch checklist audit](./docs/LAUNCH_AUDIT.md#public-site-checklist-26-october-2026)
and [activation steps](./docs/DEPLOYMENT.md#public-site-integrations).

```text
src/app            Routes, route group (access), admin, api handlers
				   privacy/contact/register pages; robots.ts, sitemap.ts, opengraph-image.tsx, icon.svg
src/components     ui (shared primitives), votes, admin, guides
				   access/contact-form.tsx, access/self-registration-form.tsx; ui public metadata/analytics/navigation
src/server         Server-only modules: config, auth, db, results, audit, ...
				   contact.ts (support email only); register/self-registration.ts
src/shared         Browser-safe contracts and validation
				   metadata.ts (public page inventory); contracts/contact.ts
src/styles         Tailwind theme and design tokens (globals.css)
supabase           config.toml and migrations (reviewed, versioned SQL)
tests              unit, integration, e2e, fixtures
src/app/user-guide Native public index and Resident/RWA Admin guide pages
src/app/tech-guide Unlisted public developer reference
src/components/guides Native content, contents navigation, screenshots and diagrams
src/shared/guides/screenshots.ts Curated synthetic screenshot inventory
public/guides      Current referenced PNGs and generated dimensions.json
scripts/docs       Opted-in captures and native-guide checks; no HTML renderer
```

Real voting requires approval of PRD assumptions A1–A7, providers, region, retention and recovery objectives. Follow the [deployment runbook](./docs/DEPLOYMENT.md); a successful build or configuration check alone does not establish production readiness.
