# Architecture

## 01 Scope and Governing Decisions
[PRD.md](./PRD.md) defines product behavior and acceptance criteria. [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) defines visual and accessibility behavior. This document defines the target implementation; it does not override product requirements or claim the current scaffold has already been migrated.

- One mobile-first Next.js application for one RWA, initially 500 households and about 100 concurrent users.
- Preserve **Supabase** for PostgreSQL, Auth, RLS, guarded SQL functions and scheduled database maintenance, and **Tailwind CSS** for styling.
- **Supabase PostgreSQL is the source of truth** for eligibility, accepted participation, responses, totals and audit history. On-screen results and exports are derived views, never independent editable records.
- PDF is an optional printable results export and may be deferred beyond version 1. No voting, completion or recovery operation depends on a PDF.
- OPEN and CLOSED are voting types, separate from Draft, Active, Completed and Cancelled lifecycle statuses.
- CLOSED voting provides application-level privacy under PRD assumption A2, not cryptographic anonymity against infrastructure operators.
- Obtain approval of PRD assumptions A1-A7, providers, region, retention and recovery objectives before real voting.
- No separate backend application, microservices, Redis, queue, AI, or application file storage for the MVP. Approved off-site backup storage is a separate operational requirement.

## 02 System Overview and Stack
```text
Phone / laptop browser
        |
        v
Next.js App Router + React + Tailwind
        |
Server routes/actions and server-only application services
        |
Supabase Auth + PostgreSQL
  - RLS and restricted grants
  - Guarded submission/lifecycle SQL functions
  - Frozen electorates and historical identity snapshots
  - Participation + CLOSED counters / OPEN responses
  - Cron for due completion and bounded cleanup

Supporting services:
  Custom SMTP -> resident login codes
  Encrypted off-site backups and privacy-safe monitoring
  Optional PDFKit rendering in Next.js
```

| Area | Decision |
|------|----------|
| Application | Next.js App Router, React, TypeScript, supported Node.js LTS |
| UI | Tailwind CSS, shared design tokens, accessible native controls, Lucide React |
| Database | Supabase PostgreSQL in an approved region; Mumbai is the preferred starting option if available |
| Database access | Server-side Supabase client with the verified user's session; guarded SQL RPCs for protected writes and completed results |
| Authentication | Supabase Auth email OTP with an admin-managed register and custom SMTP |
| Validation | Zod on requests/forms plus database constraints and function validation |
| Maintenance | Supabase Cron (`pg_cron`) calling narrowly scoped SQL maintenance functions |
| Exports | CSV in version 1; optional PDFKit in a Node.js server route, not an external PDF service |
| Hosting | Vercel is the preferred starting option, subject to plan eligibility, region, runtime limits and cost validation |
| Testing | Vitest, real Supabase/PostgreSQL integration tests, Playwright and axe |
| Observability | Allowlisted application events and provider metrics without sensitive payload capture |

Pin supported dependency versions in a lockfile and review licenses/advisories. Do not introduce an ORM, custom authentication system or generic repository framework without a demonstrated need.

## 03 Application Boundaries
1. **Presentation:** Pages/layouts, ballots, review/confirmation, participation feedback, results and optional downloads.
2. **HTTP boundary:** Same-origin route handlers or server actions validate identity, origin, input and permissions, then translate domain outcomes into safe responses.
3. **Application services:** Register, authorization, lifecycle, submissions, result projections, exports and audit coordination.
4. **Persistence:** Supabase clients, SQL migrations, constraints, RLS and narrowly scoped database functions.
5. **Adapters:** SMTP configuration, export rendering and privacy-safe operational logging.

- Server-render initial data through the same services used by endpoints, not internal HTTP calls to the application itself.
- Mark protected services and clients server-only. Never serialize full database entities and rely on hidden UI to protect fields.
- Browser voting reads/writes go through Next.js. This is a boundary for the application, not a substitute for database permissions: assume someone can call the Supabase API directly.
- Use the user's verified session for normal database calls. Never use a service-role client to bypass eligibility or obtain live tallies.
- Validate state-changing request origins and apply anti-CSRF protection appropriate to the route/action. Do not rely on hidden buttons, middleware alone or broad CORS.
- Authenticated pages, APIs and exports use private, no-store behavior; disable shared Next.js/CDN caching for protected data.
- Keep unsent selections in page memory only, never URLs, browser storage, persistent drafts, service workers or telemetry. Clear them after acknowledged submission, sign-out or access revocation.
- Disable repeat clicks for UX, but rely on database transactions for correctness. Never optimistically acknowledge a ballot.
- Follow the existing design system: 48px touch targets, at least 16px input text, visible labels/focus, keyboard access and WCAG 2.2 AA. Test phone widths of 320-430 CSS pixels and laptop widths of 1280-1440.

## 04 Target Project Structure
This is the migration target, not a description of already completed changes. Retain existing feature directories where practical; create helpers only when needed.

```text
src\
  app\
    (access)\
    (member)\
    admin\
    api\
      auth\
      votes\
      admin\
      internal\
  components\
    ui\
    votes\
    admin\
  server\
    auth\
    authorization\
    register\
    votes\
    results\
    exports\
    audit\
    db\
    observability\
    config\
  shared\
    contracts\
    validation\
  styles\
    globals.css
public\
  fonts\
supabase\
  migrations\
  config.toml
tests\
  unit\
  integration\
  e2e\
  fixtures\
docs\
```

Keep Supabase user-session and privileged provisioning clients separate. Do not introduce a second frontend/backend package or speculative abstraction layers.

## 05 Data Model and Database Permissions
Use stable identifiers, foreign keys, nonnegative counter constraints, explicit state checks and UTC `timestamptz` values. Store the RWA's IANA timezone for input/display.

| Record | Responsibility |
|--------|----------------|
| Supabase `auth.users` | Managed authentication identity; do not replace with custom OTP/session tables |
| `profiles` | Stable auth-user reference, representative name, current application role and suspension status |
| `households` | Unique normalized household identifier, current representative and eligibility |
| `rwa_settings` | RWA name/timezone, approved policies, retention settings and approval metadata |
| `votes` | Voting type, separate lifecycle state, ballot metadata, frozen deadline, activation/effective completion timestamps, revision and terminal reasons |
| `offices`, `candidates`, `poll_options` | Ordered choices with ownership constraints tying them to the correct vote/office |
| `electorate` | Unique vote/household entitlement with frozen representative and name/household snapshots |
| `participation` | One accepted submission per frozen entitlement; no CLOSED choices |
| `open_responses` | One option per accepted poll response, linked to the frozen entitlement |
| `closed_tallies` | Candidate and abstention counters per office; no per-ballot rows or selection timestamps |
| `audit_events` | Administrative actor/action/record/time/reason, never codes or vote payloads |
| Application rate limits | Shared, atomic counters where application-level limits are needed beyond Auth limits |

### Permission rules
- Enable RLS on all application tables; revoke unauthenticated application-data access and unnecessary table/function privileges.
- Deny direct client access to choice storage, including authenticated admin access. Expose completed data through authorized, completion-gated projections.
- Do not expose private tables through Realtime publications or change feeds. Members cannot inspect others' active participation.
- Members cannot update role, suspension, electorate, participation, counters or audit records directly. Never trust a role supplied in user-editable Auth metadata.
- Guard register/draft mutations with admin checks and enforce frozen configuration in the database, not only the service.
- Separate migration-owner privileges from runtime access. Function owners use restricted non-login roles with only the required privileges.
- For `security definer` functions, fix `search_path`, schema-qualify references, revoke default public execution and grant only required callers. Explicitly validate `auth.uid()`, current profile status, capability and frozen entitlement inside each user-callable function.
- Never accept an account/household identifier from the request as proof of identity. User-facing functions derive identity from the verified JWT context.
- Cron runs a separate maintenance entry point with no end-user JWT; grant it only to the scheduling role. Do not make maintenance callable by normal users.

Admin status grants administrative access, not voting entitlement or access to individual CLOSED choices. Supabase dashboard/database operators are privileged infrastructure operators, not application admins.

## 06 Authentication, Register and Sessions
- Disable public sign-up. Use Supabase Auth email OTP with `shouldCreateUser: false` for login and a six-digit code template using `{{ .Token }}`.
- Admin provisioning creates the Auth identity and associated profile/household assignment through controlled server-only code. Auth and application-record changes are not one cross-service transaction: use a retry-safe provisioning workflow, surface partial failure, and do not grant access until the application assignment is valid.
- Bootstrap the first admin through a controlled deployment command against an approved address; no public bootstrap endpoint or default credentials.
- Normalize emails using one documented policy without provider-specific rewriting. Reject duplicate household IDs and ambiguous representative assignments.
- Return generic code-request acknowledgements without revealing registration. Invalid/expired codes get actionable retry guidance without exposing account existence.
- Configure custom SMTP, expiry, resend cooldown, attempt/request limits and sender authentication. Never log OTPs or email contents.
- Use `@supabase/ssr` for the Next.js cookie/session integration. Verify identity server-side using supported Auth verification methods; do not trust an unverified cookie session object as authorization.
- Apply secure cookie settings and the SDK's supported refresh behavior. Do not invent a parallel opaque-session system or claim all SDK cookies are HttpOnly without validating the chosen integration.
- Check current application suspension/role on each protected operation and inside guarded database functions. A still-valid JWT must not bypass suspension or changed entitlement.
- Implementation: `src/proxy.ts` refreshes an expiring session before render (Server Components cannot set cookies) and forwards the new cookies to the page and browser; this is session upkeep, not authorization. Session cookies are hardened in one place (`src/server/auth/session-cookies.ts`): HttpOnly, SameSite=Lax, Secure in production, capped at 14 days as a sliding inactivity window (provisional until A4).
- Sign-out and administrative Auth actions do not necessarily invalidate every issued JWT immediately. Enforce application access independently and test existing-token scenarios.
- Native time-boxed sessions, inactivity limits and single-session enforcement require Supabase Pro or higher. Do not promise those controls on Free; approve the persistent-session policy under A4.
- Server-proxied Auth calls must follow Supabase's supported trusted-IP forwarding configuration where needed. Never trust arbitrary client forwarding headers or let all residents accidentally share an untested server-IP limit.
- Privileged Auth credentials remain server-only and isolated to provisioning/administrative Auth operations. Never use them for ordinary ballots, results or exports.

## 07 Atomic Voting and CLOSED Privacy
Each `cast_vote` call performs one guarded PostgreSQL transaction:
1. Lock the vote row using the same lock order as lifecycle operations.
2. Recheck the authenticated profile's status, frozen representative entitlement, voting type and Active state.
3. Check the current database clock after acquiring the lock, immediately before acceptance. Require time strictly before the frozen deadline; use a current clock reading rather than transaction-start `now()`.
4. Check unique participation and validate the complete ballot: exactly one poll option, or one valid candidate/explicit abstention for every office. Reject missing/repeated offices, extra input and choices belonging to another vote/office.
5. Insert participation and either one OPEN response or all CLOSED counter increments atomically.
6. Commit durably, then acknowledge participation only. Never return CLOSED selections.

- Any failure rolls back participation and every response/counter update. Unique constraints remain the last defense against concurrent retries.
- Acquire subordinate locks in stable order. Serialize completion/cancellation on the same vote row.
- A request arriving before the deadline but waiting past it is rejected. A transaction admitted before the deadline may commit afterwards; click time and HTTP arrival do not reserve acceptance.
- Per-vote serialization is deliberate at this scale, but must pass contention/load tests rather than being assumed fast enough.
- If acknowledgement is lost, the UI checks own participation. If that also fails, show an unknown outcome, not false rejection or success.

### Privacy boundary and limitations
- Store aggregate CLOSED counters, not individual ballots, cross-office ballot identifiers or correlatable per-response timestamps alongside choices.
- Keep participation separate, while updating it in the same transaction as counters. This prevents ordinary stored identity-to-choice mappings; it is not a proof of cryptographic anonymity.
- Disable vote/auth payload capture in application, proxy, APM, error reporting and SQL-parameter instrumentation. Never record selections in receipts, audit events, URLs or notifications.
- Deny active tally snapshots, debug dashboards and change feeds that could permit differencing.
- Database WAL, backup comparisons, privileged instrumentation or a compromised application process may reveal counter changes and transaction relationships. Small/unopposed elections may permit inference from final totals.
- Document and obtain A2 approval for these limits. Stronger secrecy requires a separately approved cryptographic design, not a toggle on this schema.

## 08 Lifecycle, Maintenance and Counting
### Draft and activation
- Use draft revision checks to prevent lost edits and stale preview confirmations.
- Activation atomically revalidates the previewed revision, freezes ballot content/deadline/electorate/representative assignments and relevant display metadata, initializes counters, changes state and appends audit history.
- Later register edits affect future votes only. Suspension may block access but does not transfer an active entitlement or remove accepted votes.

### Completion and cancellation
- Only Draft -> Active -> Completed and Active -> Cancelled are supported. Terminal votes never reopen.
- Schedule idempotent due completion through Supabase Cron, initially once per minute. It uses the same guarded lifecycle logic and vote-row locks.
- Authorized service reads may invoke narrowly scoped overdue reconciliation before fetching state/results; plain download responses must not perform unrelated mutations.
- Submission deadline checks remain authoritative even if Cron is delayed or unavailable. Database pausing prevents Cron from executing; Cron is not a keep-alive guarantee.
- Scheduled completion records the deadline as effective completion time, not job execution time.
- Early completion requires confirmation/reason and is labelled in results/exports. Cancellation requires a reason; reconcile overdue state before deciding whether an Active transition is still allowed.
- Cancelled votes display "Cancelled; results not valid" without publishing choices or enabling exports. Correct an invalid active vote by cancellation/replacement, not edits.
- Outages never automatically extend deadlines.

### Results
- Hide all choice totals until completion, including from admins. Apply the same authorization to pages, API and exports.
- Use one consistent result projection/snapshot for completed screens and CSV, plus PDF when implemented.
- Frozen eligible households form the turnout denominator, including households later suspended.
- Submitted ballots equal accepted participation. Per office, candidate counts plus abstentions equal submitted ballots; OPEN responses and option totals equal submitted ballots.
- Candidate/abstention percentages use submitted ballots; poll percentages use accepted responses. Show explicit denominators and a not-applicable zero-denominator state.
- Use one rounding policy without changing raw counts to make percentages sum to 100.
- Zero ballots have no winner. Tied positive leaders are marked "Tie"; abstention is not a candidate. Apply the proposed all-abstain "No candidate elected" rule only after A5 approval.
- Check invariants before publishing results/exports. A mismatch blocks publication and triggers a safe operational alert; never silently fabricate or repair totals.
- OPEN names and household labels come from frozen snapshots. CLOSED results never expose voter lists or individual ballots.

## 09 API and Error Contracts
Use same-origin endpoints and explicit response projections. Server actions may share the same services; do not create duplicate business logic.

| Endpoint group | Responsibility |
|----------------|----------------|
| `POST /api/auth/code`, `/verify`, `/sign-out` | Request/verify OTP and manage Auth session |
| `GET /api/votes`, `GET /api/votes/{id}` | Authorized summaries and ballot detail, no active totals |
| `GET /api/votes/{id}/participation` | Own accepted/not-submitted status |
| `POST /api/votes/{id}/submission` | Complete final ballot, participation-only response |
| `GET /api/votes/{id}/results` | Completed, authorized, reconciled results |
| `GET /api/votes/{id}/exports/{format}` | CSV; PDF only when implemented |
| `/api/admin/households`, `/api/admin/votes` | Admin register, lists and revision-checked draft operations |
| `POST /api/admin/votes/{id}/{action}` | Validated activation, early completion and cancellation |
| `GET /api/admin/votes/{id}/participation` | Admin participation monitoring without selections |
| `GET /api/admin/audit` | Paginated audit history |
| Internal health | Minimal dependency status without secrets/member data; not a pausing workaround |

- Match existing routes where practical and reconcile [API.md](./API.md) during implementation; these are target responsibilities, not a claim of current endpoint availability.
- Bound body/string/list sizes and paginate register/audit/named-response screens. Exports include the complete authorized dataset, not just the displayed page.
- Use stable error codes, safe messages, optional safe field errors and random support IDs. Never echo ballot choices in errors.
- Use 401 for unauthenticated, 403 for denied capabilities, 404 for inaccessible vote IDs, 409 for duplicates/stale revision/lifecycle conflicts, 422 for validation, 429 for limits and 503 for temporary dependencies.
- Distinguish unknown submission outcome from rejection. A duplicate response directs the UI to confirm participation.
- Loading, empty and failure states remain explicit; no broad catches returning empty results or success-shaped defaults.

## 10 Exports
- CSV is in scope for version 1. PDF may be deferred; hide unavailable controls and do not block pilot readiness for an unimplemented PDF feature.
- The database is authoritative. Exports are generated on demand from completed results; do not store public report files, editable report copies or bearer download URLs.
- Recheck authorization and completion for every download. Use attachment disposition, safe filenames, correct MIME types, `nosniff` and `no-store`.
- OPEN exports include the full authorized named-response list without emails. CLOSED exports contain aggregate data only, never household/voter lists.
- Escape CSV values and neutralize spreadsheet formulas in user-controlled text.
- When PDF is added, render with PDFKit in a Node.js server route using bundled fonts per the design system. Verify approved script coverage and actual rendering, not just font presence.
- Include RWA/title/type, ballot labels, activation/effective completion times and timezone, turnout/denominators, totals, abstentions/ties/no-votes, generation time and early-completion reason where applicable.
- Support readable A4 portrait/grayscale, wrapped long text, repeated headers, page numbers and complete multi-page lists at the maximum electorate.
- Bound export concurrency and memory; finish rendering before returning success. Generation failure must not deliver a partial success document or mutate votes.
- PDFs are neither database backups nor signatures/certifications. Signature-replacement workflows are not a version 1 requirement. Downloaded/printed copies cannot be remotely revoked.

## 11 Free-Tier Feasibility and Hosting
The following planning values were checked against official documentation on 2026-10-24. Revalidate pricing, quotas and plan terms before deployment; these are not application guarantees.

| Supabase Free capability | Planning allowance / limitation |
|--------------------------|--------------------------------|
| PostgreSQL | 500 MB database, shared CPU and 500 MB RAM |
| Auth | 50,000 monthly active users; email OTP and custom SMTP configuration available |
| Core database features | RLS, constraints, transactions, SQL functions and Cron available |
| API | Unlimited API requests does not imply unlimited throughput |
| Bandwidth | 5 GB egress and separate 5 GB cached-egress allowance; private voting data must not be publicly cached |
| Storage | 1 GB; not required for application ballots or on-demand reports |
| Edge Functions | 500,000 included invocations; not required by this Next.js architecture |
| Hosted projects | Two active Free projects; use the local stack for routine development |
| Availability | Free projects may pause after one week of inactivity; no keep-alive availability promise |
| Recovery | Automatic backups and PITR not included |
| Sessions | Native time-boxing, inactivity timeout and single-session enforcement require Pro or higher |

### Email
- Built-in SMTP is for exploration: currently two emails/hour and restricted to project-team addresses. Configure production custom SMTP even on Free.
- Validate both SMTP-provider capacity and Supabase Auth project/IP/user limits, including same-day login bursts, retries, sender/domain verification and delivery failures.
- For example, Resend Free currently provides 3,000 emails/month but only 100/day; that cannot accommodate 500 fresh same-day logins. Do not select a provider solely by monthly volume.
- Existing sessions reduce demand but are not a substitute for sufficient peak capacity. Provider selection remains subject to approval; do not hard-code an unverified free quota.

### Hosting and readiness
- Tailwind CSS is a build-time library with no hosted per-user/request fee; paid component products are unnecessary.
- Vercel Hobby restricts use to personal/non-commercial projects. Confirm eligibility for the RWA deployment.
- Hobby Cron runs at most daily with per-hour scheduling precision; do not use it for minute-level completion. Use Supabase Cron instead.
- Choose the application/database region deliberately and test latency, function runtime/memory, export execution and rate limits. Supabase is not the Next.js application host.
- Free is appropriate for development and potentially a controlled pilot after load, email and recovery validation. It is not a guarantee of 100-user concurrency, election uptime or zero-data-loss recovery.
- Supabase Pro starts at $25/month and includes daily backups with seven-day retention and no inactivity pausing. PITR is separate; neither a paid plan nor daily backups alone prove completeness of acknowledged votes.
- Approve cost changes rather than weakening integrity or backup requirements to preserve the zero-cost objective.

Sources: [Supabase pricing](https://supabase.com/pricing), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Auth limits](https://supabase.com/docs/guides/auth/rate-limits), [sessions](https://supabase.com/docs/guides/auth/sessions), [Cron](https://supabase.com/docs/guides/cron), [backups](https://supabase.com/docs/guides/platform/backups), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Resend pricing](https://resend.com/pricing).

## 12 Configuration, Operations and Recovery
- Validate required configuration at startup; fail explicitly for unsafe/missing production settings.
- Keep canonical application origin, Supabase URL/public client key, server-only privileged credentials and SMTP settings in appropriate environment/provider configuration. The Supabase URL and public key are not secrets; privileged credentials must never use a browser-visible prefix.
- Store RWA timezone, policy approvals and retention settings in controlled database records. Block real activation until required approvals are recorded.
- Keep local/test/staging/production data and credentials isolated. Use synthetic data and local mail capture; never copy production registers, ballots or backups into development.
- Enforce HTTPS, secure cookies, restrictive CSP, frame denial, MIME protection and safe origin handling. Limit export concurrency and untrusted text input.
- Monitor availability, submission failure/latency, invariant failures, Cron lag, database capacity, email and export failures. Disable session replay and payload capture; log allowlisted event classes and random support IDs only.
- Keep automated encrypted backups outside the live database with restricted credentials/access and approved expiry. On Free, arrange an external scheduled export and off-site storage; database Cron alone is not an off-site backup.
- Back up application records, required Auth identities and necessary configuration through a supported, tested process. Do not assume a default dump includes every Auth object or external setting. Protect dumps as sensitive identity/participation data.
- Approve recovery-point/recovery-time objectives, backup frequency and incident responsibilities. Test restoration and permissions before real voting.
- An internally consistent backup can still omit acknowledged votes. After an incident, keep the application in maintenance mode until completeness, uniqueness and counters/responses reconcile.
- If accepted-data completeness is uncertain, do not resume or silently edit totals. Follow an approved incident/cancellation/replacement process; do not invent a terminal-state reopening path.
- Restore current suspension/deletion obligations before allowing access. Apply retention coherently across related records and backup expiry; never delete participation while voting remains possible.
- PDFs do not restore entitlements, Auth identities, participation or counter integrity and must never substitute for database recovery.

## 13 Testing and Release
| Layer | Required evidence |
|-------|-------------------|
| Unit | Validation, roles/type/state, percentages/rounding, ties/no-votes and approved all-abstain behavior, error/result projections |
| Supabase integration | Real migrations, RLS/grants, direct API/RPC denial, guarded functions, Auth context, frozen entitlement, rollback and lifecycle races |
| Concurrency | Double-submit/multiple devices, injected failure midway through counters, lock waits crossing deadline, exact-deadline rejection |
| Auth/authorization | OTP limits, no account enumeration, provisioning failure/retry, suspension with existing JWT, role changes, admin without entitlement |
| Browser | Both voting types, mobile admin/member journeys, review/confirmation, lost acknowledgement, unknown outcome, results and CSV |
| Privacy | HTML/API/errors/logs/ordinary records expose no CLOSED identity-to-choice mappings or active tallies |
| Accessibility | Axe plus manual keyboard/focus/screen-reader/zoom checks; 48px targets and specified viewport widths |
| Exports | CSV matches authoritative results; if PDF is included, full multi-page/approved-script/A4/grayscale and failure-recovery checks |
| Performance/recovery | 500 households/100 concurrent users, p95 page/API under two seconds and acknowledgement within three seconds; restored-data reconciliation |

- Use real Supabase/PostgreSQL, not SQLite or transaction mocks. Test under anonymous/member/admin identities and direct Supabase calls as well as the Next.js layer.
- Test a committed ballot whose HTTP acknowledgement is lost. Verify current-clock deadline checks after lock acquisition.
- Exercise Chromium, Firefox and WebKit automation plus real mobile Safari/Android Chrome and laptop checks.
- CI runs locked dependency restore, formatting/lint, type-check, unit/integration tests, production build and focused browser tests.
- Apply migrations with deployment-only credentials, not on each application start. Use compatible schema changes; avoid counting/submission changes during active votes.
- **Pilot readiness:** Required A1-A7/provider approvals, integrity/privacy/accessibility/performance evidence, email capacity, backup restoration and CSV must pass. PDF checks apply only if PDF is included.
- **Pilot evaluation:** Measure setup/voting speed, first-attempt login, unaided completion and turnout without collecting selections. Do not make real-pilot measurements a prerequisite for starting that same pilot.
- **Wider rollout:** Review pilot findings, operational capacity and fixes. Lost/duplicate/partial/late ballots, wrong totals or unauthorized disclosure block release.
- Roll back application code only when schema-compatible. Never restore an old database merely to undo a deployment after accepting votes.

## 14 Migration and Future Growth
### Migration from the current scaffold
1. Reconcile [DATABASE.md](./DATABASE.md), [API.md](./API.md) and [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) with this target as the corresponding phases are implemented. Preserve PRD business guarantees. This architecture governs stack choices, not permission to override the PRD.
2. Add `@supabase/supabase-js`, `@supabase/ssr`, Tailwind and its supported PostCSS integration, and Lucide React. Preserve existing token values and accessible behavior during the CSS Modules conversion.
3. Create reviewed migrations under `supabase\migrations`, adapting existing SQL to Auth-linked profiles, grants, RLS and guarded functions. Do not merely move old migrations unchanged.
4. Replace custom OTP/session runtime code with Supabase Auth. If real data exists, plan identity mapping and historical-reference preservation explicitly; do not assume existing accounts can be dropped.
5. Replace raw `pg` runtime access with user-session Supabase clients and RPCs. Remove old dependencies/modules only after all callers are migrated and validated.
6. Configure SMTP, Cron, grants, backup automation, environment examples and provider limits. Retain PDF tooling only if needed; its presence does not make export mandatory.
7. Validate in staging with synthetic data, then schedule cutover outside active votes. No real election should straddle an unvalidated storage/Auth migration.

### Growth
- Measure indexes, query plans, RPC contention and capacity before adding infrastructure. Upgrade operational capacity before redesigning locking.
- Additional application instances remain stateless; PostgreSQL is the shared coordination point.
- Introduce report queues/private artifacts only if measured export size/concurrency requires them.
- Multi-RWA support, stronger cryptographic secrecy, native apps, signatures and complex voting rules require separately approved product/architecture changes.
