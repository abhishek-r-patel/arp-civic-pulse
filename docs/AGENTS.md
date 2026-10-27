# Agent Instructions

## 01 Scope and Project Context
This file contains the detailed engineering guidance referenced by root `AGENTS.md`, which also defines the repository-wide documentation-sync rule. Keep detailed rules here rather than duplicating them in another customization file; verify root instruction loading when using a different tool.

Civic Pulse is a mobile-first, single-RWA voting application. PUBLIC polls show aggregate counts while active, allow a voter to replace their response before closure, and publish attributable responses after completion. PRIVATE elections keep aggregate choices private until completion and accepted ballots immutable. Integrity and privacy take priority over convenience.

The implemented stack is Next.js App Router, TypeScript, **Supabase Auth/PostgreSQL/RLS/SQL functions/Cron**, and **Tailwind CSS**. Application source, scripts and tests are present. Inspect the actual code and manifests; do not apply historical custom-auth/scaffold assumptions or perform unrelated wholesale rewrites.

Supabase PostgreSQL is authoritative. CSV is required; PDF is an optional printable export that may be deferred. PDFs are not backups, signatures or a source of truth.

## 02 Governing Documents
Read the relevant documents before implementing affected behavior:

| Document | Authority |
|----------|-----------|
| [PRD](./PRD.md) | Scope, behavior, provisional assumptions A1-A7 and acceptance criteria |
| [Design system](./DESIGN_SYSTEM.md) | Visual tokens, interactions, responsive layouts and accessibility |
| [Architecture](./ARCHITECTURE.md) | Target stack, application boundaries, privacy and operations |
| [Database](./DATABASE.md), [API](./API.md), [implementation plan](./IMPLEMENTATION_PLAN.md) | Supporting contracts and sequencing; verify alignment with the merged documents before use |

Follow each document within its domain. Architecture governs stack choices, not permission to override the PRD. Flag material contradictions and unresolved decisions; never silently choose a weaker guarantee. Do not copy old-stack authentication, styling or database-access rules from unreconciled documents.

Distinguish proposed, implemented, tested and approved behavior. Never fabricate production approvals or treat documentation as proof of working code.

## 03 Inspect and Change Carefully
- Read affected code, callers, tests, configuration and manifests before editing. Reuse existing components, contracts, helpers and services.
- Make the smallest complete change across relevant UI, services, database, exports and tests. Preserve unrelated behavior and user changes.
- Avoid speculative features, unnecessary files, broad cleanup and generic frameworks. Ask before changing product scope or architecture.
- Use strict TypeScript, explicit types/narrowing, shared Zod validation and existing naming/formatting conventions. Avoid `any`, unchecked casts and suppressed diagnostics.
- Keep services server-only and out of client imports. Pages call shared services directly rather than internal HTTP endpoints.
- Update directly affected documentation and contracts. Do not introduce new exact response shapes, rounding policies or pagination conventions solely through this file.

## 04 Non-Negotiable Voting Rules
- PUBLIC/PRIVATE are types; Draft/Scheduled/Active/Completed/Cancelled are separate statuses.
- Submission and lifecycle changes use guarded database functions, never ad-hoc writes.
- Derive identity from verified authentication. Recheck current suspension/role, frozen entitlement, state and choice ownership inside protected operations.
- Lock the vote first and use the current database clock after acquiring the lock. Reject admission at or after the current deadline (read under the lock); browser time and transaction-start time are not authoritative.
- Atomically record participation and either one current PUBLIC response or every PRIVATE office counter update. PUBLIC voters may replace that response only while ACTIVE; keep one participation record and count only the latest choice. Enforce uniqueness and whole-transaction rollback; browser click prevention is not duplicate protection.
- Freeze ballot, electorate and representative assignments on activation or scheduling confirmation. A SCHEDULED vote exposes only its summary to residents, rejects early submissions using database time, and can return to draft only before opening through the guarded, reasoned withdrawal routine. Register imports never overwrite existing records or enable accounts. The deadline may change only while ACTIVE, through the guarded, audited deadline-change routine with a required reason; never for a terminal vote. Register edits never transfer frozen entitlements or rewrite historical identities.
- Never reopen terminal votes, edit accepted PRIVATE ballots or manually alter totals. A PUBLIC response may be replaced only before its deadline; retain only the latest response, not a change history. Early completion/cancellation require confirmation and recorded reasons.
- PRIVATE storage uses aggregate counters, no individual ballots or identity/ballot/timestamp-to-choice mappings. Do not offer selection receipts or retrieval endpoints.
- While voting is active, PUBLIC polls expose aggregate option counts and turnout; PRIVATE elections expose aggregate turnout only. Never expose active choices in either type. During an active PRIVATE election, administrators and explicitly authorized `rwa-readonly` committee observers may see the household participation list for follow-up; ordinary members see only aggregate turnout. Hide candidate/NOTA totals until completion. Completed results/exports require authorization and invariant checks; cancelled votes publish neither choices nor exports.
- Use one authoritative result projection for screens and exports. Admin status does not confer voting entitlement.
- Never hard-code the word "household" or the identifier name in user-visible text: use the configured household terms (`loadHouseholdTerms()`/`PageContext.terms` on the server, `useHouseholdTerms()` in client components, a `terms` argument in exports). Code identifiers, routes, API fields, CSV column keys and audit codes keep their `household` names.
- RWA profile values (name, alias, address, email, phone, website, accent palette, welcome message) are editable only by administrators and are shown to residents on other pages through narrow projections, never by exposing the settings page. Show the current RWA name on screens and exports (the stored per-vote name snapshot is only an internal record). Public pages receive only name, alias, address and palette through the service-role-only routine; do not grant `anon` any routine. Branding failures must fall back to the product name and default palette.
- Show a live, informational deadline countdown on active voter and administrator vote pages, including after submission. Refresh state when it reaches zero, but never use the browser timer to decide whether a ballot is accepted; the database deadline remains authoritative.
- Explain application-level privacy and privileged-operator/small-election inference limits. Do not promise cryptographic anonymity.

## 05 Supabase and UI Boundaries
- Normal server database calls use the verified user's Supabase session. Isolate privileged Auth provisioning credentials; never use them to bypass voting/result permissions.
- Enable deny-by-default RLS on application tables and restrict grants. Assume callers can access Supabase directly; the Next.js boundary is not database authorization.
- Prefer invoker privileges where sufficient. Use `security definer` only when elevated access is required, with restricted ownership, fixed `search_path`, schema-qualified references, revoked public execution and explicit caller checks.
- Keep maintenance functions restricted to the scheduling role. Cron does not replace transactional deadlines or guarantee availability while a database is paused.
- Use Supabase Auth rather than adding custom OTP/session storage. Disable public sign-up; provision registered members through controlled workflows.
- Verify identity server-side with supported Auth methods, not an unverified session object. Existing JWTs must not bypass current application suspension/role checks.
- Keep `rwa-admin` and `rwa-readonly` mutually exclusive. Committee-read authorization must never satisfy mutation guards; only admins assign roles, and observers need a household assignment before enablement. Neither role broadens frozen voting entitlement.
- Preserve the design system through Tailwind token classes, not raw hex values or a competing palette. Keep 48px touch targets and at least 16px input text.
- Meet WCAG 2.2 AA with semantic controls, labels, keyboard/focus support and non-colour cues. Test member and admin journeys on phones.
- Keep unsent selections in page memory only, never URLs, browser storage, offline caches or persistent drafts.

## 06 Errors, Secrets and Data Safety
- Handle expected failures explicitly. Unexpected failures produce safe errors and privacy-safe operational reporting, never silent empty values or success-shaped fallbacks.
- Acknowledge ballots only after durable commit. After an uncertain response, check participation before offering retry; if unavailable, show an unknown outcome.
- Never fabricate or silently repair totals. Keep email/export failures independent from accepted ballots and render complete exports before returning success.
- Rate-limit code requests/verification and avoid email-account enumeration. Generic OTP acknowledgements do not guarantee delivery.
- Never log resident data, vote payloads, OTPs, tokens, cookies or selection-bearing RPC arguments. Disable trackers, replay and sensitive payload capture on voting/authentication workflows.
- Public Supabase URL and publishable/legacy anon keys may be browser-visible where needed; secret/service-role keys and SMTP credentials never may. Public keys do not replace RLS.
- Use approved secret storage, ignored local environment files and placeholder examples. Use synthetic test data; never copy production registers, ballots or backups into development.
- Protect CSVs against formula injection and treat report text as untrusted. PDF-specific checks apply only if PDF is implemented.
- Follow approved retention and automated encrypted backup/restore procedures. Never delete participation while voting is possible or resume after recovery when acknowledged votes may be missing.

## 07 Verification and Commands
Inspect the actual dependency manifest, lockfiles and tool configuration before running commands. Install/restore dependencies only when needed; do not upgrade unrelated packages. Use locked installs in CI.

The repository's `package.json` defines the following scripts. Inspect it for the current commands and use the exact environment and dependency requirements documented in README and the setup/deployment guides:

```text
npm run dev           # Development server; not a validation command
npm run lint
npm run typecheck
npm run test          # Vitest; add focused selectors where appropriate
npm run test:e2e      # Playwright; requires configured application/test services
npm run build
npm run format:check
```

Supabase commands are migration-target tooling, requiring the CLI and initialized local configuration; the local stack also requires Docker:

```text
npx supabase start
npx supabase migration new <name>
```

`npx supabase db reset` destroys/recreates local database data. Use only against an explicitly verified disposable local stack with authorization; never use remote/linked reset flags or production as routine validation.

- Add regression tests for changed behavior and run focused checks first, expanding according to risk.
- Use real local Supabase/PostgreSQL for RLS, grants, Auth context, routines, constraints, transactions and locking; mocks/SQLite are not substitutes.
- Test direct API/RPC access, suspension with existing JWTs, duplicate/concurrent submission, partial-update rollback, exact deadlines/lock waits, lifecycle races, frozen identities and lost acknowledgements.
- Verify privacy in HTML, APIs, ordinary stored records, logs and exports, not just hidden controls. Test candidate ties, NOTA-versus-candidate outcomes, zero turnout and result reconciliation.
- Use Playwright/axe plus required manual keyboard/screen-reader and real-device checks. Automated tests do not prove full accessibility.
- Verify performance and recovery against the architecture's exact thresholds before release. PDF acceptance applies only when included.
- Documentation-only work needs no application tests unless documentation tooling exists. Never claim checks passed if not run.

## 08 Authorization, Escalation and Handoff
- Follow approved integrity requirements without asking about every routine implementation. Ask before changing their meaning, weakening a guarantee or choosing an unresolved governance rule.
- Obtain authorization for destructive operations, production data changes, commits/pushes and history rewrites. Preserve existing user changes and never stage secrets, dumps or generated resident reports.
- Do not change submission/counting semantics during active voting without an approved maintenance plan. Use reviewed, versioned migrations; do not rewrite applied migrations or run them on every app startup.
- Never restore an old database merely to undo a deployment after votes have been accepted. Prefer schema-compatible application rollback or a reviewed forward fix.
- Handoff states what changed, actual verification commands/outcomes, checks not run and unresolved risks/approval blockers. Documentation or partial migration must not be described as production-ready.
- Lost/duplicate/partial/late ballots, incorrect tallies or unauthorized disclosure block release.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
