# Pilot readiness: evidence and open gates

The plan (docs/IMPLEMENTATION_PLAN.md, phase 16) separates **readiness** (must be proven before any real voter is admitted) from **pilot evaluation** (measured afterwards). This file records, honestly, what is proven by automated evidence in this repository and what still needs a person, a device, a decision or a real environment. **Nothing in the "open" column may be ticked by a developer alone.**

Legend: ✅ proven here by an automated check you can re-run · 🟡 partly proven, remainder open · ⬜ open (needs people, devices, approvals or a real environment).

## 1. Automated regression and security evidence

### Committee Read-Only Role

The new `rwa-readonly` role is mutually exclusive with `rwa-admin`; it receives
the authorized administrative read scope while database mutations and role
assignment remain admin-only. A household is optional for both management roles
(migration `20261113100000`): an enabled observer or administrator without one
reads its authorized scope but has no ballot, and only an ordinary resident
needs a household before enablement. The account's own frozen household voting
entitlement remains independent.
Seven focused PostgreSQL integration tests exercise register/read scope, denied
mutations, atomic role switching, final-admin protection, role revocation,
household-required enablement and own PUBLIC/PRIVATE voting/privacy. The opt-in
Chromium journey passed on the confirmed disposable Supabase project using
synthetic accounts; the observer submitted its own ballot and downloaded the
completed CSV result (and PDF when enabled). Migration `20261108100000` was
applied there only. This is
not production deployment, manual accessibility acceptance or governance
approval. The user subsequently authorized a persona-first guide and refreshed captures; the earlier freeze described below is historical.

### Resident self-registration

The requested public `/register` page lets residents onboard themselves: each
registration is a suspended `voter` profile (`self_registered`) with an
ineligible household, created atomically and audited as
`PROFILE_SELF_REGISTERED`. Repeated emails and already registered households
are rejected with specific errors (a deliberate, user-chosen enumeration
trade-off); budgets are per email, per household and global, plus a honeypot.
Administrators review through the Residents **Source** filter and the existing
enable/eligibility actions. When the RWA has configured Default Households,
residents pick their flat from that list (type-to-filter combobox) and the server
and database reject anything else; with no list the field is free text.

Earlier local evidence: 482 unit tests passed, including 18 route tests for CSRF,
strict fields, honeypot, budgets, duplicate email/household errors,
configured-list checks and identity cleanup. Verification on the disposable
project is recorded below.

### One-step account and household onboarding

Add Resident now creates the account together with its household (required for
voters in the admin form, optional for management roles)
(all-or-nothing, through `provision_profile_with_household`), eligibility and
optional immediate enablement; account pages assign or move a household; the
separate Add Household page is gone and resident details now expands the shared eligibility
editor inline with Save/Cancel; the standalone eligibility route is removed.
This changes eligibility only, not account access or frozen electorates.
Configured Default Households limit administrator choices to listed,
unassigned identifiers.

### App Support Access (RWA-controlled developer help)

In place of a hidden login or standing default administrator, an enabled RWA
Admin can turn App Support Access on or off from Settings. The server-only
`APP_SUPPORT_EMAIL` only enables the toggle; turning it on creates a single
household-free, read-only `rwa-readonly` support profile (`profiles.is_app_support`,
guarded by a check constraint and triggers) that signs in through the normal
email OTP flow and cannot vote, and the RWA Admin can revoke it at any time. Both
toggles are audited (`APP_SUPPORT_ACCESS_ENABLED`/`APP_SUPPORT_ACCESS_DISABLED`),
`config-check` surfaces an active grant as a non-failing `APP_SUPPORT_ACCESS`
warning, and the support profile is managed only from this control. Local unit and
disposable-PostgreSQL integration tests pass; migration `20261112100000` is a
reviewed deployment input, and end-to-end verification against a live Supabase
project (including real OTP sign-in by the support identity) is still outstanding.

### Full numbered-pagination follow-up

The six paginated screens now show exact filtered totals, First/Previous,
Page X of Y, Next/Last and a page-size selector: member Votes, Residents,
Manage Votes, Audit History, participation and completed PUBLIC named responses.
The compact follow-up uses icon-only directions with accessible names/titles
and native disabled buttons, a single **Page X of Y · N results** summary,
and immediately applies page-size selections without an apply button.
Navigation retains filters; page-size changes return to page one. Empty and
beyond-end pages have defined totals/clamping. Existing cursor HTTP API
contracts, full-result exports and PRIVATE/active-response privacy remain unchanged.

- Current local validation: **522 unit tests in 32 files**, **58 focused real
  PostgreSQL integration tests in 3 files**, production build including
  TypeScript, ESLint, guide regeneration/link validation and **10 renderer
  tests** pass. SQL coverage includes counts/anchors for all six datasets,
  filters, multi-select response deduplication, invalid inputs, current-role
  checks, result privacy and the existing result projections.
- Two focused Chromium tests pass: full First/Previous/Next/Last and size/filter
  behavior across all six screens, and the existing Residents no-flat/filter
  workflow. Empty/clamped pages and selection reset are covered. Light/Dark
  checks cover 320/375/768/1280px reflow and pagination axe checks. Larger pages
  exposed table overflow at tablet width; the shared table now stays inside a
  labelled, keyboard-focusable horizontal scroller.
- One synthetic disposable-project capture flow passed, refreshing six
  representative list/result screenshots and adding desktop/phone pagination
  illustrations. Administrator and resident sessions use separate browser
  contexts; existing screenshot redaction remains in place.
- The user explicitly authorized applying
  `20261114100000_numbered_pagination.sql` to the same disposable Supabase
  project. A dry run listed only that migration before application. This is not
  a real-production migration or application deployment: the pagination app
  changes remain local, and this task did not commit, push or deploy them.
- Live counts and a subsequent bounded row read are not a frozen multi-request
  snapshot. Concurrent updates can move rows/totals. Hosted latency/capacity,
  real-device/manual-accessibility acceptance and all unresolved launch gates
  still require separate evidence.

### Residents consolidation verification (28 October 2026)

**Substring-search follow-up:** name search already matches case-insensitive
substrings; identifier search now does too, including partial text when Settings
suggestions exist. Migration `20261116100000` was separately authorized and
applied only to the verified disposable database. Local checks passed 553 unit
tests, 17 PostgreSQL tests (including all four requested Abhi name variants,
literal wildcard characters, global identifier paging and exact-filter
compatibility), and the focused Chromium table-controls journey with a partial
identifier submitted through the real form. No typo-tolerant search, HTTP
filter contract change, refreshed screenshot or production approval is claimed.

**Column-control follow-up:** Residents now uses global sortable/filterable
headings rather than a separate top filter form, with Source in the table
toolbar and Sort & Filter on phones. Migration `20261115100000` is a new,
read-only deployment input, now applied only to the verified disposable project
with explicit authorization. Local verification passed 549 unit tests, 26 real
PostgreSQL tests across the new query and legacy directory/pagination files,
and three focused Chromium journeys across the final targeted runs (role labels,
global query controls/320px layout and observer reads without mutation).
A separate browser check verified the name-sort boundary between pages.
TypeScript, lint, formatting, build and 10 guide-renderer tests also pass.
The CLI duplicate-migration-version issue is recorded in
[migration status](../supabase/README.md); only the new routine was applied.
Historical browser results below remain separate evidence. Guide screenshots
remain unchanged under the existing capture hold and predate the new controls;
hosted application rollout, screenshot refresh and full manual accessibility
acceptance are not claimed. No launch gate is closed.

**Current follow-up:** the user approved consolidating Accounts and Flats into
one Residents directory, with a required flat for voters in the admin create
form and optional flats for management roles. Canonical routes now use
`/admin/residents`; existing account/household APIs, voting safeguards and applied
migrations remain unchanged. The existing security-invoker directory view supplies
flat/name ordering and identifier/eligibility/no-assignment filters before
pagination; page-scoped current-profile enrichment retains App Support handling.
Account APIs retain their existing filters and ID ordering. This supersedes the
navigation rollback below, not its historical verification results.
At the user's request, former Accounts/Households UI routes and compatibility
redirects are now removed rather than retained. Those URLs return 404; browser
and screenshot workflows navigate directly to Residents. Account/household APIs
are unchanged. This removal changes no illustrated Residents controls, so the
existing affected-workflow screenshots remain applicable.
The removal follow-up passed three focused Chromium checks: removed URL
trees return 404 without a Location header, Residents subroutes retain
signed-out protection, and combined onboarding/eligibility/enablement works
using Residents URLs directly. Production build (including TypeScript),
ESLint, guide regeneration/link validation and all 10 renderer tests pass.
The earlier 511-test unit result below is consolidation evidence; the full unit
suite was not rerun for this routing-only follow-up.

- Current local checks: **511 unit tests in 31 files**, production build,
  TypeScript, ESLint, and **10 documentation-renderer tests** pass.
- Seven focused Chromium journeys pass across the final targeted runs: combined
  resident/flat creation, required-flat validation, duplicate assignment refusal,
  eligibility editing, directory filters/pagination, management
  role behavior and read-only protections, including the observer's own ballot.
  Directory and onboarding reflow/axe checks cover Light/Dark at 375px, with
  overflow checks at 320/375/768/1280px. Manual screen-reader/device acceptance
  remains open.
- With explicit user approval of the configured disposable project, two focused
  capture flows refreshed **18 affected administrator/readonly screenshots**.
  Synthetic records and redaction were used; temporary Default Households and
  branding settings were restored by the capture cleanup. Earlier attempts hit
  an isolated screenshot-write failure and temporary Supabase unavailability;
  final focused reruns passed without weakening checks or TLS.
- This turn ran no new schema migration, full SQL integration suite, hosted
  deployment or real SMTP-delivery verification. Existing production launch,
  capacity, operational and governance gates remain open.

### Manage Votes table-control follow-up

The Manage Votes list now has global sorting and per-column filters, with exact
filtered totals and bounded page IDs from the new
`20261119100000_admin_vote_table_controls` routine. The existing HTTP cursor
contract is unchanged. After the target was verified and separately authorized,
only this migration was applied to `civic-pulse-disposable` in one verified-TLS
transaction with its exact ledger entry and a PostgREST schema notification.
Function ownership and authenticated-only execution were verified. Staging and
production were not changed.

- Current local checks pass: **562 unit tests**, ESLint, TypeScript, production
  build, Prettier, guide rendering/link checks and all **10 renderer tests**.
- The focused PostgreSQL pagination test was skipped because
  `INTEGRATION_DATABASE_URL` is unset. The new SQL routine therefore remains
  unverified by the repository's integration suite. A direct post-apply query
  confirmed the routine exists, is owned by `cp_owner`, and is executable by
  `authenticated` but not `anon` or `service_role`.
- The existing authenticated browser now loads the populated `/admin/votes`
  screen. A PRIVATE Type filter applied and cleared successfully, restoring the
  default table view. This is disposable-browser verification, not production
  or general hosted verification.
- The migration-history blocker was resolved forward-only: the Amber migration
  now has version `20261124100000`, while the existing deadline migration
  history remains unchanged. The audit-filter and draft-deletion migrations
  were applied to the verified disposable project, and the Amber migration was
  applied through the normal CLI. This did not deploy the staging application
  or change a separate production database.
- User Guide HTML copies were regenerated; guide screenshots were not changed.
  Accessibility, hosted rollout and all existing launch gates remain open.

### Manage Votes turnout follow-up

The approved final Turnout column shows submitted / frozen eligible households
and an exact whole percentage for Active/Completed votes. Draft/Scheduled rows
show **Not open**; Cancelled rows show **Not available**. It does not expose
candidate or option totals. Its follow-up migration,
`20261120100000_admin_vote_turnout`, was applied only to the verified
`civic-pulse-disposable` project after separate authorization. Function
ownership, fixed search path and authenticated-only execution were verified;
anon and service-role execution are absent. `INTEGRATION_DATABASE_URL` is
unset, so the new SQL behavior is not verified by the PostgreSQL integration
suite. The authenticated local browser loaded the populated Screen 8 table
after the migration and showed aggregate counts, including PRIVATE turnout.
Staging and production remain untouched; the prior table-control verification
above does not cover this follow-up.

### Centred confirmation popup follow-up (28 October 2026)

The shared native confirmation dialog now centres in both viewport axes at all
breakpoints instead of becoming a phone bottom sheet. Width gutters, bounded
height and internal scrolling preserve access to long content and actions.
Dropdown menus and autocomplete suggestions remain anchored to their controls.

- Two focused Chromium tests pass: actual dialog bounds are centred within 1px
  at 320x640, 375x812, 768x1024, 1280x900 and 844x390; synthetic tall content
  scrolls at 375x480, with Cancel reachable. Escape/cancel, return focus and modal
  focus containment remain covered.
- A focused synthetic capture passes with Light/Dark phone centring assertions,
  two refreshed desktop confirmation screenshots and two new phone illustrations.
  The guides and their HTML copies are regenerated with local link validation.
- Production build (including TypeScript), ESLint and all 10 documentation
  renderer tests pass. The full unit/integration suites were not rerun for this
  shared styling change; real-device/assistive-technology acceptance remains open.
- No migration or hosted deployment was performed. Existing launch gates remain
  unchanged.

### 27 October 2026 verification of both changes

Historically, the earlier Residents-tab experiment was rolled back to the separate
Accounts and Households screens, preserving self-registration and one-step
account/household onboarding. Its additive `20261111100000` view and SQL regression
test remain because the migration was already applied to the disposable project;
the rollback does not change any database, repair history or deploy hosted code.
Some retained guide screenshots came from the interrupted Residents capture;
the missing readonly household-edit image was recovered from the committed
baseline. A fresh synthetic capture is still needed before treating those images
as evidence of the restored navigation. No hosted fixture writes or captures are
authorized by this local rollback alone.

- **Local real PostgreSQL 17.11** (throwaway localhost cluster): the five focused
  integration files (self-registration, account with household, security
  allowlist, provisioning, register) passed 76 tests; the full integration suite
  passed 269 tests with 7 environment-gated skips.
- **Disposable hosted project** (user-confirmed, never production): after a dry
  run listing exactly `20261109100000` and `20261110100000`, both were applied
  with `supabase db push --skip-vault`. `npm run test:live` then passed 64 of 67.
  The 3 failures are outside these changes and remain open: two results tests
  still expect two-decimal percentages (`"100.00"`, `"50.00"`) while the
  committed shared percentage helper returns `"100"`/`"50"`, and the
  per-profile submission-limit test did not observe `RATE_LIMITED`.
- **Live Chromium** (`register-live`, `access-control-live`, `foundation`): all
  checks of the new flows passed after making `register-live` independent of the
  RWA's household wording and matching the field-error summary. One remaining
  failure is pre-existing and outside these changes: the responsive check
  reports touch targets below 48px on `/` (status links All/Active, the footer
  Sign In link and three appearance inputs).
- **Screenshots:** all seven capture flows passed, refreshing the affected
  images (01, 16, 17, 20, 21, 42-47, 30-33, readonly 05-08) and adding 77-80
  (Resident registration, list picker, received, duplicate email) and 81-84
  (Add Account picker, created with flat, move dialog, self-registered filter).
  The flow temporarily set a run-unique Default Households list and the original
  (empty) list was confirmed restored. Representative images were visually
  inspected; a dialog redaction overlap and a cramped account-page section found
  this way were fixed before the final captures.
- Not yet done: manual keyboard and screen-reader checks of the flat pickers and
  move dialog, A4 approval, and staging/production application.

### Persona-First User Guide Refresh

The guide is now organized by Resident (`voter`), RWA Admin (`rwa-admin`) and
RWA ReadOnly (`rwa-readonly`), with
current-app synthetic screenshots grouped by persona. The ReadOnly journey
covers management read scope, disabled
controls, own-household PUBLIC/PRIVATE voting, completed results outside its own
electorate and downloads. The six capture flows passed individually on the
confirmed disposable project using verified database TLS and redaction. The
renderer embedded 111 persona screenshots plus three workflow diagrams and
checked local assets/links. Mobile Admin/ReadOnly captures are excluded from
the active guide to match the requested device targets.
This
proves the documented fixtures render; it does not prove production identity,
email delivery, capacity, manual accessibility or launch approval. The previous
hash of the frozen guide is historical and is no longer the current baseline.

### All-Screen Visual Rollout

After accepting the concept-aligned Votes screen, the user authorized rollout
across the remaining screens while explicitly freezing the User Guide, its HTML/
public copies and screenshots. Shared hierarchy, field, notice, table/dialog,
ballot/review, result and lifecycle/admin sections now use the same presentation;
no permissions, payload, counting, export or submission rules were changed.
460 unit tests passed. The guide-preserving visual matrix passed public pages in
both modes at 375/1280px, fifteen admin destinations in both desktop modes and
dark phone mode, and actual PUBLIC multi-select/PRIVATE NOTA selection, review,
durable acknowledgement, active turnout/results, completed results, deadline
dialogs and participation. Theme readiness and resolved mode are explicitly
checked; per-surface overflow and axe checks passed. Representative temporary
ballot-review, result and settings images were visually inspected.

One native appearance-disclosure `open` hydration warning remained in automation
despite the readiness wait; it was not hidden with additional hydration-warning
suppression and remains a follow-up console finding. This does not turn manual
device/accessibility or production gates into passes. At that historical rollout,
guide assets had to match their pre-rollout content hash and tests used direct
Next startup with a preserve-guide switch and temporary screenshots only; technical documentation was updated
separately. Final build/lint/format and exclusion-hash results are recorded below
when executed, not inferred from historical runs.

The later native-guide migration explicitly lifts that screenshot hold:
`/user-guide` now links to Resident and RWA Admin pages with fresh curated
synthetic captures; `/tech-guide` is public/unlisted/noindex, with diagrams and
ERD. Old standalone guide outputs/images and renderer hooks are removed.
Normal dev/build/browser checks no longer write guide assets. The historical
hash/renderer results below are not current native-guide evidence, deployed-host
verification, SMTP/Cron proof or production approval; unresolved gates stay open.

Final rollout gates: direct Next production build and TypeScript, lint and
repository formatting passed; all 460 unit tests, both new visual-matrix tests,
27 foundation/appearance browser checks and seven renderer tests passed. The
existing health case was explicitly excluded from the foundation run. SHA-256
comparison of all 82 User Guide Markdown/HTML/public/image files matched the
pre-rollout baseline exactly. Only the technical HTML was regenerated. The app
preview uses direct Next startup to preserve the hold. Manual device/accessibility,
production approval and the recorded disclosure hydration warning remain separate
follow-ups; no new migration or production data change was performed.

### Votes Concept Fidelity Correction

The user identified that the initial colour/font slice did not match the approved
concept closely enough. The correction implements compact branding, history by
the title, a three-column own-entitlement overview, status links/type menu, rich
turnout/participation cards and upcoming scheduled entries. The real-fixture
capture passed with 2 active votes, 1 scheduled vote, 1 active response and actual
1/2 (50%) turnout; filtering to PRIVATE did not alter the overview or expose
candidates. A separate administrator without entitlement receives zero own active
votes, not an association-wide count. Scope/failure/countdown tests are local
evidence; performance/read-budget verification on the approved host, manual
accessibility and all production gates remain open. No schema migration or new
permission/endpoint was added. Guide images must be actual application captures.

Final correction evidence: all 460 unit tests passed, including identity-scoped
overview, missing-count handling, aggregate-only turnout and compact countdown
formatting. The final real-fixture capture passed after checking the administrator
zero-entitlement case and filtered-card/global-own-summary distinction. All 27
Chromium foundation/appearance checks passed with the existing health case
explicitly excluded. Production build/TypeScript, lint and seven guide-renderer
checks passed. The refreshed phone, light desktop and dark phone images were
visually compared with the concept; top navigation is intentionally retained as
previously agreed. These checks do not close hosting latency/read-budget,
production or manual device/accessibility gates.

### Appearance Review Slice

The approved first slice adds Platinum/Obsidian with browser-local Light/Dark/
System, Sora/Manrope typography and Votes/Accounts layouts; top navigation and
voting safeguards remain unchanged. 455 unit tests passed, including pre-paint
normalization, blocked-storage fallback and contrast gates. Four focused Chromium
checks passed for System/live media changes, saved preference, cross-tab updates,
keyboard/Escape, corrupt/blocked storage, both-mode phone/desktop accessibility,
self-hosted browser fonts and light print. Rendered Accounts testing caught a
warning-badge contrast failure on a selected-row tint; the light warning token
was corrected and the same check passed. The focused real-fixture capture uses
the already confirmed disposable project, not production. Record final capture
and quality-gate results separately; manual device/accessibility acceptance,
production readiness and redesign of the remaining layouts are not claimed.

Final 27 October appearance checks: production build/TypeScript and lint passed;
all 455 unit tests, seven documentation-renderer checks and the focused actual
Votes/Accounts capture passed. The combined Chromium appearance/foundation run
passed 26 checks; its guide check assumed the first PNG was Sign-in and failed
after the new appearance section changed image order. That check was corrected
to select the named Sign-in image, expanded to load the new appearance images,
and passed on its focused rerun. The existing unavailable-health case was
explicitly excluded, not counted as passed. Narrow 320px and 375px views,
self-hosted fonts, light native print controls, live System switching and blocked
storage were exercised. Dependency audit reported zero known vulnerabilities.
Seven new redacted images and three affected overviews were captured; representative
desktop/phone/menu images were visually inspected. These are review-slice evidence,
not approval to redesign the remaining layouts or a full manual accessibility audit.

### Bulk account review follow-up

The agreed page-local review defaults to the `voter` role, explicitly supports All Roles
including administrators, and separates account access from future flat voting
eligibility. It adds no migration or permission bypass; it uses the existing
guarded PATCH operations, current-admin checks and per-record audit/budgets.
435 unit tests passed, including assignment enrichment and independent target
rules. A focused Chromium run against the confirmed disposable project passed:
one eligibility change left access suspended, two selected accounts were enabled,
another account remained suspended, enabling did not change another flat's
ineligibility, administrator enablement required explicit inclusion/warning, and
a controlled 503 left access blocked with review-before-retry guidance. The test
also exposed/fixed a same-page refresh selection race and uses stable IDs for
same-named synthetic residents. Five new redacted screenshots and the Accounts
overview were refreshed. These results are not production, peak quota, real-device
or manual accessibility approval; existing launch gates remain open.

### Register import and scheduled opening follow-up

The requested implementation uses combined household/representative CSV rows,
suspended-account review, scheduling-time freezing and summary-only upcoming
votes. The two forward migrations were applied on 27 October 2026 only to the
user-confirmed disposable screenshot project, after authorization and a dry run;
there was no production deployment or reset. Focused local PostgreSQL 17 checks
cover import conflicts/concurrent retries/suspended access and scheduling,
direct pre-opening ballot denial, early/late admission, frozen register identities,
withdrawal and missed-window completion. Unit checks cover malformed/oversized CSV,
duplicates, confirmation, provider failure and current-admin checks. Record final
gate results separately from historical counts below.

Final local verification on 27 October 2026: production build and TypeScript
passed; ESLint passed after removing unchecked fixture assertions; 432 unit tests,
249 PostgreSQL integration tests and 7 documentation-renderer checks passed.
Seven environment-gated database checks were skipped, not passed. The 23
Chromium foundation checks passed with the unavailable database-health check
explicitly excluded. They verify the public surface/guide, not authenticated new
workflows. `npm audit` reported zero known vulnerabilities after using patched
`csv-parse` 7.0.3. Guide regeneration checked 82 technical-guide and 4 user-guide
local links; the lifecycle diagram now includes scheduled opening/withdrawal.

The focused Chromium documentation capture passed against that migrated project:
real synthetic provisioning/import with suspended-account review, exact-match
checking on mobile, revision-bound scheduling, summary-only resident rendering,
reasoned withdrawal and renewed draft invisibility. Nine new redacted screenshots
and four affected existing pictures were captured; representative desktop/mobile
captures and a dialog crop were visually inspected. The
shared browser-fixture SQL helper now uses verified TLS/hostname checks with the
provider CA; the earlier bypass is not used by this capture. The first CLI push
rolled back because the migration retained the restricted owner role; a read-only
check confirmed no schema/history change, `RESET ROLE` was added while unapplied,
and the authorized retry succeeded. No migration ledger was edited manually.

Still required: hosted provisioning failure/retry and Auth quota behavior at
500 rows; manual/device accessibility for the new workflows; actual scheduled
Cron execution; and all production/security/recovery/SMTP gates below. Screenshots
and one-row browser evidence do not establish any of those approvals or capacity
claims. Other older test helpers still need their own verified-TLS audit fixes.

The table below includes historical runs, not a claim that every suite passes
against the currently configured services. In the **26 October 2026 public-launch
change run**, build/lint/typecheck, 374 unit tests, four documentation-renderer
tests and 21 configured Chromium public/foundation tests passed. The existing
health test returned **503**, so it was explicitly excluded from that final
21-test run, not reclassified as a pass. Live authenticated/database checks were
not rerun. Contact and Google provider traffic was controlled with synthetic
settings; real contact inbox receipt, GA4 collection and Search Console ownership
were not verified. All five external-integration settings were absent locally at
that check. See the [dated audit](./LAUNCH_AUDIT.md#public-site-checklist-26-october-2026)
for exact scope; the Firefox/WebKit counts below predate the public additions.

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
| Privacy of choices in rendered HTML, URLs, storage, errors, CSV, PDF | ✅ | Browser tests assert no selection in the page, URL, storage or JSON after submission; PRIVATE results, CSV and PDF contain no names or households; PUBLIC exports contain no emails.                                         |
| Exact agreement of screen, API, CSV and PDF               | ✅     | `tests/e2e/voting-live.spec.ts` (“the screen, the API and the CSV agree exactly”, which also reads the downloaded PDF).                                                                                                     |
| Core journeys accessible (WCAG 2.2 AA, automatic part)    | 🟡     | axe at 320/375/768/1280 px, 48 px targets, 200% text, keyboard operation of the ballot (Chromium, Firefox) on every resident and administrator screen. The manual part is open (section 3).                                  |
| Backup and restore rehearsal                              | 🟡     | `tests/integration/restore.test.ts` (encrypted backup, verification, restore into a separate database, reconciliation, tampering, lost ballot, elapsed deadline, recovery record) and one real backup of the hosted project. Open: restore of the hosted project into a second project from the real off-site store (docs/OPERATIONS.md, section 5). |
| Retention                                                | ✅     | `tests/integration/maintenance.test.ts`; the Cron job `civic-pulse-maintenance` is scheduled on the hosted project.                                                                                                        |

## 2. Capacity (500 households, about 100 concurrent users)

Targets (provisional, from the plan): p95 under **2 s** for pages and API calls, acknowledgement of a submission under **3 s**.

**Database half, local PostgreSQL 17, 500 households, 100 requests in flight through a 20-connection pool** (`npm run test:load`, `tests/load/db-capacity.test.ts`; no network, so this shows locking and query behaviour only):

| Operation (all with 100 in flight)           | p50      | p95      | Notes                                                    |
| -------------------------------------------- | -------- | -------- | -------------------------------------------------------- |
| Submit a PUBLIC ballot (one shared vote)      | 96 ms    | 152 ms   | 500 accepted, exactly once each                          |
| Submit a PRIVATE ballot (5 offices, shared counters) | 341 ms | 457 ms | Every office's counters add up to exactly 500            |
| Open ballot / own status / list votes        | 51–58 ms | 85–232 ms |                                                         |
| Administrator participation (during the burst) | 77 ms  | 159 ms   |                                                          |
| Replace a PUBLIC response (100 at once)      | 86 ms    | 139 ms   | All accepted; still 500 participations and 500 current responses (re-measured 2026-10-30) |
| Results page (50 named) / all 500 for export | 84 / 27 ms | 92 / 31 ms |                                                      |
| CSV render, 500 names                        | 2 ms     |          |                                                          |
| PDF render, 500 names (17 pages)             | about 1 s |         | Single-threaded CPU; two renders at a time, others queue |

**HTTP half, production build (`next start`, behind a local TLS front) against the hosted free-tier project, from this laptop over the corporate network** (`tests/e2e/load-live.spec.ts`, 24 signed-in members reused, 100 requests in flight; see section 5):

| Operation                                       | n  | p50      | p95      |
| ----------------------------------------------- | -- | -------- | -------- |
| Submit a ballot (24 at the same moment, plus background reads) | 24 | 1613 ms | 1657 ms |
| Repeat submission (refused, 409; historical — PUBLIC responses are now replaceable, so the spec now measures `POST replace response` and this row has not been re-measured) | 24 | 446 ms   | 532 ms   |
| Vote list / ballot (warm)                       | 72 | 1096 ms  | 1165 ms  |
| Vote list / ballot (**cold** first pass)        | 72 | 2153 ms  | 2250 ms  |
| Own participation status (during the burst)     | 72 | 1394 ms  | 1463 ms  |
| Results (completed vote)                        | 72 | 926 ms   | 1006 ms  |
| CSV download                                    | 24 | 295 ms   | 317 ms   |
| PDF download                                    | 24 | 850 ms   | 1285 ms  |

All warm figures meet the targets (p95 < 2 s, acknowledgement < 3 s), the totals were exact afterwards, and no request answered an unexpected status. The **cold** first pass is slightly over 2 s: a server that has just started, with connections not yet open, is slower for its first few seconds. Each request makes several sequential round trips to the hosted project (session check, profile, rate limit, then the routine), so these numbers are dominated by distance to the database, and will differ on the real hosting plan. The first two runs of this test also found that export downloads were being refused with 503 when more than four were rendering at once (the limit counted the database wait, not just the CPU work); that was fixed by queueing instead of refusing (`src/server/exports/semaphore.ts`).

What this does **not** show: behaviour on the real hosting plan, from phones on mobile networks, with real Auth peak limits (hosted Auth limits token verifications per IP, so a pool of 24 signed-in members is reused), or with real emailed codes. ⬜ Repeat on the chosen hosting plan once it exists.

## 3. Open gates: people, devices, approvals, environments

These gates require external evidence or approval; some also require unresolved code changes. Record the evidence (date, who, result) next to each. A documentation update does not close a gate.

The local operator `npm run ops -- config-check` report can inspect RWA setup,
approval/retention completeness and aggregate account/vote health without an
app login. It requires separately protected database access and makes no
changes. A passing report is not production evidence: its environment checks
apply only to injected runner values, approval presence is not authenticity,
and provider/SMTP/ingress/Cron/backup/recovery gates remain open. See
[Operations](./OPERATIONS.md#read-only-rwa-configuration-inspection).

**Security release blocker:** production ingress is undecided and trusted-client-IP rate limiting is not implemented. The email-only budgets can be bypassed by rotating addresses. Do not release until the selected proxy's client-IP guarantees, direct-origin restrictions, limiter implementation and spoofing/burst tests are complete. Merely setting `TRUSTED_PROXY_CONFIG` does not enable this control.

Operational remote database connections now require verified TLS, and backup manifests are validated before use. The real provider CA/hostname and off-site backup/restore path still need deployment evidence; local integration tests do not establish that evidence.

**27 October protected-staging evidence:** the committed GitHub app plus the
deployment packaging fix (`8ac9d1c`) is Ready on Vercel Preview using the
operator-confirmed disposable Supabase project. See the
[staging deployment record](./DEPLOYMENT.md#protected-staging-27-october-2026).
Hosted health, maintenance, signed-out access boundaries and wrong-Origin
rejection passed; authenticated voting/export acceptance, full
migration history, hosted capacity and recovery remain unverified. Read-only SQL
verification failed certificate-chain validation without disabling TLS; no
migrations or database writes were performed. Local uncommitted features were
not deployed. This partial staging evidence does **not** close gates 4 or 9,
approve production, or supersede any unresolved credential-hygiene gate.

**28 October staging email evidence:** Brevo-backed six-digit OTP inbox receipt
and successful sign-in were confirmed by the operator after explicitly
authorizing a staging administrator. The browser showed RWA Admin navigation.
See the [SMTP verification record](./DEPLOYMENT.md#staging-otp-verification-28-october-2026).
This is not approval of the personal Gmail sender for production, the unchanged
one-hour OTP expiry, sending capacity, or any production release gate.

**Current 28 October staging-only follow-up:** the canonical site was then
<https://arp-civic-pulse-staging.vercel.app> (moved on 31 October to
<https://staging.arp-civic-pulse.vercel.app>; see the
[deployment record](./DEPLOYMENT.md#current-staging-configuration-production-target-only)), using Vercel's Production target
only with the same disposable database. Hosted Preview deployments are disabled,
all eight Preview-only variables were removed, Production `APP_ORIGIN` and
Supabase Auth Site URL are aligned, and redeployment
`dpl_6cEy2UQrC2ZDFxupXbhy14VMWR5x` of committed `a0823d8` is Ready.
Current protection settings were preserved; the canonical sign-in/health URLs
were publicly reachable during checks. Same-origin empty-body authentication
requests now reach validation (422), wrong-origin requests still fail CSRF (403),
and health returns 200/ok. No OTP email, new migration, reset, real voting
acceptance or uncommitted Residents/modal deployment occurred. Main-only Git
policy is also prepared locally in `vercel.json`, pending a separate commit/push.
This supersedes earlier git-main URL/Preview-variable/protection observations
below, not the unresolved gates. Real production remains a separate Vercel and
non-disposable Supabase setup. See the
[current staging configuration](./DEPLOYMENT.md#current-staging-configuration-production-target-only).

**Earlier 28 October Production-target switch:** the staging host now uses Vercel's
Production environment so `main` builds carry application variables. The two
pending migrations (`20261112100000_app_support_access`,
`20261113100000_readonly_household_optional`) were applied to the disposable
staging Supabase over its session pooler without weakening TLS, `APP_SUPPORT_EMAIL`
and the other Production variables were set, and the `-git-main-` deployment is
Ready behind Vercel SSO. See the
[Production-target record](./DEPLOYMENT.md#staging-promoted-to-the-production-target-28-october-2026).
This does **not** close gates 4 or 9: authenticated voting/export and App Support
Access acceptance, load and recovery stay unverified, and real production still
requires a separate Vercel project and non-disposable Supabase project.

| #   | Gate                                                                                                                                                                                  | State |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | Real approvals **A1–A7**, provider and region, recorded by the real approving authority (today they exist only as **fixtures on the disposable project**)                               | ⬜     |
| 2   | Approved session policy (the app caps the session cookie at 14 days of inactivity as a provisional default; confirm or change it, and decide whether Pro-tier idle/absolute timeouts are needed), bylaw confirmation of the NOTA winner rule (A5) and early-completion rule, retention periods and backup expiry, RPO/RTO                                                                | ⬜     |
| 3   | Custom SMTP provider with enough sending/peak capacity, and its Auth limits (Gmail was deferred; the built-in hosted mail cannot carry a code to arbitrary users)                      | ⬜     |
| 4   | Hosting plan eligibility and cost, TLS, trusted-proxy configuration (`TRUSTED_PROXY_CONFIG`; the per-IP limiter is not implemented until this is approved)                              | ⬜     |
| 5   | Real-device checks: Safari on iPhone, Chrome on Android, and the supported laptop browsers (including keyboard use of radios and the skip link in Safari), CSV and **PDF** download and print on real phones and a laptop | ⬜     |
| 6   | Manual accessibility: screen reader (VoiceOver, TalkBack, NVDA), keyboard-only, forced contrast, reduced motion, 200–400% zoom on the core journeys                                      | ⬜     |
| 7   | Backup to the real off-site store with the real key, then a **full restore of the hosted project into a second project** and a documented RPO/RTO                                       | ⬜     |
| 8   | Incident owner, committee decision-maker and escalation route named in docs/OPERATIONS.md, section 6                                                                                    | ⬜     |
| 9   | Deployment through staging to production on the approved plan; smoke test with synthetic data; migrations applied outside any active vote                                               | ⬜     |
| 10  | Load test repeated on the real plan                                                                                                                                                   | ⬜     |
| 11  | Key and credential hygiene: the database password that was shown in a chat earlier and the CLI access token must be rotated or deleted; the disposable project reset or deleted        | ⬜     |
| 12 | Public launch: approve legal operator/contact details, exact privacy/retention/provider terms and canonical domain; configure contact sender/recipient/Resend and prove real inbox receipt. If enabling GA4/Search Console, approve the integrations, verify consent/isolation and disable Enhanced Measurement, complete property verification and submit the public sitemap. | ⬜ |
| 13 | Resident self-registration: record A4 approval covering it (including its duplicate-email/household disclosure); apply `20261109100000` to staging/production through the release process; manual keyboard and screen-reader checks of the flat picker; the trusted-IP release blocker also applies to this endpoint. (Integration, hosted-project application and screenshots: done 27 October on the disposable project.) | ⬜ |
| 14 | One-step account and household onboarding: apply `20261110100000` to staging/production through the release process; manual keyboard and screen-reader checks of the Add Account picker and account-page move dialog. (Integration, live browser flow and screenshots: done 27 October on the disposable project.) | ⬜ |

## 4. Pilot evaluation (after the gates above, with real residents)

Run at least one real PUBLIC poll and one real PRIVATE election, then measure **without recording anyone's selection**:

| Measure                                                        | Target            | How                                                                                          |
| -------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| Administrator setup of a vote                                  | under 10 minutes  | Time from "New vote" to "Activate", observed on a phone, once per administrator.               |
| First-attempt sign-in success                                  | at least 90%      | Count residents who signed in on the first try over those who tried; non-attempts counted separately. |
| Unaided sign-in and first submission                           | at least 90%      | Observed or surveyed; no helper intervention.                                                |
| Median ballot-open to acknowledgement on a phone               | under 60 seconds  | Timed with consenting volunteers, never from selection data. The app deliberately collects no telemetry. |
| Turnout (adoption target)                                      | at least 60%      | From the turnout figure on the results page. Reported separately from correctness.           |
| Cost                                                           | zero-monthly-cost feasibility | Reported separately.                                                                |

No adoption or budget target excuses an integrity or privacy failure. A lost, duplicate, partial or late-admitted ballot, a wrong tally, unauthorised disclosure, a PRIVATE identity-to-choice exposure, or unknown completeness after a recovery blocks release.

## 5. Running the HTTP load test

A production server insists on an HTTPS **non-loopback** origin, so use an approved
isolated staging hostname and TLS front in front of `next start`. The earlier
`https://127.0.0.1:3100` recipe is rejected by current production validation; do
not weaken that guard. Provision the hostname/certificate and set both
`APP_ORIGIN` and `LOAD_ORIGIN` to its exact origin at build/runtime before using
the historical test topology below; it is not a currently validated runnable
deployment recipe.

1. With the approved staging origin and isolated Supabase settings injected, run `npm run build`, then `next start --hostname 127.0.0.1 --port 3101` behind the approved HTTPS front.
2. Verify the front's hostname, certificate and forwarding rules. Use approved CA configuration where required; ignore-certificate test flags do not prove trusted production TLS.
3. With `LOAD_LIVE=1` and `LOAD_ORIGIN` set to that same approved origin, run `npx playwright test -c playwright.load.config.ts`. Validate this host-specific recipe before recording new results.

Hosted Auth allows only a limited number of token verifications per IP per few minutes: if sign-in answers 429, wait about five minutes.
