# Final production readiness audit

Date: 2026-10-24
Verdict: **NOT READY for real residents or binding votes**

## Scope and decision

Reviewed the implemented application against [PRD.md](./PRD.md), [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) (the actual design document), [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [API.md](./API.md), and root/documentation agent guidance.

The exercised core workflows pass. No new critical counting, atomicity or authorization defect was reproduced in the exercised scenarios. That is not proof of exhaustive security, production availability or regulatory/bylaw approval. Mandatory launch gates remain open, including a missing abuse-control implementation and external operating controls.

This audit did not change application code, deploy, migrate production, modify DNS, rotate credentials or make governance decisions. Live browser tests used the existing disposable Supabase test project and created synthetic records; they did not test real SMTP delivery or an approved production project.

## Findings and required actions

Severity reflects launch impact, not a claim that an unverified control is an exploited vulnerability.

| ID | Severity | Evidence / finding | Required action before launch |
|---|---|---|---|
| H1 | High, blocker | [Auth rate limits](../src/server/auth/rate-limit.ts) and [OTP calls](../src/server/auth/otp.ts) enforce email budgets but no trusted-client-IP budget. `TRUSTED_PROXY_CONFIG` is only configuration metadata; rotating addresses bypasses an individual email budget. The existing [release gate](./PILOT_READINESS.md) explicitly defers this implementation. | Approve ingress, enforce shared atomic IP budgets, constrain direct-origin access and supported Auth IP forwarding, and test spoofed forwarding headers, rotating addresses, bursts, shared NAT and limiter outages. Do not trust arbitrary client headers. |
| H2 | High, blocker | Real A1-A7 approvals, the session policy, retention/backup expiry and recovery objectives are not evidenced. The readiness register identifies current approvals as test fixtures only. The 14-day sliding cookie lifetime remains provisional. | Obtain and record real authority/decisions, approve the actual provider/region/session policy and retention/RPO/RTO, then initialize the isolated production settings through the protected procedures. Never copy fixture approvals. |
| H3 | High, blocker | [Deployment status](./DEPLOYMENT.md) remains prepared, not deployed: no approved production URL/project, DNS/TLS validation, production migration history, production Cron/RLS verification or hosted CI result. SMTP was deferred; actual delivery and peak capacity are unverified. | Complete an approved staging-to-production rollout with separate secrets, verified production migrations/permissions/jobs, exact canonical URLs, production HTTPS/session checks, custom SMTP/template/sender/limits and real delivered OTP evidence. Require CI and deployment approvals rather than assuming Vercel Git deployments wait for CI. |
| H4 | High, blocker | [Operations](./OPERATIONS.md) documents no configured external backup or monitoring scheduler, no completed restore from the real off-site store into a second hosted project, and generic rather than named incident responsibility. Local restore tests are not this evidence. | Schedule encrypted off-site backups and freshness/availability/Cron/submission/email alerts, test alert delivery, name owners/escalation, and perform the hosted off-site restore with the separately stored key and measured RPO/RTO. Independently establish completeness of acknowledged ballots before resuming. |
| H5 | High, blocker | Existing [HTTP measurements](./PILOT_READINESS.md) record cold list/ballot p95 **2250 ms**, above the PRD's **under 2000 ms** target. Warm figures pass, but the approved hosting plan has not been tested. This audit's passing local database test does not supersede HTTP latency. | Measure representative cold/warm server-backed journeys at launch scale on the actual host/region, including p95 acknowledgement under 3000 ms. Investigate/fix failures or obtain an explicit approved requirement change; do not silently exempt cold requests or use keep-alives as proof. |
| H6 | High, blocker | [Readiness gate 11](./PILOT_READINESS.md) records previously exposed development database/CLI credentials and rotation/revocation still open. This audit did not inspect or print credential values and cannot establish whether rotation happened externally. | Verify revocation/rotation and clean separation of production keys. Retire/reset the disposable project only under explicit authorization and after confirming it contains no required data. Record evidence without secrets. |
| H7 | High, acceptance gate | Chromium automation and axe pass selected core screens, but real iPhone Safari/Android Chrome, screen-reader, manual focus/keyboard/contrast/zoom and download/print acceptance remain open. Automated checks do not establish WCAG 2.2 AA. | Complete the manual/device checklist with named testers, dates and results; resolve core-journey failures before admitting residents. Verify available CSV/PDF on real phones and laptops; PDF may be disabled if deferring its optional acceptance scope. |
| M1 | Medium, confirmed requirement gap | [Results downloads](../src/components/votes/results-view.tsx) are ordinary download anchors. They provide no application generation-progress state, duplicate-in-progress prevention or inline recoverable export error/retry flow required by PRD section 11 and design section 15. Server export integrity/authorization is a separate control and passed exercised cases. | Implement accessible per-download progress/locking and safe error/retry while leaving results visible. Test network/render/authorization failures and both enabled formats. This is required for full requirement sign-off, not evidence of incorrect tallying. |
| M2 | Medium, test-tooling weakness | [Access-control helpers](../tests/e2e/access-control-live.spec.ts), [voting helpers](../tests/e2e/voting-live.spec.ts), [browser fixtures](../tests/e2e/support/live.ts), and [live fixtures](../tests/live/support/live.ts) contain `rejectUnauthorized: false` for their direct test database connections. These successful tests therefore do not prove database certificate verification. [Operational database tooling](../scripts/ops/database.ts) separately requires verified remote TLS. | Use verified test-provider TLS/approved CA configuration in those helpers without weakening production controls, then rerun. Keep any exceptional local-only test transport narrowly scoped; do not carry the remote bypass into deployment tooling. |
| L1 | Low, confirmed documentation drift | [Readiness section 5](./PILOT_READINESS.md) instructs a production-mode HTTP load test with `APP_ORIGIN=https://127.0.0.1:3100`; current production validation rejects it. This was reproduced with synthetic configuration. [Documentation agent guidance](./AGENTS.md) still contains scaffold-era claims that implementation/package files do not exist. | Reconcile the load recipe with the strict production-origin policy using a dedicated approved test hostname/configuration; do not disable HTTPS or weaken production guards. Update stale customization guidance through its prescribed workflow. |

## Verification performed in this audit

| Check | Actual result and limits |
|---|---|
| Unit suite | **355 passed**, 19 files. |
| Static quality | TypeScript, ESLint and repository formatting all passed. |
| Dependency advisories | `npm audit`: **0 known vulnerabilities** at audit time. This does not establish absence of unknown vulnerabilities or configuration problems. |
| Critical Chromium journeys | **12 passed**, one worker, zero retries: OPEN setup/preview; activation/freeze; early completion/reason; administrator sign-in/out; OPEN and CLOSED ballot/review/submission; hidden active results; completed screen/API/CSV/PDF agreement; CLOSED result privacy; cancellation privacy; access-token refresh/token nonexposure; resident reflow/axe/48px/200% text checks. OTP tests obtain codes administratively, not through SMTP delivery. |
| Direct application HTTP access sweep | **7 passed**, one worker, zero retries: source-discovered API coverage, signed-out denial on every protected route, Origin/CSRF enforcement, member denial on every admin route, indistinguishable inaccessible/not-found IDs, current suspension and demotion with still-valid sessions. Not a fresh audit of the target production Supabase project's grants. |
| Local capacity | **2 passed** on PostgreSQL 17.11: 500 households, 100 concurrent tasks, 20-connection pool; OPEN and five-office CLOSED submissions with exact totals, read/acknowledgement latency assertions, result/export completeness and render bounds. This is database/local rendering evidence, not a production HTTP or email capacity result. |
| Load-runbook drift reproduction | `npm run deploy:check` rejects the documented loopback production origin as expected under the new policy. |

### Evidence verified immediately before this audit

The same application revision was exercised during the preceding deployment preparation; these checks were **not rerun in this audit**:

- Production build and positive/negative injected-environment preflight with synthetic configuration.
- **225 PostgreSQL 17 integration tests**, including all 12 migrations, constraints/guards/RLS/grants, deadline/race/rollback cases, retention and encrypted restore.
- **13 Chromium foundation tests** against `next start`.
- Production HTTP checks for private caching, restrictive security headers, Secure/HttpOnly/host-only CSRF cookie, signed-out denial, wrong-Origin rejection, safe unavailable-dependency health and maintenance-mode 503 responses.
- All four PDF font binaries present in the production output trace.

Earlier browser evidence also exercised uncertain/malformed submission acknowledgements with a single accepted participation. These bounded checks do not imply every browser/live suite was rerun for this final audit.

## Requirement coverage and remaining manual proof

| Area | Evidence / remaining work |
|---|---|
| Register/admin and voting lifecycle | Current selected browser journeys plus recent integration evidence cover setup, freeze, controlled completion and historical entitlement guards. Revalidate on staging before production promotion. |
| Authentication/authorization | Current refresh/token privacy/API role/suspension/demotion checks pass. Production SMTP, actual HTTPS auth cookies, approved session policy and provider limits remain unverified. |
| Integrity and privacy | Recent integration evidence covers atomicity, exact deadline/lock admission, races, duplicates, counters-only CLOSED storage, grants and retention. Current browser/capacity checks pass. Production grants/logging/APM and recovery completeness need target-environment proof. |
| APIs and external services | Selected application APIs and Supabase test integration pass. Real SMTP, production database/configuration, canonical domain, trusted ingress, monitoring and off-site storage are open. |
| UX and states | Core selected normal/empty/validation/submission/privacy/responsive cases have automated coverage; prior failure-recovery regressions passed. M1 remains a confirmed missing export flow. No claim that every loading/error state was manually traversed. |
| Responsive/accessibility | Current resident automation and recent foundation automation pass; historical admin checks exist. Manual assistive technology, real mobile browsers and actual printing remain mandatory. |
| Performance | Current local database thresholds pass; older warm HTTP measurements pass, cold measurements miss the page/API target. Production host capacity is not established. |
| Build/deployment | Recent production build, preflight and maintenance/security-header checks pass with synthetic configuration. No production deployment, CI hosted run, migration or domain verification occurred. |
| Operations/recovery | Local encrypted restore tests pass; real automation, alert delivery, hosted off-site restore, completeness evidence and named response ownership are missing. |

## Launch decision and exit criteria

Do not admit real residents or run a binding vote. An isolated synthetic-data staging exercise is appropriate; it is not a conditional production approval.

Close H1-H7 with evidence, resolve M1 for full requirement conformance, harden the remote test TLS paths, and reconcile the stale validation recipe. Then rerun regression, authorization/privacy, staging load, delivery and recovery checks against the exact release candidate. Obtain a named final sign-off against the actual production environment, not the existence of this document.

Pilot adoption targets such as turnout and first-attempt login success are measured after an approved pilot; they are not incorrectly treated here as prerequisites to starting that pilot.

Audit-owned local database and browser servers were stopped after testing. Synthetic fixture records in the disposable hosted project are deliberately not deleted by an unapproved project reset.
