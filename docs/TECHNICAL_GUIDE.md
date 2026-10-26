# Civic Pulse: technical guide for junior developers

Audience: a developer joining this codebase. Describes the current implementation; recheck the manifests and release evidence as the application evolves.

This guide explains the implemented code, not just the intended architecture. Read the [PRD](./PRD.md), [design system](./DESIGN_SYSTEM.md), [architecture](./ARCHITECTURE.md), [database contract](./DATABASE.md) and [API contract](./API.md) for authoritative requirements. The application is **not approved for production launch**; see the [launch audit](./LAUNCH_AUDIT.md).

Companion: [illustrated end-user guide](./USER_GUIDE.md). Printable/offline version: [technical guide HTML](./TECHNICAL_GUIDE.html). Open the HTML in a browser and use Print / Save as PDF.

## 1. What the application does

Civic Pulse serves one Resident Welfare Association (RWA). Administrators register household representatives, create votes, preview them and explicitly activate them. Residents sign in with an emailed six-digit code and submit once for their frozen household entitlement.

- **OPEN poll:** one choice. Authorized completed results contain representative names, household identifiers and choices.
- **CLOSED election:** one candidate or explicit abstention for every office. Storage and results use aggregate counters, not retrievable individual ballots.
- **Lifecycle:** Draft, Active, Completed or Cancelled. Type and status are different concepts.
- **Results:** private to entitled members and administrators; CSV is required and PDF is implemented but can be disabled.
- **Operations:** audit history, bounded retention, encrypted backups/restore, health checks and maintenance mode.

![Application overview](./images/user-guide/overview.svg)

Application-level CLOSED privacy is not cryptographic anonymity. Privileged infrastructure operators, WAL/backups and very small electorates can allow inference. Never describe the system as secret from all operators.

## 2. Stack and boundaries

| Layer      | Implementation                                       | Why it matters                                                                                                                                        |
| ---------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime    | Node.js 24, npm, pinned lockfile                     | CI/hosting must use the supported Node major.                                                                                                         |
| Framework  | Next.js App Router 16, React 19, strict TypeScript   | Pages are usually server components; interactive forms use client components. Read the installed Next.js docs before applying old framework patterns. |
| UI         | Tailwind CSS, shared semantic tokens, Lucide icons   | Reuse components; do not introduce an alternate theme or UI framework.                                                                                |
| Validation | Zod request/response contracts                       | Types alone do not validate network input or database JSON.                                                                                           |
| Identity   | Supabase Auth email OTP and SSR cookie integration   | No custom password, OTP table or home-grown session store.                                                                                            |
| Database   | Supabase PostgreSQL 17, RLS, guarded functions, Cron | Database permissions remain effective when someone bypasses the web UI.                                                                               |
| Exports    | PDFKit/fontkit and CSV renderer                      | Generate private completed results on demand; no public stored reports.                                                                               |
| Tests      | Vitest, real PostgreSQL, Playwright, axe             | Different layers prove different things; mocks do not prove database permissions.                                                                     |

![Server and database trust boundaries](./images/user-guide/architecture.svg)

Key vocabulary:

| Term               | Meaning                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server component   | Runs on the server, can call server services directly, and must not send secrets to the browser.                                                 |
| Client component   | Uses browser state/events. Its checks help UX but are not authorization.                                                                         |
| RLS                | Row-level security: database policies restrict what a caller can read.                                                                           |
| RPC                | A database function called through Supabase; protected writes use these guarded routines.                                                        |
| `SECURITY DEFINER` | A function executes with its owner's privileges. It must independently validate the caller and pin a trusted search path.                        |
| Frozen electorate  | The households, representatives and historical names selected when a vote is activated. Later register edits do not transfer these entitlements. |
| Participation      | The fact that a frozen household submitted. For CLOSED votes this is not a record of its selections.                                             |
| Acknowledgement    | The application says the transaction committed; it does not expose a CLOSED selection receipt.                                                   |

## 3. First hour in the repository

1. Follow [LOCAL_SETUP.md](./LOCAL_SETUP.md) for the complete Windows setup and isolated Supabase test project. Never use production for development.
2. Inspect [package.json](../package.json), [.nvmrc](../.nvmrc), [.env.example](../.env.example), and [AGENTS.md](./AGENTS.md).
3. Put Node 24 on PATH. Use `npm ci` with the committed lockfile for a fresh checkout. The existing local guide also describes portable tools/corporate CA setup.
4. Supply your own ignored local environment configuration. Do not copy an actual developer's secrets or publish them in issues, screenshots or commits.
5. Start with `npm run dev`. Open the address reported by Next.js; ordinary local development uses port 3000.
6. Sign in with a deliberately provisioned test account. New installations require migrations, settings and a controlled first administrator; visiting the site does not create an admin.
7. Run `npm test`, `npm run typecheck` and `npm run lint`.
8. Trace one feature using section 5 before attempting changes.

Never disable certificate verification to solve corporate TLS problems. Configure the approved CA for the relevant tooling. Existing live-test helpers have a documented TLS-verification weakness; do not copy that pattern into new runtime/deployment code.

## 4. Folder and file map

| Path                                                | Responsibility                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [src/app](../src/app)                               | Pages, layouts, loading/error boundaries and HTTP route handlers. Route-group parentheses do not appear in URLs.        |
| [src/components/ui](../src/components/ui)           | Buttons, fields, notices, dialogs, tables, pagination, badges and common layout.                                        |
| [src/components/admin](../src/components/admin)     | Account/household forms, draft editing, preview and lifecycle interaction.                                              |
| [src/components/votes](../src/components/votes)     | Resident ballots, privacy notices and completed results.                                                                |
| [src/server](../src/server)                         | Server-only services. Do not import these into client components.                                                       |
| [src/shared](../src/shared)                         | Browser-safe contracts, validation, HTTP client and time formatting.                                                    |
| [src/styles/globals.css](../src/styles/globals.css) | Shared Tailwind design tokens and global styling.                                                                       |
| [src/proxy.ts](../src/proxy.ts)                     | Page-request CSRF context, pre-render session refresh and maintenance page handling. Not the final authorization layer. |
| [src/instrumentation.ts](../src/instrumentation.ts) | Validate server environment on Node startup.                                                                            |
| [next.config.ts](../next.config.ts)                 | Security/cache headers, PDF dependencies and bundled-font tracing.                                                      |
| [supabase/migrations](../supabase/migrations)       | Ordered, immutable schema/guard/RLS/function migrations.                                                                |
| [scripts/ops](../scripts/ops)                       | Encrypted backup/restore, status, recovery-record and cleanup commands.                                                 |
| [tests](../tests)                                   | Unit, integration, live-service, browser and capacity suites.                                                           |
| [.github](../.github)                               | Validation, CodeQL and Dependabot configuration.                                                                        |

Public launch additions are mapped in [Architecture](./ARCHITECTURE.md#public-discovery-and-contact-additions): server-rendered privacy/contact pages, a public metadata allowlist, robots/sitemap, an Open Graph image, escaped JSON-LD, breadcrumbs, opt-in public-only analytics and CSRF/rate-limited contact email. See [Deployment](./DEPLOYMENT.md#public-site-integrations) for provider settings and real delivery verification. Full document navigation between public information and authentication is intentional: an executed analytics script cannot be unloaded by simply removing a React component. Mocked delivery checks never prove inbox receipt.

The footer's **User Guide** link opens `/user-guide.html`, generated at
`public/user-guide.html` from the same Markdown and screenshots as the offline
edition. `npm run dev`/`npm run build` run the generator through lifecycle hooks.
The public edition disables repository-only links, contains no analytics/scripts,
uses a return-to-app anchor and defers screenshot loading. It is no-indexed and
not included in the sitemap. Do not publish the technical guide or serve arbitrary
repository files. A footer-only addition does not require screenshot recapture.

The selected F/**Open Conversation** favicon lives in
[src/app/icon.svg](../src/app/icon.svg). Next.js emits its metadata link for all
app pages. The web guide references the same asset; offline HTML does not depend
on an app server for its icon. The SVG preserves the selected teal conversation
bubble/check artwork at browser-tab sizes without a separate icon package.

Useful server entry points:

- [authorization/account.ts](../src/server/authorization/account.ts): verified identity, enabled profile and current role.
- [db/clients.ts](../src/server/db/clients.ts): separate user-session and privileged clients.
- [register/page-context.ts](../src/server/register/page-context.ts): page guards plus services' dependencies and CSRF token.
- [http/route.ts](../src/server/http/route.ts): consistent methods, support IDs, maintenance and safe errors.
- [http/request.ts](../src/server/http/request.ts): request-body, parameter and query parsing.
- [auth/dependencies.ts](../src/server/auth/dependencies.ts): Origin/CSRF guard and Auth dependencies.
- [auth/otp.ts](../src/server/auth/otp.ts): request code, verify and sign out.
- [votes/submission.ts](../src/server/votes/submission.ts): submission and participation status.
- [votes/member.ts](../src/server/votes/member.ts): entitled discovery/detail/results.
- [votes/lifecycle.ts](../src/server/votes/lifecycle.ts): activation/completion/cancellation and overdue reconciliation.
- [exports/results-export.ts](../src/server/exports/results-export.ts): complete private CSV/PDF response.
- [observability/logger.ts](../src/server/observability/logger.ts): allowlisted logs.

## 5. Trace a real feature: submit a ballot

Read these files in order:

1. [Vote page](../src/app/votes/[id]/page.tsx) obtains a guarded page context and authorized vote detail.
2. [BallotForm](../src/components/votes/ballot-form.tsx) renders choices and keeps unsent selections in component/page memory.
3. [Browser API helper](../src/shared/http/api-client.ts) sends a same-origin JSON request with a CSRF token and validates the response envelope.
4. [Submission route](../src/app/api/votes/[id]/submission/route.ts) checks Origin/CSRF, validates the ID/body and obtains an enabled member context.
5. [Submission service](../src/server/votes/submission.ts) enforces a profile budget and calls `cast_vote` using the member's own client.
6. [cast_vote migration](../supabase/migrations/20261024140000_cast_vote.sql) locks/rechecks/validates/writes atomically.
7. After commit the response is participation-only: `voteId` and `submitted: true`, wrapped in the common envelope.
8. A lost, malformed or unavailable acknowledgement triggers an own-participation check. The client must not blindly repeat a submission.

```text
Browser POST /api/votes/{id}/submission
  -> exact Origin + CSRF
  -> verified Auth identity + current enabled profile
  -> Zod/body/UUID validation and shared rate limit
  -> user-session RPC cast_vote
       -> lock vote, recheck entitlement/status/deadline
       -> insert unique participation
       -> OPEN: insert response
          CLOSED: increment one counter per office
       -> whole transaction commits, or all changes roll back
  -> safe acknowledgement (no CLOSED selections)
```

![Submission and recovery branches](./images/user-guide/submission.svg)

The definitive deadline check uses the **database clock after locking**, not the browser clock, request arrival time or transaction-start time. A request waiting for a lock until the deadline is rejected. A transaction admitted before the deadline can commit afterward.

## 6. Authentication, sessions and authorization

### Sign-in flow

1. A controlled administrator provisions the email identity/profile. Public signup is disabled.
2. The code-request route normalizes/validates the email and returns generic guidance. It must not reveal whether an address is registered.
3. Supabase handles six-digit, expiring, single-use email codes. Production requires custom SMTP; test helpers can obtain codes through supported Auth administration without email.
4. Verification requires both a valid Auth session and a current enabled application profile.
5. The server-side SDK writes session cookies. [Shared cookie hardening](../src/server/auth/session-cookies.ts) applies HttpOnly, Secure in production, SameSite=Lax and a provisional 14-day sliding browser lifetime.
6. [Proxy session refresh](../src/server/auth/proxy-session.ts) refreshes before Server Component rendering and forwards new cookies to both browser and request. Server Components cannot themselves write cookies.
7. Protected APIs use `getUser` and current profile checks. Role comes from the database profile, not user-editable JWT metadata.
8. Sign out uses supported Auth behavior. Current application suspension/role checks remain essential because issued tokens are not universally revoked instantly.

CSRF context is a separate HttpOnly cookie; production uses a host-only Secure cookie and SameSite=Strict. The page exposes a derived token, not that secret context. Do not confuse CSRF and session cookies.

| Capability                      | Signed out | Enabled resident            | Enabled administrator            |
| ------------------------------- | ---------- | --------------------------- | -------------------------------- |
| Sign-in page/code flow          | Yes        | Yes                         | Yes                              |
| Member ballot                   | No         | Own frozen entitlement only | Only own frozen entitlement      |
| Completed results/export        | No         | Entitled votes only         | Authorized administrative access |
| Register/drafts/lifecycle/audit | No         | No                          | Yes                              |
| Active choice totals            | No         | No                          | No                               |
| Individual CLOSED selections    | No         | No                          | No                               |

Suspended/deleted/unprovisioned identities do not gain access merely by holding a valid token. Admin pages use a plain not-found for non-admins; APIs use the appropriate safe status. Inaccessible vote IDs are indistinguishable from nonexistent ones.

## 7. Database model and invariants

| Entity                   | Relationship and purpose                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `auth.users`             | Managed Supabase identity; email/verification/session state is not duplicated in application profiles. |
| `profiles`               | Stable Auth user ID, representative name, enabled/suspended/deleted status and admin flag.             |
| `households`             | Unique normalized label and one current representative; controls future eligibility selection.         |
| `rwa_settings`           | Singleton RWA name/timezone, actual A1-A7 approvals and approved retention periods.                    |
| `votes`                  | Type, status, revision, deadline, terminal reasons and frozen display metadata.                        |
| `offices` / `candidates` | CLOSED ballot structure with parent ownership and ordered positions.                                   |
| `poll_options`           | OPEN ballot choices.                                                                                   |
| `electorate`             | One frozen entitlement per vote/household, frozen representative and historical labels.                |
| `participation`          | One accepted submission per entitlement. No CLOSED choices.                                            |
| `open_responses`         | Attributable option response. Published only through authorized completed results.                     |
| `closed_tallies`         | Candidate/abstention counters per office. No per-voter CLOSED record.                                  |
| `audit_events`           | Administrative actor/action/record/time/reason, not payloads or OTPs.                                  |
| `rate_limit_buckets`     | Shared atomic limiter state with HMAC-derived subjects rather than raw emails.                         |

```text
auth.users -- profiles -- households
                  \          \
                   \       electorate -- votes -- offices -- candidates
                    \          |            \-- poll_options
                     historical representative
                               |
                         participation
                         /           \
                OPEN response    CLOSED aggregate counters*

* Diagram shows the atomic workflow, NOT a stored per-person link
  from participation to a particular CLOSED choice.
```

Critical constraints:

- Unique participation and whole-transaction rollback prevent duplicate/partial ballots.
- Frozen content, representatives and deadlines cannot be edited after activation.
- Candidate IDs must belong to the submitted office/vote.
- For each completed CLOSED office, candidates plus abstentions equal submitted ballots.
- OPEN response counts equal accepted participation. Invariant failure withholds results rather than fabricating a fix.
- Terminal votes cannot reopen. Accepted submissions cannot be edited, deleted manually or withdrawn.
- Counts/audit bigints use decimal strings across API boundaries to avoid unsafe JavaScript coercion.
- Current suspension blocks access without erasing accepted participation or changing the frozen turnout denominator.

### Permissions

All application tables have RLS and restricted grants. Ordinary users/admins cannot directly read choice tables or write application tables. Guarded functions independently check identity and capability. Restricted non-login owners have fixed search paths; private data is not published to Realtime.

The privileged client bypasses RLS: use it only in the established provisioning/Auth administration, limiter and narrowly scoped reconciliation paths. Do not use it for ordinary ballot/result access.

### Migration map

| Migration suffix                     | Responsibility                                                       |
| ------------------------------------ | -------------------------------------------------------------------- |
| `100000_core_schema`                 | Owners, tables, keys, constraints and indexes.                       |
| `100100_guards_and_helpers`          | Identity/visibility, lifecycle guards and invariants.                |
| `100200_rls_and_grants`              | Policies, safe column access and restricted execution.               |
| `100300_audit_settings_provisioning` | Audit, deployment settings/admin bootstrap and profile provisioning. |
| `100400_rate_limiting`               | Atomic supplemental application limiter.                             |
| `110000_register_administration`     | Household/account routines and last-admin guard.                     |
| `120000_vote_drafts`                 | Draft revision/ballot/electorate/preview routines.                   |
| `130000_activation_lifecycle`        | Freeze, lifecycle and restricted due-completion scheduling.          |
| `130100_deferred_trigger_definer`    | Consistent deferred-trigger execution semantics.                     |
| `140000_cast_vote`                   | Atomic submission and participation-status routine.                  |
| `150000_member_votes_results`        | Authorized discovery, results, participation and audit projections.  |
| `160000_retention_maintenance`       | Bounded retention, readiness/status and maintenance scheduling.      |

All files start with `20261024`; use the exact filenames in [migrations](../supabase/migrations). Do not rewrite an applied migration. New changes require a new versioned migration and fresh/upgrade tests. Never run migrations at application startup or use a reset on an existing real database.

## 8. Lifecycle and register workflows

![Immutable lifecycle](./images/user-guide/lifecycle.svg)

Drafts can be incomplete. Every edit increments `draftRevision`; an update includes the expected revision. A stale edit receives a conflict rather than overwriting someone else's work. Preview identifies its version, and activation must confirm that same version.

Activation checks ballot validity, current selected representatives, future deadline, approvals and retention configuration. It freezes the electorate, historical identity/display data and ballot. Editing a household later affects future votes only.

Supabase Cron completes due votes and runs bounded retention. The scheduling role has narrow function grants. Scheduled completion records the deadline as effective completion time even if processing is late. Authorized reads may reconcile an overdue vote, but the transactional deadline remains authoritative.

Register changes span Auth and application records; they are not one distributed transaction:

- Create a profile suspended; ordinary residents need a household before enabling.
- Email changes preflight identity ownership, block access and verify Auth consistency before restoring prior access.
- Provider failures surface partial-workflow errors. Do not silently enable an inconsistent account.
- Repeated suspension/deletion status can retry an incomplete Auth ban. A deleted profile is not restored or edited.
- At least one enabled administrator must remain.

![Safe register onboarding](./images/user-guide/register.svg)

## 9. Pages and HTTP entry points

| URL                                  | Main use                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `/sign-in`                           | Registered email, code verification, resend and recovery.                                 |
| `/`                                  | Member's entitled votes, filters and own participation. Admins also see management links. |
| `/votes/{id}`                        | Authorized ballot, submitted state or terminal context.                                   |
| `/votes/{id}/results`                | Completed totals, authorized named OPEN responses and downloads.                          |
| `/admin/accounts`, `/new`, `/{id}`   | Account list, provisioning, details, role/access changes.                                 |
| `/admin/households`, `/new`, `/{id}` | Register, assignment, label and future eligibility.                                       |
| `/admin/votes`, `/new`, `/{id}`      | Draft creation/editing or frozen lifecycle detail.                                        |
| `/admin/votes/{id}/preview`          | Version-bound preview/readiness and activation.                                           |
| `/admin/votes/{id}/participation`    | Participation monitor with no choices.                                                    |
| `/admin/audit`                       | Administrative history.                                                                   |

HTTP groups mirror the same services:

- `/api/auth/code`, `/verify`, `/sign-out`.
- `/api/votes`, `/api/votes/{id}`, `/{id}/participation`, `/{id}/submission`, `/{id}/results`, `/{id}/exports/{format}`.
- `/api/admin/accounts` and `/api/admin/households`, plus record IDs.
- `/api/admin/votes`, record IDs, `/preview`, `/activate`, `/complete`, `/cancel`, `/participation`.
- `/api/admin/audit`.
- `/api/internal/health`.

Read [API.md](./API.md) for exact methods and schemas. Pages call services directly; do not have a Server Component HTTP-fetch the application's own API.

### Errors and pagination

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Check the fields.",
    "fieldErrors": []
  },
  "requestId": "random-support-identifier"
}
```

Success envelopes use `data`, errors use `error`; paginated responses include `page`. HTTP `204` has no JSON body. Error bodies never contain provider internals, tokens or submitted choices.

| Status | Typical meaning                                                                          |
| ------ | ---------------------------------------------------------------------------------------- |
| 401    | No verified session.                                                                     |
| 403    | Denied capability, blocked account or failed browser mutation protection.                |
| 404    | Missing/inaccessible object or unsupported authorized format.                            |
| 409    | Duplicate, stale revision, lifecycle conflict or vote no longer open.                    |
| 422    | Invalid fields, IDs or filters.                                                          |
| 429    | Budget exceeded; follow retry guidance.                                                  |
| 503    | Dependency/export/partial provisioning unavailable; do not assume a ballot was rejected. |

The browser helper converts malformed envelopes to `INVALID_RESPONSE` rather than throwing through a form. Endpoint success payloads still need their own contracts; the generic helper does not deeply validate every `data` shape.

Lists use bounded keyset cursors tied to endpoint/filters. Never invent offsets, assume the first page contains all records, or accept cursor content as authorization.

## 10. Results, exports and UI conventions

The database result projection is validated and transformed in [shared result contracts](../src/shared/contracts/results.ts). Screen, CSV and PDF derive from it, not separate counting implementations.

- Frozen eligible households are the turnout denominator.
- Per-office percentages use submitted ballots; zero denominators are not applicable.
- Zero ballots have no winner. Positive tied leaders remain ties. Abstention is not a candidate.
- All-abstain and early-completion semantics require real A5 approval.
- OPEN names/households are frozen snapshots, with no email in exports.
- CLOSED exports contain aggregate data only.
- Rendering completes before success headers. A render error returns a clean failure, not a partially successful document.
- Current process-local render slots: eight CSV, two PDF, bounded wait. These are not a global cross-instance queue.
- PDF fonts are bundled and traced for deployment; unsupported text is explicitly refused, with CSV guidance.

Use [UI primitives](../src/components/ui) for status, validation, focus, dialogs and accessible fields. Preserve 48px touch targets, 16px input text, semantic tokens, visible focus and native radios. A button's disabled state is not authorization.

Current export controls are ordinary download links: generation progress, in-progress deduplication and inline recoverable errors remain an acknowledged UX gap. Do not document those missing behaviors as implemented.

## 11. Environment, deployment and operations

Read [environment validation](../src/server/config/environment.ts), [.env.example](../.env.example) and the [deployment guide](./DEPLOYMENT.md).

| Configuration                                                               | Location                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Canonical origin, public Supabase URL/key, server Auth credential, HMAC key | Hosting environment/secret manager; isolated per environment. |
| SMTP credentials, code template/expiry/limits, Auth URLs                    | Supabase/provider configuration.                              |
| Contact-only Resend key, sender and recipient | Server-only hosting settings: `RESEND_API_KEY`, `CONTACT_EMAIL_FROM`, `CONTACT_EMAIL_TO`; all required together when enabled. |
| Optional public analytics and Google verification | `GOOGLE_ANALYTICS_ID`, `GOOGLE_SITE_VERIFICATION`; public identifiers configured at build/runtime. GA4 requires consent and disabled Enhanced Measurement. |
| RWA timezone, policy approvals, retention                                   | Controlled database settings/procedures.                      |
| Migration credentials                                                       | Deployment runner only, not ordinary app runtime.             |
| Backup database URL/encryption key/destination                              | Approved isolated operations runner and secret store.         |

`npm run deploy:check` validates injected production configuration without loading local environment files. It does not prove provider identity, key correctness, SMTP, approval or IP limiting. `next build`/startup independently validate relevant configuration. Public build values and CSP settings require rebuilding for the target environment.

Security headers, exact Origin/CSRF, private/no-store responses and Secure production cookies are already configured. Avoid wildcard credential CORS. `TRUSTED_PROXY_CONFIG` is reserved: the missing trusted-IP enforcement remains a release blocker.

`MAINTENANCE_MODE=1` returns 503 on pages/data APIs and unavailable health. Health aborts its database HTTP probe at three seconds and clears its timeout; it is readiness, not proof of SMTP/backups or an invitation to keep a free project awake.

Operational commands are in [OPERATIONS.md](./OPERATIONS.md). Backup sets encrypt application/Auth/counts data with AES-GCM and validate manifest filenames/hashes. Keep encryption keys separately. A consistent restore can still omit acknowledged votes: completeness needs independent evidence. Never restore an old database simply to undo a code deployment.

Logs accept only bounded allowlisted metadata. Do not add request bodies, raw provider errors, emails, cookies, codes, SQL bind values or CLOSED selections. Provider/APM payload capture must also be disabled in the actual deployment.

## 12. Tests: what to run and what they prove

| Command                                 | Proves / prerequisites                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                              | Unit contracts, services, response handling and ops guards. Does not prove real RLS.                                                                         |
| `npm run typecheck`                     | Strict TypeScript. Not runtime validation.                                                                                                                   |
| `npm run lint` / `npm run format:check` | Static quality and repository formatting.                                                                                                                    |
| `npm run test:integration`              | Real PostgreSQL 17 migrations, RLS/grants, guards, races, deadlines, retention and restore. Requires a disposable server; suites create/drop test databases. |
| `npm run test:live`                     | Real Auth/Data API behavior against the disposable configured Supabase project. Creates synthetic records.                                                   |
| `npm run test:e2e`                      | Playwright browser journeys/axe. Live specs need `LIVE_AUTH=1` and isolated test credentials.                                                                |
| `npm run test:load`                     | 500-household/100-task local database contention and rendering bounds. Not production HTTP/email capacity.                                                   |
| `npm run build`                         | Production compilation with valid configuration. Not deployment or launch approval.                                                                          |
| `npm audit`                             | Currently disclosed dependency advisories, not absence of all vulnerabilities.                                                                               |

The validation workflow uses a disposable PostgreSQL 17 service, synthetic build values and signed-out browser tests without production secrets. Restore/hosted workflows remain separate. CodeQL advanced workflow and Dependabot are configured; do not enable a competing CodeQL default setup at the same time.

Before these guides, the current baseline was 355 unit tests and 225 integration tests, with selected live browser/capacity evidence. Counts change over time: report your own actual results rather than quoting this number as certification.

The 26 October 2026 launch-change run recorded 374 passing unit tests and 21
configured Chromium foundation/public checks. The database-health case returned
503 and was excluded from that final browser run; live authenticated checks were
not rerun. Provider traffic was synthetic/intercepted, not real delivery or Google
verification. See the [dated audit](./LAUNCH_AUDIT.md#public-site-checklist-26-october-2026)
instead of treating earlier counts as a current certification. Future changes
must follow the documentation-sync checklist in [root instructions](../AGENTS.md#keep-documentation-in-sync).

### Rebuild these illustrated documents

The [capture spec](../scripts/docs/capture.spec.ts) is outside the ordinary e2e directory and is explicitly opt-in:

```powershell
$env:LIVE_AUTH = "1"
$env:DOC_SCREENSHOTS = "1"
npx playwright test -c playwright.docs.config.ts
node scripts\docs\render.mjs
```

Use only the approved disposable fixture project. Capturing creates synthetic Auth users, profiles, households, votes, participation and fixture policy/retention data; never run it against production. It reuses existing fixture helpers. Email/code fields are masked, trace/video are off, and screenshots are stored in the documentation image folder. The code-error response and connection failures are deliberately simulated; the rest of the principal voting/administration flows use the real test application and database. The capture does not prove SMTP delivery.

The renderer supports the deliberately small Markdown subset used by these two guides and embeds local images in the printable HTML. It fails on missing local linked files/images. Regenerate both HTML files whenever changing Markdown or screenshots. Do not hand-edit the generated HTML.

## 13. A safe workflow for your first code change

1. Identify the exact requirement and relevant page/API/service/SQL contract.
2. Read nearby tests and reuse established components/helpers before adding new logic.
3. Write a focused regression or acceptance test. Reproduce the old failure when possible.
4. Change shared validation first when input/output shapes change; update related server/database/UI surfaces together.
5. Add a new migration if persistence/permissions need changing. Test fresh schema and upgrade/data preservation, not just an empty mock.
6. Preserve privacy and atomicity. Never fix a display problem by altering counters manually or weakening an RLS policy.
7. Exercise loading/empty/success/error paths and the relevant viewport/keyboard flow.
8. Run focused tests, types and lint, then expand to the affected integration/browser/build checks.
9. Update directly related documentation. Report actual evidence and remaining limits.
10. Have a reviewer inspect permissions, historical data compatibility, rollback and production risk.

Example: adding a required draft field involves its shared Zod schema, editor, draft service/RPC, database constraints and preview/activation readiness, result/export snapshot if historically relevant, tests and contract docs. Changing only a text input is incomplete.

## 14. Debugging without leaking data

| Symptom                      | Start here                                                                | Do not do this                                                   |
| ---------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Signed out unexpectedly      | Proxy refresh, cookie attributes, Auth outcome and current profile.       | Print session cookies/tokens into console or chat.               |
| Resident cannot see a vote   | Frozen electorate, current enabled status, correct project and lifecycle. | Use service-role reads to bypass the restriction.                |
| Draft conflict               | Revision in editor/preview and another admin's edit.                      | Retry an overwrite with an invented latest revision.             |
| Submission appears uncertain | Own participation check and support ID.                                   | Blindly resubmit or reconstruct CLOSED selections from counters. |
| Results unavailable          | Completion gate and invariants; operations escalation.                    | Repair totals by hand or publish a best-effort approximation.    |
| Export fails                 | Authorization, completion, capacity, supported fonts and safe error code. | Return truncated bytes with HTTP 200.                            |
| DB tests skipped             | Confirm disposable `INTEGRATION_DATABASE_URL` is configured.              | Claim skipped tests passed.                                      |
| Build accepts placeholders   | Preflight checks shape, not actual provider connectivity.                 | Treat a successful synthetic build as a live deployment.         |

## 15. Known limitations and next reading

Read the [launch audit](./LAUNCH_AUDIT.md) before any release. The unresolved items include trusted-IP abuse protection, real SMTP/capacity, provider/region approvals, credential hygiene, production deployment verification, real off-site recovery, real-device/manual accessibility acceptance, the export UX gap, remote test-helper TLS verification and stale local HTTP-load instructions.

The existing instructions that imply the repository is documentation-only are stale; actual code/manifests are present. Do not infer working behavior from either old prose or this guide without running the relevant checks.

Suggested reading order after this guide: [user guide](./USER_GUIDE.md), [API](./API.md), [database](./DATABASE.md), [operations](./OPERATIONS.md), [deployment](./DEPLOYMENT.md), [launch audit](./LAUNCH_AUDIT.md).
