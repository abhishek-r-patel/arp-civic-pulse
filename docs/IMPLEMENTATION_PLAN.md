# Civic Pulse - implementation and migration plan

## 1. Basis, current state, and scope

**Status:** Proposed implementation sequence reconciled with the current source documents. Tasks below are not evidence of implemented behavior, passing tests, or RWA approval. This update changes planning documentation only.

### Governing references

- [PRD.md](./PRD.md): version 1 scope, assumptions A1-A7, FR1-FR8, metrics, and acceptance.
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md): visual identity, Tailwind tokens, accessible interactions, responsive layouts, and optional print output.
- [ARCHITECTURE.md](./ARCHITECTURE.md): target stack, migration boundaries, privacy, hosting feasibility, and operations.
- [DATABASE.md](./DATABASE.md): Auth-linked profiles, schema, RLS/grants, guarded RPCs, concurrency, retention, and recovery.
- [API.md](./API.md): exact endpoint/request/response contracts, errors, integrations, configuration, and resource controls.
- [AGENTS.md](./AGENTS.md): workspace-wide implementation and verification discipline.

### Observed starting point

The workspace now contains an existing Next.js/TypeScript foundation, not just documents. Its manifest includes React, Zod, `pg`, and PDFKit; existing UI uses CSS Modules and shared styles. Configuration validation, a unit test, and a foundation browser test exist. Feature directories and the old SQL migration location largely contain placeholders. No lockfile was found during this planning inspection.

Do not treat the scaffold's dependencies, directories, or tests as proof of implemented custom authentication, voting, database migrations, or verified behavior. Inspect actual callers before migration, retain reusable work, and replace only superseded responsibilities.

### Target and version 1 boundary

- One single-RWA, mobile-first Next.js App Router application using TypeScript, React, Tailwind CSS, Lucide React, Zod, Supabase Auth/PostgreSQL/RLS/guarded SQL functions/Cron, Vitest, Playwright, and axe.
- Normal server database calls carry the verified user's Supabase session. Separate privileged Auth administration from ordinary ballots, results, and exports.
- Supabase PostgreSQL is authoritative. CSV is mandatory; PDFKit-based PDF is an optional derived printable export, not a launch dependency, backup, signature, or legal certification.
- Prefer Vercel and the approved Supabase region, with Mumbai as the documented starting preference if available. Hosting eligibility, quotas, capacity, costs, and recovery require validation and approval.
- Preserve the zero-monthly-cost feasibility objective, excluding an optional domain, without weakening correctness, availability decisions, privacy, or recovery. Approve paid capacity if necessary.
- No bulk CSV register import, multiple RWAs, native apps, public signup, messaging/reminders, multilingual UI, signatures, payments/spending authorization, advanced election rules, AI, Redis, queues, separate backend, external PDF renderer, or application report storage.
- Approved encrypted off-site backup storage is an operational requirement, not speculative application file storage.

### Execution discipline

1. Treat each numbered task as a small implementation and verification unit; ship its migration, grants/policies, service/HTTP/UI wiring, and focused tests together where applicable.
2. Inspect existing modules/manifests before changing them. Migrate in reviewed stages; remove old dependencies only after their callers have migrated and validation passes.
3. Use `supabase\migrations` and supported Supabase migration history/tooling. Do not copy old custom-auth SQL unchanged or introduce a second migration ledger.
4. Use real local Supabase/PostgreSQL for Auth context, RLS, RPC, locking, and transaction evidence. Mocks/SQLite are not substitutes. Keep all development/test identities synthetic.
5. Use existing npm verification scripts: lint, format check, typecheck, Vitest, Playwright, and build. Add focused integration selectors/configuration only where missing. Never claim current scripts have passed without running them.
6. The local Supabase stack requires the CLI and Docker. Any reset needs authorization and an explicitly verified disposable local target; never reset a linked/production database as routine validation.
7. Use fixture-only policy approvals for isolated tests. Record actual approvals/authority separately before real voting.
8. Keep protected data private/no-store, unsent selections in page memory only, and sensitive capture disabled across application/infrastructure. Never acknowledge submissions before durable commit.
9. Update directly affected documentation with each implemented behavior. Paths below describe likely responsibilities; reuse existing names/layouts where appropriate.

## 2. Dependency and release sequence

Default execution order is Phases 1-16. Phase 17 is optional and can be deferred beyond version 1.

| Phase | Primary prerequisites | Exit milestone |
|---|---|---|
| 1 | None | Baseline/migration risks and decision owners identified |
| 2 | 1 | Repeatable target-tooling baseline |
| 3 | 2 | Shared contracts/configuration/HTTP protections |
| 4 | 2-3 | Supabase schema and independently enforced database permissions |
| 5 | 3-4 | Retry-safe controlled provisioning and genuine approval recording |
| 6 | 3-5 | Managed OTP/session integration and authorization |
| 7 | 2-3; 6 for access screens | Tailwind design system and accessible access journey |
| 8 | 4-7 | Individual account/household administration |
| 9 | 7-8 | Revision-safe setup and preview |
| 10 | 4-6, 9 | Frozen activation, lifecycle invariants, and restricted Cron completion |
| 11 | 4-6, 10 | Atomic, exactly-once guarded submission |
| 12 | 6-7, 9-11 | Complete resident journeys and uncertainty recovery |
| 13 | 8, 10-12 | Authoritative results and safe administrative monitoring |
| 14 | 3, 7, 13 | Mandatory complete CSV exports |
| 15 | 4-6, 10-11; 13-14 for recovery output checks | Retention, encrypted off-site backup, and tested recovery |
| 16 | 1-15 | Approved pilot readiness, then pilot evaluation and rollout decision |
| 17, optional | 7, 13-14 and explicit inclusion decision | Verified PDF enhancement only if selected |

UI primitives in Phase 7 may proceed once Phases 2-3 are complete, while backend work continues. Recovery/provider feasibility starts in Phase 1, even though its implementation is completed in Phase 15. Production activation remains gated throughout development.

## Phase 1 - Inspect the scaffold and confirm decisions

**Goal:** Establish the actual migration baseline and explicit owners for unresolved governance/operational choices.

**Tasks**
1. Inventory existing configuration, UI components/styles, dependencies, callers, SQL, tests, and scripts. Mark each responsibility retain/adapt/replace; distinguish placeholders from working implementations. Check whether any real identities/votes or active elections exist before planning cutover.
2. Review A1-A7 and record actual approval status, authority/date/version, owner, and blocker. Include all-abstain behavior, permission/reason for early completion, persistent-session policy, retention/recovery, and the revised limits of optional printable exports.
3. Confirm RWA name/timezone, approved household register, scripts used in names/labels, 500-household/about-100-concurrent-user capacity, and the pilot measurement checklist.
4. Validate initial Supabase/Vercel eligibility, region, custom SMTP peak capacity, free-tier pausing/session restrictions, and automated encrypted off-site backup options. Do not select services on monthly quotas alone.
5. Record technical configuration owners: Auth expiry/cooldown/limits, trusted IP forwarding, supplemental limiter budgets, request/list bounds, database wait bounds, export memory/concurrency, backup cadence/expiry, and RPO/RTO. Do not invent election-rule caps.

**Likely files/modules:** Existing manifest/configuration, UI/server/test modules, source documents, and directly related migration/operations documentation.

**Dependencies/prerequisites:** None. Provisionally use documented assumptions in isolated development; actual approvals are required before real voting.

**Database/API changes:** None. Identify any required legacy identity/history mapping; no destructive migration or new product endpoint.

**Tests required:** Baseline requirements/caller review; inspect available validation configuration and capture actual baseline outcomes when implementation begins. Map every release gate to an owner/evidence source.

**Completion criteria:** The migration inventory, data-preservation conditions, decision status, and operational feasibility risks are explicit. No approval, existing feature, free quota, or recovery guarantee is assumed.

## Phase 2 - Adapt tooling and establish the Supabase development baseline

**Goal:** Reuse the current foundation while making the target stack reproducible.

**Tasks**
1. Retain compatible Next.js/React/TypeScript/Zod/test configuration; check supported runtime/dependency versions and establish a consistent npm lockfile rather than recreating the application scaffold.
2. Add the documented Supabase SDK/SSR packages, Tailwind with supported PostCSS integration, and Lucide React when their configuration/migration tasks are implemented. Review licenses/advisories.
3. Initialize local Supabase configuration, migration location, disposable test environment, and synthetic mail capture. Document CLI/Docker prerequisites and environment isolation.
4. Preserve existing npm scripts and extend focused integration/browser setup as needed. Configure locked dependency restore and baseline CI; no startup migrations.
5. Keep `pg`, CSS Modules, and optional PDF tooling only while needed by existing callers or the selected feature. Schedule removal after replacement validation, not as an unrelated dependency sweep.

**Likely files/modules:** Root manifest/lockfile, PostCSS/framework/test/CI configuration, `supabase\config.toml`, `supabase\migrations`, placeholder environment example, development documentation.

**Dependencies/prerequisites:** Phase 1 inventory; CLI/Docker availability for local stack verification.

**Database/API changes:** Local Supabase initialization only; no production data cutover or product endpoints.

**Tests required:** Existing focused foundation/unit/browser tests, lint, formatting, strict types, production build, local Supabase/Auth connectivity, and reproducible dependency restore.

**Completion criteria:** The existing foundation remains usable; target dependencies/tooling and isolated real-service tests are repeatable. Missing tools/environment prerequisites are explicit blockers, not reasons to substitute mocks for database evidence.

## Phase 3 - Reconcile shared contracts, configuration, and HTTP protections

**Goal:** Provide one target-compatible validation/error/transport boundary before feature migration.

**Tasks**
1. Retain/adapt strict Zod contracts for identifiers, type/state, field bounds, normalization, offset-bearing times, revisions, and type-discriminated ballots. Reject unknown fields and match SQL checks.
2. Centralize decimal-string bigint handling and two-decimal half-up percentages, with `null` for zero denominators. Define candidate/option outcomes from API.md, not old assumptions.
3. Implement documented success/error envelopes, random support IDs, safe field errors, methods/media/body validation, endpoint/filter/parent-bound keyset cursors, and pagination bounds.
4. Adapt existing environment validation/tests to Supabase public URL/key, isolated server-only Auth administrative credential, rate-limit HMAC key, canonical origin, safe logs, and trusted proxies. Keep migration/CLI credentials deployment-only; manage SMTP/Auth/Cron in provider configuration.
5. Replace obsolete runtime raw-database, custom OTP, scheduler-secret, and direct email-send configuration only after confirming callers no longer depend on it. Validate mandatory operational thresholds without inventing unsupported Auth/session controls.
6. Establish exact Origin and session/pre-authentication-context CSRF checks, no-store behavior, HTTPS/security headers, and allowlisted logging with no payload capture.

**Likely files/modules:** `src\server\config\environment.ts`, `tests\unit\environment.test.ts`, `src\shared\contracts`, `src\shared\validation`, `src\server\observability`, HTTP/auth helpers, environment example.

**Dependencies/prerequisites:** Phase 2; approved operational values before release.

**Database/API changes:** Shared schemas only. Include `PROVISIONING_INCOMPLETE` and `EXPORT_FORMAT_UNAVAILABLE` mappings. No custom challenge/session schema or scheduler HTTP endpoint.

**Tests required:** Precision/rounding, zero denominator, unknown input/filter/cursor, timestamp ambiguity, normalization/boundary parity, malformed/oversized JSON, safe configuration failure, secret/client separation, Origin/CSRF, headers, and error redaction.

**Completion criteria:** Features share one explicit contract/configuration layer. Public Supabase configuration is not treated as a secret or authorization substitute; privileged credentials and sensitive input never reach clients/logs.

## Phase 4 - Supabase schema, RLS, grants, and guarded-operation foundation

**Goal:** Make the database safe even when callers bypass Next.js and call Supabase directly.

**Tasks**
1. Create reviewed immutable migrations under the supported Supabase migration workflow with deployment-only execution/advisory locking. Adapt any real existing SQL; preserve historical references if present.
2. Add Auth-linked `profiles`, households, settings, rate buckets, and audit records; add votes, ballot configuration, electorate, participation, OPEN responses, and CLOSED counters with documented constraints/indexes.
3. Enable RLS on every application table with default-deny grants/policies. Allow only required safe reads; never expose direct protected writes, choice-table reads, or private Realtime feeds, even to application admins.
4. Define non-recursive current-profile/capability/visibility helpers. Isolate deployment, restricted non-login function owners, authenticated users, privileged Auth provisioning, and Cron scheduling capabilities.
5. Establish guarded mutation entry points, parent-lock/freeze guards, and the invariant-verification basis. Use fixed trusted search paths, schema-qualified SQL, explicit `auth.uid()`/profile checks, and revoked default execution.
6. Keep Supabase-managed Auth schema untouched. Do not create parallel accounts/OTP/session tables, email indexes, a custom migration ledger, or custom session-digest RPC authority.

**Likely files/modules:** `supabase\migrations`, `src\server\db`, `tests\integration`, `tests\fixtures`; retire the old migration placeholder only when no workflow uses it.

**Dependencies/prerequisites:** Phases 2-3; actual Auth/JWT test contexts and supported Supabase/PostgreSQL environment.

**Database/API changes:** Documented schema, RLS, grants, helpers, and foundational guards. Feature RPCs are added with their owning phases; incomplete features remain inaccessible.

**Tests required:** Fresh install/upgrade, Auth/profile FK restrictions, uniqueness/composite ownership, check constraints/indexes, anonymous/member/admin direct REST/RPC behavior, suspended-profile reads, recursion/owner bypass, safe-column access, function grants/search paths, and private Realtime exclusion.

**Completion criteria:** No caller can bypass eligibility/privacy through direct Supabase access. Definer functions enforce caller checks independently of RLS; no individual CLOSED ballot storage exists.

## Phase 5 - Retry-safe provisioning, settings approvals, and audit

**Goal:** Establish controlled initial access and approval recording without claiming cross-service atomicity.

**Tasks**
1. Implement the audited deployment procedure for singleton RWA settings and the approved first Auth identity/admin profile. Require normal OTP sign-in; no public bootstrap/default credentials.
2. Build a retry-safe server-only provisioning coordinator: identify/create the approved Auth user, create/validate the profile/application assignment, and audit the database stage. Profiles default suspended until consistent.
3. Support an intentionally household-free administrator. Ordinary residents remain suspended until a valid household assignment and explicit enablement exist; an Auth identity alone grants no application access.
4. Add controlled audited operations for actual A1-A7 authority/date/versions/decisions and retention values. Changed decision/version invalidates approval; unset retention is unapproved, not unlimited.
5. Build allowlisted audit insertion inside application-database transactions and safe partial-failure reporting for separate Auth administration. Do not delete pre-existing identities or re-enable inconsistent profiles as blind rollback.

**Likely files/modules:** Controlled deployment scripts, `src\server\auth`, `src\server\register`, `src\server\audit`, guarded settings/profile RPCs, operational documentation.

**Dependencies/prerequisites:** Phases 3-4; authorized addresses and genuine decisions for real environments.

**Database/API changes:** Guarded setup/settings/audit operations and isolated supported Auth Admin calls. No settings/bootstrap HTTP endpoints; provisioning coordinator is reused by Phase 8.

**Tests required:** Retry after Auth-only/profile-stage failure, duplicate identity prevention, suspended-by-default access, no-profile JWT denial, admin-without-household setup, invalid/changed approvals, audit rollback, and safe `503 PROVISIONING_INCOMPLETE`.

**Completion criteria:** Partial provisioning is visible and recoverable without duplicate identities or false success. Database mutation/audit are atomic; Auth/database stages are explicitly not one transaction.

## Phase 6 - Supabase OTP, SSR sessions, and current-profile authorization

**Goal:** Replace old-stack authentication assumptions with managed Auth and independently enforced application access.

**Tasks**
1. Configure disabled public signup, six-digit `{{ .Token }}` email OTP, approved custom SMTP/sender, supported expiry/cooldown/request limits, and valid Auth URLs. Request login with `shouldCreateUser: false`.
2. Integrate `@supabase/ssr` cookie/refresh behavior and supported server identity verification. Do not authorize from an unverified cookie session object or user-editable role metadata.
3. Implement generic code issuance, email-plus-code verification, and sign-out route contracts. Return no application challenge ID, raw tokens, or invented idle/absolute session deadlines.
4. Gate all protected services and guarded SQL on current enabled profile/role and frozen entitlement. Existing JWTs must not bypass suspension, soft deletion, or role changes.
5. Implement only necessary supplemental shared rate buckets using a dedicated versioned HMAC key, independently committed abuse accounting, and tested trusted-client-IP forwarding. Preserve live windows on rotation.
6. Complete pre-auth/session-bound CSRF, validate actual cookie behavior, and document the selected plan-appropriate persistent-session policy. Do not promise universal HttpOnly cookies or Pro-only controls on Free.
7. Remove obsolete custom-auth code/dependencies only when no caller remains. Handle provider/verification/sign-out failure explicitly; never retry an ambiguous send blindly or report delivery from generic acknowledgement.

**Likely files/modules:** `src\server\auth`, `src\server\authorization`, `src\server\db`, `src\app\api\auth`, Supabase/provider configuration, auth/rate-limit tests.

**Dependencies/prerequisites:** Phases 3-5; custom SMTP/provider and A4 decisions for real login.

**Database/API changes:** Supplemental limiter operations only; Auth owns OTP/session state. `POST /api/auth/code` returns generic acknowledgement/cooldown; `/verify` accepts email plus six-digit string code and sets SDK cookies; `/sign-out` uses supported Auth behavior.

**Tests required:** No signup, generic registered/unknown/blocked responses, actual configured expiry/replay/resend/verification limits, SMTP failure, rate/IP forwarding, SSR refresh, sign-out failure, existing-JWT suspension/role denial, Origin/CSRF, actual cookies, and token/OTP redaction.

**Completion criteria:** Only consistently provisioned enabled profiles access the app. No parallel authentication store exists; session claims match actual SDK/plan capability and A4 approval.

## Phase 7 - Tailwind design system and accessible access screens

**Goal:** Migrate reusable UI to the current Civic Pulse design identity without introducing a second palette.

**Tasks**
1. Adapt existing global tokens/layout/components to the design system's slate/teal/indigo Tailwind theme in `src\styles\globals.css`. Use token classes, not component hex values or the superseded warm-neutral palette.
2. Configure self-hosted Inter via `next/font`, prescribed typography/layout spacing, Lucide icons, distinct type/status/participation badges, and approved privacy copy.
3. Migrate reusable buttons, fields/native radio cards, notices, feedback, tables, pagination, and shell/navigation. Replace CSS Modules incrementally and remove each only after migrated callers pass checks.
4. Add mobile-bottom-sheet/desktop-modal confirmations with focus containment/return, explicit cancel actions, safe-area/mobile-keyboard handling, loading/empty/error states, and reduced motion.
5. Implement registered-email access, one six-digit text input with paste/autocomplete/leading-zero support, cooldown/recovery, access denial, and sign-out using Phase 6.

**Likely files/modules:** Existing app layout/page and UI shell/status components, `src\styles`, `src\components\ui`, `src\app\(access)`, Tailwind/PostCSS configuration, foundation browser tests.

**Dependencies/prerequisites:** Phases 2-3 for primitives; Phase 6 for integrated access.

**Database/API changes:** None; use existing auth contracts and supported SSR integration, not custom token storage.

**Tests required:** 48-by-48-pixel targets with spacing, at least 16px input text, actual contrast, semantic icons/labels, focus/dialog behavior, OTP paste/autofill, axe plus manual keyboard/zoom, 200% text resizing, and reflow without page overflow at 320-430/1280-1440 CSS pixels and intermediate widths.

**Completion criteria:** The current design language and responsive behavior are implemented consistently; obsolete CSS callers are not stranded; automated accessibility checks are not presented as full WCAG proof.

## Phase 8 - Individual account and household administration

**Goal:** Build a validated register without adding bulk import or duplicating Auth identity state.

**Tasks**
1. Implement profile-first account pagination with `status`/`isAdmin` filters, then enrich only the authorized page through supported server-only Auth administration. Do not add an exact-email query filter/application email index.
2. Expose account create/patch through Phase 5's coordinator. Keep residents suspended pending valid household assignment and explicit enablement; recheck caller admin authority at each privileged stage.
3. Implement household list/create/detail/patch, normalized identifier uniqueness, one current household per representative, exact household/eligibility filters, and responsive individual add/edit workflows.
4. For identity/email change, block the profile first and keep it blocked until Auth and application associations are consistent. Apply supported Auth controls without promising immediate invalidation of every JWT.
5. Audit application mutations atomically, surface partial Auth failures, and explain that current register edits never transfer existing frozen entitlements or rewrite historical names.

**Likely files/modules:** `src\server\register`, `src\server\auth`, `src\server\audit`, account/household API handlers, `src\app\admin`, `src\components\admin`, migrations/tests.

**Dependencies/prerequisites:** Phases 4-7.

**Database/API changes:** Documented account GET/POST and account PATCH; household GET/POST and household detail GET/PATCH. HTTP account ID maps to Auth user/profile ID; `representativeAccountId` maps to the profile FK. No hard-delete/restore/import HTTP endpoint.

**Tests required:** Ambiguous/duplicate identities and household normalization, retry-safe partial provisioning, assignment before enablement, admin without household, stale admin capability between stages, existing-JWT suspension, audit atomicity, safe-page enrichment, pagination/filters, mobile forms, and historical-reference preservation.

**Completion criteria:** Administrators maintain entries individually with explicit safe failures. Managed email/verification state is not duplicated in application tables, and inconsistent identities stay blocked.

## Phase 9 - Revision-safe drafts and resident preview

**Goal:** Enable independently verifiable setup for both types without prematurely opening a vote.

**Tasks**
1. Implement admin vote list/create/detail and incomplete drafts with explicit OPEN/CLOSED type.
2. Implement revision-checked guarded draft edits, supplied-child ownership, replacement collections, positive unique positions, selected household sets, and atomic removal of incompatible children on type change.
3. Build CLOSED offices/candidates/instructions with built-in abstention and OPEN question/context/distinct options. Require unambiguous deadline input/display in the RWA timezone.
4. Add complete read-only resident preview with the approved type-specific notices, review context, readiness/blockers, and exact previewed revision.
5. Preserve valid admin draft inputs and provide stale-edit recovery; preview never increments revision or guarantees later activation.

**Likely files/modules:** `src\server\votes`, shared contracts/validation, admin vote/preview handlers/pages, `src\components\admin`, `src\components\votes`, Supabase migrations/tests.

**Dependencies/prerequisites:** Phases 7-8 and their server foundations.

**Database/API changes:** Guarded draft RPCs; admin vote GET/POST, detail GET/PATCH, and `POST /api/admin/votes/{id}/preview`. Every actual edit increments the parent revision.

**Tests required:** Stale/missing revision, child ownership, duplicate normalized labels/positions, collection replace versus omission, type changes, mixed shapes, incomplete blockers, timezone ambiguity, anonymous/non-admin direct RPC denial, mobile editor, and preview notice parity.

**Completion criteria:** Both types can be configured and previewed safely. Incomplete drafts cannot activate; a stale preview cannot silently authorize newer content.

## Phase 10 - Frozen activation, lifecycle invariants, and Supabase Cron

**Goal:** Establish race-safe legal transitions and completion gates before accepting submissions.

**Tasks**
1. Implement activation under the parent vote lock: current admin/revision, complete ballot, future deadline, selected eligible households/enabled profiles, current approvals, and retention settings.
2. Lock/re-read register/settings consistently, freeze identity/RWA/timezone/policy snapshots, initialize CLOSED counters, and commit lifecycle/audit atomically.
3. Complete deferred OPEN response/participation and CLOSED per-office tally/membership invariants; share the verifier with completion/publication.
4. Implement idempotent due completion and confirmed early completion/cancellation with required reasons. Reconcile due state first; effective automatic completion time is the frozen deadline.
5. Configure Supabase Cron SQL completion initially once per minute with a dedicated restricted scheduling role. Keep cleanup separately unavailable until Phase 15 is approved/implemented; completion must not depend on cleanup readiness.
6. Add narrowly scoped authorized service reconciliation and responsive action confirmations. Explain paused-database/Cron limitations and prohibit reopening, active edits, deadline extension, and manual totals.

**Likely files/modules:** `src\server\votes`, `src\server\audit`, `src\server\db`, admin lifecycle handlers/UI, `supabase\migrations`, Cron/provider configuration, integration tests.

**Dependencies/prerequisites:** Phases 4-6 and 9; genuine approvals/settings before real activation.

**Database/API changes:** Guarded activation/complete/cancel/reconciliation RPCs and documented lifecycle POST routes. Cron invokes restricted SQL directly; no maintenance HTTP endpoint, scheduler secret, or Vercel minute-level Cron.

**Tests required:** Register/activation snapshot races, approval/version failures, deadline recheck, frozen write denial, counter initialization, invariant failure, terminal transitions, overdue cancellation/early-completion denial, idempotent Cron, scheduling-role grants, direct user maintenance denial, and effective versus processing timestamps.

**Completion criteria:** Only legal transitions occur; frozen data/type remain unchanged; invalid counts cannot publish; delayed/paused Cron never weakens transactional deadlines or implies guaranteed availability.

## Phase 11 - Atomic guarded OPEN and CLOSED submissions

**Goal:** Prove exactly-one durable participation with aggregate-only CLOSED choice storage.

**Tasks**
1. Implement `cast_vote` using the verified user's session: require `auth.uid()`, lock vote then caller profile, recheck enabled status and frozen entitlement, and validate complete type-specific selections.
2. Perform the authoritative `clock_timestamp()` check after all admission locks immediately before acceptance. Admit only strictly before the cutoff; a request waiting past it fails, while an admitted transaction may commit afterwards.
3. Atomically insert participation plus one owned OPEN option response, or participation plus all CLOSED candidate/explicit-abstention increments with stable subordinate lock order.
4. Expose participation-only final acknowledgement and own-status lookup. Reject caller identity/timestamps/counts/idempotency payload IDs and any mixed/unknown ballot input.
5. Preserve committed overdue reconciliation on domain rejection without rolling it back through an exception; roll back actual database/invariant failures completely. Verify durable commit and actual provider durability settings.
6. Add bounded waits/rate budgets and explicit unknown-commit handling. Never retry an uncertain commit as if it were known rejected or use service-role access for submission.

**Likely files/modules:** `src\server\votes`, `src\server\authorization`, submission/participation API handlers, guarded SQL migrations, real Supabase integration tests.

**Dependencies/prerequisites:** Phases 4-6 and 10.

**Database/API changes:** `cast_vote`/own-participation RPCs; `POST /api/votes/{id}/submission`, `GET /api/votes/{id}/participation`. No selection retrieval, edit/withdrawal, receipt, or direct protected writes.

**Tests required:** Concurrent retries/multiple devices, unique participation, wrong/missing/repeated offices, foreign choices, explicit null abstention, suspended-existing-JWT/admin-without-entitlement denial, exact deadline, lock waits, admitted-before/committed-after cutoff, lifecycle races, mid-transaction fault injection, and committed submission with lost HTTP acknowledgement.

**Completion criteria:** All-office updates and participation commit together exactly once. No individual CLOSED records, correlatable choice timestamps/IDs, sensitive errors, audits, logs, or acknowledgements expose selections.

## Phase 12 - Member discovery, review, and uncertain-outcome recovery

**Goal:** Deliver complete resident journeys without optimistic acknowledgement or persisted unsent choices.

**Tasks**
1. Implement authorized member vote list/detail with frozen-electorate discovery, supported filtering/pagination, separate type/state/participation, and timezone-labelled deadlines.
2. Build native unselected radio choices, per-office abstention, full review/Back, final confirmation, and privacy notices before selection and submission.
3. Wire submitting, accepted, duplicate, denied, terminal, and expired-access states. Clear unsent choices after acknowledged acceptance, sign-out, or access revocation.
4. On transport/commit uncertainty, check participation before a deliberate retry. Unavailable status remains unknown; `submitted: false` is current committed state, not proof an earlier in-flight request cannot still commit.
5. Keep selections in page memory only; no URLs, browser/offline storage, telemetry, persistent ballot drafts, or later CLOSED retrieval. Disable selection/submission when access/state/deadline no longer permits it.

**Likely files/modules:** `src\app\(member)`, `src\components\votes`, `src\server\votes`, member list/detail API handlers, browser tests.

**Dependencies/prerequisites:** Phases 6-7 and 9-11.

**Database/API changes:** Authorized safe read/RPC projections; `GET /api/votes` and `GET /api/votes/{id}`. Reuse own participation/submission contracts; expose no active totals or other members' participation.

**Tests required:** Both full journeys, all-office review, no preselection, notice copy, repeated clicks, response/status-check failure, revocation mid-flow, inaccessible IDs, JSON/rendered-HTML privacy, memory-only selections, keyboard/axe, mobile and browser-engine coverage.

**Completion criteria:** Eligible representatives can review and submit knowingly once; uncertain outcomes are never fabricated; CLOSED acknowledgement shows participation only.

## Phase 13 - Authoritative results, safe monitoring, and audit history

**Goal:** Publish reconciled completed results with correct outcomes and restricted administrative oversight.

**Tasks**
1. Implement one completion-gated SQL RPC projection from a consistent database snapshot. Reuse it for screen/API/CSV and optional PDF; separate Supabase HTTP calls are not a shared transaction.
2. Verify invariants before completion/publication and block/alert on mismatch. Calculate frozen eligible/submitted counts, turnout, explicit denominators, shared rounding, and zero-denominator states.
3. Implement CLOSED LEADER/TIE/NO_WINNER with abstention separate from candidates and A5-approved all-abstain wording. Implement OPEN LEADER/TIE/NO_VOTES and leader option IDs without implying spending authority.
4. Add completed-only frozen OPEN named responses with keyset pagination and full-dataset totals. CLOSED results omit named responses, households, and participation lists.
5. Show effective completion context and early-completion label/reason consistently; show cancelled-invalid state without choices.
6. Implement paginated administrator participation and audit views. Monitoring omits selections, emails, and per-submission timestamps; audit uses safe allowlisted actor/action/target/reason fields.

**Likely files/modules:** `src\server\results`, `src\server\votes`, `src\server\audit`, results/admin monitoring/audit handlers and UI, migrations/tests.

**Dependencies/prerequisites:** Phases 8 and 10-12.

**Database/API changes:** Completed-result/monitoring/audit RPCs; documented results GET, administrator participation GET, and audit GET. No editable results table or active tally endpoint.

**Tests required:** Candidate and option ties, all-abstain approval/outcome, zero turnout, unopposed office, bigint/half-up boundaries, early-completion parity, snapshot consistency, frozen identities after edits, suspended access denial, pagination-independent totals, invariant-error blocking, direct choice-storage denial, and exact page/API agreement.

**Completion criteria:** Completed results reconcile exactly and obey publication permissions. Eligible denominators include later-suspended households; active/cancelled choices and CLOSED identities never publish.

## Phase 14 - Mandatory complete CSV export

**Goal:** Complete version 1 downloads independently of optional PDF work.

**Tasks**
1. Fetch the full authorized completed projection through Phase 13's consistent RPC, including all OPEN named responses regardless of UI page. Release database work before rendering.
2. Implement API.md's exact rectangular CSV schema/record types, including `completionMode`/`completionReason`, poll outcome in SUMMARY, instructions/disclaimers in NOTICE, counts, denominators, and generation time.
3. Apply UTF-8 escaping, consistent line endings, spreadsheet-formula protection, safe generated attachment filenames, MIME/nosniff/no-store headers, and complete bounded-memory rendering before success.
4. Enforce per-account request budgets and bounded render concurrency/memory. Exports are not stored, emailed, or distributed through bearer links.
5. Implement progress/retry without changing results or resubmitting. When PDF is deferred, hide its controls and return authorized `404 EXPORT_FORMAT_UNAVAILABLE` for unavailable formats.

**Likely files/modules:** `src\server\exports`, `src\server\results`, `src\app\api\votes\[id]\exports\[format]`, results download controls, CSV fixtures/tests.

**Dependencies/prerequisites:** Phases 3, 7, and 13.

**Database/API changes:** `GET /api/votes/{id}/exports/{format}` with required CSV support; reject pagination/identity-selection inputs. No report table/file persistence, unrelated download mutation, or mandatory PDF dependency.

**Tests required:** Exact header/row schema, screen/API/CSV counts and identities, 500-household full OPEN list, early completion and poll/candidate ties, blank CLOSED identity columns/no named rows, formula/header injection, authorization/terminal restrictions, renderer failure before success headers, unavailable PDF, resource limits, and phone/laptop download recovery.

**Completion criteria:** Complete CSVs match authoritative results exactly and expose only authorized fields. Failures never return truncated successful reports or modify voting data. Version 1 exports are complete without PDF.

## Phase 15 - Retention, encrypted off-site backups, and tested recovery

**Goal:** Finish safe maintenance and recovery required even on a free tier.

**Tasks**
1. Add restricted Cron cleanup using approved current settings, bounded repeatable batches, parent locks, coherent terminal-vote deletion, and atomic deletion audit. Keep earlier successful batches committed if a later one fails; report failures explicitly.
2. Expire audit/rate-bucket records independently without resetting live abuse windows. Remove inactive profiles only when retention/references permit; coordinate later Auth removal through supported administration with explicit partial-failure recovery.
3. Configure automated encrypted off-site backup scheduling/storage and expiry with isolated credentials and approved recovery objectives. On Free, validate external scheduled exports: database Cron and PDFs are not backups.
4. Back up required application data/schema, Auth identities, RLS/grants/functions, settings, migration history, and necessary external Auth/SMTP/Cron configuration through a supported tested process. Verify actual dump coverage and manage secret/key recovery separately.
5. Add safe availability/capacity/submission/invariant/Cron/email/export monitoring and the minimal health route. Health checks must not expose details or serve as a free-tier keep-alive workaround.
6. Rehearse isolated maintenance-only restore: validate Auth/profile mapping, policies/grants/invariants, accepted-data completeness, later suspension/deletion/revocation replay, supported Auth recovery, live-token restrictions, and elapsed deadlines.
7. Document incident responsibility and cancellation/replacement procedures. If acknowledged-data completeness is uncertain, remain in maintenance mode; never silently discard votes, extend deadlines, or reopen terminal votes.

**Likely files/modules:** Restricted SQL maintenance, `src\server\db`, `src\server\audit`, `src\server\observability`, `src\app\api\internal\health`, deployment/backup configuration and operational documentation/tests.

**Dependencies/prerequisites:** Phases 4-6 and 10-11; Phases 13-14 for restored result/export checks; approved retention/RPO/RTO, backup provider/scheduler/storage, access, expiry, and funding if needed.

**Database/API changes:** Scheduling-role-only cleanup/completion SQL; `GET /api/internal/health` returns minimal `ok`/`unavailable` plus request ID. No maintenance HTTP endpoint, caller time overrides, direct managed-Auth-table cleanup, or resident-facing backup service.

**Tests required:** Missing policy, active-vote protection, coherent deletion rollback, retained references/Auth removal partial failure, live bucket preservation, batch idempotence/failure, user maintenance denial, paused/delayed Cron, encrypted export/expiry/access, minimal health payloads, and full isolated restore/completeness reconciliation.

**Completion criteria:** Automated backups exist outside the live database, policy expiry is enforced, and a tested restore covers required Auth/configuration as well as voting records. A consistent but incomplete backup never authorizes election resumption.

## Phase 16 - Pilot readiness, evaluation, and controlled rollout

**Goal:** Prove mandatory gates before real voting, then evaluate the pilot without making its own measurements a prerequisite to starting it.

**Tasks**
1. Run accumulated acceptance/regression checks using locked dependency restore, lint/format, strict types, unit/integration tests, build, and focused Playwright Chromium/Firefox/WebKit suites. Check upgrades, RLS/RPC grants, legacy caller removal, and dependency advisories.
2. Verify authorization/privacy through Next.js and direct anonymous/member/admin Supabase REST/RPC/Realtime paths, existing JWTs, ordinary storage, rendered HTML, errors, audits/logs, CSV, and optional PDF only if included.
3. Validate WCAG 2.2 AA core journeys with axe plus manual keyboard/focus/screen reader/contrast/zoom/reduced-motion checks. Exercise mobile administration and resident journeys on real mobile Safari, Android Chrome, and supported laptop browsers, including Chrome/Edge/Firefox/Safari where supported.
4. Load-test 500 households/about 100 concurrent users with same-vote contention, Auth/login bursts, monitoring/results pages, and exports. Require p95 page/API under two seconds and acknowledgement within three seconds, excluding email/poor client connectivity. Tune measured query plans/indexes/RPC/capacity without weakening locks.
5. **Pilot-readiness gate:** Record genuine A1-A7/provider/region approvals, actual session policy, approved all-abstain/early-completion rules, retention/recovery settings, custom SMTP/Auth peak limits, hosting eligibility/cost, CSV correctness, mobile/accessibility evidence, backup restoration/completeness, incident runbooks, and safe deployment/migration evidence.
6. Deploy the reviewed Next.js build through staging/production on the approved hosting plan; apply deployment-only Supabase migrations and configuration outside active votes. Smoke-test with synthetic data before admitting real voters. Never use database restoration as application rollback.
7. **Pilot evaluation after readiness:** Run at least one real OPEN poll and one CLOSED election. Measure admin setup under ten minutes, first-attempt login at least 90% with non-attempts separate, unaided sign-in/first submission at least 90%, and median mobile ballot-open-to-acknowledgement under 60 seconds without collecting selections.
8. Report the at-least-60% turnout adoption target and zero-monthly-cost feasibility objective separately from correctness gates. Review pilot findings/capacity/fixes before wider rollout; no adoption or budget target excuses an integrity/privacy failure.

**Likely files/modules:** Existing CI/framework/test configuration, deployment configuration, test suites/fixtures, directly affected feature modules for verified fixes, acceptance/operations documentation.

**Dependencies/prerequisites:** Phases 1-15. Phase 17 is not required; if selected for the pilot, its checks also apply. Real approvals and readiness checks precede real-pilot measurements.

**Database/API changes:** No new product scope. Reviewed compatible fixes and deployment permissions only; preserve every acknowledged submission and historical identity during cutover.

**Tests required:** Full FR1-FR8 matrix, real Supabase authorization/concurrency/deadline evidence, exact output agreement, measured p95 thresholds, real-device/accessibility evidence, SMTP/hosting feasibility, backup restore/completeness, and schema-compatible rollback/staged cutover checks.

**Completion criteria:** Mandatory readiness evidence exists before real voting; pilot metrics are measured afterwards and guide rollout. Lost/duplicate/partial or late-admitted ballots, wrong tallies, unauthorized disclosure, or CLOSED identity-to-choice exposure block release. Unknown recovery completeness blocks resumption.

## Phase 17 - Optional PDF enhancement, outside the version 1 critical path

**Goal:** Add a printable derived outcome only when explicitly included, without delaying mandatory CSV or pilot readiness.

**Tasks**
1. Confirm PDF inclusion/timing and actual Node.js host runtime/memory feasibility. If deferred, leave controls absent; PDFKit's presence in the manifest does not make the feature mandatory.
2. Reuse Phase 13's full authorized snapshot and Phase 14's export protections. Generate locally with PDFKit in a Node.js route; no external renderer, public report storage, or bearer links.
3. Bundle licensed Inter and an explicitly configured approved-script fallback such as Noto Sans Devanagari. Validate actual shaping/rendering; never silently omit unsupported characters.
4. Implement A4 portrait/grayscale, long wrapped/continued rows, repeated headers, page numbers, complete maximum-electorate named lists, all required metadata/denominators/outcomes, and early-completion label/reason.
5. Render the complete bounded document before successful headers and expose the PDF control only after availability/acceptance checks. Preserve completed results and safe download retry on failure.

**Likely files/modules:** `src\server\exports`, export route/download controls, `public\fonts`, PDF fixtures/tests, hosting resource configuration.

**Dependencies/prerequisites:** Phases 7 and 13-14; explicit inclusion decision, licensed fonts, approved-script and execution-capacity validation. If PDF is added after rollout, repeat affected acceptance checks.

**Database/API changes:** Enable `pdf` on the existing export endpoint; no report entity, ballot change, database backup mechanism, or signature workflow.

**Tests required:** Exact screen/API/CSV/PDF agreement, full 500-household OPEN list, no CLOSED voter identities, actual long/multiscript shaping, multi-page continuation, A4/grayscale visual inspection, header/page numbering, unavailable/unauthorized requests, pre-header rendering failure, resource bounds, and physical-phone/laptop download/print checks.

**Completion criteria:** Enabled PDFs are complete, authorized, legible, and identical to authoritative completed data. They are clearly derived outcomes, not backups/signatures/certifications. If deferred, version 1 readiness is unaffected.

## 3. Acceptance and migration cross-check

| Governing requirement | Primary phases | Evidence needed |
|---|---|---|
| FR1: register and access | 4-8 | Six-digit managed OTP, disabled signup, retry-safe provisioning, current-profile/JWT checks, validated individual register |
| FR2-FR3: CLOSED/OPEN setup | 7, 9-10 | Type-specific validation, privacy preview, reviewed activation, both mobile admin flows |
| FR4: lifecycle and freeze | 9-11, 15 | Revision/freeze/snapshot tests, legal transitions, Cron effective times, confirmed reasons, no extensions/reopening |
| FR5: final atomic submission | 11-12 | Real RPC locks/rollback/uniqueness, exact admission cutoff, completion races, lost-ack recovery |
| FR6: results and counting | 10, 13 | Reconciled counters/responses, candidate/option ties, approved all-abstain behavior, denominators/rounding, frozen OPEN identities |
| FR7: administration and audit | 5, 8, 10, 13 | Safe monitoring without choices, database audit atomicity, explicit cross-service partial failures, historical preservation |
| FR8: exports | 14; 17 only if included | Complete CSV and optional PDF parity, full OPEN lists, no CLOSED identities, failure recovery, early-completion context |
| Supabase/Tailwind migration | 1-8, 16 | Reviewed caller conversion, Auth-linked profiles, default-deny RLS, direct API/RPC safety, target tokens, no obsolete runtime dependencies |
| Privacy and accessibility | 3-16; 17 if included | No ordinary identity-to-CLOSED-choice mapping, approved A2 limits, manual/device WCAG checks, 48px targets/16px inputs |
| Capacity, free-tier feasibility, and recovery | 1, 6, 15-16 | Exact p95 measurements, peak SMTP/Auth capacity, plan eligibility, approved costs, encrypted off-site backups, tested completeness |
| Pilot versus wider rollout | 16 | Readiness before real pilot; separate first-attempt/unaided/setup/voting-speed/adoption measurements and rollout review |

## Recommended first task

**Start with Phase 1, Task 1: inspect and record a retain/adapt/replace inventory of the existing scaffold against the Supabase/Tailwind target.** Identify actual callers of old configuration/styling/database dependencies and whether any real identities or votes need preservation. Then establish the missing lockfile/local-Supabase verification baseline before changing runtime behavior; pursue A1-A7/provider/recovery decisions in parallel, without bypassing real-voting approval gates.
