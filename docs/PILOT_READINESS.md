# Pilot readiness: evidence and open gates

The plan (docs/IMPLEMENTATION_PLAN.md, phase 16) separates **readiness** (must be proven before any real voter is admitted) from **pilot evaluation** (measured afterwards). This file records, honestly, what is proven by automated evidence in this repository and what still needs a person, a device, a decision or a real environment. **Nothing in the "open" column may be ticked by a developer alone.**

Legend: ✅ proven here by an automated check you can re-run · 🟡 partly proven, remainder open · ⬜ open (needs people, devices, approvals or a real environment).

## 1. Automated regression and security evidence

| Gate (plan task)                                         | State | Evidence and how to re-run                                                                                                                                                                                                 |
| -------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locked dependency restore, format, strict types, lint    | ✅     | `npm ci`, `npm run format:check`, `npm run typecheck`, `npm run lint`. Dependencies are pinned to exact versions with a lockfile.                                                                                          |
| Dependency advisories                                    | ✅     | `npm audit` reports 0 vulnerabilities (re-run before release; advisories change daily).                                                                                                                                    |
| Unit tests                                               | ✅     | `npm test`                                                                                                                                                                                                                 |
| Real-database integration (PostgreSQL 17.11, as Supabase) | ✅     | `npm run test:integration` with `INTEGRATION_DATABASE_URL` (docs/LOCAL_SETUP.md, section 10). Includes the guards, RLS and grants, concurrency, retention, restore rehearsal (needs `PG_BIN_DIR`). |
| Real Supabase Auth / PostgREST / RLS                      | ✅     | `npm run test:live`, including `tests/live/rest-privacy.live.test.ts` (below).                                                                                                                                            |
| Build                                                    | ✅     | `npm run build`                                                                                                                                                                                                            |
| Browser suites, Chromium                                 | ✅     | `LIVE_AUTH=1 npx playwright test --project=chromium --workers=1`                                                                                                                                                          |
| Browser suites, Firefox                                  | ✅     | The foundation and resident/admin voting journeys (26 tests) pass: `--project=firefox tests/e2e/foundation.spec.ts tests/e2e/voting-live.spec.ts`.                                                                          |
| Browser suites, WebKit (Safari engine)                   | 🟡     | The same 26 pass **except** two steps the automated WebKit build cannot do (Tab to the skip link; keyboard operation of radios), which are skipped for WebKit and are on the real-Safari checklist in section 3. Running WebKit found a real bug, fixed: text typed or chosen before the page finished loading was lost (the sign-in email, the ballot choice). |
| Direct Data API as anonymous / member / administrator / suspended member | ✅ | `tests/live/rest-privacy.live.test.ts` against the hosted project: every table denied to anonymous callers; every routine denied to anonymous callers; choices, counters, settings and rate buckets unreadable by any signed-in role including an administrator; the audit log readable by administrators only; participation rows (vote, household, acceptance time, no choice) readable only by their owner or an administrator; a member sees only their own entitlement; no API role has a write privilege; a still-valid token of a suspended member is refused on every vote path; nothing is published to Realtime; the hosted privileges equal the migrations (the platform's default privileges did not add anything). |
| Privacy of choices in rendered HTML, URLs, storage, errors, CSV, PDF | ✅ | Browser tests assert no selection in the page, URL, storage or JSON after submission; CLOSED results, CSV and PDF contain no names or households; OPEN exports contain no emails.                                         |
| Exact agreement of screen, API, CSV and PDF               | ✅     | `tests/e2e/voting-live.spec.ts` (“the screen, the API and the CSV agree exactly”, which also reads the downloaded PDF).                                                                                                     |
| Core journeys accessible (WCAG 2.2 AA, automatic part)    | 🟡     | axe at 320/375/768/1280 px, 48 px targets, 200% text, keyboard operation of the ballot (Chromium, Firefox) on every resident and administrator screen. The manual part is open (section 3).                                  |
| Backup and restore rehearsal                              | 🟡     | `tests/integration/restore.test.ts` (encrypted backup, verification, restore into a separate database, reconciliation, tampering, lost ballot, elapsed deadline, recovery record) and one real backup of the hosted project. Open: restore of the hosted project into a second project from the real off-site store (docs/OPERATIONS.md, section 5). |
| Retention                                                | ✅     | `tests/integration/maintenance.test.ts`; the Cron job `civic-pulse-maintenance` is scheduled on the hosted project.                                                                                                        |

## 2. Capacity (500 households, about 100 concurrent users)

Targets (provisional, from the plan): p95 under **2 s** for pages and API calls, acknowledgement of a submission under **3 s**.

**Database half, local PostgreSQL 17, 500 households, 100 requests in flight through a 20-connection pool** (`npm run test:load`, `tests/load/db-capacity.test.ts`; no network, so this shows locking and query behaviour only):

| Operation (all with 100 in flight)           | p50      | p95      | Notes                                                    |
| -------------------------------------------- | -------- | -------- | -------------------------------------------------------- |
| Submit an OPEN ballot (one shared vote)      | 96 ms    | 152 ms   | 500 accepted, exactly once each                          |
| Submit a CLOSED ballot (5 offices, shared counters) | 341 ms | 457 ms | Every office's counters add up to exactly 500            |
| Open ballot / own status / list votes        | 51–58 ms | 85–232 ms |                                                         |
| Administrator participation (during the burst) | 77 ms  | 159 ms   |                                                          |
| Repeat submission (refused)                  | 26 ms    | 44 ms    | Nothing changes                                          |
| Results page (50 named) / all 500 for export | 84 / 27 ms | 92 / 31 ms |                                                      |
| CSV render, 500 names                        | 2 ms     |          |                                                          |
| PDF render, 500 names (17 pages)             | about 1 s |         | Single-threaded CPU; two renders at a time, others queue |

**HTTP half, production build (`next start`, behind a local TLS front) against the hosted free-tier project, from this laptop over the corporate network** (`tests/e2e/load-live.spec.ts`, 24 signed-in members reused, 100 requests in flight; see section 5):

| Operation                                       | n  | p50      | p95      |
| ----------------------------------------------- | -- | -------- | -------- |
| Submit a ballot (24 at the same moment, plus background reads) | 24 | 1613 ms | 1657 ms |
| Repeat submission (refused, 409)                | 24 | 446 ms   | 532 ms   |
| Vote list / ballot (warm)                       | 72 | 1096 ms  | 1165 ms  |
| Vote list / ballot (**cold** first pass)        | 72 | 2153 ms  | 2250 ms  |
| Own participation status (during the burst)     | 72 | 1394 ms  | 1463 ms  |
| Results (completed vote)                        | 72 | 926 ms   | 1006 ms  |
| CSV download                                    | 24 | 295 ms   | 317 ms   |
| PDF download                                    | 24 | 850 ms   | 1285 ms  |

All warm figures meet the targets (p95 < 2 s, acknowledgement < 3 s), the totals were exact afterwards, and no request answered an unexpected status. The **cold** first pass is slightly over 2 s: a server that has just started, with connections not yet open, is slower for its first few seconds. Each request makes several sequential round trips to the hosted project (session check, profile, rate limit, then the routine), so these numbers are dominated by distance to the database, and will differ on the real hosting plan. The first two runs of this test also found that export downloads were being refused with 503 when more than four were rendering at once (the limit counted the database wait, not just the CPU work); that was fixed by queueing instead of refusing (`src/server/exports/semaphore.ts`).

What this does **not** show: behaviour on the real hosting plan, from phones on mobile networks, with real Auth peak limits (hosted Auth limits token verifications per IP, so a pool of 24 signed-in members is reused), or with real emailed codes. ⬜ Repeat on the chosen hosting plan once it exists.

## 3. Open gates: people, devices, approvals, environments

None of these can be completed by code. Record the evidence (date, who, result) next to each.

**Security release blocker:** production ingress is undecided and trusted-client-IP rate limiting is not implemented. The email-only budgets can be bypassed by rotating addresses. Do not release until the selected proxy's client-IP guarantees, direct-origin restrictions, limiter implementation and spoofing/burst tests are complete. Merely setting `TRUSTED_PROXY_CONFIG` does not enable this control.

Operational remote database connections now require verified TLS, and backup manifests are validated before use. The real provider CA/hostname and off-site backup/restore path still need deployment evidence; local integration tests do not establish that evidence.

| #   | Gate                                                                                                                                                                                  | State |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | Real approvals **A1–A7**, provider and region, recorded by the real approving authority (today they exist only as **fixtures on the disposable project**)                               | ⬜     |
| 2   | Approved session policy (the app caps the session cookie at 14 days of inactivity as a provisional default; confirm or change it, and decide whether Pro-tier idle/absolute timeouts are needed), all-abstain wording (A5) and early-completion rule, retention periods and backup expiry, RPO/RTO                                                                | ⬜     |
| 3   | Custom SMTP provider with enough sending/peak capacity, and its Auth limits (Gmail was deferred; the built-in hosted mail cannot carry a code to arbitrary users)                      | ⬜     |
| 4   | Hosting plan eligibility and cost, TLS, trusted-proxy configuration (`TRUSTED_PROXY_CONFIG`; the per-IP limiter is not implemented until this is approved)                              | ⬜     |
| 5   | Real-device checks: Safari on iPhone, Chrome on Android, and the supported laptop browsers (including keyboard use of radios and the skip link in Safari), CSV and **PDF** download and print on real phones and a laptop | ⬜     |
| 6   | Manual accessibility: screen reader (VoiceOver, TalkBack, NVDA), keyboard-only, forced contrast, reduced motion, 200–400% zoom on the core journeys                                      | ⬜     |
| 7   | Backup to the real off-site store with the real key, then a **full restore of the hosted project into a second project** and a documented RPO/RTO                                       | ⬜     |
| 8   | Incident owner, committee decision-maker and escalation route named in docs/OPERATIONS.md, section 6                                                                                    | ⬜     |
| 9   | Deployment through staging to production on the approved plan; smoke test with synthetic data; migrations applied outside any active vote                                               | ⬜     |
| 10  | Load test repeated on the real plan                                                                                                                                                   | ⬜     |
| 11  | Key and credential hygiene: the database password that was shown in a chat earlier and the CLI access token must be rotated or deleted; the disposable project reset or deleted        | ⬜     |

## 4. Pilot evaluation (after the gates above, with real residents)

Run at least one real OPEN poll and one real CLOSED election, then measure **without recording anyone's selection**:

| Measure                                                        | Target            | How                                                                                          |
| -------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| Administrator setup of a vote                                  | under 10 minutes  | Time from "New vote" to "Activate", observed on a phone, once per administrator.               |
| First-attempt sign-in success                                  | at least 90%      | Count residents who signed in on the first try over those who tried; non-attempts counted separately. |
| Unaided sign-in and first submission                           | at least 90%      | Observed or surveyed; no helper intervention.                                                |
| Median ballot-open to acknowledgement on a phone               | under 60 seconds  | Timed with consenting volunteers, never from selection data. The app deliberately collects no telemetry. |
| Turnout (adoption target)                                      | at least 60%      | From the turnout figure on the results page. Reported separately from correctness.           |
| Cost                                                           | zero-monthly-cost feasibility | Reported separately.                                                                |

No adoption or budget target excuses an integrity or privacy failure. A lost, duplicate, partial or late-admitted ballot, a wrong tally, unauthorised disclosure, a CLOSED identity-to-choice exposure, or unknown completeness after a recovery blocks release.

## 5. Running the HTTP load test

A production server insists on an HTTPS origin, so put a TLS front in front of `next start`:

1. `npm run build`, then start `next start --hostname 127.0.0.1 --port 3101` with `APP_ORIGIN=https://127.0.0.1:3100` and the Supabase variables (and the corporate CA variables if your network inspects TLS).
2. Run any TLS terminator on port 3100 that forwards to 3101 with a self-signed certificate (the test ignores certificate errors for this local address).
3. `LOAD_LIVE=1 LOAD_ORIGIN=https://127.0.0.1:3100 npx playwright test -c playwright.load.config.ts`

Hosted Auth allows only a limited number of token verifications per IP per few minutes: if sign-in answers 429, wait about five minutes.
