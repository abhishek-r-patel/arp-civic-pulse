# Civic Pulse

Mobile-first voting and polls for a single Resident Welfare Association (RWA).

The application implements registered-member email OTP access, household/account administration, OPEN polls and CLOSED elections, protected results, CSV/PDF exports, and operational backup/recovery tooling. Production use remains blocked by the approvals and external-environment checks in [pilot readiness](./docs/PILOT_READINESS.md).

## Source of truth

| Document                                                             | Authority                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| [AGENTS.md](./AGENTS.md) | Root instructions and automatic documentation-sync checklist |
| [docs/AGENTS.md](./docs/AGENTS.md)                                   | Workspace-wide engineering rules                            |
| [docs/PRD.md](./docs/PRD.md)                                         | Scope, behaviour and acceptance criteria                    |
| [docs/DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md)                     | Visual tokens, accessibility and responsive behaviour       |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)                       | Stack, boundaries, privacy and operations                   |
| [docs/API.md](./docs/API.md), [docs/DATABASE.md](./docs/DATABASE.md) | Supporting contracts                                        |
| [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md)         | Sequencing                                                  |
| [docs/OPERATIONS.md](./docs/OPERATIONS.md)                           | Backups, restore, retention, monitoring, incidents          |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)                           | Production deployment, secrets, migrations and verification |
| [docs/PILOT_READINESS.md](./docs/PILOT_READINESS.md)                 | Evidence gathered and gates still open                      |

## Learning and user documentation

- [Junior-developer technical guide](./docs/TECHNICAL_GUIDE.md) — architecture, source map, authentication, database invariants, feature walkthroughs, tests and deployment boundaries. [Printable/offline HTML](./docs/TECHNICAL_GUIDE.html).
- [Illustrated resident and administrator guide](./docs/USER_GUIDE.md) — step-by-step main flows, recovery guidance, 47 synthetic screenshots and flow diagrams. [Printable/offline HTML](./docs/USER_GUIDE.html).
- HTML copies embed their images, require no CDN/JavaScript, and support browser Print / Save as PDF. Supporting source/document links require the repository layout.
- The application footer opens `/user-guide.html`, a self-contained public copy generated at `public/user-guide.html`. It embeds the same synthetic screenshots, disables repository-only links and includes a return-to-app link. `npm run dev` and `npm run build` regenerate guides first; footer-only changes do not require new screenshots.
- Regenerate HTML with `node scripts\docs\render.mjs`; test the small renderer with `node --test scripts\docs\render.test.mjs`.
- Screenshot capture is deliberately separate from normal tests: set `LIVE_AUTH=1` and `DOC_SCREENSHOTS=1`, then run `npx playwright test -c playwright.docs.config.ts`. Use **only a disposable fixture project**: the run creates synthetic accounts, households, votes and submissions and supplies test-only policy settings. Do not use a production project. See the technical guide for details and coverage limitations.

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

Server configuration is validated when the server starts (`src/instrumentation.ts` → `src/server/config/environment.ts`); production fails clearly on missing or unsafe values. See [.env.example](./.env.example) for placeholder-only variables.

- `NEXT_PUBLIC_*` values are visible in browsers and must never hold a secret.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and reserved for controlled Auth provisioning, never ballots, results or exports.
- `SUPABASE_ACCESS_TOKEN` and `MIGRATION_DATABASE_URL` are deployment-only and not read by the running application.
- SMTP, OTP settings and Cron are configured in Supabase/provider settings and reviewed migrations.

## Layout

Public `/sign-in`, `/privacy` and `/contact` pages are server-rendered and have
canonical metadata, social cards and structured data. `/robots.txt` and
`/sitemap.xml` list only the public surface; resident and administrator screens
default to `noindex, nofollow`. Contact email (Resend), opt-in public-page GA4 and
Search Console verification require the optional settings in `.env.example`.
See the [launch checklist audit](./docs/LAUNCH_AUDIT.md#public-site-checklist-26-october-2026)
and [activation steps](./docs/DEPLOYMENT.md#public-site-integrations).

```text
src/app            Routes, route groups ((access), (member)), admin, api handlers
				   privacy/contact pages; robots.ts, sitemap.ts, opengraph-image.tsx, icon.svg
src/components     ui (shared primitives), votes, admin
				   access/contact-form.tsx; ui public metadata/analytics/navigation
src/server         Server-only modules: config, auth, db, results, audit, ...
				   contact.ts (support email only)
src/shared         Browser-safe contracts and validation
				   metadata.ts (public page inventory); contracts/contact.ts
src/styles         Tailwind theme and design tokens (globals.css)
supabase           config.toml and migrations (reviewed, versioned SQL)
tests              unit, integration, e2e, fixtures
public/user-guide.html Generated public user help; do not edit separately from the Markdown guide
```

Real voting requires approval of PRD assumptions A1–A7, providers, region, retention and recovery objectives. Follow the [deployment runbook](./docs/DEPLOYMENT.md); a successful build or configuration check alone does not establish production readiness.
