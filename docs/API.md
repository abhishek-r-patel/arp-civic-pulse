# API: Civic Pulse

## 1. Scope and authority

[PRD.md](./PRD.md), [ARCHITECTURE.md](./ARCHITECTURE.md), and [DATABASE.md](./DATABASE.md) govern this contract. This document defines the required HTTP boundaries and integrations for the single-RWA MVP; it does not add product capabilities.

**Status:** Implementation contract, not evidence of an implemented or tested API. PRD assumptions A1-A7 remain provisional until approved. Production activation requires current approvals, approved retention settings, provider/region approval, and the release evidence required by the governing documents.

- Use same-origin Next.js route handlers under `/api`, server-only application services, Supabase Auth, Supabase PostgreSQL with RLS and guarded SQL RPCs, and approved custom SMTP.
- Supabase PostgreSQL is authoritative. CSV export is required for version 1; PDF is an optional derived printable outcome and may be deferred without blocking pilot readiness. Neither export is a backup or signature-replacement workflow.
- Server-rendered pages call application services directly, not the application's HTTP endpoints. Browser requests use the same services and authorization rules.
- Voting types are `PUBLIC` and `PRIVATE`. Lifecycle states are independently `DRAFT`, `ACTIVE`, `COMPLETED`, and `CANCELLED`.
- There is no public registration, public results API, GraphQL API, separate API version, or API for retrieving PRIVATE selections. Browser application journeys go through Next.js, but assume callers can access the Supabase API directly: RLS, grants, and RPC checks must independently enforce the same boundaries.
- No payments, resident messaging, reminders, attachments, signatures, external PDF rendering, or AI integration is required. The public launch additions provide support enquiries and optional opt-in public-page analytics only, never voting/authentication tracking.

## 2. Transport and common contracts

### 2.1 Requests and responses

| Concern | Contract |
|---|---|
| Transport | HTTPS in production; same-origin browser requests only. Do not enable cross-origin credential access. |
| Request encoding | `application/json; charset=utf-8` for JSON bodies. Reject unsupported media types with `415`. |
| Success encoding | `application/json; charset=utf-8`, except downloads and `204` responses. |
| Success envelope | An object containing `data` and `requestId`. Paginated responses additionally contain `page`. |
| Error envelope | An object containing `error` and `requestId`; never a success envelope with an embedded failure. |
| Request identifier | A server-generated random support identifier, also returned in `X-Request-ID`. It must not encode identity, selections, or session material. |
| Field naming | JSON uses `camelCase`; database column names remain internal. |
| Identifiers | UUID strings for entities. Audit IDs and all database `bigint` counts use decimal strings. IDs never confer permission. |
| Time | RFC 3339 instants with explicit offsets on input; UTC `Z` instants on output. Return the frozen IANA `timezone` for activated vote display. Never accept an ambiguous local date/time. |
| Optional values | Omitted PATCH fields mean unchanged. Explicit `null` is permitted only for documented nullable fields. |
| Enumerations | Exact uppercase values documented here; UI labels may display PUBLIC VOTING and PRIVATE VOTING. |
| Cache | Authenticated pages, JSON, errors containing protected context, and downloads use `Cache-Control: private, no-store`. Authentication responses also use `no-store`. |
| Security headers | Apply MIME protection, no-referrer policy, frame denial, restrictive CSP, and production HSTS. |
| Methods | Unsupported methods return `405` with `Allow`. GET has no user-requested domain mutation; overdue-state reconciliation and session activity accounting remain server housekeeping. |

Return explicit, allowlisted projections rather than serializing database rows. Never expose Auth tokens in application JSON, raw policy administration metadata, internal tally IDs, privileged credentials, or provider responses.

The shared browser client validates the JSON envelope and error metadata before returning them to forms. Malformed responses produce `INVALID_RESPONSE`, never an uncaught parsing/type error or a successful acknowledgement. An uncertain first submission requires a participation check before retry. For an uncertain PUBLIC replacement, the check confirms participation but cannot reveal which choice is current; the same intended choice may be resubmitted safely while the poll remains active.

### 2.2 Pagination and filtering

All list endpoints use keyset pagination:

- `limit`: integer, default `25`, minimum `1`, maximum `100`.
- `cursor`: opaque bounded string issued by the server; clients must not construct it.
- `page`: `{ limit, nextCursor, hasMore }`; `nextCursor` is `null` on the final page.
- `data` is an array for list endpoints. Results use an object with a separately paginated `namedResponses` array.
- Cursors are validated and bound to the endpoint, filters, and parent vote where applicable. A cursor is not an authorization token; every page rechecks access.
- Invalid cursors, unknown filters, and invalid enum values return `422`.
- No arbitrary SQL sort expressions, fuzzy search, offset pagination, or unbounded list requests.

| Dataset | Fixed ordering | Supported filters |
|---|---|---|
| Member votes | Active first by `closesAt ASC`; terminal votes by completion/cancellation time descending; `id ASC` breaks ties | `status`, `votingType` |
| Administrator votes | `updatedAt DESC`, then `id DESC` | `status`, `votingType` |
| Households | Normalized household identifier, then `id`, ascending | `isEligible`; optional exact normalized `identifier` |
| Accounts | Profile `id ASC` | `status`, `isAdmin` |
| PUBLIC named responses | Frozen `householdId ASC` within the vote | None |
| Administrator participation | Frozen `householdId ASC` within the vote | `submitted` boolean |
| Audit history | `occurredAt DESC`, then audit `id DESC` | `action`, `targetType`, `from`, `to` |

Audit times use an inclusive `from` and exclusive `to`; reject inverted ranges. Filters apply before pagination and never broaden authorization. Account email is retrieved only through supported server-only Auth administration, not an application email table/index or direct managed-schema query. Paginate application profiles first and enrich only the authorized page through supported Auth interfaces.

Exports contain the **complete authorized dataset**, independent of UI pagination. Export endpoints reject pagination or identity-selection parameters.

## 3. Authentication, sessions, and authorization

### 3.1 OTP and session rules

- Disable public signup. Request codes through Supabase Auth using `shouldCreateUser: false`; only fully provisioned enabled profiles may access application data. Normalize email by trimming and lowercasing without provider-specific rewriting.
- Codes are six numeric digits, expiring and single-use. Configure the Auth email template with `{{ .Token }}`, custom SMTP, expiry, resend cooldown, and request/verification limits. Record and validate the selected values under A4 before real voting; do not invent a parallel challenge store or fixed attempt budget unsupported by Auth.
- Supabase Auth owns OTP verification, tokens, refresh, and session records. Use `@supabase/ssr` for supported Next.js cookie/session integration; do not add custom OTP/session tables, keyed OTP digests, or a parallel opaque-session system.
- Verify identity server-side with supported Auth verification methods. An unverified cookie session object or user-editable Auth metadata is not authorization.
- Apply HTTPS, Secure and appropriate SameSite/path settings using the SDK-supported integration. Validate actual cookie behavior; do not promise all SDK cookies are HttpOnly. Keep tokens out of application JSON, URLs, logs, and custom browser-storage flows.
- Approve the actual persistent-session policy under A4. Native time-boxed sessions, inactivity limits, and single-session enforcement require Supabase Pro or higher; do not promise a 30-minute idle or 12-hour absolute timeout on Free.
- **Implemented session upkeep.** Access tokens are short-lived (about an hour). `src/proxy.ts` refreshes an expiring session before any page renders (`src/server/auth/proxy-session.ts`) and passes the new cookies to both the page and the browser, because a Server Component cannot set cookies; without this a session would end at the first page after the token expired. This is upkeep only, never authorization: every page and API call still verifies the user with the Auth server and re-reads the current profile. Session cookies are written by one shared function (`src/server/auth/session-cookies.ts`): HttpOnly, `SameSite=Lax`, path `/`, Secure in production, and the browser-side lifetime capped at 14 days (the SDK default is about 400). The SDK rewrites the cookie on each refresh, so the cap is a **sliding inactivity window**, not a fixed deadline. It is a provisional default pending the A4 session policy; native idle and absolute timeouts and single-session enforcement still need Supabase Pro or higher and are not claimed. Sign-out ends that session at Auth, and replaying a copy of the old cookie afterwards is refused (tested).
- Sign-out clears SDK cookies and uses supported Auth sign-out behavior. Auth administrative actions and sign-out may not immediately invalidate every issued JWT.
- Current profile status and role are checked on every protected operation, applicable RLS read, and guarded RPC. Suspension/soft deletion block access even with an existing JWT; role changes take effect from the current profile, not stale token claims.

### 3.2 Origin and CSRF protection

All browser mutations, including code issuance, verification, and sign-out, require:

1. An `Origin` exactly matching validated `APP_ORIGIN`; reject missing or mismatched origins.
2. A valid `X-CSRF-Token` bound to the current session or a short-lived pre-authentication browser context.

Deliver CSRF material in the server-rendered sign-in/application document; no separate token API is required. Bind pre-authentication material to a secure same-origin browser context, and replace it after authentication. A CSRF token is not a session token. Reject CSRF failures with `403 CSRF_FAILED`. Do not use a permissive CORS policy or SameSite cookies alone as CSRF protection.

Supabase Cron invokes restricted SQL maintenance directly; there is no scheduler HTTP credential or browser-callable maintenance endpoint.

### 3.3 Authorization matrix

| Capability | Enabled member | Current enabled administrator |
|---|---|---|
| Discover member votes and view ballots | Own frozen electorate only; no drafts | Own electorate through member APIs; administrative details through admin APIs |
| Submit and read own participation | Own frozen entitlement only | Own frozen entitlement only; no impersonation |
| Manage register, accounts, drafts, lifecycle | No | Yes |
| Inspect participation of others | No | Yes, without choices |
| View/export completed results | Own frozen electorate | Yes |
| View completed PUBLIC named responses | Same permission as results | Yes |
| Retrieve PRIVATE individual choices | Never | Never |
| Read administrative audit | No | Yes |
| Invoke maintenance | No | No; dedicated Cron scheduling role only |

Every request and protected database operation checks verified identity, current profile status/role, and object-level access. Normal server-side Supabase clients carry the user's session. User-callable SQL entry points validate non-null `auth.uid()`, current profile capability, and frozen entitlement; never pass custom session digests or use a service-role client for ordinary ballots, results, or exports. UUID possession, hidden buttons, middleware checks, and client role claims are insufficient.

Enable RLS on every application table, starting with revoked privileges and default-deny policies. Grant only required safe reads and guarded RPC execution. Deny direct writes to protected voting records, direct reads of choice storage even by application admins, and private-table Realtime/change feeds. Fix `search_path`, schema-qualify references, restrict function-owner privileges, and revoke default public execution on definer functions. Anonymous callers have no application-data or protected-RPC access.

Suspension/deletion blocks access immediately. Current household reassignment affects future activations only: it neither transfers an existing entitlement nor rewrites historical identities. Administrator status alone never grants a ballot entitlement.

For authenticated callers, inaccessible or nonexistent vote IDs return the same `404 NOT_FOUND`. Missing/expired sessions return `401`; authenticated non-administrators requesting administration return `403`.

## 4. Endpoint inventory

### 4.1 Authentication

| Method and path | Purpose | Request | Successful response |
|---|---|---|---|
| `POST /api/auth/code` | Request or resend a Supabase email OTP | `email` | `202`: generic message and configured `resendAfterSeconds`; no application challenge ID |
| `POST /api/auth/verify` | Verify email OTP and establish the SDK-managed session | `email`, six-digit string `code` | `200`: `account: { id, representativeName, isAdmin }`; SDK-managed cookies, no raw tokens or invented session deadlines |
| `POST /api/auth/sign-out` | Sign out through Supabase Auth and clear SDK cookies | Empty object | `204` after successful sign-out or when no session remains; valid origin/CSRF context still required |

Code issuance uses the same response shape, wording, and status for registered, unregistered, disabled, and account-specific delivery-failure cases. Do not return provider errors or invent non-verifiable challenge IDs. Mitigate timing differences and apply additional abuse controls regardless of account existence. Do not persist raw unregistered emails.

The acknowledgement means the request was processed, **not** that email was sent or delivered. Suggested message: "If this address can sign in, a code may arrive shortly. If it does not, wait before requesting another code or contact the administrator." Do not reveal provider errors or registration status. Record actual delivery failures and alert operationally; this generic response is not evidence of delivery success. A system-wide database/email outage may return a uniform `503 AUTH_UNAVAILABLE`, without account-specific distinctions.

Verify the normalized email/code through Supabase Auth's supported email OTP verification. Return `422 CODE_INVALID_OR_EXPIRED` for invalid/expired/unusable codes without exposing account existence. Auth owns attempt accounting and replay prevention; endpoint/provider throttling maps to `429`. After verification, require a consistent enabled application profile before returning application success; an Auth session alone grants no application capability. If sign-out fails, clear local cookies where safe but surface the Auth failure rather than returning false success.

There is no public bootstrap, self-registration, password reset, or role-assignment endpoint. Initial administrator provisioning is a controlled, audited deployment operation.

### 4.2 Member votes, participation, results, and exports

| Method and path | Purpose | Input | Successful response |
|---|---|---|---|
| `GET /api/votes` | List votes available to the current frozen representative | Standard pagination; `status`, `votingType` | `200`: paginated vote summaries; never drafts |
| `GET /api/votes/{id}` | Load an authorized ballot/detail | Vote UUID | `200`: vote detail and own entitlement/submission state |
| `GET /api/votes/{id}/participation` | Resolve current member's submission status, including uncertain network outcomes | Vote UUID | `200`: `voteId`, `status`, `submitted` |
| `POST /api/votes/{id}/submission` | Submit a first ballot or replace a PUBLIC poll response while active | Type-specific confirmed submission | `200`: `voteId`, `submitted: true` only |
| `GET /api/votes/{id}/results` | View active aggregates or completed results | Vote UUID; `limit`, `cursor` for completed PUBLIC named responses | `200`: authorized result projection |
| `GET /api/votes/{id}/exports/{format}` | Download complete completed results | `csv` required; `pdf` only when implemented/enabled | `200`: attachment, not a JSON envelope |

Vote summaries contain `id`, `votingType`, `status`, `title`, `closesAt`, `timezone`, `activatedAt`, `completedAt`, `cancelledAt`, and the caller's `submitted` flag. Inapplicable lifecycle times are `null`. Detail additionally contains `instructions`, type-specific ballot configuration (including `openSelectionMode` and `openSelectionLimit` for PUBLIC polls), frozen RWA display metadata/policy versions, privacy notice, `canSubmit`, available `exportFormats`, completion mode/reason, and cancellation reason when applicable. Administrators viewing a vote outside their own entitlement receive no fabricated member submission state. Omit `pdf` from available formats and hide its controls when unavailable; an authorized request for an unavailable format returns `404 EXPORT_FORMAT_UNAVAILABLE`.

The server supplies type-specific privacy notices. While a PUBLIC poll is active, authorized voters/admins can see aggregate counts and turnout but not individual responses. While a PRIVATE election is active, eligible members and admins can see aggregate turnout only; admins can separately see the frozen household participation list for follow-up, never choices. Candidate/NOTA counts and outcomes stay hidden until completion. Before PUBLIC submission, disclose that frozen representative name, household identifier, and final response will appear in completed results and downloads, and that the voter may replace the response until closure. PRIVATE notices explain aggregate-only application access and the approved assurance limitations.

Neither summary nor ballot endpoints include active choice counts or other households' participation. Active PUBLIC aggregates and active PRIVATE turnout are available only through the authorized results projection. Active PRIVATE candidate/NOTA totals remain hidden. The administrator-only participation endpoint may show household-level submission status for follow-up but never choices. A cancelled detail says **"Cancelled; results not valid"**, disables submission, and exposes no choices. Ballot configuration may remain visible, but responses and tallies may not.

#### Submission request shapes

| Voting type | Required JSON fields | Rules |
|---|---|---|
| PUBLIC single-select | `confirmed: true`, `optionId` | Exactly one UUID referencing an option in this vote |
| PUBLIC multi-select | `confirmed: true`, `optionIds` | Non-empty array of distinct UUIDs referencing options in this vote; obey the configured maximum when present |
| PRIVATE | `confirmed: true`, `selections` | One entry for every configured office |

Each PRIVATE selection contains `officeId` and `candidateId`. A candidate UUID selects that office's candidate; explicit `candidateId: null` means NOTA (None of the Above). Omitting `candidateId` is invalid. Reject duplicate/missing/extra offices, foreign candidates, repeated options, mixed ballot shapes, and unknown fields. Every PUBLIC multi-select submission is still one ballot and one household participation; at least one choice is required.

Do not accept `accountId`, `profileId`, `householdId`, an actor role, timestamps, result counts, or an idempotency payload identifier. Derive entitlement from `auth.uid()` and the frozen electorate. `confirmed: true` records explicit final confirmation intent; it does not replace eligibility or integrity checks.

Submission processing:

1. Call guarded `cast_vote` with the verified user's session; require `auth.uid()`, lock the parent vote then caller profile, and recheck enabled status and frozen entitlement. Do not lock or modify managed Auth session tables.
2. Reconcile overdue state; require `ACTIVE` and check `clock_timestamp()` after all admission locks, immediately before acceptance, strictly before `closesAt`.
3. Validate the complete ballot. Reject prior participation for PRIVATE; for PUBLIC, verify the existing response and permit replacing it while active.
4. Atomically insert one participation row and the selected PUBLIC response row(s) on the first submission, replace the complete selected set on PUBLIC resubmission, or increment all PRIVATE counters once.
5. Commit durably before returning the participation-only acknowledgement.

Requests waiting until or beyond the cutoff are rejected even if sent earlier. A transaction admitted strictly before the deadline may commit afterwards. Terminal votes never accept submissions. Deadline reconciliation must remain committed when the submission itself is rejected; database/invariant failures instead roll back and surface an error.

A PUBLIC resubmission replaces the household's current choice set without creating another participation record; only the latest option set is counted and no change history is retained. PUBLIC option counts count selected options, so they may exceed submitted households. Per-option percentages use submitted households as the denominator and may add up to more than 100%. PRIVATE repeat submissions return `409 ALREADY_SUBMITTED` without echoing or comparing selections. There is no withdrawal or PRIVATE ballot receipt. An entitlement's unique participation provides duplicate protection for PRIVATE ballots and the one-ballot-per-household invariant for PUBLIC polls.

After a timeout, lost response, or ambiguous infrastructure error, the client reads participation before offering a retry. `submitted: true` confirms acceptance; `submitted: false` describes the current committed state, not proof that an earlier in-flight request cannot commit. A deliberate retry remains protected by the same uniqueness/locking rules. If status cannot be read, show an unknown outcome, not success or rejection. Unsent choices stay in page memory only and are cleared after confirmed acceptance, sign-out, or access revocation.

**Implemented results, monitoring and export contract (phases 12–14).** `GET /api/votes` lists only the caller's own frozen entitlements (never drafts), active votes first by soonest deadline, then finished ones newest first, with `status`/`votingType` filters and keyset pagination; each row carries only the caller's own `submitted` flag. `GET /api/votes/{id}` returns the ballot, frozen RWA name and policy versions, `entitled`, `submitted`, `canSubmit`, `exportFormats` and `privacyNotice` (`PUBLIC` or `PRIVATE`); an administrator outside the electorate gets `entitled: false` and no submission state. An unknown vote, a draft and a vote outside the electorate are indistinguishable `404`s. An overdue vote is finalised (server-only reconcile) before it is shown.

`GET /api/votes/{id}/results` is available to a frozen eligible representative or enabled administrator. For any unexpired ACTIVE vote, the projection includes eligible/submitted counts and turnout and refreshes in the browser every 10 seconds. ACTIVE PUBLIC additionally returns aggregate option counts and an outcome, with `namedResponses` and `namedPage` null; counts include each participating household's latest selection(s). ACTIVE PRIVATE returns empty `options` and `offices` arrays and no names, exposing no candidate/NOTA totals or outcomes. A COMPLETED result includes PUBLIC frozen names/household identifiers/selected option labels or PRIVATE aggregates only. Cancelled or overdue votes return `409 RESULTS_UNAVAILABLE` until deadline reconciliation completes. Everything comes from one SQL call on one snapshot: eligible/submitted counts as decimal strings, `turnout {numerator, denominator, percent}`, and type-specific results. Each completed PUBLIC named-response row represents one household, with all selected options in `optionLabels`; `limit`/`cursor` page by household and totals always cover every selection. Null/unbounded response pages are completed-only and required for exports. PUBLIC option counts count selections and can exceed submitted households; option `percent` uses submitted households and `eligiblePercent` uses eligible households; both may total over 100% in multi-select polls. A counter/participation mismatch returns `503 RESULTS_INTEGRITY_ERROR` and publishes nothing. Percentages and outcomes are derived once in `src/shared/contracts/results.ts`.

`GET /api/votes/{id}/exports/csv` renders the complete file (BOM, CRLF, the fixed columns above, formula-starting cells prefixed with an apostrophe, control characters removed) before any success header, with `Content-Disposition: attachment` and a server-generated name (`civic-pulse-results-<date>-<id8>.csv`), `no-store` and `nosniff`; a render failure is `503 EXPORT_FAILED`. Unknown or disabled formats are `404 EXPORT_FORMAT_UNAVAILABLE` after authorization. PDF availability and per-format rendering bounds are described below. Budgets (provisional): 120 reads and 10 exports per minute per profile.

`GET /api/admin/votes/{id}/participation` (admin only, not for drafts, `submitted` filter, keyset pagination) returns `eligibleCount`, `submittedCount` and rows of frozen representative name, household identifier and `submitted`; never a selection, email or submission time. `GET /api/admin/audit` (admin only; `action`, `targetType`, `from`, `to`; newest first) returns allowlisted fields only: `details` keeps only keys the application itself writes, so a stray key is dropped rather than exposed.

**Implemented export and operations additions (phases 15 and 17).** `GET /api/votes/{id}/exports/pdf` now renders an A4 portrait, grayscale PDF locally with PDFKit from the same completed-result projection as the screen, API and CSV: header and footer on every page with `Page X of N`, the RWA name and title, type, opened/ended times **with the year**, time zone, how it ended (and the early-completion reason), turnout with its denominator, totals with percentages of submitted responses, outcomes, instructions and the disclaimer; PUBLIC includes the complete named list (no emails) with a repeated table header across pages, PRIVATE only aggregates. Long and unbroken text wraps. Text is shaped with Inter (Latin, Greek, Cyrillic) and Noto Sans Devanagari; a character neither font covers fails the export with `503 EXPORT_FAILED` and the message "The PDF cannot display some characters in this record. Download the CSV instead." It is never dropped or replaced. Headers: `application/pdf`, attachment with `civic-pulse-results-<date>-<id8>.pdf`, `no-store`, `nosniff`. `PDF_EXPORT_ENABLED=0` switches PDF off (`exportFormats` then lists only `csv`, and the endpoint answers `404 EXPORT_FORMAT_UNAVAILABLE`). Rendering is capped (8 CSV, 2 PDF at a time); callers beyond the cap wait up to 15 s and then get `503 DEPENDENCY_UNAVAILABLE` with `Retry-After`. `GET /api/internal/health` answers `{"data":{"status":"ok"}}` (200) or `{"data":{"status":"unavailable"}}` (503) with a request ID after a bounded (3 s) database ping, and nothing else; maintenance mode (`MAINTENANCE_MODE=1`) makes every other API route answer `503` with `Retry-After: 300` and pages show a maintenance notice.

**Implemented submission contract (phase 11).** `POST /api/votes/{id}/submission` accepts exactly the shapes above (strict objects; the database re-validates, so a payload that bypassed the API schema is still refused) and answers `200 {voteId, submitted: true}` only after the transaction committed. A PUBLIC resubmission replaces the current response; PRIVATE repeat submission returns `409 ALREADY_SUBMITTED` (no selection echoed or compared). Other outcomes include `409 VOTING_CLOSED` (the deadline passed or the vote is terminal; an overdue vote was completed at its deadline in the same committed step), `404 NOT_FOUND` for an unknown vote, a draft, a vote outside the caller's frozen electorate, or an administrator without an entitlement (all indistinguishable), `403 FORBIDDEN` for a revoked or suspended profile even with a still-valid session, `422 VALIDATION_FAILED`, `429 RATE_LIMITED` (20 submissions per minute per profile, provisional), and `503 DEPENDENCY_UNAVAILABLE` when a bounded lock wait or timeout expires (retry only after reading participation). `GET /api/votes/{id}/participation` returns `{voteId, status, submitted}` for the caller's own entitlement (60 per minute per profile, provisional). Both responses are `no-store`. A malformed vote id is a `404`.

### 4.3 Administrator register and account management

These routes require a current enabled administrator. The HTTP term `account` means one managed Auth identity plus its application profile; `account.id` equals `profiles.id` and the Auth user UUID. It is not a separate accounts table. Profiles are separate from households so administrators without household entitlements can be maintained.

| Method and path | Purpose | Request / query | Successful response |
|---|---|---|---|
| `GET /api/admin/accounts` | List registered identities/profiles for register administration | Standard pagination and account filters | `200`: paginated account projections |
| `POST /api/admin/accounts` | Provision a managed Auth identity and profile | `email`, `representativeName`, `isAdmin` | `201`: provisioned account projection; ordinary residents remain suspended pending household assignment |
| `PATCH /api/admin/accounts/{id}` | Maintain managed identity or application profile capability/status | Changed fields among `email`, `representativeName`, `status`, `isAdmin` | `200`: updated projection only after required workflow steps succeed |
| `PATCH /api/admin/settings` | Update the RWA profile, branding, household display wording and suggestion lists | Strict object containing `fullName`, `alias`, `address`, `email`, `phone`, `website`, `accentPalette`, `welcomeMessage`, `householdLabel`, `identifierKind`, `defaultHouseholds` and `rwaPositions` | `200`: updated settings; changed field names are audited, never values |
| `GET /api/admin/households` | List the household register | Standard pagination and household filters | `200`: paginated register projections |
| `POST /api/admin/households` | Create a household assigned to an existing account | `identifier`, `representativeAccountId`, `isEligible` | `201`: household projection |
| `GET /api/admin/households/{id}` | Load a household for editing | Household UUID | `200`: household projection |
| `PATCH /api/admin/households/{id}` | Change current label, assignment, or eligibility | Changed fields among `identifier`, `representativeAccountId`, `isEligible` | `200`: updated household projection |

Account projections contain `id`, `email`, `representativeName`, `status`, `isAdmin`, `emailVerifiedAt`, and `updatedAt`. Email and verification state come from supported Auth interfaces and are not duplicated in profiles. Household projections contain `id`, `identifier`, `representativeAccountId` (mapped to `representative_profile_id`), `isEligible`, `updatedAt`, and the minimal representative name/email/status needed by the administrator. None are member directory endpoints. Privileged Auth enrichment is restricted to this administrative purpose; never use it for normal voting/results access.

Require an existing consistently provisioned, non-deleted identity/profile for a representative assignment; a suspended newly provisioned profile may be assigned without granting access. Enabling an ordinary resident requires its valid household assignment and explicit administrative status change; activation additionally requires enabled selected representatives. Reject ambiguous assignments and normalized duplicate emails/household identifiers with `409 REGISTER_CONFLICT`. Never silently create or merge an account during household mutation. A retained suspended/deleted account's identity must not be replaced to bypass historical references.

Provisioning and identity changes span Supabase Auth and application records and are **not one cross-service transaction**. Use retry-safe server-only provisioning with supported Auth administrative APIs; create profiles suspended by default and grant access only after the identity and required application assignment are consistent. An ordinary resident profile is not enabled until its valid household assignment exists; a deliberately provisioned administrator may exist without a household.

For email/identity changes, block the profile first and keep it blocked until the Auth identity and register association are verified consistent. Surface partial failures as `503 PROVISIONING_INCOMPLETE` with a safe support ID; do not acknowledge success, create a duplicate identity on retry, or re-enable an inconsistent profile. Recheck the caller's current administrator capability before each privileged stage. Do not silently roll back an already-blocked profile to enabled after an Auth failure.

Suspension/soft deletion immediately blocks application access through current-profile RLS/RPC checks; use supported Auth administrative revocation/bans/email-change controls as applicable without promising instant invalidation of all issued JWTs. Soft deletion uses `status: DELETED`; no HTTP hard-delete or deleted-account restoration is defined.

If the Auth ban fails after a suspension/deletion commits, repeat the same status-only PATCH to retry the Auth stage. An already-blocked profile is not mistaken for a fully completed workflow: the ban is retried and any continuing failure remains `503 PROVISIONING_INCOMPLETE`. A repeated `DELETED` status never restores or edits the deleted profile. Auth identity searches return absence only after completing the search; provider failures or the bounded lookup ceiling return `503 DEPENDENCY_UNAVAILABLE`. Email-change preflight failures do not suspend the target or start the Auth update.

Application-database register/profile writes commit atomically with their audit records and serialize against activation/submission where required; Auth administrative steps require the separate retry-safe workflow above. Current edits never rewrite frozen snapshots. Bulk CSV register import is out of scope for version 1; maintain entries individually.

### 4.4 Administrator draft and lifecycle management

| Method and path | Purpose | Request / query | Successful response |
|---|---|---|---|
| `GET /api/admin/votes` | List all administrative votes, including drafts | Standard pagination; `status`, `votingType` | `200`: paginated administrative summaries |
| `POST /api/admin/votes` | Create an incomplete draft with explicit voting type | `votingType` | `201`: draft detail with `draftRevision: 1` |
| `GET /api/admin/votes/{id}` | Read draft/configuration and lifecycle detail | Vote UUID | `200`: explicit administrative detail, no hidden tallies |
| `PATCH /api/admin/votes/{id}` | Atomically edit a draft | `expectedRevision` and permitted draft fields | `200`: revised detail with incremented `draftRevision` |
| `POST /api/admin/votes/{id}/preview` | Validate and render the resident ballot/privacy preview | `expectedRevision` | `200`: preview, revision, readiness, and activation blockers |
| `POST /api/admin/votes/{id}/activate` | Freeze and activate the previewed draft | `expectedRevision`, `confirmed: true` | `200`: activated vote detail |
| `POST /api/admin/votes/{id}/complete` | Complete an active vote early | `confirmed: true`, `reason` | `200`: completed lifecycle summary |
| `POST /api/admin/votes/{id}/cancel` | Cancel an active vote before deadline | `confirmed: true`, `reason` | `200`: cancelled lifecycle summary |
| `POST /api/admin/votes/{id}/deadline` | Move an active vote's deadline later or earlier | `confirmed: true`, `closesAt`, `reason` | `200`: active detail with the new `closesAt` |
| `GET /api/admin/votes/{id}/participation` | Monitor frozen electorate participation without choices | Standard pagination; optional `submitted` | `200`: aggregate turnout and paginated participation rows |
| `GET /api/admin/audit` | Read administrative audit history | Standard pagination and audit filters | `200`: paginated allowlisted events |

#### Draft fields and child identity

Permitted draft fields are `votingType`, `openSelectionMode`, `openSelectionLimit`, `title`, `instructions`, `closesAt`, `eligibleHouseholdIds`, `offices`, and `options`. Set `openSelectionMode` and `openSelectionLimit` together on PUBLIC polls: `SINGLE` requires limit `1`; `MULTIPLE` requires a maximum from `2` to `100` or `null` for no maximum. PRIVATE elections always use the fixed single-selection configuration and reject PUBLIC selection settings.

- `offices` entries contain optional existing `id`, `name`, `position`, and `candidates`; candidate entries contain optional existing `id`, `name`, and `position`.
- `options` entries contain optional existing `id`, `label`, and `position`.
- Supplied child IDs must already belong to the edited draft and parent office. The server generates UUIDs for new children and returns them.
- A supplied collection replaces that entire collection atomically; omitted top-level fields remain unchanged. Removed draft children are removed only within this draft transaction.
- `eligibleHouseholdIds` is the complete selected set when supplied; reject duplicates and unknown households.
- Drafts may lack activation-required content; supplied child labels must still be non-empty and structurally valid. No partial activation or mixed voting-type child configuration is accepted.
- A voting-type change atomically removes incompatible draft children. Return the resulting configuration explicitly; never reinterpret old options as candidates.
- Positions are positive and unique within their parent. Names/labels must be normalized-distinct within the required office/vote scope.

Every draft edit, including electorate or child edits, increments the parent revision. Missing revision returns `422`; mismatched revision returns `409 STALE_REVISION`. Preview is read/validation-only and does not create a stored report or increment revision. It may return `readyToActivate: false` with safe blockers for an incomplete draft; malformed requests still return errors.

**Implemented lifecycle contract (phase 10).** `POST /api/admin/votes/{id}/activate` takes `{expectedRevision, confirmed: true}` and returns the activated detail (status `ACTIVE`, frozen `rwaName`/`timezone`, `activatedAt`); `STALE_REVISION` if the draft changed, `ACTIVATION_BLOCKED` if the register, approvals or deadline no longer allow it (preview again to see why), `LIFECYCLE_CONFLICT` with `context.reason` set to the current state if it is not a draft. `POST .../complete` and `POST .../cancel` take `{confirmed: true, reason}` and return the updated detail. If the deadline has already passed, the vote is completed at its deadline instead, that is kept, and the action returns `409 LIFECYCLE_CONFLICT` with `context.reason: "DEADLINE_PASSED"`. A repeat against a finished vote returns `409` with `context.reason` of `COMPLETED` or `CANCELLED`. `GET /api/admin/votes/{id}` finalises an overdue vote through the server-only reconcile routine first, so an administrator never sees a stale Active.

**Deadline change.** `POST /api/admin/votes/{id}/deadline` takes `{confirmed: true, closesAt, reason}` for an `ACTIVE` vote of either type; `closesAt` must carry an explicit UTC offset and `reason` is required. The database clock requires the new deadline to be at least 5 minutes ahead (`422 VALIDATION_FAILED` with `context.reason: "DEADLINE_TOO_SOON"`) and different from the current one (`context.reason: "DEADLINE_UNCHANGED"`). There is no upper bound and no limit on repeated changes; moving the deadline earlier is allowed. As with completion and cancellation, an overdue vote is completed at its deadline (committed) and the call returns `409 LIFECYCLE_CONFLICT` with `context.reason: "DEADLINE_PASSED"`; drafts and finished votes return `409 LIFECYCLE_CONFLICT` with their state. Success returns the updated detail and appends `VOTE_DEADLINE_CHANGED` with the reason and `{previousClosesAt, closesAt, direction}` (`EXTENDED` or `SHORTENED`). The reason is never included in member responses, and residents are not notified; admission, countdowns, live results and due completion all follow the new deadline.

**Implemented draft contract (phase 9).** `GET /api/admin/votes` returns summaries `{id, votingType, status, title, closesAt, draftRevision, updatedAt, timezone}` ordered by last change (keyset pagination). Create, detail and edit return the explicit detail `{id, votingType, status, title, instructions, closesAt, draftRevision, createdAt, updatedAt, ..., rwaName, timezone, offices[{id,name,position,candidates[]}], options[], eligibleHouseholdIds[]}`; it never contains tallies. A `PATCH` with only `expectedRevision` is not an edit and returns the current detail unchanged. The preview response is `{revision, readyToActivate, blockers[{code, section, message}], electorate{selected, eligibleWithEnabledRepresentative}, vote}` and is returned only for the exact `expectedRevision`; a non-draft returns `409 LIFECYCLE_CONFLICT`. `closesAt` must carry an explicit UTC offset. The browser converts what the administrator typed in the RWA time zone and refuses a local time that is ambiguous or does not exist when clocks change.

Activation revalidates the supplied revision, complete type-specific ballot, future deadline, eligible enabled representatives, current settings, A1-A7 approvals, and retention configuration. It freezes type, configuration, deadline, household/representative identity snapshots, RWA name/timezone, and policy versions; initializes PRIVATE counters; and commits lifecycle plus audit atomically. Preview is not a durable guarantee that subsequent activation will succeed.

After activation, configuration and electorate edits return `409 VOTE_FROZEN`. Only `DRAFT -> ACTIVE`, `ACTIVE -> COMPLETED`, and `ACTIVE -> CANCELLED` exist. The only change allowed to an active vote is its deadline, through the guarded deadline endpoint above. There are no reopen, active-edit, or manual result-edit endpoints, and a finished vote's deadline cannot change.

Early completion and cancellation require an explicit confirmation and non-empty reason. Reconcile the deadline first: an overdue vote completes at its frozen deadline, cannot be cancelled, and cannot be relabelled as early completion. Repeating an action against a terminal vote returns `409 LIFECYCLE_CONFLICT` with safe current-state context.

Participation monitoring returns `eligibleCount`, `submittedCount`, turnout, and rows containing frozen representative name, household identifier, and `submitted`. It does not return selections, counter snapshots, email, or per-submission timestamps. It is unavailable for drafts. This administrative participation list is never attached to PRIVATE results/exports.

`PATCH /api/admin/settings` is administrator-only and CSRF-protected. It accepts a strict object: official full name (1-200 characters), compact alias (1-80), optional address (up to 500, blank allowed), optional email (blank or a valid address up to 254), optional phone (up to 40, blank allowed), optional HTTP(S) website (up to 200, blank allowed), accent palette (`TEAL`, `BLUE`, `FOREST`, `PLUM` or `SLATE`; each preset meets 4.5:1 contrast), optional plain-text welcome message (up to 300 characters, blank allowed), household label (1-40 characters of single-line plain text, such as `Flat` or `Villa`), identifier kind (`NUMBER` or `ID`), `defaultHouseholds` (array of up to 1000 single-line identifiers, each 1-100 characters) and `rwaPositions` (array of up to 50 single-line office names, each 1-200 characters; defaults to President, Vice-President, Secretary, Joint-Secretary, Treasurer). Both arrays are required keys but may be empty, and entries must be unique after the household key normalization (trim, NFKC, collapsed whitespace, case-fold); a duplicate is reported against `defaultHouseholds[i]` or `rwaPositions[i]`. The settings form edits them as comma-separated text. Only the full name, alias, household label and identifier kind are required; blank optional values are hidden wherever they would appear. The guarded database routine independently validates the values, rechecks the current administrator, keeps `rwa_settings.name` equal to the full name, and audits changed field names atomically without storing the values in audit details.

The full settings projection is returned to the settings page only by the administrator-only `get_rwa_profile` routine; the settings page is not available to residents. Residents see the values on other pages through `get_rwa_branding` (enabled members only): the alias in the “Civic Pulse for {alias}” header and the breadcrumb root, the full name on the Votes page, vote pages and results, an RWA contact block (name, address, email, phone and optional website) in the signed-in footer, the welcome message on the Votes page and the administrator Households and Manage Votes pages, the chosen accent palette, and the household label and identifier kind used for all household wording. The two suggestion lists are administrator-only: the new-household form offers default households not yet in the register as identifier suggestions, and PRIVATE draft editors offer RWA positions as office-name suggestions and through **Add All Positions**. They never create households or offices by themselves and are excluded from member branding and the public identity projection. Public pages receive only the full name, alias, address, palette and household label through `get_public_rwa_identity`, which only the server-side service role can execute (sign-in shows name and alias; the privacy page shows name and address). A settings outage falls back to the product name and default palette rather than blocking pages. Member vote, results and export responses carry the **current** RWA name; the vote's activation-time `rwa_name_snapshot` remains an internal historical record and is not displayed. PDF results print the current name, address, email and phone; CSV carries the current name in `rwaName`. Direct `rwa_settings` access remains denied. Changing the household label or identifier kind affects wording across views and reports (for example “Flats” and “Flat Number”) without altering stored identifiers, uniqueness, normalization, API field names or CSV column keys; the UI derives plural and sentence wording from them.

Audit events expose decimal-string `id`, `actorKind`, authorized actor identifier, `action`, `targetType`, `targetId`, `occurredAt`, required `reason`, and allowlisted action metadata. They never include OTPs, session material, full account records, ballots, or PRIVATE counter deltas.

RWA identity/contact profile fields and the household and identifier labels are administrator-managed through `PATCH /api/admin/settings`. Timezone, retention approvals, policy approvals and first-administrator setup remain controlled operational procedures; they are not accepted by this profile endpoint.

## 5. Results and download formats

### 5.1 Common result projection

Active and completed results use the same projection. Active PUBLIC results contain aggregate option counts and turnout only. Active PRIVATE results contain aggregate turnout only, with empty option/office arrays; only the separate administrator participation endpoint can identify households that have or have not voted. Cancelled requests return `409 RESULTS_UNAVAILABLE` after object authorization. No endpoint leaks active choices or member-facing identities.

The completed projection contains:

- `vote`: ID, title, voting type/status, instructions/context, frozen ballot labels/order, the current RWA name, timezone, policy versions, activation time, deadline, and (when completed) effective completion time, completion mode and early-completion reason.
- `eligibleCount` and `submittedCount` as nonnegative decimal strings.
- `turnout`: explicit decimal-string numerator and denominator, and `percent`.
- Type-specific options or offices/candidates with authoritative counts and explicit percentage denominators.
- A clear record disclaimer: not a signature, legal certification, or spending authorization.

`percent` is a whole-number decimal string (for example `"38"`, no decimals) rounded half-up by one shared policy, or `null` when the denominator is zero. Turnout uses eligible households. PRIVATE candidate/NOTA and PUBLIC option `percent` values use submitted households; each of those rows also has `eligiblePercent`, the same count as a share of eligible households, which the results page and PDF display beside `count/eligible`. The CSV keeps `percent` only. Multi-select PUBLIC option shares may sum above 100% because each household can select several options. Never emit `NaN`, infinity, or a fabricated percentage.

| Type | Additional fields |
|---|---|
| PUBLIC | `options`: option ID, label, count, `percent` (of submitted) and `eligiblePercent` (of eligible); `outcome` and `leaderOptionIds`; `namedResponses`: frozen `representativeName`, frozen `householdIdentifier`, and selected option ID/label; `page` for that response list |
| PRIVATE | `offices`: office ID/name, candidate IDs/names/counts/`percent`/`eligiblePercent`, `nota` count/`percent`/`eligiblePercent`, outcome, and leader IDs; no respondent/household lists or named-response field |

PUBLIC aggregate totals always cover all accepted responses, not the current named-response page. Names/labels come from frozen snapshots/configuration, never current register joins. Omit registered email and unnecessary internal identity fields from result responses.

For each PRIVATE office, outcome is `LEADER`, `TIE`, or `NO_WINNER`. The candidate with the highest positive count among candidates is elected even if NOTA has more votes; NOTA is counted separately and cannot win. Equal highest positive candidate counts are labelled "Tie." Zero submissions or zero votes for all candidates (including an office where every response is NOTA) produce `NO_WINNER`. Candidate/NOTA `percent` uses submitted ballots; `eligiblePercent` uses eligible households.

PUBLIC outcome is `LEADER`, `TIE`, or `NO_VOTES`: mark equally highest positive option counts "Tie" without selecting a winner, and use `NO_VOTES` with no leaders for zero responses. Reporting a leading option does not elect an officeholder or confer spending authority/legal certification.

Before publication, verify PUBLIC response/participation equality and each PRIVATE office's candidate-plus-NOTA equality with participation. Invariant failure blocks completion/publication/downloads with `503 RESULTS_INTEGRITY_ERROR` and a restricted operational alert; never repair, omit, or invent totals silently.

All components of one result projection come from one authorized SQL RPC using a consistent database snapshot. Separate Supabase HTTP requests do not share a transaction. Materialize authorized data before rendering; active PUBLIC aggregates reflect the current response rows, while completed values are immutable apart from approved whole-record retention deletion.

### 5.2 CSV and PDF downloads

CSV is required. All PDF requirements below apply only when the optional feature is implemented and enabled. PDF readiness is not a version 1 release gate when PDF is deferred.

| Format | Headers and content |
|---|---|
| PDF | `Content-Type: application/pdf`; safe `Content-Disposition: attachment` filename ending `.pdf`; A4 portrait, grayscale-safe, wrapped text, repeated headers, page numbers, complete multi-page rows |
| CSV | `Content-Type: text/csv; charset=utf-8`; safe attachment filename ending `.csv`; correctly escaped UTF-8 fields, consistent line endings, spreadsheet-formula protection for user-controlled text |

Both formats use `no-store` and `X-Content-Type-Options: nosniff`. Filenames are server-generated and cannot contain path separators, header injection, or arbitrary user-supplied fragments.

Use the same authoritative projection as the results screen. Generate the complete file in bounded application memory before returning successful headers; do not hold a database transaction open while rendering. Do not persist public/private report copies, issue bearer download URLs, or email attachments.

Each available format includes RWA name, title, type, question/offices and candidates/options, activation/effective completion times with timezone, eligible/submitted counts, turnout, final totals, explicit denominators, NOTA/ties/no-votes, generation time, and the early-completion label/reason where applicable. CSV uses one rectangular schema with fixed columns: `recordType`, `rwaName`, `voteTitle`, `votingType`, `timezone`, `activatedAt`, `completedAt`, `completionMode`, `completionReason`, `generatedAt`, `office`, `label`, `count`, `numerator`, `denominator`, `percent`, `outcome`, `representativeName`, `householdIdentifier`, `choice`, `notice`. Unused cells are empty. Rows use `SUMMARY`, `TURNOUT`, `OPTION`, `CANDIDATE`, `NOTA`, `OFFICE_OUTCOME`, `NAMED_RESPONSE`, or `NOTICE` as applicable; repeat report metadata consistently. Include poll outcome in `SUMMARY` and instructions/context as a `NOTICE` alongside the record disclaimer.

PUBLIC files include the **entire** named-response list without emails. PRIVATE files contain aggregates only: no named-response rows, voter/household lists, participation identities, or individual ballots. Any identity-related CSV columns remain empty for PRIVATE.

Rendering failure returns structured `503 EXPORT_FAILED` before a successful attachment response. A network-interrupted download remains a download failure and does not change results. Download retries never resubmit a ballot.

When PDF is included, use PDFKit in a Node.js server route with locally bundled fonts. Validate actual legible rendering for approved scripts, long text, complete named lists, and maximum electorate before enabling the feature; never silently drop unsupported characters.

Downloaded or printed records cannot be remotely deleted, access-revoked, or guaranteed to follow application retention. Exports are derived views, not authoritative records, database backups, electronic signatures, or legal certifications. Replacing physical signatures is not a version 1 requirement.

## 6. Validation and errors

### 6.1 Server validation

Use shared Zod contracts at HTTP entry points plus protected database validation/constraints. Browser validation is advisory.

- Reject unknown JSON fields and unsupported query parameters; do not silently ignore privileged or selection-bearing extra input.
- Require valid UUIDs, exact enums, booleans, positive integer revisions/positions, finite pagination values, and valid timestamp/timezone values.
- Store trimmed plain text; reject inappropriate control characters and rich HTML. Normalize before uniqueness checks.
- Bounds match database checks: email `254`, household identifiers `100`, names/ballot labels `200`, titles/questions `300`, instructions/context `10,000`, reasons `2,000` characters.
- PRIVATE activation requires a title, non-empty instructions, at least one office, at least one named candidate per office, built-in NOTA for every office, non-empty electorate, and a future deadline.
- PUBLIC activation requires a title/question, at least two distinct non-empty options, non-empty electorate, and a future deadline; context is optional.
- Enforce bounded body bytes, nesting, and collection sizes at the proxy and application. Set consistent technical limits against the approved 500-household/100-concurrent-user pilot dataset; do not invent election-rule caps or silently truncate oversized ballots.
- Reject oversized bodies with `413 REQUEST_TOO_LARGE`. Reject malformed JSON with `400 MALFORMED_JSON`.
- Revalidate candidate/option ownership, electorate eligibility, lifecycle, and deadline inside the atomic operation, not solely before entering it.

### 6.2 Error envelope

`error` contains:

| Field | Contract |
|---|---|
| `code` | Stable uppercase machine-readable code |
| `message` | Safe actionable text; no stack trace, SQL, provider body, or sensitive input echo |
| `fieldErrors` | Optional array of `{ field, code, message }`; field paths only, never submitted values |
| `context` | Optional allowlisted lifecycle/revision recovery context; never identity-to-choice information |

The top-level `requestId` supports restricted troubleshooting. PRIVATE validation must not echo candidate IDs, chosen values, or a summary of selections; generic indexed field paths are sufficient.

| HTTP status | Representative codes | Meaning / recovery |
|---|---|---|
| `400` | `MALFORMED_JSON` | Correct request syntax |
| `401` | `AUTH_REQUIRED`, `SESSION_EXPIRED` | Sign in again; do not retain ballot choices outside page memory |
| `403` | `FORBIDDEN`, `CSRF_FAILED` | Capability or browser-request protection failed |
| `404` | `NOT_FOUND`, `EXPORT_FORMAT_UNAVAILABLE` | Record absent/inaccessible, or requested optional format unavailable after authorization |
| `405` | `METHOD_NOT_ALLOWED` | Unsupported method; the `Allow` header lists supported methods |
| `409` | `ALREADY_SUBMITTED`, `STALE_REVISION`, `REGISTER_CONFLICT`, `VOTE_FROZEN`, `LIFECYCLE_CONFLICT`, `VOTING_CLOSED`, `RESULTS_UNAVAILABLE`, `ACTIVATION_BLOCKED` | Refresh safe state, resolve conflict, or satisfy activation blockers; never blindly retry a mutation |
| `413` | `REQUEST_TOO_LARGE` | Reduce request size within documented technical limits |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | Send the expected content type |
| `422` | `VALIDATION_FAILED`, `CODE_INVALID_OR_EXPIRED` | Correct fields or obtain a fresh code |
| `429` | `RATE_LIMITED` | Wait at least the integer seconds in `Retry-After` |
| `500` | `INTERNAL_ERROR` | Unexpected fault; restricted alert and safe support ID, no success-shaped fallback |
| `503` | `DEPENDENCY_UNAVAILABLE`, `AUTH_UNAVAILABLE`, `PROVISIONING_INCOMPLETE`, `EXPORT_FAILED`, `RESULTS_INTEGRITY_ERROR` | Temporary, partial-provisioning, or integrity-related unavailability; preserve safe state and follow outcome checks |

Do not map unexpected database failures to duplicate success. A submission error or transport failure does not by itself prove rejection: recover through participation status. Results/export integrity errors require operator investigation rather than automatic client repair.

## 7. Internal maintenance and health boundaries

### 7.1 Supabase Cron SQL maintenance

There is **no `POST /api/internal/maintenance` endpoint** in the target contract. Supabase Cron (`pg_cron`) invokes narrowly scoped SQL completion/retention functions, initially once per minute. Grant execution only to the scheduling role, not `anon`, `authenticated`, or application administrators. This path has no end-user JWT and no scheduler HTTP secret.

- Complete due votes idempotently under the same parent-row locks as submission/lifecycle operations, using the deadline as effective completion time.
- Check invariants before completion/publication; block and alert safely on mismatch.
- Run bounded cleanup batches from approved database retention settings. Never accept caller-supplied time overrides, retention periods, SQL, or arbitrary target lists.
- Never remove participation while voting remains possible; delete expired terminal vote data coherently with an atomic deletion audit.
- Keep transactions short and repeatable. Earlier completed batches remain committed if a later batch fails; surface failure operationally rather than reporting all work successful.
- Supabase owns Auth retention/session records through supported interfaces; do not add custom challenge/session cleanup SQL.
- Authorized services may perform narrowly scoped overdue reconciliation; submission admission independently enforces deadlines. Plain download responses perform no unrelated mutations.
- Database pausing stops Cron. Neither Cron nor health checks are an availability/keep-alive workaround, and downtime never extends a deadline.

### 7.2 `GET /api/internal/health`

Expose only `200` with `status: "ok"` or `503` with `status: "unavailable"` and a request ID for minimal readiness/dependency status. No account data, database/provider error details, quotas, tally snapshots, credentials, or configuration are returned. Restrict detailed monitoring to approved operators/provider tools. This route is not an alternative voting API or a periodic request intended to prevent free-tier pausing.

## 8. External services, webhooks, and verification

### 8.1 Transactional email

| Concern | Contract |
|---|---|
| Required operation | Supabase Auth delivers six-digit email OTPs through production custom SMTP |
| Provider selection | SMTP provider/host, sender domain, region, processing/retention terms, and peak capacity require approval |
| Provider authentication | SMTP credentials configured in Supabase Auth/provider settings; never available to the browser |
| Outbound data | Destination registered email, approved sender, OTP, expiry guidance, and minimal sign-in context only |
| Forbidden data | Ballots, choices, results, household registers, participation lists, PDF/CSV attachments, cookies, or session tokens |
| Response mapping | Map Auth outcomes to generic issuance/verification responses; provider acceptance never guarantees delivery |
| Delivery uncertainty | Monitor privacy-safe Auth/provider delivery failures; Supabase verification remains authoritative |

Use approved SMTP configuration, never a request-supplied host or delivery URL. Auth/SMTP network operations are outside voting transactions. Apply supported bounded timeouts; never log email content, codes, raw destination addresses, credentials, or provider bodies.

Do not blindly retry an ambiguous Auth send or build application challenge/delivery-state tables. A user-requested resend goes through the same rate-limited Auth flow; test actual provider/Auth resend behavior. Provider failures never change already accepted votes.

Built-in Supabase SMTP is for exploration, not production login capacity. Validate both SMTP and Auth project/IP/user limits against 500-household same-day bursts, retries, and sender/domain authentication. Monthly allowance alone is insufficient. Free-tier feasibility is a launch check, not a guarantee or permission to omit recovery/privacy controls.

### 8.2 Database and hosting

- Normal database calls use a server-side Supabase client carrying the verified user's session over TLS, not raw `pg` or a privileged service-role client.
- RLS and restricted grants permit only required safe reads and guarded functions. Direct Supabase REST/RPC calls must remain safe under anonymous/member/admin identities; no direct choice storage access or protected writes.
- Supabase Auth owns identity/session operations; server-only privileged clients are isolated to controlled provisioning/administration.
- Vercel is the preferred application host subject to plan eligibility, region, runtime/memory limits, and approved cost. It does not replace Supabase database/Auth hosting. Vercel Hobby Cron is not used for minute-level completion.
- Use trusted source-IP forwarding supported by Supabase for proxied Auth calls. Never trust arbitrary forwarding headers or assume all residents can safely share a server-IP Auth budget.
- Supabase Cron schedules database maintenance. Encrypted off-site backup scheduling/storage is a separate operational integration, especially on Free without automatic backups/PITR; it is not application report storage.
- When included, PDFKit renders locally with bundled fonts. No external renderer, e-signature provider, or remote font fetch is required.

### 8.3 Webhooks

**No webhook endpoint is required for the MVP.** Sign-in delivery does not require delivery-event callbacks, and no payment, messaging, or signature integration exists.

Disable unused provider webhooks; do not create an unauthenticated callback "for later." Supabase Cron executes SQL directly, not a delivery webhook or HTTP callback. Use standard custom SMTP, not an additional custom Auth send-email webhook.

If a future approved integration requires webhooks, first extend this contract with the provider-specific signature algorithm and signed raw-body format, timestamp tolerance, replay/event-ID deduplication, key rotation, allowed event schema, and bounded processing/retry semantics. IP allowlisting alone is not verification. Do not accept events until that contract and verification tests exist.

### Public contact endpoint

`POST /api/contact` does not require member authentication. It requires the same
exact Origin and CSRF cookie/token protections as other browser mutations, a
JSON body within the 16 KiB small-body cap, and the strict payload below:

| Field | Contract |
|---|---|
| `name` | Trimmed string, 1-100 characters |
| `email` | Valid email, at most 254 characters, normalized to lowercase |
| `message` | Trimmed string, 10-5000 characters; no attachments |

Unknown fields are rejected. Shared atomic budgets are 3 requests per normalized
email per hour and 30 globally per hour. Limiter failure refuses sending; these
budgets do not implement the unresolved trusted-IP release requirement.

The server posts plain text to Resend with a fixed subject, configured sender
and recipient, and the validated sender address as `reply_to`. Delivery has a
10-second timeout and a provider idempotency key derived from the request ID.
There are no automatic retries; an uncertain network result can already have
sent mail, and a later manual request has a different key. No payload or provider
diagnostic is logged. `202` with `data.message` means the provider returned a
message ID, not confirmed inbox delivery. `503 DEPENDENCY_UNAVAILABLE` covers
disabled configuration, provider rejection, timeout and malformed acceptance;
`429 RATE_LIMITED` carries `Retry-After`. Common `403`, `413`, `415`, `422`,
maintenance and method restrictions still apply. Missing all three contact
settings disables the form; incomplete settings fail startup validation.

## 9. Rate limiting and resource protection

Supabase Auth enforces its own OTP request/verification limits. Shared PostgreSQL `rate_limit_buckets` supplement those controls only where needed for application endpoint/export limits and additional request-abuse protection; they do not replace Auth. In-memory counters are not authoritative. Commit abuse accounting independently of rejected domain transactions and deny direct public API writes to buckets.

| Surface | Required enforcement dimensions |
|---|---|
| Code request/resend | Normalized-email HMAC, trusted-client-IP HMAC, resend cooldown; apply equally to unknown accounts |
| Code verification | Configured Auth attempt/request limits, trusted IP, and additional application budget where needed |
| Submission and sensitive mutations | Authenticated account, endpoint, and trusted IP as appropriate |
| Results/named-response reads | Authenticated account and bounded page size |
| PDF/CSV | Authenticated account request budget plus bounded global render concurrency and memory |
| Cron maintenance | Scheduling-role execution grants and bounded batch/concurrency limits |

Code expiry, resend cooldown, Auth request/verification limits, additional application thresholds, body/list caps, timeouts, and export concurrency are controlled operational settings, finalized and validated during the pilot. Validate both configured Auth protections and application limits before release; do not claim a custom five-attempt challenge rule or unsupported session timeout. Session policy must match the selected plan and A4 approval. Technical limits must not silently alter voting rules.

**Unresolved security release blocker:** the current application enforces email budgets for code requests/verification, but not trusted-client-IP budgets. Rotating email addresses bypasses that application dimension and can consume database/provider capacity; provider limits alone are not a substitute. Production ingress is not decided, so `TRUSTED_PROXY_CONFIG` is currently reserved and does not activate IP enforcement. Before deployment, choose the ingress, implement and test its guaranteed overwritten client-IP header, block direct-origin bypass, and verify spoofed forwarding headers cannot reset budgets. Do not trust arbitrary `X-Forwarded-For` or `X-Real-IP` values.

Return `429 RATE_LIMITED` and `Retry-After` in whole seconds when an abuse budget is exhausted. Temporary resource/dependency exhaustion may instead return `503` with appropriate retry guidance. Do not publish email-specific account existence through limiter behavior.

Application buckets store only versioned HMAC subject digests, not raw IPs or unregistered emails. Use a dedicated rate-limit HMAC key, never Supabase Auth signing material. Rotation must preserve existing enforcement windows. Expire buckets only under approved retention, without resetting live budgets.

Bound database wait time and export concurrency to preserve submission responsiveness. Rate limiting is not duplicate-vote prevention; protected transactions and uniqueness enforce integrity.

## 10. Required environment and operational configuration

Validate server configuration at startup. Store credentials in the hosting secret manager; use placeholder-only examples and exclude real environment files from source control. No secret uses a browser-visible environment prefix or appears in rendered HTML, JavaScript bundles, JSON, URLs, or logs.

| Variable | Purpose | Availability |
|---|---|---|
| `APP_ORIGIN` | Canonical origin for exact Origin/CSRF checks; HTTPS in production | Server configuration |
| `NODE_ENV` | Execution mode | Build/runtime configuration; not a secret |
| `NEXT_PUBLIC_SUPABASE_URL` | Approved Supabase project URL | Public configuration; not a secret |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public Supabase client key; use the selected SDK/project's supported publishable or legacy anon key convention | Public configuration; never a privileged key |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged Auth provisioning/administration credential, or the supported server secret-key equivalent selected for the project | Server secret; isolated from normal ballot/result clients |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI deployment/management authentication where required | Deployment-only secret; not application runtime |
| `MIGRATION_DATABASE_URL` | Reviewed Supabase migration connection where the deployment workflow uses a direct connection | Deployment-only secret; not application runtime |
| `RATE_LIMIT_HMAC_KEY` | Versioned digest key for supplemental application rate limits | Server secret |
| `LOG_LEVEL` | Privacy-safe operational logging level | Server runtime |
| `TRUSTED_PROXY_CONFIG` | Explicit trusted proxy/source-IP interpretation | Server runtime |
| `RESEND_API_KEY` | Optional contact-only Resend credential; required with both contact addresses | Server secret |
| `CONTACT_EMAIL_FROM`, `CONTACT_EMAIL_TO` | Optional bare sender/administrator email addresses; all contact settings are required together | Server-only configuration |
| `GOOGLE_ANALYTICS_ID` | Optional GA4 `G-...` identifier; privacy/contact only after opt-in | Public identifier supplied by the server; build/runtime |
| `GOOGLE_SITE_VERIFICATION` | Optional Google HTML-tag verification token | Public identifier; build/runtime |

The public-key name above is the target convention, not a reason to duplicate an existing supported anon-key variable during implementation. Public Supabase URL/key visibility is safe only with correct RLS/grants; it never replaces authorization. Privileged credentials must never use a `NEXT_PUBLIC_` prefix.

Configure SMTP host/port, approved sender, username/password or provider credential, six-digit template, OTP expiry/cooldown/limits, and allowed Auth URLs through Supabase Auth/provider configuration, not browser variables or a parallel Next.js OTP sender. The separate optional Resend sender handles support enquiries only. Configure Cron jobs/grants through reviewed Supabase migrations/operations. Application runtime does not require `OTP_HMAC_KEY`, `SCHEDULER_SECRET`, `DB_POOL_MAX`, or a raw runtime database URL. An email-send API key is required only when public contact delivery is enabled.

Manage rate-limit key versions and still-needed keys in secret management. Validate source-IP forwarding and operational thresholds; they are not client-selectable.

RWA name, timezone, policy approvals, and retention periods live in controlled database settings, not public build variables. Configure backup scheduler credentials, approved off-site encrypted storage, encryption keys, access, and expiry separately through the selected operational service; no new resident-facing API or application file storage is required. Cron roles cannot be invoked through member RPC access.

Use separate credentials, databases, and email destinations in local/test/staging/production. Local/test use synthetic identities and a local mail sink; staging uses approved test recipients. Never copy real registers, votes, or production backups into development.

## 11. Privacy, failures, and operational guarantees

### Data minimization and PRIVATE privacy

- Names, emails, household identifiers, participation, and PUBLIC responses are restricted personal data. Project only what the caller needs.
- PRIVATE choices exist transiently for validation/counter increments; never persist individual ballots, cross-office ballot identifiers, selection receipts, counter-update history, or request payloads.
- Disable body, SQL bind-parameter, cookie, token, code, email-content, session replay, and network-payload capture across application, proxy, APM, error tracker, and database instrumentation.
- Log only allowlisted event names, safe status classes, latency, and random support IDs. Never attach PRIVATE payloads to errors, audits, traces, emails, or metrics.
- Deny live tallies, tally snapshots, change feeds, and debug endpoints that enable differencing. Administrators may monitor participation only.
- Application-level anonymity does not protect against privileged infrastructure/WAL/PITR correlation, a compromised process, or inference from low turnout. Obtain A2 approval without promising cryptographic anonymity.

### Failure handling

- No email/provider dependency is involved in ballot acceptance. Database/invariant failures roll back all submission changes; durable commit precedes acknowledgement.
- No automatic client mutation retries. Handle duplicate, stale revision, lifecycle conflict, and unknown submission outcome explicitly.
- Bounded internal database retries, if used, must restart the whole transaction only for known rollback conditions; never retry an uncertain commit as though it were proven rejected.
- Email failures surface through generic account-safe guidance and restricted operational alerts. Do not claim delivery from a generic code acknowledgement.
- PDF/CSV failures never change voting records. Keep completed results available and permit a separately authorized download retry.
- Dependency outages, scheduler lag, and deployment downtime do not extend frozen deadlines.
- Unexpected faults produce safe errors and alerts, not empty results, fabricated counts, silently dropped fields, or false success.

### Retention and recovery

- Apply approved lifecycle-aware retention to application records, audit, and rate-limit data. Manage Auth retention/removal only through supported Auth controls, coordinated with stable profile/history references. Downloads retained by users cannot be remotely erased.
- Keep automated encrypted backups outside the live database with approved frequency/expiry and restricted access. On Free, arrange external scheduled exports and off-site storage; Cron alone and PDFs are not backups. Do not assume automatic backups/PITR exist on the selected plan.
- Include required Auth identities/configuration in a supported tested backup process; a default database dump may not include all Auth objects or external settings.
- Restore into isolated maintenance-only infrastructure, validate RLS/grants/RPCs/invariants and accepted-data completeness, reapply later deletion/suspension/revocation obligations, use supported Auth recovery/revocation procedures, and reconcile deadlines before access resumes. Existing JWTs must not bypass current profile restrictions.
- Do not resume an interrupted active vote with uncertain accepted data. Remain in maintenance mode and use the approved cancellation/replacement procedure where required.
- Production approval includes provider recovery objectives and demonstrated restore capability; this contract promises neither automatic deadline extensions nor unverified zero-data-loss recovery.

## 12. Contract acceptance

Implementation must demonstrate:

- Server-side authorization and Supabase RLS/grants/RPC denial through both Next.js and direct anonymous/member/admin Supabase calls, including suspended profiles with existing JWTs and administrators without voting entitlement.
- Six-digit OTP expiry/replay/limit behavior, no public signup, generic issuance, custom SMTP capacity/failure handling, SDK session refresh/sign-out, approved plan-appropriate session policy, CSRF, and supplemental shared limits.
- Retry-safe Auth/profile provisioning and identity changes, including partial failures that leave inconsistent identities blocked and never return false success.
- Revision-safe draft editing, valid activation/frozen snapshots, exact-deadline admission, and completion/cancellation races.
- Exactly one durable participation under concurrent sessions, retries, lost acknowledgements, and injected mid-transaction faults.
- No active/cancelled choice disclosure and no PRIVATE identity-to-choice leakage through ordinary storage, direct APIs/Realtime, logs, audits, CSV, or PDF when included.
- Exact agreement of completed screen/API/export counts, frozen PUBLIC identities, all-response exports, denominators, NOTA counts, candidate ties, NOTA-higher-than-candidate outcomes, and no-votes states.
- Structured errors and explicit unknown submission outcomes; export failures never return a successful partial report.
- CSV matches authoritative completed data, including PUBLIC full named lists, option/candidate ties, and early-completion label/reason. PDF tests apply only when implemented: actual approved-script rendering, full multi-page A4/grayscale output, mobile download, and recovery from failure.
- Supabase Cron completion/cleanup grants and idempotence, delayed/paused-database deadline rejection, and no unsupported availability guarantee.
- At 500 households/about 100 concurrent users, p95 page/API response under two seconds and acknowledgement within three seconds, excluding email delivery and poor client connectivity.
- Approved free-tier/hosting eligibility and capacity, peak SMTP/Auth limits, off-site backups, and tested restoration/completeness. Obtain cost approval rather than weaken integrity or recovery to meet the zero-monthly-cost objective.

Documentation alone does not satisfy these checks. Any lost/duplicate participation, partial election submission, incorrect tally, unauthorized disclosure, or PRIVATE identity-to-choice exposure blocks release.
