# Architecture

## 01 Scope and Governing Decisions
[PRD.md](./PRD.md) defines product behavior and acceptance criteria. [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) defines visual and accessibility behavior. This document defines the target implementation; it does not override product requirements or claim the current scaffold has already been migrated.

- Current application: one mobile-first Next.js deployment for one RWA, with a historical target of 500 households and about 100 concurrent users. Planned SaaS retains the shared app with a separate Supabase project per RWA; SaaS capacity is not approved by that historical target.
- Preserve **Supabase** for PostgreSQL, Auth, RLS, guarded SQL functions and scheduled database maintenance, and **Tailwind CSS** for styling.
- **Supabase PostgreSQL is the source of truth** for eligibility, accepted participation, responses, totals and audit history. On-screen results and exports are derived views, never independent editable records.
- PDF is an optional printable results export and may be deferred beyond version 1. No voting, completion or recovery operation depends on a PDF.
- PUBLIC and PRIVATE are voting types, separate from Draft, Scheduled, Active, Completed and Cancelled lifecycle statuses.
- PRIVATE voting provides application-level privacy under PRD assumption A2, not cryptographic anonymity against infrastructure operators.
- Obtain approval of PRD assumptions A1-A7, providers, region, retention and recovery objectives before real voting.
- No separate backend application, microservices, Redis, queue, AI, or application file storage for the MVP. Approved off-site backup storage is a separate operational requirement.

### Planned SaaS boundary

The [S01 decision record](./IMPLEMENTATION_PLAN.md#s01---product-and-commercial-boundaries)
confirms a shared application with a separate Supabase database/Auth project per
customer RWA, customer subdomains, a separate main website and a dedicated
synthetic demo (shared and writable since 31 October 2026, reset regularly). S03 routing code is now present but disabled; no
current deployment has tenant isolation or routing configured. The existing
single-project staging configuration remains unchanged.

Server-controlled exact-host allowlisting, managed secret references and
restricted operator access are confirmed boundaries. The [S02 design
contract](./IMPLEMENTATION_PLAN.md#s02---tenant-resolution-and-configuration-contract)
specifies the directory, environment kinds/states, fail-closed behavior and
spoofing/isolation cases. S03 now implements a strict server-only directory and
immutable request-scoped backend context behind `TENANT_ROUTING_ENABLED`
(default `false`); the current staging deployment still uses one project and
has no tenant directory, customer hosts or tenant secrets configured. Vercel
environment variables were selected for a capped pilot, with the
shared-runtime/fleet-wide secret blast radius documented; the pilot cap of 10
customer RWAs was approved on 31 October 2026 and is enforced by the directory
parser. S04 implements tenant-namespaced
host-only session cookies and request-tenant canonical-origin CSRF checks.
Real disposable cross-project tests pass. A retained hosted Vercel test project
shows that the public Host selects the tenant, spoofed forwarding headers are
rejected and per-deployment URLs are SSO-protected. The same project's S03 run
showed that concurrent requests to two backends keep their own branding, data,
exports, rate limits and logged tenant; see
[the deployment record](./DEPLOYMENT.md#tenant-routing-disabled-on-staging-separate-hosted-test-project).
Staging itself does not route tenants.
Unknown or unavailable hosts must never fall back to another RWA. The actual
domain, customer capacity and existing production gates remain open.

## 02 System Overview and Stack

The staging Vercel project uses only its Production target on `main`, with
Preview deployments disabled and the existing disposable Supabase database.
`vercel.json` restricts automatic Git deployments to `main`; hosted environment
scope, protection and canonical `APP_ORIGIN` remain project settings.
Real production requires separate hosting/database projects and credentials.
See the [current staging configuration](./DEPLOYMENT.md#current-staging-configuration-production-target-only).

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
  - Participation + PRIVATE counters / PUBLIC responses
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
| Observability | Allowlisted application events and provider metrics without sensitive payload capture; optional Sentry errors and 10% sampled traces, scrubbed of request headers, cookies, bodies, query strings, user identity, emails, phone numbers and tokens (no Session Replay) |

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
- Use the RWA-configured household terms throughout member/admin/public screens and printable results: `rwa_settings` stores a household label (for example Flat) and an identifier kind (Number or ID); `buildHouseholdTerms` derives singular, plural, sentence-case and identifier wording; server code reads them with `loadHouseholdTerms()` (request-cached, falling back to the defaults) and client components with `useHouseholdTerms()` from the provider in the app shell. Changes go only through the audited administrator RPC.
- Keep the RWA profile editable by administrators only; enabled `rwa-readonly` committee observers share the authorized administrative read scope. Enabled members see the resulting values on other pages (alias in the “Civic Pulse for {alias}” header, full name on vote/results/home pages, contact block in the footer, welcome message, accent palette) through the narrow `get_rwa_branding` projection; the public sign-in and privacy pages receive only name, alias, address and palette through a server-only service-role routine, so `anon` still executes no routine. Screens and exports show the current RWA name, while each vote keeps its activation-time `rwa_name_snapshot` only as an internal historical record.
- Active voter, results and administrator pages display a browser countdown to the current deadline and refresh at zero (a changed deadline resets the countdown). It is informational only; the database's post-lock deadline check remains authoritative.
- Use the user's verified session for normal database calls. Never use a service-role client to bypass eligibility or obtain live tallies.
- Validate state-changing request origins and apply anti-CSRF protection appropriate to the route/action. Do not rely on hidden buttons, middleware alone or broad CORS.
- Authenticated pages, APIs and exports use private, no-store behavior; disable shared Next.js/CDN caching for protected data.
- Keep unsent selections in page memory only, never URLs, browser storage, persistent drafts, service workers or telemetry. Clear them after acknowledged submission, sign-out or access revocation.
- Disable repeat clicks for UX, but rely on database transactions for correctness. Never optimistically acknowledge a ballot.
- Follow the existing design system: 48px touch targets, at least 16px input text, visible labels/focus, keyboard access and WCAG 2.2 AA. Test phone widths of 320-430 CSS pixels and laptop widths of 1280-1440.

## 04 Target Project Structure

- `src/styles/globals.css` defines the shared `form-panel` utility used by
  standalone access/admin/voting forms and action panels. Nested assignment forms
  inherit their section's frame; popovers/dialogs retain their existing frame.

- `.vscode/settings.json`: workspace-scoped Copilot commit-message instructions,
  requiring one `type(scope): imperative summary` title, a blank line and a
  plain bullet-point body for Source Control generation.
  `docs/AGENTS.md` records the matching rule for agent-created/proposed commits.

`.certs/` is an optional local-only folder for approved CA certificates, including
`supabase-db-ca.crt` for direct PostgreSQL tooling. Its contents are excluded from
Git and Vercel deployment uploads; it is not an application/public asset directory.
See [local setup](./LOCAL_SETUP.md) for `PGSSLROOTCERT` configuration.

`scripts/ops/configuration.ts` owns the operator-only configuration snapshot and
versioned aggregate report, exposed by `npm run ops -- config-check`.
`tests/unit/ops-configuration.test.ts` covers report decisions/redaction and
`tests/integration/ops-configuration.test.ts` covers real PostgreSQL reads,
permissions, rollback, privacy and CLI exit behavior. No web route or schema
migration is added.

`tests/integration/migration-upgrade.test.ts` verifies migration
`20261124100000` upgrades a disposable database from the previous schema baseline,
preserves RWA settings and enables the new accent through the guarded profile
routine. Fleet migration reporting remains an operator-run release check.
`scripts/ops/migration-status.ts` validates the confirmed per-RWA database
target for the read-only migration-version report; it never applies SQL.
`tests/unit/ops-migration-status.test.ts` covers target/refusal behavior.

Concept-fidelity correction: `src/components/votes/vote-list-card.tsx` owns the
server-rendered rich card and compact upcoming row; `src/app/page.tsx` owns status
links, compact type/history controls and the three-column overview. Existing
`src/server/votes/member.ts` adds RLS-bound own-entitlement counts and narrows
existing authorized results to turnout only. `MemberVoteOverview` and
`VoteCardTurnout` in the shared member-vote contracts describe those internal
projections, not new HTTP endpoints. `tests/unit/vote-dashboard.test.ts` verifies
identity scoping, aggregate-only projection and unavailable-data handling. Existing
countdown helpers/components supply informational compact deadline chips. The
shared shell reuses the chosen icon/alias with an authenticated initials avatar;
navigation, authentication and permissions are unchanged. No migration is needed.

Approved appearance review implementation:

- `src/shared/theme.ts`: the non-sensitive mode/storage key and static pre-paint normalizer; no ballot or identity storage.
- `src/components/ui/theme-provider.tsx`: `next-themes` 0.4.6 integration for System mode, browser persistence and cross-tab/media updates.
- `src/components/ui/theme-switcher.tsx`: native header Light/Dark/System menu with Escape/outside dismissal; available before and after authentication.
- `src/app/layout.tsx` and `src/styles/globals.css`: self-hosted Sora/Manrope, root appearance attribute, Platinum/Obsidian tokens, dark RWA accent variants and light print overrides. Shared button foreground tokens remain contrast-safe.
- `tests/unit/theme.test.ts`: startup recovery and contrast gates; `tests/e2e/theme.spec.ts`: real-browser mode, persistence, blocked storage, keyboard, accessibility, responsive, self-hosted-font and print checks.
- `tests/e2e/tenant-origin-live.spec.ts`: opt-in real-HTTP checks of tenant-specific OTP cookies, same-email session isolation, host-bound Origin/CSRF, forwarded-header spoofing, unknown hosts and independent sign-out against the two disposable Supabase projects. It runs locally through Host overrides. With `TENANT_HTTP_REMOTE=1` and `PLAYWRIGHT_NO_WEB_SERVER=1`, it runs against hosted tenant hosts over HTTPS with production `__Host-` cookie names.
- Error IDs and structured failure logging:
  - `src/shared/observability/error-id.ts`: readable `AREA-XXXXX-XXXXX` IDs and the path-to-area map.
  - `src/server/observability/request-context.ts`: the per-request `AsyncLocalStorage` log context.
  - `src/components/ui/page-error-id.ts`: the `PAGE-` ID and Sentry report for `src/app/error.tsx` and the new `src/app/global-error.tsx`.
  - `tests/unit/error-logging.test.ts`: covers IDs, catalogue completeness, cause sanitising, failure logs, Sentry tags and tag scrubbing.
- `scripts/docs/capture.spec.ts` captures current Platinum/Obsidian persona screens from synthetic accounts; the former root-level pictures `68`-`74` are archived with the old guide. No production data is used.

After the user approved the concept-aligned Votes screen, the shared style was
extended to all screen families: compact PageHeader/EmptyState hierarchy,
refined Field controls, quiet Notice/DataTable/ConfirmDialog surfaces, native
ballot options/review, ResultsView/ResultBars, lifecycle facts, and admin draft/
register/audit/participation filter sections. Top navigation and all server-side
authorization/submission/result paths remain unchanged. Theme preference adds no
API, cookie, migration or analytics dependency; PDF rendering remains unchanged.

`tests/e2e/visual-rollout.spec.ts` verifies the actual public, admin and resident
surfaces in explicit Light/Dark modes and phone widths, writes only temporary
redacted test images, and performs synthetic PUBLIC/PRIVATE selection, review,
acceptance, active results, completed results, lifecycle-dialog and participation
checks. Ordinary browser runs never regenerate guide assets. Appearance controls expose a
hydration-readiness marker and disable mode radios until client state is ready.

The User Guide is now native server-rendered app content at `/user-guide`,
`/user-guide/resident` and `/user-guide/rwa-admin`, with stable contents anchors.
Curated synthetic captures live in `public/guides/{resident,rwa-admin}`.
The public developer guide is only directly discoverable at `/tech-guide`,
unlinked and noindex/nofollow. Legacy standalone guide copies, old images and
document-generation lifecycle hooks are removed.
This is the migration target, not a description of already completed changes. Retain existing feature directories where practical; create helpers only when needed.

```text
src\
  app\
    (access)\
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
    exports\
    db\
    observability\
    config\
  shared\
    contracts\
    observability\
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

Tenant-routing source map:

- `src/server/config/tenant-directory.ts` validates the versioned directory envelope and isolates invalid or conflicting entries to their affected hosts; project URLs are restricted to canonical HTTPS `*.supabase.co` origins.
- `src/server/config/tenant-context.ts` resolves the exact request host to an immutable context without placing service-role values in that context. Request lookup is React request-cached; there is no mutable process-wide current tenant.
- `src/server/db/clients.ts` binds user and privileged Supabase clients to the supplied context. The privileged credential is read only from its referenced server environment variable.
- `src/proxy.ts` resolves page hosts before session refresh; API handlers resolve through the request Host header. On Vercel, the hosted S04 test project showed that the public host, not forwarded headers, selects the tenant. Tenant routing stays disabled on staging/production until the domain, cap and external release gates are closed.
- Process-wide state audited in S03: React `cache()` lookups are per request; the parsed environment is identical for all tenants; rate-limit buckets are stored in each tenant's own database (only the HMAC key is shared); PDF fonts are static assets. The CSV/PDF render semaphores in `src/server/exports/results-export.ts` are shared by every tenant in one function instance. They hold no tenant data, but one busy RWA can briefly delay another's exports (a fairness limit, not a data-isolation risk). The browser never talks to Supabase directly.
- `tests/e2e/support/tenant-http.ts`: shared guarded helpers for the tenant HTTP specs. They accept only the two disposable project refs (or, for a freshly provisioned project, an explicit `TENANT_HTTP_PROJECT_A_REF`/`_B_REF` override) and never print keys, codes or cookies.
- `tests/e2e/tenant-isolation-live.spec.ts`: opt-in (`TENANT_HTTP_TEST=1`) cross-surface check. It seeds one completed synthetic PUBLIC vote per project, then runs interleaved concurrent requests on both hosts. It asserts that branding, vote lists, vote details, CSV exports, error IDs and rate-limit buckets stay with their own tenant, and that the other tenant's vote returns 404. It needs two customer hosts; since project B became the demo, the second host is a temporarily provisioned project (S07).

Product website, demo and provisioning map (S05-S07):

- `src/shared/host-routes.ts`: which paths the main host serves (website pages, `robots.txt`, `sitemap.xml`, health) and which email-sending routes the shared, writable demo host refuses.
- `src/proxy.ts` rewrites main-host pages to `src/app/site/{page,contact/page,privacy/page}.tsx`; `src/server/http/route.ts` (`enforceHostKind`) answers main-host APIs `NOT_FOUND` and demo email routes `DEMO_EMAIL_DISABLED` before any handler runs.
- `src/server/site/main-host.ts`, `src/server/site/discovery.ts`, `src/components/site/{main-shell,demo-banner}.tsx`: main-site links, host-aware robots/sitemap/metadata, the product shell (no session or RWA data) and the demo banner. `src/app/app-shell.tsx` chooses the shell by host kind; `src/app/not-found.tsx` is host-aware.
- `src/shared/demo.ts`, `src/server/demo/session.ts`, `src/app/api/demo/session/route.ts`, `src/components/demo/demo-persona-sign-in.tsx`: one-click persona sign-in on the demo host (password derived from the demo service-role key, never sent to the browser and self-repaired after a reset, so simultaneous visitors do not cancel each other; global rate limit).
- `scripts/ops/supabase-project.ts`: shared guard that every credential points at the one confirmed project, plus service-role and Auth-lookup helpers.
- `scripts/ops/demo.ts`: `npm run ops -- demo-reset` (shortcut `npm run demo:reset`), which erases and reseeds the marked demo project only.
- `scripts/test/live.mjs`: `npm run test:live` wrapper. Runs the live Vitest suites, then `npm run demo:reset` whenever the cross-customer paired test (which uses the demo as project B) could have run.
- `scripts/ops/provision.ts`: `npm run ops -- provision`, which prepares one fresh customer project step by step (migrations, settings, Auth, first administrator) and prints its directory entry.
- Tests: `tests/unit/{host-routes,demo-session,ops-demo,ops-provision}.test.ts`; hosted `tests/e2e/site-demo-live.spec.ts` (`SITE_DEMO_HTTP_TEST=1`).

Register import and scheduling implementation map:

- `src/components/admin/account-review-table.tsx`: page-scoped account selection, independent enable/eligibility confirmations, administrator warnings and per-row outcomes. `src/app/admin/residents/page.tsx` defaults to the implicit `voter` role and explicitly supports All Roles. Existing `src/server/register/accounts.ts` adds RLS-bound assignment enrichment for only the returned page; shared register contracts define the review projection and action-target helpers. Existing protected PATCH services remain the sole mutation paths, with no new migration or bulk permission bypass.
- `src/components/admin/management-fields.tsx` and `src/app/admin/layout.tsx`: visible, disabled management controls and observer notice. `src/server/authorization/account.ts` separates committee read capability from strict admin mutation checks; `src/server/register/shared.ts` provides explicit committee-read dependencies for read handlers only.
- `supabase/migrations/20261108100000_readonly_committee_role.sql`: exclusive `is_readonly` role, current-profile committee-read helper, narrowly broadened read routines/RLS, audited atomic role changes and readonly provisioning. `tests/integration/readonly-role.test.ts` exercises management read/write boundaries, optional-household observers, privacy and final-admin safeguards; `tests/e2e/readonly-role-live.spec.ts` is an opt-in synthetic disposable-project journey.
- `supabase/migrations/20261113100000_readonly_household_optional.sql`: patches `enable_profile`/`update_profile` so a household is optional for `rwa-readonly` observers (matching `rwa-admin`) — only ordinary residents require one to be enabled or to receive an enabled management account's demotion — with the DETAIL `HOUSEHOLD_REQUIRED`, and keeps the `LAST_ADMIN` guard ahead of the household check.
- App Support Access (RWA-controlled, read-only developer/support grant):
  - `supabase/migrations/20261112100000_app_support_access.sql`: `profiles.is_app_support` with the read-only check constraint, two new audit actions, profile/household guard triggers, patched `update_profile`/`enable_profile`, and the service-role-only `set_app_support_access` routine.
  - `src/shared/contracts/app-support.ts`: `appSupportAccessSchema` (`{enabled}`) and the `AppSupportStatus` projection.
  - `src/server/settings/app-support.ts`: `getAppSupportStatus`/`loadAppSupportActive` reads and `setAppSupportAccess` with fail-safe Auth/database ordering (unban before enable, suspend before ban) around the service-role routine; reads `APP_SUPPORT_EMAIL`.
  - `src/app/api/admin/settings/app-support/route.ts`, `src/components/admin/app-support-access.tsx`: admin-only CSRF-protected `PUT` endpoint and the On/Off settings control under `#app-support`.
  - `src/app/admin/layout.tsx`, `src/app/admin/settings/page.tsx`, `src/app/admin/residents/[id]/page.tsx`, `src/components/ui/badges.tsx`, `src/components/admin/account-review-table.tsx`, `src/components/admin/account-forms.tsx`, `src/server/authorization/account.ts`, `src/server/register/accounts.ts`, `src/shared/contracts/register.ts`: support-account badges/notices, the "App Support Access Is On" admin warning, the `is_app_support` projection, non-reviewability, and the `updateAccount` refusal of support profiles.
  - `tests/unit/app-support.test.ts` (service ordering and refusals) and `tests/integration/app-support.test.ts` (routine, committee reads without writes/voting, household refusal, disable, identity change, actor/service-role checks).
- `scripts/docs/capture.spec.ts` also has a focused **bulk account review** test, refreshing `47-accounts-list` and adding `63-account-review` through `67-enable-admin-warning`. It uses stable-ID synthetic row lookup, independent eligibility/two-account enablement, an unselected account, explicit admin inclusion and a controlled failed request. Ordinary provider/mutation budgets remain in force.

Account and household onboarding map:

The shared `--container-content` token in `src/styles/globals.css` is uncapped:
application/public page shells, headers and footers use available viewport width
with 16px phone and 24px desktop gutters. Individual form/ballot and short-copy
blocks retain `max-w-ballot` readability bounds. Table overflow remains contained
inside its labelled region rather than widening the document.
Shared `PageHeader` in `src/components/ui/layout.tsx` puts the title and
right-aligned actions on a wrapping top row, then renders the description below
at the full available header width. The member Votes and Residents pages also
use this shared component rather than duplicating header layout. It has no
independent copy-width cap.
Form-focused route wrappers use `mx-auto w-full max-w-ballot` with
`data-form-page` for layout regression coverage: resident new/detail/household
eligibility, Settings, vote new/detail/preview and the voter ballot.
Titles, back links, notices and controls center as one left-aligned unit.
Existing access/register/contact/privacy wrappers already use this width.
Directory/import-review, audit, participation and results remain wide; shared
breadcrumbs stay in the shell. `tests/e2e/register-live.spec.ts` and
`tests/e2e/theme.spec.ts` cover route-level centering and responsive gutters.

Shared numbered navigation is implemented in `src/components/ui/pagination.tsx`
and `src/server/http/numbered-page.ts`, using the guarded
`supabase/migrations/20261114100000_numbered_pagination.sql` count/anchor RPC.
It covers member/admin vote lists, Residents, audit, participation and completed
PUBLIC named responses without changing the existing HTTP cursor APIs.
The pagination UI is a client component so its native GET page-size form
submits immediately on selection. The page-size label is inline with its
dropdown, keeping size, position and navigation on one desktop row. Icon-only links retain accessible names and
titles; disabled directions use native disabled buttons. A single
`Page X of Y · N results` summary (singular `1 result`) retains the filtered total without a second
record-range line.
`tests/unit/numbered-pagination.test.ts`,
`tests/integration/numbered-pagination.test.ts` and
`tests/e2e/pagination-live.spec.ts` cover metadata, authorization and navigation.
Each page remains bounded (100 maximum); exact authorized counts and a bounded
sort-key offset locate the existing cursor rather than reading all projections,
except Residents and Manage Votes, which return ordered page IDs through their
table-window RPCs.
Count/anchor share a snapshot, but changing data between page requests can still
move rows. Full exports and PRIVATE/active-result privacy boundaries are unchanged.

`src/components/ui/dialog.tsx` is the shared native confirmation modal for account,
assignment, bulk review/import, ballot editing and vote lifecycle actions. It is
fixed and centred in both viewport axes at every breakpoint, with phone gutters
and internal scrolling for content taller than 90dvh. Native focus containment,
Escape cancellation and return focus are preserved; menus and combobox lists
remain anchored to their controls. Each dialog labels itself with its own
`useId` title id, so pages rendering several dialogs announce the right title.

- `src/components/ui/date-time-picker.tsx`: accessible themed calendar modal and 12-hour AM/PM editor for draft opening/closing deadlines; displays `hh:mm:ss AM/PM` and returns second-precision local values for conversion in the configured RWA timezone.
- `src/app/admin/residents/page.tsx`: unified people/assignment directory, defaulting to Voters, with global column sorting, role/status/source/identifier/eligibility (including no assignment), name and profile-changed-time filters, plus independent access/eligibility review actions. `listResidentTable` in `src/server/register/accounts.ts` validates bounded ordered IDs and exact metadata from `get_resident_table_page`, then uses shared page-scoped profile/household/Auth enrichment, preserving App Support flags. Account API paths, ID ordering, response shapes and the older `listResidents` cursor service remain unchanged.
- `src/components/admin/resident-table-controls.tsx`, `resident-identifier-filter.tsx` and shared `src/components/ui/data-table.tsx`: URL-backed sortable column headers with `aria-sort`, native top-layer filter popovers, Settings-backed identifier picker/manual fallback, Source column controls and mobile Sort & Filter controls. Data-table headers/cells expose their column keys, and responsive table views filter columns by the same keys before rendering headers and values. Dropdown lists expand in flow inside scrolling panels. The Clear filters link removes filter state while preserving sort, direction and page size. The uncontrolled filter forms here, in Manage Votes (`vote-table-controls.tsx`) and in Audit History are keyed by the URL state, so they remount after any URL change and never re-apply cleared values. Controls remain usable for observers outside management-disabled fields; selections clear on ordering/filter/page/size changes.
- `src/components/admin/audit-table-controls.tsx` and `src/components/ui/table-filter-popover.tsx`: Audit History's URL-backed browser-local date-range, Who, Action, Target and combined Details/reason filters, including its mobile combined filter toolbar; the shared viewport-aware native popover is also used by Residents. Clearing filters preserves page size; audit pagination remains newest-first and timestamps display in the viewer's time zone.
- `src/app/admin/votes/[id]/participation/page.tsx` and `src/components/admin/participation-filter.tsx`: participation follow-up page. It mirrors the results header: **Participation: {title}** heading, collapsible background or instructions, then type/status badges and the turnout line with an (i) "About this list" explanation in place of a header subtitle (vote read once per request via React `cache`; the title also appears in the browser tab title); the Show filter applies on selection and preserves page size.
- `src/components/votes/vote-instructions.tsx`: shared collapsed **Background** (PUBLIC) / **Instructions for voters** (PRIVATE) disclosure placed under the results and participation page headers; renders nothing when the vote has no text.
- `src/app/votes/[id]/results/page.tsx`: results page; the heading and browser tab title use the vote title (no RWA subtitle). In `src/components/votes/results-view.tsx`, completed results put the eligibility-freeze note behind an (i) beside **Voting ended** and keep the Download text to a short plain-language note. The record disclaimer is not shown on the results screen (active or completed); it remains in the CSV `NOTICE` row and the PDF. Completed PRIVATE offices render as bordered cards in a one-column grid that becomes two columns from the `md` breakpoint. The turnout bar uses `ResultBars fullWidth` so it spans the page width; option and candidate bars keep the ballot reading width.
- `src/app/admin/votes/page.tsx`, `src/components/admin/vote-table-view.tsx`, `src/components/admin/vote-table-controls.tsx`, `src/components/admin/vote-table-urls.ts` and `src/server/votes/drafts.ts`: Manage Votes' plain table headings and all-viewport Sort & Filter toolbar for title/type/status/closing-deadline/last-changed filters and ordering, plus a final aggregate Turnout column for Active/Completed votes. On compact screens, the vote table view keeps Vote/Status/Turnout visible and stores the optional Type/Deadline/Last Changed choices in browser local storage; desktop shows every column. The toolbar shares the Residents funnel-with-arrows and circled-X icons. `vote-table-urls.ts` holds the pure URL/clear-filter helpers shared by the server page's empty state and client controls; `tests/unit/vote-table-urls.test.ts` and `tests/unit/vote-table-controls.test.ts` cover URL, toolbar and responsive column behavior. The UI uses `get_admin_vote_table_page` to select exact, authorized page IDs and page-bounded frozen-electorate/participation counts; no choices or result totals are included, and the existing HTTP vote-list cursor contract remains unchanged.
- `supabase/migrations/20261119100000_admin_vote_table_controls.sql`: committee-guarded sorting, filtering and exact totals/page IDs for the Manage Votes UI; no write, electorate or lifecycle behavior changes.
- `supabase/migrations/20261120100000_admin_vote_turnout.sql`: additive replacement of the same guarded Manage Votes table routine, adding page-bounded aggregate turnout counts for Active/Completed rows only; no ballot or HTTP list projection changes.
- `src/components/ui/app-shell.tsx`: administration navigation keeps Residents and Manage Votes as text tabs and places icon-only Settings then Audit History links at the right before Sign Out, with accessible labels and hover titles.
- `supabase/migrations/20261117100000_resident_source_sort.sql`: global Source ordering in the same committee-only table routine, with existing boolean filters and stable ties unchanged.
- `supabase/migrations/20261118100000_audit_text_filters.sql`: bounded literal text filters on the displayed audit actor and combined Details/reason values, with matching numbered totals/anchors and newest-first order.
- `supabase/migrations/20261115100000_resident_table_controls.sql`, `tests/integration/resident-table.test.ts`, `tests/unit/resident-table-controls.test.ts` and `tests/unit/register.test.ts`: guarded global query, real PostgreSQL sort/filter/page/permission coverage and service/URL/header regression checks. Apply the read-only migration before the new table revision; it is not automatically applied.
- `supabase/migrations/20261116100000_resident_identifier_contains.sql`: additive table-RPC filter for case-insensitive identifier substrings, preserving the old exact filter and all account/cursor APIs. The Residents page maps URL `identifier` to `identifierContains`; `resident-identifier-filter.tsx` accepts partial text with optional Settings suggestions using `ComboboxField.allowCustomValue`, leaving strict onboarding defaults unchanged.
- `src/app/admin/residents/new/page.tsx`, `src/components/admin/account-forms.tsx` (`AccountCreateForm`, shared `HouseholdPicker`): one form for the account, household (required for voters in the admin form, optional for management roles; combobox of unassigned Default Households when configured, otherwise free text), eligibility and "Enable account now". The API retains optional-household provisioning for compatibility.
- `src/app/admin/residents/[id]/page.tsx`, `AccountHouseholdSection` and `src/app/api/admin/accounts/[id]/household/route.ts`: assign a household to an account without one or move it (rename, eligibility kept, confirmation dialog).
- `src/app/admin/residents/import/page.tsx`: centered CSV import form. The former `/admin/accounts` and `/admin/households` UI route trees and compatibility redirects are removed; those URLs return 404. The standalone Residents eligibility route is also removed; eligibility is edited inline on resident details. Existing account/household API routes remain unchanged. `/admin` opens Residents.
- `src/server/register/accounts.ts` (`createAccount`): list and "already assigned" pre-checks, Auth identity, the service-role `provision_profile_with_household` routine, best-effort identity removal on failure, then the normal enable workflow when requested. `src/server/register/households.ts` adds `resolveHouseholdChoice`, `assertHouseholdFree`, `getAccountHousehold` and `setAccountHousehold`; `src/server/settings/rwa-profile.ts` `loadHouseholdChoices` supplies the picker options.
- `src/components/admin/household-form.tsx`: eligibility-only editor, expanded inline by `AccountHouseholdSection` with Save/Cancel and same-page refresh. It uses the existing guarded PATCH API and preserves frozen electorates. Moving a household is hidden during inline editing to keep the operations separate. The former `/admin/households/new` page was removed.
- `supabase/migrations/20261110100000_account_with_household.sql`; `tests/unit/register.test.ts` (combined creation) and `tests/integration/account-with-household.test.ts`.
- `supabase/migrations/20261111100000_resident_directory.sql` and `tests/integration/resident-directory.test.ts`: existing security-invoker view and RLS regression coverage, now consumed by `listResidents`. Cursors contain only the stable profile ID, bound to the directory filters; subsequent pages resolve its current sort key through the caller's RLS session. This avoids resident names in URLs and oversized Unicode-name cursors. Concurrent register edits can move rows; restart the list when reconciling changes. No new migration is needed for the consolidation.

Resident self-registration implementation map:

- `src/app/register/page.tsx`, `src/components/access/self-registration-form.tsx`: public, `noindex` page (not in the sitemap) with name, email and RWA-worded household identifier plus a hidden honeypot. When Default Households are configured the identifier is chosen with `src/components/ui/combobox-field.tsx` (ARIA combobox/listbox: type to filter, arrow keys, Enter, Escape; only list entries can be submitted; at most 100 matches rendered); otherwise it is free text. If the list cannot be read, including when the server-only Supabase client is not configured (as in CI's browser step), the page still renders and shows an unavailability notice. Linked from `/sign-in` and the footer; a signed-in account is redirected home.
- `src/app/api/register/route.ts`, `src/server/register/self-registration.ts`: CSRF/Origin-protected `POST /api/register`; per-email, per-household and global budgets; configured-list check (`UNKNOWN_HOUSEHOLD`) before the Auth stage; Auth identity first (so a repeated email is reported before a taken household), then the service-role routine; best-effort removal of an identity created by a failed request. Specific `DUPLICATE_EMAIL` / `DUPLICATE_IDENTIFIER` conflicts are returned as field errors. `selfRegistrationSchema` lives in `src/shared/contracts/register.ts`.
- `supabase/migrations/20261109100000_resident_self_registration.sql`: `profiles.self_registered`, `PROFILE_SELF_REGISTERED` audit action, the service-role-only `get_self_registration_households` read and the `self_register_resident` routine creating a suspended profile plus ineligible household atomically (restricted to configured Default Households when any exist).
- `src/app/admin/residents/page.tsx`, `src/components/admin/account-review-table.tsx`, `src/server/register/accounts.ts`: icon-only **Source** column immediately before Actions, with sorting and `selfRegistered` filtering instead of a top filter/name caption. `RegistrationSourceBadge` in `src/components/ui/badges.tsx` supplies accessible/hover/tap text; enabling and eligibility still use the existing review actions. Reset/mobile controls share the selection/bulk-action toolbar but remain outside management-disabled fieldsets for observer access.
- `tests/unit/self-registration.test.ts` (route, honeypot, budgets, conflicts, configured-list checks, cleanup) and `tests/integration/self-registration.test.ts` (routine, duplicates, normalization, configured list, grants).

- `src/shared/contracts/register-import.ts`: bounded `csv-parse` parsing, strict row/request validation and outcome types; `tests/unit/register-import.test.ts` covers parsing and orchestration.
- `src/server/register/import.ts`: current-admin checks, supported Auth lookup/provisioning and guarded row assignment. It never enables accounts or overwrites records.
- `src/components/admin/register-import-form.tsx`, `src/app/admin/residents/import/page.tsx`: memory-only resident CSV selection, preview, progress, confirmation and resident-review links; `src/app/api/admin/households/import/route.ts` processes bounded per-row requests.
- `src/app/api/admin/votes/[id]/schedule/route.ts` and `schedule/withdraw/route.ts`: confirmed schedule/withdrawal endpoints. Existing lifecycle controls, preview and vote pages provide the UI.
- `supabase/migrations/20261106100000_register_import.sql`: guarded import inspection/assignment; `tests/integration/register-import.test.ts` verifies conflicts, permissions, concurrency and suspended access.
- `supabase/migrations/20261107100000_scheduled_opening.sql`: opening fields, scheduled state, freeze/withdraw/opening routines, direct-read ballot privacy and Cron integration; existing `tests/integration/lifecycle.test.ts` exercises boundaries.
- `supabase/migrations/20261121100000_vote_draft_opening.sql`: persists an optional planned opening in a draft and exposes it only through the guarded draft projection; scheduling still requires the confirmed freeze routine.
- `supabase/migrations/20261121110000_draft_opening_public_private_types.sql`: keeps planned-opening draft updates compatible with PUBLIC/PRIVATE ballot options and offices; `tests/integration/drafts.test.ts` covers saving the opening with ballot content.
- `supabase/migrations/20261122100000_delete_drafts.sql`: adds revision-checked, confirmed and audited draft deletion through a guarded administrator routine.
- `supabase/migrations/20261123100000_enabled_rwa_admin_names.sql`: adds an authenticated, enabled-member-only name projection for the Contact page; App Support, anonymous and service-role callers are denied.
- `scripts/docs/capture.spec.ts`: opted-in synthetic screenshot journeys. The default docs configuration selects resident/admin onboarding, bulk review, import/scheduling and voting. Only the curated inventory is written to `public/guides/{resident,rwa-admin}`, with exact dimensions, email/code redaction and dialog-only confirmations. Requires `LIVE_AUTH=1`, `DOC_SCREENSHOTS=1`, `DOC_DISPOSABLE_CONFIRMED=1` and an authorised disposable project. `tests/e2e/support/live.ts` uses verified database TLS with a provider CA.

### Public discovery and contact additions

The crawlable public surface is `/sign-in`, `/privacy`, `/contact`, `/user-guide`,
`/user-guide/resident` and `/user-guide/rwa-admin`. These
pages use server rendering through the session-aware shell, not a client-only
SPA. `/register` is public but deliberately `noindex` and outside the sitemap.
Private routes inherit `noindex, nofollow`; robots and sitemap are not
authorization. Do not include register, ballot or results URLs in discovery.
With tenant routing on, discovery is per host: the main host lists only its
product pages, the demo host disallows all crawling, and customer hosts list
their own public pages with relative canonical URLs.

| File | Responsibility |
|---|---|
| `src/shared/metadata.ts` | Public route allowlist, canonical/social metadata and private record titles/canonicals; no-index defaults |
| `src/app/robots.ts`, `src/app/sitemap.ts` | Public discovery, derived from the allowlist |
| `src/app/opengraph-image.tsx` | Public 1200 by 630 PNG share artwork, without resident information |
| `src/app/icon.svg` | Selected F/Open Conversation favicon; Next.js automatically emits the app icon link and serves the scalable SVG at `/icon.svg` |
| `src/app/privacy/page.tsx`, `src/app/contact/page.tsx` | Public privacy notice and support entry point; Contact conditionally renders the guarded enabled-RWA-Admin name projection to enabled RWA members only |
| `src/server/settings/rwa-profile.ts` | Server-side validation of member branding, profile and the names-only Contact directory projections |
| `src/components/ui/public-structured-data.tsx` | Escaped Organization and public BreadcrumbList JSON-LD |
| `src/components/ui/breadcrumbs.tsx` | Contextual navigation using generic record labels |
| `src/components/ui/field-info.tsx` | Client click-to-open (i) field help; shifts an opened panel to stay inside the viewport. Re-exported from `field.tsx` |
| `src/components/ui/public-analytics.tsx` | Optional, opt-in GA4 on privacy/contact only; sanitized path-based views |
| `src/components/access/contact-form.tsx` | Accessible support form, validation and uncertain-send recovery |
| `src/shared/contracts/contact.ts` | Strict, bounded support payload |
| `src/app/api/contact/route.ts`, `src/server/contact.ts` | CSRF-protected, rate-limited Resend delivery; never an OTP or voting dependency |
| `tests/unit/metadata.test.ts`, `tests/unit/contact.test.ts` | Discovery policy, contact protections and controlled transport tests |
| `src/app/user-guide/{page.tsx,resident/page.tsx,rwa-admin/page.tsx}` | Public persona index and complete resident/admin journeys; footer destination and crawlable public routes |
| `src/app/tech-guide/page.tsx` | Public unlisted junior-developer reference; noindex/nofollow, outside sitemap and app navigation; not an authorization boundary |
| `src/components/guides/guide.tsx` | Shared responsive contents sidebar, stable section anchors, text/steps/notes, exact-dimension lazy Next Image figures and source-file tables |
| `src/components/guides/{resident-content,admin-content,technical-content}.tsx` | Owned end-to-end procedures, source/route maps, developer traces, deployment/tests and safe debugging |
| `src/components/guides/diagrams.tsx` | Dependency-free textual flow diagrams and accessible SVG ERD with key/cardinality descriptions |
| `src/shared/guides/screenshots.ts` | Curated referenced image paths, personas and captions, shared with the capture runner |
| `public/guides/{resident,rwa-admin}`; `public/guides/dimensions.json` | Refreshed synthetic PNGs and generated true intrinsic sizes; no base64-embedded HTML bundle |
| `scripts/docs/check.test.mjs`; `tests/e2e/guides.spec.ts` | Inventory/source/anchor checks plus public navigation, image delivery, discovery, axe and responsive browser checks |

Guide pages use the normal app shell/theme/favicon with full-document public
boundary navigation and lazy screenshots that open at full size in a new tab.
Every page has contents links; section URLs are bookmarkable. Only Resident and
RWA Admin get dedicated pages in this scope; ReadOnly remains an application role.
There is no generic endpoint exposing repository files. Source paths are text in
the public technical guide, not arbitrary file downloads. Analytics remains
limited to consented privacy/contact visits, not guides. Normal dev/build no
longer generates documents; captures are explicit synthetic test work.

Public information links across the authentication boundary intentionally use
full document navigation: removing Next.js Script from JSX does not unload a
previously executed tracker. Never replace those boundary anchors with SPA
navigation without preserving isolation. GA4 enhanced measurement must also be
disabled in the property. No form payloads, URL queries, referrers, account names
or voting events are sent. Analytics is disabled by default and consent can be
withdrawn. Contact messages are emailed, not stored in application tables;
rate-limit buckets retain only HMAC subjects. See deployment for activation and
the remaining identity/retention/provider approvals.

## 05 Data Model and Database Permissions
Use stable identifiers, foreign keys, nonnegative counter constraints, explicit state checks and UTC `timestamptz` values. Store the RWA's IANA timezone for input/display.

| Record | Responsibility |
|--------|----------------|
| Supabase `auth.users` | Managed authentication identity; do not replace with custom OTP/session tables |
| `profiles` | Stable auth-user reference, representative name, current application role and suspension status |
| `households` | Unique normalized household identifier, current representative and eligibility |
| `rwa_settings` | RWA identity/contact profile, household label, identifier kind, timezone, approved policies, retention settings and approval metadata; private fields are read only through admin-guarded RPCs |
| `votes` | Voting type, separate lifecycle state, ballot metadata, frozen deadline, activation/effective completion timestamps, revision and terminal reasons |
| `offices`, `candidates`, `poll_options` | Ordered choices with ownership constraints tying them to the correct vote/office |
| `electorate` | Unique vote/household entitlement with frozen representative and name/household snapshots |
| `participation` | One accepted participation per frozen entitlement; no PRIVATE choices |
| `open_responses` | Current selected option row(s) for one PUBLIC ballot per accepted household; the set is replaceable only while active |
| `closed_tallies` | Candidate and NOTA counters per office; no per-ballot rows or selection timestamps |
| `audit_events` | Administrative actor/action/record/time/reason, never codes or vote payloads |
| Application rate limits | Shared, atomic counters where application-level limits are needed beyond Auth limits |

### Permission rules
- Enable RLS on all application tables; revoke unauthenticated application-data access and unnecessary table/function privileges.
- Deny direct client access to choice storage, including authenticated admin access. Expose active PUBLIC aggregates, active PRIVATE aggregate turnout, and completed data through authorized projections; never expose active choices.
- Do not expose private tables through Realtime publications or change feeds. Members cannot inspect others' active participation; administrators and `rwa-readonly` observers may view the active PRIVATE household participation list for follow-up, never choices.
- Members cannot update role, suspension, electorate, participation, counters or audit records directly. Never trust a role supplied in user-editable Auth metadata.
- Guard every role assignment and register/draft/lifecycle mutation with a true-admin check; `rwa-readonly` is an explicit read capability, never a mutation predicate. Enforce frozen configuration in the database, not only the service.
- Separate migration-owner privileges from runtime access. Function owners use restricted non-login roles with only the required privileges.
- For `security definer` functions, fix `search_path`, schema-qualify references, revoke default public execution and grant only required callers. Explicitly validate `auth.uid()`, current profile status, capability and frozen entitlement inside each user-callable function.
- Never accept an account/household identifier from the request as proof of identity. User-facing functions derive identity from the verified JWT context.
- Cron runs a separate maintenance entry point with no end-user JWT; grant it only to the scheduling role. Do not make maintenance callable by normal users.

`rwa-admin` and `rwa-readonly` are mutually exclusive management roles. Readonly observers receive the same authorized management reads/downloads as admins, with disabled UI controls; only admins change roles or data. Either enabled role may vote through its own household entitlement, and neither role grants access to individual PRIVATE choices. Supabase dashboard/database operators are privileged infrastructure operators, not application admins.

## 06 Authentication, Register and Sessions
- CSV onboarding creates households and representative accounts together after preview/confirmation, with no public signup or role column. Exact matches are skipped; mismatches are reported, never merged. At most 500 rows/256 KiB are accepted. Each row is a separately retryable cross-service workflow, not an all-file transaction; partial or uncertain failures stop further processing. New accounts stay suspended pending review and explicit enablement through existing account controls. CSV data stays in browser page memory and is never logged. A dedicated 1200-request/hour administrator budget covers check/import stages without relaxing ordinary mutation budgets.
- Disable Supabase Auth public sign-up. Use Supabase Auth email OTP with `shouldCreateUser: false` for login and a six-digit code template using `{{ .Token }}`.
- Resident self-registration (`/register`) is a server-side workflow using the privileged Auth client: it creates a suspended resident profile and an ineligible household only. It never enables access, assigns roles or makes a household eligible, and repeated emails or households are rejected.
- Admin provisioning creates the Auth identity and associated profile/household assignment through controlled server-only code. Auth and application-record changes are not one cross-service transaction: use a retry-safe provisioning workflow, surface partial failure, and do not grant access until the application assignment is valid.
- Bootstrap the first admin through a controlled deployment command against an approved address; no public bootstrap endpoint or default credentials.
- Normalize emails using one documented policy without provider-specific rewriting. Reject duplicate household IDs and ambiguous representative assignments.
- Return generic code-request acknowledgements without revealing registration. Invalid/expired codes get actionable retry guidance without exposing account existence.
- Configure custom SMTP, expiry, resend cooldown, attempt/request limits and sender authentication. Never log OTPs or email contents.
- OTP request and verification add per-RWA shared atomic IP budgets (30 requests and 100 verifications per 15 minutes) alongside the email budgets. `src/server/auth/trusted-client-ip.ts` trusts only a single valid Vercel-overwritten `X-Forwarded-For` value when `TRUSTED_PROXY_CONFIG=vercel` and `VERCEL=1`; missing, ambiguous or invalid source data fails closed. Raw IPs are HMACed before the limiter and never stored or logged. Pilot capacity and hosted spoofing tests remain release gates.
- Use `@supabase/ssr` for the Next.js cookie/session integration. Verify identity server-side using supported Auth verification methods; do not trust an unverified cookie session object as authorization.
- Apply secure cookie settings and the SDK's supported refresh behavior. Session cookies use a tenant-specific name, are HttpOnly and omit Domain; production names use the `__Host-` prefix. Do not invent a parallel opaque-session system.
- Check current application suspension/role on each protected operation and inside guarded database functions. A still-valid JWT must not bypass suspension or changed entitlement.
- Implementation: `src/proxy.ts` refreshes an expiring session before render (Server Components cannot set cookies) and forwards the new cookies to the page and browser; this is session upkeep, not authorization. Session cookies are hardened in one place (`src/server/auth/session-cookies.ts`): HttpOnly, SameSite=Lax, Secure in production, capped at 14 days as a sliding inactivity window (provisional until A4).
- Sign-out and administrative Auth actions do not necessarily invalidate every issued JWT immediately. Enforce application access independently and test existing-token scenarios.
- Native time-boxed sessions, inactivity limits and single-session enforcement require Supabase Pro or higher. Do not promise those controls on Free; approve the persistent-session policy under A4.
- Server-proxied Auth calls use Vercel's documented overwritten `X-Forwarded-For` only on the configured Vercel runtime. Do not trust arbitrary forwarding headers or place an unapproved upstream proxy in front; shared-NAT IP thresholds require pilot validation.
- Privileged Auth credentials remain server-only and isolated to provisioning/administrative Auth operations and resident self-registration. Never use them for ordinary ballots, results or exports.

## 07 Atomic Voting and PRIVATE Privacy
Each `cast_vote` call performs one guarded PostgreSQL transaction:
1. Lock the vote row using the same lock order as lifecycle operations.
2. Recheck the authenticated profile's status, frozen representative entitlement, voting type and Active state.
3. Check the current database clock after acquiring the lock, immediately before acceptance. Require time strictly before the frozen deadline; use a current clock reading rather than transaction-start `now()`.
4. Check unique participation and validate the complete ballot: at least one owned PUBLIC option within the selection rule, or one valid candidate/explicit NOTA choice for every office. Reject empty/duplicate options, missing/repeated offices, extra input and choices belonging to another vote/office.
5. Insert one participation row and either the full PUBLIC selection set or all PRIVATE candidate/NOTA counter increments atomically.
6. Commit durably, then acknowledge participation only. Never return PRIVATE selections.

- Any failure rolls back participation and every response/counter update. Unique constraints remain the last defense against concurrent retries.
- Acquire subordinate locks in stable order. Serialize completion/cancellation on the same vote row.
- A request arriving before the deadline but waiting past it is rejected. A transaction admitted before the deadline may commit afterwards; click time and HTTP arrival do not reserve acceptance.
- Per-vote serialization is deliberate at this scale, but must pass contention/load tests rather than being assumed fast enough.
- If acknowledgement is lost, the UI checks own participation. If that also fails, show an unknown outcome, not false rejection or success.

### Privacy boundary and limitations
- Store aggregate PRIVATE counters, not individual ballots, cross-office ballot identifiers or correlatable per-response timestamps alongside choices.
- Keep participation separate, while updating it in the same transaction as counters. This prevents ordinary stored identity-to-choice mappings; it is not a proof of cryptographic anonymity.
- Disable vote/auth payload capture in application, proxy, APM, error reporting and SQL-parameter instrumentation. Never record selections in receipts, audit events, URLs or notifications.
- Deny active tally snapshots, debug dashboards and change feeds that could permit differencing.
- Database WAL, backup comparisons, privileged instrumentation or a compromised application process may reveal counter changes and transaction relationships. Small/unopposed elections may permit inference from final totals.
- Document and obtain A2 approval for these limits. Stronger secrecy requires a separately approved cryptographic design, not a toggle on this schema.

## 08 Lifecycle, Maintenance and Counting
### Draft and activation
- A ready preview may instead schedule the future opening time saved in the draft's Deadline section, shown and confirmed in the RWA time zone without a second editable opening field. Scheduling freezes ballot, electorate, representatives and policy/display snapshots immediately and initializes zero PRIVATE counters. Residents see only summary/instructions/times/countdown until opening; RLS also hides candidates/options from direct reads. The database-clock opening helper shares the vote lock and admission timeout. Cron and authorized list/detail/submission calls reconcile due openings; delayed processing never opens early or extends closure. A missed window completes with zero participation at its original deadline.
- A confirmed withdrawal with a reason may return a scheduled vote to draft only before opening. It clears frozen snapshots/zero counters, advances the revision and records `VOTE_SCHEDULE_WITHDRAWN`; fresh preview and scheduling/activation are required. No active or terminal vote can use this path.
- Use draft revision checks to prevent lost edits and stale preview confirmations.
- Activation atomically revalidates the previewed revision, freezes ballot content/electorate/representative assignments (the deadline can later move only through the audited deadline change below) and relevant display metadata, initializes counters, changes state and appends audit history.
- Later register edits affect future votes only. Suspension may block access but does not transfer an active entitlement or remove accepted votes.

### Completion and cancellation
- Draft -> Active or Draft -> Scheduled -> Active precedes completion/cancellation; only a not-yet-opened schedule may return to draft. Terminal votes never reopen.
- Schedule idempotent due completion through Supabase Cron, initially once per minute. It uses the same guarded lifecycle logic and vote-row locks.
- Authorized service reads may invoke narrowly scoped overdue reconciliation before fetching state/results; plain download responses must not perform unrelated mutations.
- Submission deadline checks remain authoritative even if Cron is delayed or unavailable. Database pausing prevents Cron from executing; Cron is not a keep-alive guarantee.
- Scheduled completion records the deadline as effective completion time, not job execution time.
- Early completion requires confirmation/reason and is labelled in results/exports. Cancellation requires a reason; reconcile overdue state before deciding whether an Active transition is still allowed.
- Cancelled votes display "Cancelled; results not valid" without publishing choices or enabling exports. Correct an invalid active vote by cancellation/replacement, not edits.
- Outages never automatically extend deadlines.

### Deadline changes
- The deadline is the only field of an Active vote that may change. An administrator can move it later or earlier, for PUBLIC and PRIVATE votes, with a confirmed request and a required reason. The new deadline must be at least 5 minutes ahead and different from the current one.
- The change runs through one guarded database routine under the vote lock. An overdue vote is completed at its old deadline instead. The reason and previous/new deadlines are recorded only in the audit trail; residents are not notified, but countdowns, admission and due completion follow the new deadline.

### Results
- Show active PUBLIC aggregate counts/turnout and active PRIVATE aggregate turnout to eligible Residents and authorized RWA Admin/ReadOnly readers, but hide active choices. During active PRIVATE elections, RWA Admins and RWA ReadOnly observers may see household participation for follow-up. Keep PRIVATE candidate/NOTA totals hidden until completion. Apply the same authorization to pages, API and exports.
- Use one consistent result projection/snapshot for active aggregates and completed screens/exports; only completed data can be exported.
- Frozen eligible households form the turnout denominator, including households later suspended.
- Submitted ballots equal accepted participation. Per office, candidate counts plus NOTA count equal submitted ballots; every PUBLIC participant has one or more valid selected-option rows.
- Candidate/NOTA and PUBLIC per-option `percent` use submitted households; `eligiblePercent` uses eligible households and is what the results page and PDF bars display. Multi-select PUBLIC option shares can sum above 100%; show explicit denominators and a not-applicable zero-denominator state.
- Use one rounding policy without changing raw counts to make percentages sum to 100.
- Zero ballots have no winner. Tied positive candidate leaders are marked "Tie". NOTA is counted separately and cannot win; the highest-count candidate is elected even when NOTA receives more votes. If no candidate receives a vote, no candidate is elected.
- Check invariants before publishing results/exports. A mismatch blocks publication and triggers a safe operational alert; never silently fabricate or repair totals.
- PUBLIC names and household labels come from frozen snapshots. PRIVATE results never expose voter lists or individual ballots; active PRIVATE turnout does not include household identities.

## 09 API and Error Contracts
Use same-origin endpoints and explicit response projections. Server actions may share the same services; do not create duplicate business logic.

| Endpoint group | Responsibility |
|----------------|----------------|
| `POST /api/auth/code`, `/verify`, `/sign-out` | Request/verify OTP and manage Auth session |
| `GET /api/votes`, `GET /api/votes/{id}` | Authorized summaries and ballot detail, no active choice totals |
| `GET /api/votes/{id}/participation` | Own accepted/not-submitted status |
| `POST /api/votes/{id}/submission` | PUBLIC response submission/replacement or one final PRIVATE ballot; participation-only response |
| `GET /api/votes/{id}/results` | Authorized active aggregates or completed, reconciled results |
| `GET /api/votes/{id}/exports/{format}` | CSV; PDF only when implemented |
| `/api/admin/households`, `/api/admin/votes` | Admin register, lists and revision-checked draft operations |
| `DELETE /api/admin/votes/{id}` | Confirmed, revision-checked draft deletion with an audit record |
| `POST /api/admin/votes/{id}/{action}` | Validated activation, early completion and cancellation |
| `GET /api/admin/votes/{id}/participation` | Admin participation monitoring without selections |
| `GET /api/admin/audit` | Paginated audit history |
| Internal health | Minimal dependency status without secrets/member data; not a pausing workaround |

- Match existing routes where practical and reconcile [API.md](./API.md) during implementation; these are target responsibilities, not a claim of current endpoint availability.
- Bound body/string/list sizes and paginate register/audit/named-response screens. Exports include the complete authorized dataset, not just the displayed page.
- Use stable error codes, safe messages, optional safe field errors and random, readable error IDs (`AREA-XXXXX-XXXXX`). Never echo ballot choices in errors.
- Error handling is centralised:
  - `src/server/http/errors.ts` is the catalogue: status, safe message, category, `user`/`system` type, log level and operator hint per code, plus an identifier-only `cause` and an optional `report: false`.
  - `src/server/http/route.ts` creates the error ID (`src/shared/observability/error-id.ts`) and runs each handler inside a request log context (`src/server/observability/request-context.ts`). Nested logs and Sentry reports (`src/server/observability/error-reporting.ts`) therefore carry the same ID, area, route, host and tenant.
  - Every failure is logged once as `request.failed` (or `request.unhandled`). System faults go to Sentry, tagged `error_id` and grouped by code and route.
  - `src/server/db/errors.ts` records the SQLSTATE/status as the cause.
  - Page crashes use `src/app/error.tsx` and `src/app/global-error.tsx`, through `src/components/ui/page-error-id.ts`, with a `PAGE-` ID.
- Use 401 for unauthenticated, 403 for denied capabilities, 404 for inaccessible vote IDs, 409 for PRIVATE duplicates/stale revision/lifecycle conflicts, 422 for validation, 429 for limits and 503 for temporary dependencies.
- Distinguish unknown submission outcome from rejection. A duplicate response directs the UI to confirm participation.
- Loading, empty and failure states remain explicit; no broad catches returning empty results or success-shaped defaults.

## 10 Exports
- CSV is in scope for version 1. PDF may be deferred; hide unavailable controls and do not block pilot readiness for an unimplemented PDF feature.
- The database is authoritative. Exports are generated on demand from completed results; do not store public report files, editable report copies or bearer download URLs.
- Recheck authorization and completion for every download. Use attachment disposition, safe filenames, correct MIME types, `nosniff` and `no-store`.
- PUBLIC exports include the full authorized named-response list without emails. PRIVATE exports contain aggregate data only, never household/voter lists.
- Escape CSV values and neutralize spreadsheet formulas in user-controlled text.
- When PDF is added, render with PDFKit in a Node.js server route using bundled fonts per the design system. Verify approved script coverage and actual rendering, not just font presence.
- Include RWA/title/type, ballot labels, activation/effective completion times and timezone, turnout/denominators, totals, NOTA counts/ties/no-votes, generation time and early-completion reason where applicable.
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
- Authorized operators may inspect RWA setup without an app session using `npm run ops -- config-check` and a separately protected `CONFIG_DATABASE_URL`. This local command requires operator database privileges, uses one bounded repeatable-read/read-only transaction, refuses filtered RLS reads, reuses preview blockers and count-only invariant monitoring, and always rolls back. Its local service-role claim is only for the existing status routine, never a browser login. It emits configuration summaries and aggregate role/vote counts, not residents or PRIVATE choices, and never reconciles lifecycle. It creates no grants, app roles or HTTP backdoor. Production environment shape checks concern injected values only; external verification and approvals remain open. See [Operations](./OPERATIONS.md#read-only-rwa-configuration-inspection).
- Keep canonical application origin, Supabase URL/public client key, server-only privileged credentials and SMTP settings in appropriate environment/provider configuration. The Supabase URL and public key are not secrets; privileged credentials must never use a browser-visible prefix.
- Store RWA timezone, policy approvals and retention settings in controlled database records. Block real activation until required approvals are recorded.
- Configure the RWA profile (required full name, alias, household label and identifier kind; optional address, email, phone, website and welcome message, hidden when blank; one of six contrast-checked accent palettes) in Settings. RWA Admins can read and update it; RWA ReadOnly observers can read but not change it. The household and identifier labels are display-only. Updates audit changed field names, not values. Changes apply to all screens and exports immediately, including existing votes.
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
| Unit | Validation, roles/type/state, percentages/rounding, candidate ties, NOTA-versus-candidate winner logic, zero-vote outcomes, error/result projections |
| Supabase integration | Real migrations, RLS/grants, direct API/RPC denial, guarded functions, Auth context, frozen entitlement, rollback and lifecycle races |
| Concurrency | Double-submit/multiple devices, injected failure midway through counters, lock waits crossing deadline, exact-deadline rejection |
| Auth/authorization | OTP limits, no account enumeration, provisioning failure/retry, suspension with existing JWT, role changes, admin without entitlement |
| Browser | Both voting types, mobile admin/member journeys, review/confirmation, lost acknowledgement, unknown outcome, results and CSV |
| Privacy | HTML/API/errors/logs/ordinary records expose no PRIVATE identity-to-choice mappings or active tallies |
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
