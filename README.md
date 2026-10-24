# Civic Pulse

Mobile-first voting and polls for a single Resident Welfare Association (RWA).

This repository currently contains the **project foundation only**: tooling, design tokens, shared UI primitives, environment validation and base routes. Sign-in, voting, administration, database schema and exports are not implemented yet.

## Source of truth

| Document                                                             | Authority                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| [docs/AGENTS.md](./docs/AGENTS.md)                                   | Workspace-wide engineering rules                      |
| [docs/PRD.md](./docs/PRD.md)                                         | Scope, behaviour and acceptance criteria              |
| [docs/DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md)                     | Visual tokens, accessibility and responsive behaviour |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)                       | Stack, boundaries, privacy and operations             |
| [docs/API.md](./docs/API.md), [docs/DATABASE.md](./docs/DATABASE.md) | Supporting contracts                                  |
| [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md)         | Sequencing                                            |

## Stack

Next.js (App Router), React, TypeScript (strict), Tailwind CSS, Lucide React, Zod, and Supabase (Auth, PostgreSQL, RLS, SQL functions, Cron) through `@supabase/supabase-js` and `@supabase/ssr`. Tests use Vitest, Playwright and axe. PDF export is optional and not installed.

## Prerequisites

- Node.js 24 LTS and npm (see `.nvmrc`)
- Docker and the Supabase CLI are required only for the local Supabase stack (`npx supabase start`), which later phases need

## Getting started

```powershell
npm ci
copy .env.example .env.local   # optional; the foundation runs without it
npm run dev
```

Open <http://localhost:3000>. Use synthetic data only; never copy production registers, ballots or backups into development.

## Scripts

| Command                                   | Purpose                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | Development server                                                                                        |
| `npm run build` / `npm run start`         | Production build and server                                                                               |
| `npm run lint`                            | ESLint (Next.js core-web-vitals and TypeScript rules)                                                     |
| `npm run format` / `npm run format:check` | Prettier with the Tailwind class-order plugin                                                             |
| `npm run typecheck`                       | `tsc --noEmit` under strict settings                                                                      |
| `npm test`                                | Vitest unit tests in `tests/unit`                                                                         |
| `npm run test:integration`                | Real-PostgreSQL tests in `tests/integration` (needs `INTEGRATION_DATABASE_URL`, see `supabase/README.md`) |
| `npm run test:live`                       | Real hosted Supabase Auth/PostgREST tests in `tests/live` (needs a disposable project in `.env.local`)    |
| `npm run test:e2e`                        | Playwright and axe checks in `tests/e2e` (run `npx playwright install` first)                             |

Browser journeys that sign in for real (`tests/e2e/*-live.spec.ts`) run only with `LIVE_AUTH=1`. On managed Windows machines, system policy can close Microsoft Edge shortly after Playwright starts it ("DevTools remote debugging is disallowed by the system admin"); use Playwright's own Chromium (`npx playwright install chromium`) instead of `PLAYWRIGHT_CHROMIUM_CHANNEL=msedge`.

## Configuration

Server configuration is validated when the server starts (`src/instrumentation.ts` → `src/server/config/environment.ts`); production fails clearly on missing or unsafe values. See [.env.example](./.env.example) for placeholder-only variables.

- `NEXT_PUBLIC_*` values are visible in browsers and must never hold a secret.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and reserved for controlled Auth provisioning, never ballots, results or exports.
- `SUPABASE_ACCESS_TOKEN` and `MIGRATION_DATABASE_URL` are deployment-only and not read by the running application.
- SMTP, OTP settings and Cron are configured in Supabase/provider settings and reviewed migrations.

## Layout

```text
src/app            Routes, route groups ((access), (member)), admin, api handlers
src/components     ui (shared primitives), votes, admin
src/server         Server-only modules: config, auth, db, results, audit, ...
src/shared         Browser-safe contracts and validation
src/styles         Tailwind theme and design tokens (globals.css)
supabase           config.toml and migrations (reviewed, versioned SQL)
tests              unit, integration, e2e, fixtures
```

Real voting requires approval of PRD assumptions A1–A7, providers, region, retention and recovery objectives. Nothing in this foundation represents production readiness.
