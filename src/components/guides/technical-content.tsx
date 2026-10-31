// Junior-developer reference grounded in the implemented routes, services and ordered SQL migrations.
import { ErDiagram, FlowDiagram } from "./diagrams";
import { FileTable, Note, Steps, type GuideSection } from "./guide";

export const technicalSections: GuideSection[] = [
  {
    id: "mental-model",
    title: "1. Start with the mental model",
    content: (
      <>
        <p>
          Civic Pulse is a single-RWA voting application, not a multi-tenant
          platform. Next.js renders pages and handles HTTP; Supabase Auth proves
          identity; PostgreSQL guards authoritative state and results. A
          resident is the current representative of a household, but voting
          rights are frozen for each vote when activated or scheduled.
        </p>
        <p>
          PUBLIC polls allow a single or multiple-option response and
          replacement before closing; authorised completed results attribute the
          final response. PRIVATE elections require one candidate or NOTA per
          office, accept one final submission and keep only aggregate choice
          counters. Participation records who submitted, never a PRIVATE
          selection.
        </p>
        <Note>
          This URL is public but unlisted and noindex, not password-protected.
          It intentionally contains source paths and architecture, never
          credentials, resident records or operational endpoints that bypass
          login. Deployment on Vercel is not production-readiness approval:
          trusted-IP enforcement, governance, email, backups/recovery and
          external verification remain separate launch gates.
        </Note>
        <FlowDiagram
          title="Application and trust boundaries"
          steps={[
            [
              "Browser: pages and interactive forms",
              "React 19, Tailwind semantic tokens, browser-safe Zod contracts. Browser checks improve UX; they do not grant rights.",
            ],
            [
              "Next.js 16 App Router on Node 24 / Vercel",
              "Server pages call services directly. Client forms call route handlers. Secrets remain server-only.",
            ],
            [
              "Supabase Auth + user-session database client",
              "Verified identity, current enabled profile and role. A service-role client is reserved for narrow provisioning/limiter operations.",
            ],
            [
              "PostgreSQL: RLS + guarded RPC + constraints",
              "Lock vote, check database time/entitlement, atomically mutate, validate projections. Cron reconciles lifecycle and retention.",
            ],
          ]}
        />
        <p>
          Vocabulary: RLS means row-level security; RPC means a called database
          function. SECURITY DEFINER executes with its owner privileges and must
          recheck the caller. A frozen electorate is an immutable entitlement
          snapshot. An acknowledgement confirms commit, not a PRIVATE selection
          receipt.
        </p>
      </>
    ),
  },
  {
    id: "first-local-run",
    title: "2. Your first local run",
    content: (
      <>
        <Steps>
          <li>
            Read README, docs/AGENTS.md and docs/LOCAL_SETUP.md in your
            checkout. Inspect package.json, the lockfile, .nvmrc and
            .env.example. Use the supported Node major; do not copy old scaffold
            instructions.
          </li>
          <li>
            For a fresh checkout run npm ci. Supply ignored .env.local values
            for a verified disposable Supabase project. Never copy production
            registers, backups or secrets into development.
          </li>
          <li>
            Apply reviewed migrations to that authorised target in filename
            order. Provision the first administrator through controlled setup;
            browsing the site cannot bootstrap an admin. Do not apply migrations
            at application startup.
          </li>
          <li>
            Run npm run dev and use its reported address. APP_ORIGIN must match
            the browser origin exactly for mutation protection. Use a
            provisioned synthetic identity.
          </li>
          <li>
            Run focused tests, npm run typecheck and npm run lint; build before
            handing off code changes. Read the installed Next.js docs under
            node_modules/next/dist/docs before changing framework APIs.
          </li>
        </Steps>
        <pre className="overflow-x-auto rounded-control border border-border bg-surface p-4 text-caption">
          <code>{`# Windows PowerShell, from the repository root
$env:NODE_USE_SYSTEM_CA = "1"
$env:PGSSLROOTCERT = Join-Path (Get-Location).Path ".certs\\supabase-db-ca.crt"
npm run dev`}</code>
        </pre>
        <p>
          Set the Windows-managed Node CA option in each shell invocation.
          Direct hosted PostgreSQL also needs the approved provider CA. A
          missing/invalid CA is a blocker, never a reason to disable TLS or
          hostname verification. A database reset destroys data; it is not
          routine troubleshooting.
        </p>
      </>
    ),
  },
  {
    id: "source-map",
    title: "3. Know which file owns what",
    content: (
      <>
        <p>
          Paths below are relative to the repository root, not public download
          links. Start at the route for the symptom, then follow imports into
          components, shared contracts, services and finally SQL. Do not move
          server code into a client component to make an import work.
        </p>
        <FileTable
          rows={[
            [
              "src/app/layout.tsx",
              "Root metadata, self-hosted fonts, theme provider and AppShell.",
            ],
            [
              "src/components/ui/app-shell.tsx",
              "Verified-session-aware header, navigation, branding, household terminology and footer User Guide link.",
            ],
            [
              "src/proxy.ts",
              "Maintenance gate, page CSRF context and expiring-session cookie refresh. Not final authorization.",
            ],
            [
              "src/instrumentation.ts; src/server/config/environment.ts",
              "Validate the Node runtime environment; optional integrations require coherent configuration.",
            ],
            [
              "src/app/(access)/sign-in/page.tsx; src/components/access/",
              "Email-code screen and interactive authentication form.",
            ],
            [
              "src/app/register/page.tsx; src/app/api/register/route.ts",
              "Public registration UI and protected POST entry.",
            ],
            [
              "src/app/page.tsx; src/components/votes/vote-list-card.tsx",
              "Own-entitlement dashboard, counts, filters, rich cards and scheduled rows.",
            ],
            [
              "src/app/votes/[id]/page.tsx; src/components/votes/",
              "Authorised ballot, review, submission acknowledgement, countdown and recovery UI.",
            ],
            [
              "src/app/votes/[id]/results/page.tsx; src/components/votes/results-view.tsx",
              "Shared authorised active/completed result presentation.",
            ],
            [
              "src/app/admin/layout.tsx; src/server/register/page-context.ts",
              "Committee-read page guards and dependencies, current terminology and CSRF token.",
            ],
            [
              "src/app/admin/residents/; src/components/admin/account-forms.tsx",
              "Unified resident directory, add/detail pages, account and assignment actions.",
            ],
            [
              "src/components/admin/resident-table-controls.tsx; src/components/admin/household-form.tsx",
              "Global filters/sorting, page-local review actions and inline eligibility.",
            ],
            [
              "src/app/admin/residents/import/; src/server/register/import.ts",
              "CSV validation/preview/import; exact-match retry handling without overwrites.",
            ],
            [
              "src/app/admin/votes/; src/components/admin/vote-forms.tsx",
              "Vote type choice, draft editor, electorate and ballot preview.",
            ],
            [
              "src/components/admin/lifecycle-actions.tsx",
              "Activate/schedule/withdraw, active deadline change, early completion and cancellation UI.",
            ],
            [
              "src/app/admin/settings/; src/server/settings/",
              "RWA configuration and explicitly enabled App Support Access.",
            ],
            [
              "src/app/admin/audit/; src/server/votes/monitoring.ts",
              "Authorised audit/participation lists and their filters.",
            ],
            [
              "src/server/authorization/account.ts; src/server/db/clients.ts",
              "Verified identity/current profile checks; separate user-session and privileged clients.",
            ],
            [
              "src/server/auth/; src/server/http/",
              "OTP, cookies, Vercel-only trusted client-IP budgets, Origin/CSRF, request parsing, errors and pagination.",
            ],
            [
              "src/shared/contracts/; src/shared/validation/; src/shared/http/",
              "Browser-safe Zod schemas, result shaping, validation and API client.",
            ],
            [
              "src/styles/globals.css; src/components/ui/",
              "Shared semantic design tokens, fields, accessible dialogs, table controls and pagination.",
            ],
            [
              "supabase/migrations/; supabase/README.md",
              "Ordered schema, RLS/grants, guarded routines and upgrades, grouped by area in the Supabase README. Read later replacements, not only initial definitions: docs/DATABASE.md section 9 maps each table and routine to its current migration.",
            ],
            [
              "scripts/ops/; scripts/deploy/check.ts",
              "Operator-only encrypted backup/recovery/configuration reporting and deployment preflight.",
            ],
            [
              "src/app/user-guide/; src/app/tech-guide/; src/components/guides/",
              "Native guide entry points, persona content, contents navigation, diagrams and screenshot rendering.",
            ],
            [
              "src/shared/guides/screenshots.ts; public/guides/",
              "Curated synthetic image inventory, PNGs and generated intrinsic dimensions.",
            ],
            [
              "scripts/docs/capture.spec.ts; playwright.docs.config.ts",
              "Explicitly authorised, redacted disposable-project screenshot captures; no Markdown/HTML generator.",
            ],
            [
              "tests/unit/; tests/integration/; tests/live/; tests/e2e/; tests/load/",
              "Different verification layers; inspect the matching config and prerequisites.",
            ],
            [
              "next.config.ts; vercel.json; .github/workflows/",
              "Security/cache headers, PDF file tracing, hosting restrictions and validation automation.",
            ],
          ]}
        />
      </>
    ),
  },
  {
    id: "routes",
    title: "4. Route and feature navigation map",
    content: (
      <>
        <FileTable
          rows={[
            [
              "/sign-in → /api/auth/code, /api/auth/verify",
              "OTP form → auth/dependencies.ts + auth/otp.ts → Supabase Auth. Sign-out uses /api/auth/sign-out.",
            ],
            [
              "/register → /api/register",
              "Registration form → register/self-registration.ts → Auth provisioning + self_register_resident.",
            ],
            [
              "/ → /votes/[id] → /api/votes/[id]/submission",
              "Own dashboard → ballot → votes/submission.ts → cast_vote.",
            ],
            [
              "/votes/[id]/results → /api/votes/[id]/results",
              "Initial server projection + live refresh → votes/member.ts → get_vote_results.",
            ],
            [
              "/api/votes/[id]/participation",
              "Own uncertainty recovery → votes/submission.ts → get_my_participation.",
            ],
            [
              "/api/votes/[id]/exports/[format]",
              "GET csv/pdf → exports/results-export.ts → same completed result projection → renderer.",
            ],
            [
              "/admin/residents → /api/admin/accounts[/id]",
              "Directory/detail → register/accounts.ts and provisioning.ts → guarded profile routines + Auth administration.",
            ],
            [
              "/api/admin/accounts/[id]/household; /api/admin/households/[id]",
              "Assignment/eligibility → register/households.ts → guarded routines. Public API identifiers keep household naming.",
            ],
            [
              "/admin/residents/import → /api/admin/households/import",
              "In-memory CSV → check/import → register/import.ts. New accounts remain suspended.",
            ],
            [
              "/admin/votes/new, /admin/votes/[id], /admin/votes/[id]/preview",
              "Type/editor/preview → votes/drafts.ts → create_draft, update_draft and preview readiness.",
            ],
            [
              "/api/admin/votes/[id]/{activate,schedule,schedule/withdraw,deadline,complete,cancel}",
              "Confirmed lifecycle requests → votes/lifecycle.ts → guarded transaction routines.",
            ],
            [
              "/admin/votes/[id]/participation; /admin/audit",
              "Committee reads → votes/monitoring.ts → authorised projections; no PRIVATE choices.",
            ],
            [
              "/admin/settings → /api/admin/settings[/app-support]",
              "Settings/support controls → settings/rwa-profile.ts or app-support.ts → scoped routines.",
            ],
            [
              "/privacy; /contact; /api/contact",
              "Public notices and CSRF/rate-limited optional contact mail; not OTP or ballot notification.",
            ],
            [
              "/user-guide; /user-guide/resident; /user-guide/rwa-admin",
              "Public native guide index and persona pages linked from the footer; no account data embedded.",
            ],
            [
              "/tech-guide",
              "This unlisted public developer guide; no footer/persona link, excluded from sitemap, noindex/nofollow.",
            ],
            [
              "/api/internal/health",
              "Bounded readiness probe, not proof of mail, backups, Cron or production approval.",
            ],
          ]}
        />
        <p>
          Former Accounts/Households UI URLs return 404; use Residents. Existing
          account/household API paths are intentionally retained. Page guards
          and RPC authorization still run when someone types a protected URL
          directly.
        </p>
      </>
    ),
  },
  {
    id: "identity",
    title: "5. Trace registration, sign-in and authorization",
    content: (
      <>
        <FlowDiagram
          title="Registration and verified access"
          steps={[
            [
              "Register form → POST /api/register",
              "Origin/CSRF + input validation + supplemental rate budgets. Never auto-enable public registrants.",
            ],
            [
              "register/self-registration.ts → provisioning.ts",
              "Create/find Auth identity, then service-role-only self_register_resident creates a suspended profile and ineligible household atomically.",
            ],
            [
              "Admin review → separate access / eligibility changes",
              "Only an enabled current admin may approve. Provider operations and database commits are not a distributed transaction; partial outcomes are explicit.",
            ],
            [
              "Sign-in form → code request → verify",
              "Supabase Auth email OTP, generic acknowledgement, newest code, SSR cookies; no custom password or OTP storage.",
            ],
            [
              "authorization/account.ts → current profile + capability",
              "A valid JWT is insufficient if the profile is suspended/deleted. ReadOnly/admin flags are exclusive; neither grants ballot entitlement.",
            ],
          ]}
        />
        <p>
          Normal database services use the verified user session so RLS remains
          active. Administrative read scope permits RWA ReadOnly; mutation
          guards require RWA Admin. Management pages use not-found when access
          is denied. App Support is household-free, read-only and controlled by
          the RWA toggle; APP_SUPPORT_EMAIL alone grants nothing.
        </p>
        <p>
          The shell loads narrow public identity/member branding projections,
          not full admin settings. Dynamic household wording comes from
          loadHouseholdTerms / useHouseholdTerms; do not hard-code that display
          label. Source identifiers and CSV/API keys remain household-based.
        </p>
      </>
    ),
  },
  {
    id: "ballot-trace",
    title: "6. Trace a ballot end to end",
    content: (
      <>
        <FlowDiagram
          title="Submit a ballot: navigate these files in order"
          steps={[
            [
              "src/app/votes/[id]/page.tsx",
              "Authorised member detail from server/votes/member.ts; renders PUBLIC or PRIVATE UI under components/votes.",
            ],
            [
              "src/components/votes/ballot-form.tsx",
              "Selections stay in page memory. Review before POST; browser clock/disabled buttons are not integrity controls.",
            ],
            [
              "src/shared/http/api-client.ts → src/app/api/votes/[id]/submission/route.ts",
              "Send only the confirmed selection payload + CSRF token; no caller-supplied identity, household, timestamp or totals.",
            ],
            [
              "src/server/auth/dependencies.ts + src/server/http/request.ts",
              "Check Origin/CSRF, verified enabled account, bounded body and shared/contracts/ballots.ts schema.",
            ],
            [
              "src/server/votes/submission.ts → cast_vote RPC",
              "User-session RPC derives the actor and frozen entitlement. Privileged client here is only for rate limiting.",
            ],
            [
              "Latest cast_vote definition in supabase/migrations",
              "Lock vote first; use clock_timestamp after lock; reconcile lifecycle; validate ownership, deadline and all choices; atomically record participation plus responses/counters.",
            ],
            [
              "Committed acknowledgement → UI or uncertainty recovery",
              "Only return recorded after commit. On transport uncertainty call get_my_participation through the participation endpoint before offering a safe retry.",
            ],
          ]}
        />
        <Note>
          For PUBLIC, atomically replace the complete current option set while
          active; retain one participation row and no response-change history.
          For PRIVATE, a duplicate is refused and all office counters increment
          in one transaction. Never introduce a PRIVATE household-to-choice link
          in rows, logs, receipts, timestamps or telemetry.
        </Note>
        <p>
          To debug the SQL, search the exact routine name across ordered
          migrations and inspect the last CREATE OR REPLACE definition plus its
          guards/grants. Do not assume the initial 20261024 function is current.
          The core path is covered by voting unit, real-database
          concurrency/deadline and live browser tests.
        </p>
      </>
    ),
  },
  {
    id: "database-erd",
    title: "7. Database ERD, keys and privacy",
    content: (
      <>
        <ErDiagram />
        <FileTable
          rows={[
            [
              "auth.users → profiles (1 : 0..1)",
              "profiles.id is both PK and Auth FK. Auth owns email and identity; profile owns current status, representative and role flags.",
            ],
            [
              "profiles → households (1 : 0..1)",
              "households.representative_profile_id is required and unique. Normalized identifiers are unique. Management profiles may have no household.",
            ],
            [
              "votes / households / profiles → electorate (1 : many)",
              "Composite PK (vote_id, household_id), unique representative per vote, historical representative/name/identifier snapshots at freeze.",
            ],
            [
              "electorate → participation (1 : 0..1)",
              "Composite PK/FK (vote_id, household_id); accepted_at records participation only.",
            ],
            [
              "votes → poll_options; participation + options → open_responses",
              "PUBLIC responses use composite PK (vote_id, household_id, option_id), preventing duplicate selected options and cross-vote choices. Only the current set remains.",
            ],
            [
              "votes → offices → candidates / closed_tallies",
              "PRIVATE tally FK ownership binds vote/office/candidate; one stable aggregate counter per candidate and one null-candidate NOTA counter per office. No participation/identity FK to a tally.",
            ],
            [
              "profiles → audit_events (1 : many; actor nullable for system)",
              "Administrative actions/reasons and bounded metadata. target_id is a typed logical reference, not a polymorphic FK to every target table.",
            ],
            [
              "rwa_settings (singleton id = 1)",
              "Identity/contact/wording, timezone, suggestions, approval versions and retention. Application-level configuration, not a tenant table.",
            ],
            [
              "rate_limit_buckets",
              "Versioned digests and atomic request budgets; no raw email/token/ballot payload. Controlled bounded retention.",
            ],
          ]}
        />
        <p>
          All application tables have RLS and restricted grants. Guarded
          SECURITY DEFINER routines use restricted non-login owners, fixed
          search paths, schema-qualified objects and explicit caller checks.
          Revoking browser access is not optional because users can call
          Supabase directly.
        </p>
        <Note>
          PRIVATE privacy is an application storage boundary, not cryptographic
          anonymity. Privileged operators, WAL/backups and small electorates can
          permit inference. Do not reconstruct individual choices from timing or
          differences between counters.
        </Note>
      </>
    ),
  },
  {
    id: "lifecycle",
    title: "8. Draft, freeze, schedule and close safely",
    content: (
      <>
        <FlowDiagram
          title="Lifecycle and the only editable return path"
          steps={[
            [
              "DRAFT → preview the saved revision",
              "Edits increment draft_revision. Stale revision conflicts force reload/review. Incomplete drafts are allowed; activation is not.",
            ],
            [
              "DRAFT → ACTIVE, or DRAFT → SCHEDULED",
              "Validate policies/retention, ballot, eligible enabled representatives and deadline; freeze everything together. Scheduling freezes now, not at opening.",
            ],
            [
              "SCHEDULED → DRAFT only strictly before opens_at",
              "Confirmed reasoned withdrawal clears snapshots/zero counters and advances revision. A saved planned opening without confirmation remains only a draft.",
            ],
            [
              "SCHEDULED → ACTIVE at database opening time",
              "Due reconciliation holds the vote lock. Before opening, residents see only summary. If the entire window was missed, complete at the original deadline.",
            ],
            [
              "ACTIVE → COMPLETED or CANCELLED",
              "Deadline completion or authorised early completion/cancellation with reason. Terminal states never reopen. Only active deadline changes can move a deadline, with reason and minimum future margin.",
            ],
          ]}
        />
        <p>
          Use server/votes/drafts.ts for draft/preview, lifecycle.ts for
          confirmed transitions and monitoring.ts for participation/audit.
          Database time is authoritative after acquiring the vote lock, not
          browser time or transaction start. Supabase Cron assists
          reconciliation but cannot admit a late ballot or ensure uptime when a
          database is paused.
        </p>
        <p>
          Later register edits do not change frozen historical identity or
          entitlement. Suspension blocks current access without erasing
          participation or altering the denominator. Current branding is
          intentionally displayed even on old results; the saved vote RWA-name
          snapshot remains internal.
        </p>
      </>
    ),
  },
  {
    id: "results-and-exports",
    title: "9. Result integrity and exports",
    content: (
      <>
        <FlowDiagram
          title="One source of truth for screen, CSV and PDF"
          steps={[
            [
              "Authorised database result projection",
              "Active PUBLIC: aggregate options/turnout only. Active PRIVATE: turnout only. Completed PUBLIC: totals + authorised named responses. Completed PRIVATE: aggregate counters only. Cancelled: no results.",
            ],
            [
              "src/server/votes/member.ts + src/shared/contracts/results.ts",
              "Validate shape, decimal-string counts, entitlement and invariants; fail explicitly if data does not reconcile.",
            ],
            [
              "Results page / result components",
              "Frozen electorate is turnout denominator; labels explain leaders, ties and NOTA. Poll live results about every ten seconds; paginate named rows.",
            ],
            [
              "src/server/exports/results-export.ts → csv.ts / pdf.ts",
              "Render the full authorised completed projection before successful response headers. Escape CSV formula text; PDFKit/fontkit use bundled fonts.",
            ],
          ]}
        />
        <p>
          Each PRIVATE office&apos;s candidate counts plus NOTA must equal
          submitted ballots. NOTA never wins; positive tied candidate leaders
          remain ties and zero candidate votes elect nobody. PUBLIC
          participation needs at least one valid selected option and respects
          the selection cap; multi-select option counts can exceed
          participation.
        </p>
        <p>
          Counts/audit bigints cross JSON as decimal strings; avoid unsafe
          Number coercion. Result bars use frozen eligible denominators; zero
          denominators are not applicable. Candidate result contracts also
          distinguish submitted-ballot percentages. Never fabricate totals or
          auto-repair counters when a check fails.
        </p>
        <p>
          CSV/PDF share the projection; downloads include all authorised rows,
          not just the visible page. PDF is optional and unsupported glyphs fail
          with CSV guidance, not silent text loss. Process-local render slots
          are bounded, not a global Vercel queue. Ordinary download links do not
          provide a deduplicated progress/retry panel.
        </p>
      </>
    ),
  },
  {
    id: "http-and-ui",
    title: "10. HTTP contracts and UI conventions",
    content: (
      <>
        <FileTable
          rows={[
            [
              "src/server/http/route.ts; response.ts; errors.ts",
              "Supported method map, safe request/support ID, maintenance gate, data/error envelopes and sanitised logging.",
            ],
            [
              "src/server/http/request.ts; src/shared/contracts/",
              "Bounded body, ID/query parsing, strict runtime validation and explicit field errors.",
            ],
            [
              "src/server/http/browser-protection.ts; csrf.ts; auth/dependencies.ts",
              "Exact configured Origin plus per-browser CSRF. Proxy inserts trusted page context; APIs use cookies directly.",
            ],
            [
              "src/server/http/cursor.ts; numbered-page.ts",
              "Bounded filter-bound cursor APIs and validated numbered page metadata for UI.",
            ],
            [
              "src/components/ui/pagination.tsx",
              "Exact filtered totals; page 1 of 1 for empty sets; First/Previous/Next/Last and immediate per-page 10/25/50/100.",
            ],
            [
              "src/components/ui/dialog.tsx; field.tsx",
              "Native modal focus/Escape, viewport-centred confirmations with internal scroll, labelled fields and concise help.",
            ],
            [
              "src/shared/contracts/household-terms.ts; src/components/ui/household-terms.tsx",
              "Configured label/Number-or-ID wording. Use server terms/client hook, while keeping database/API names stable.",
            ],
          ]}
        />
        <p>
          Success uses data; errors use error plus requestId, and 204 has no
          JSON body. Typical outcomes: 401 no session, 403
          forbidden/CSRF/current account blocked, 404 missing or inaccessible,
          409 lifecycle/revision/duplicate conflict, 422 invalid input, 429
          budget exceeded, 503 dependency/partial workflow/export unavailable. A
          failed transport response is not proof of ballot rejection.
        </p>
        <p>
          Residents and Manage Votes use specialised ordered-ID/count routines;
          generic lists use bounded anchors. Filters/sort run before pagination,
          page/size changes clear selections, and each bulk row commits
          separately. Unknown metadata fails rather than guessing totals. Do not
          confuse a UI page number with an API offset contract.
        </p>
        <p>
          Reuse Tailwind semantic tokens, theme-aware controls, 48px touch
          targets, at least 16px form text and visible focus. Keep tables in
          contained horizontal scroll regions. Forms/ballots use readable
          centred widths; management workspaces use the available width. Unsent
          ballot selections must remain in memory, never URLs, localStorage or
          telemetry.
        </p>
      </>
    ),
  },
  {
    id: "migration-map",
    title: "11. Read migrations in the right order",
    content: (
      <>
        <p>
          Migrations are immutable once applied. Filename dates are ordering
          identifiers, not evidence that a migration is deployed or approved.
          Verify target history separately with the read-only npm run ops --
          migration-status --confirm &lt;ref&gt;. Add a new reviewed migration
          for persistent changes and test both fresh schema and upgrade paths.
          supabase/README.md groups every migration by area, and
          docs/DATABASE.md section 9 maps each table, routine, role and Cron job
          to the migration holding its current definition and to its caller.
        </p>
        <FileTable
          rows={[
            [
              "20261024… core_schema → retention_maintenance",
              "Initial tables/keys, helpers, RLS/grants, provisioning/settings, limiter, register, drafts, activation, atomic cast, member/results, retention.",
            ],
            [
              "20261026… → 20261029…",
              "Active PUBLIC results/replacement, multi-select responses, built-in NOTA and active PRIVATE turnout.",
            ],
            [
              "20261030… → 20261105…",
              "Identifier/RWA branding evolution, OPEN/CLOSED → PUBLIC/PRIVATE types, household terms/default lists and audited active deadline change.",
            ],
            [
              "20261106… → 20261110…",
              "Non-overwriting CSV import, scheduled opening/freeze/withdrawal, exclusive ReadOnly role, self-registration and atomic profile/household provisioning.",
            ],
            [
              "20261111… → 20261113…",
              "Resident directory, RWA-controlled App Support Access and optional observer household.",
            ],
            [
              "20261114… → 20261120…",
              "Numbered metadata, global resident controls/contains/source sorting, audit text filters, admin-vote ordering and aggregate turnout.",
            ],
            [
              "20261121100000_vote_draft_opening.sql; 20261121110000_draft_opening_public_private_types.sql",
              "Saved planned opening and compatibility follow-up. Read both, then the current lifecycle definition.",
            ],
            [
              "20261122100000_delete_drafts.sql",
              "Confirmed guarded draft-only deletion and audit.",
            ],
            [
              "20261123100000_enabled_rwa_admin_names.sql; 20261124100000_add_amber_accent_palette.sql",
              "Narrow enabled-member administrator-name projection and sixth contrast-checked palette.",
            ],
          ]}
        />
        <p>
          Inspect guard/trigger dependencies, ownership, search_path and grants
          as well as the changed routine. Role switching migrations must RESET
          ROLE before migration history recording. Do not grant anon routines to
          expose full settings or use service-role reads to bypass an ordinary
          result permission.
        </p>
      </>
    ),
  },
  {
    id: "deployment-operations",
    title: "12. Vercel configuration and safe operations",
    content: (
      <>
        <FileTable
          rows={[
            [
              "APP_ORIGIN; NEXT_PUBLIC_SUPABASE_URL / PUBLISHABLE_KEY",
              "Exact target origin and public project identifiers. NEXT_PUBLIC values reach the browser and are build-bound; never put a secret there.",
            ],
            [
              "SUPABASE_SERVICE_ROLE_KEY; RATE_LIMIT_HMAC_KEY",
              "Server-only privileged provisioning and versioned limiter digests. Never use the privileged client for ordinary ballot/result reads.",
            ],
            [
              "TRUSTED_PROXY_CONFIG",
              "Set to vercel for production OTP. Trusts one Vercel-overwritten X-Forwarded-For value for per-IP budgets (30 requests/100 verifications per 15 minutes); missing or invalid values fail closed.",
            ],
            [
              "APP_SUPPORT_EMAIL",
              "Server support contact; grants nothing until an enabled RWA Admin explicitly enables support access.",
            ],
            [
              "Supabase/provider settings",
              "SMTP, OTP template/expiry/limits, allowed Auth URLs, RLS and Cron. An application deployment does not configure or verify these automatically.",
            ],
            [
              "RESEND_API_KEY; CONTACT_EMAIL_FROM / TO",
              "Optional contact-only mail, all configured together; mail service acceptance is not inbox receipt or OTP verification.",
            ],
            [
              "GOOGLE_ANALYTICS_ID; GOOGLE_SITE_VERIFICATION",
              "Optional public identifiers, rebuilt for target. Analytics remains consent-gated on privacy/contact only, never guides/auth/ballots.",
            ],
            [
              "MAINTENANCE_MODE; PDF_EXPORT_ENABLED",
              "Maintenance returns 503 across pages/data APIs; optional PDF can be disabled. Health is a bounded dependency/readiness probe.",
            ],
            [
              "MIGRATION_DATABASE_URL / access token; backup / restore / config URLs and keys",
              "Deployment/approved operator tools only; not browser configuration. Keep backup encryption keys separate from ciphertext.",
            ],
          ]}
        />
        <p>
          The documented staging Vercel project uses its Production target with
          a disposable database and restricted automatic Git deployment.
          Vercel&apos;s label does not make that database real production. Real
          production needs separately approved projects, secrets, Auth URLs,
          policies and evidence. Changing the origin requires
          rebuilding/redeploying and updating provider settings.
        </p>
        <p>
          Use npm run deploy:check with injected production configuration; it
          intentionally does not load .env.local. A passing build/preflight
          cannot verify SMTP, provider identity, Cron, trusted ingress or
          governance. Production OTP requires TRUSTED_PROXY_CONFIG=vercel with
          Vercel system variables enabled, or code requests and verification
          fail closed. Hosted spoof/burst checks and pilot threshold validation
          remain unresolved release work.
        </p>
        <p>
          On an approved workstation, npm run ops -- config-check uses
          CONFIG_DATABASE_URL for a bounded read-only transaction and aggregate
          readiness report. It is not a public login bypass and emits no
          resident lists/choices. Warnings/external gates still need review even
          with exit 0.
        </p>
        <p>
          Operations under scripts/ops implement encrypted backup, verification,
          isolated restore rehearsal and recovery records. Check
          docs/OPERATIONS.md for exact command flags and approvals before
          destructive work. A consistent restored database can still omit
          acknowledged votes; independently establish completeness before
          resuming. Never restore an old database merely to roll back app code.
        </p>
      </>
    ),
  },
  {
    id: "debugging",
    title: "13. Debug and reverse-engineer safely",
    content: (
      <>
        <Steps>
          <li>
            Record the exact route, lifecycle state, safe support ID and
            observed error code. Reproduce with synthetic data on an authorised
            disposable project.
          </li>
          <li>
            Find that page/handler in the route map. Follow imports through the
            shared schema and service to the RPC name, then locate its latest
            migration definition, helper guards, RLS and grants.
          </li>
          <li>
            Check the actual deployed origin, project, migration history and
            current profile. A correct local file does not establish that the
            deployed version/configuration matches it.
          </li>
          <li>
            Compare the smallest relevant test. For a database
            permission/race/deadline symptom, use real PostgreSQL tests, not
            only a mocked service result.
          </li>
          <li>
            Stop and escalate any missing acknowledged vote, incorrect total,
            privacy disclosure or unknown destructive outcome. Keep
            maintenance/recovery decisions separate from a convenient UI
            workaround.
          </li>
        </Steps>
        <FileTable
          rows={[
            [
              "Sign-in unavailable / code never arrives",
              "auth/otp.ts, environment, provider SMTP/allowed URLs, current profile, budget/cooldown and cookie/origin settings. Do not log codes/tokens or infer registration from a generic acknowledgement.",
            ],
            [
              "Signed out unexpectedly",
              "proxy.ts → auth/proxy-session.ts → session cookies → verified account status. Existing JWTs do not override suspension.",
            ],
            [
              "Vote missing / 404",
              "Current enabled identity, frozen representative/electorate, lifecycle and filters. Admin role alone does not grant a ballot; never retry as service role.",
            ],
            [
              "Draft conflict / activation blocked",
              "Saved draft_revision vs preview; latest admin edit; ballot/entitlement/deadline checks; policy approvals and retention. Reload instead of inventing a revision.",
            ],
            [
              "Schedule not opening / vote ended",
              "Database clock, opens_at/closes_at, lock reconciliation and Cron availability. A delayed job does not extend the window.",
            ],
            [
              "Submission uncertain",
              "Own get_my_participation path before retry. Never reconstruct PRIVATE choices or treat a 503/timeout as rejection.",
            ],
            [
              "Residents sort/count wrong",
              "URL filters → table service → get_resident_table_page latest migration → bounded IDs + exact metadata + RLS enrichment; not only current-page JavaScript.",
            ],
            [
              "Results withheld / impossible total",
              "get_vote_results, shared result schema and invariant checks. Stop publication; never hand-edit counters or publish a best-effort total.",
            ],
            [
              "CSV/PDF fails",
              "Authorization/completion, validated projection, renderer concurrency, PDF glyph support and traced fonts. Return explicit failure, not truncated HTTP 200.",
            ],
            [
              "Auth/profile update partially succeeded",
              "register/accounts.ts + provisioning.ts, saved profile/access and Auth outcome; follow recovery without deleting an uncertain identity.",
            ],
            [
              "OTP returns AUTH_UNAVAILABLE with a trusted_proxy cause",
              "Confirm TRUSTED_PROXY_CONFIG=vercel, Vercel system variables are enabled (VERCEL=1), and the request has one valid Vercel-overwritten X-Forwarded-For value. Do not trust a client-supplied forwarding header or add an upstream proxy.",
            ],
            [
              "Local PostgreSQL certificate failure",
              "Provider CA in .certs, PGSSLROOTCERT and any explicit URL sslrootcert precedence. Do not disable TLS, hostname verification or certificate checks.",
            ],
          ]}
        />
        <Note>
          Logs use bounded allowlisted metadata. Never add emails, raw provider
          errors, cookies, tokens, OTPs, SQL selection binds, request bodies or
          ballot choices. Disable provider/APM payload capture and session
          replay on sensitive workflows; a local logger policy cannot prove
          hosted observability is configured safely.
        </Note>
      </>
    ),
  },
  {
    id: "testing",
    title: "14. Tests: what each check proves",
    content: (
      <>
        <FileTable
          rows={[
            [
              "npm test / npm run test -- <focused files>",
              "Vitest contracts, services, safe errors and rendering/ops units. Does not prove real RLS or email.",
            ],
            [
              "npm run typecheck; npm run lint; npm run format:check",
              "Strict types, lint and formatting. They are not runtime/integration evidence.",
            ],
            [
              "npm run test:integration",
              "Disposable real PostgreSQL: migrations, RLS/grants, transactions, locks, concurrency, exact deadlines and recovery. Confirm destructive fixture scope first.",
            ],
            [
              "npm run test:live",
              "Opted-in synthetic Supabase Auth/Data API integration. Requires an authorised disposable target; may create records.",
            ],
            [
              "npm run test:e2e",
              "Playwright browser journeys and axe. Authenticated specs need LIVE_AUTH=1 and configured synthetic services.",
            ],
            [
              "npm run test:load",
              "Configured local contention/rendering thresholds, not production hosted HTTP/SMTP capacity.",
            ],
            [
              "npm run build; npm run deploy:check",
              "Production compilation and injected config checks, not launch approval or provider readiness.",
            ],
            [
              "node --test scripts/docs/check.test.mjs",
              "Native guide source/link/image inventory, PNG dimensions, cropped-confirmation bounds and legacy-asset removal.",
            ],
            [
              "npx playwright test --project=chromium tests/e2e/guides.spec.ts",
              "Public persona routes, contents anchors, lazy image loading, hidden technical navigation, metadata, diagrams, reflow and axe.",
            ],
          ]}
        />
        <p>
          For voting changes explicitly test exact deadline after waiting on a
          lock, duplicate/concurrent submission, whole-transaction rollback,
          frozen assignments, current suspension, PUBLIC replacement and PRIVATE
          non-disclosure. Run manual keyboard/screen-reader/real-device
          acceptance separately; axe is not complete accessibility
          certification. Report skipped/unconfigured checks as such, never as
          passed.
        </p>
      </>
    ),
  },
  {
    id: "maintain-guides",
    title: "15. Maintain these native guides",
    content: (
      <>
        <p>
          Edit persona content under src/components/guides and route metadata
          under src/app. Each GuideSection supplies its stable URL fragment and
          contents entry. Keep important steps in text, not only screenshots.
          These pages replace the old Markdown/HTML copies; dev/build no longer
          regenerate documents.
        </p>
        <p>
          Curate images in src/shared/guides/screenshots.ts. Use one image for a
          dropdown unless selecting a value materially changes the rest of the
          screen; crop confirmation dialogs rather than capturing their
          background. The capture helper records true PNG dimensions for lazy
          Next Image rendering and masks email/code values. Only referenced
          Resident/Admin images are published.
        </p>
        <pre className="overflow-x-auto rounded-control border border-border bg-surface p-4 text-caption">
          <code>{`# ONLY after verifying and authorising the disposable project:
$env:NODE_USE_SYSTEM_CA = "1"
$env:PGSSLROOTCERT = Join-Path (Get-Location).Path ".certs\\supabase-db-ca.crt"
$env:LIVE_AUTH = "1"
$env:DOC_SCREENSHOTS = "1"
$env:DOC_DISPOSABLE_CONFIRMED = "1"
npx playwright test -c playwright.docs.config.ts
node --test scripts/docs/check.test.mjs`}</code>
        </pre>
        <p>
          Captures create synthetic Auth/profile/household/vote/participation
          and fixture policy records. An ignored test-output snapshot records
          the pre-capture RWA profile; a separate after-test hook restores it
          even when a browser action fails and removes the snapshot on success.
          If a worker is forcibly terminated, preserve that file for approved
          recovery before another run rather than guessing old settings.
          Temporary RWA profile changes are restored and active examples are
          safely cancelled where possible. Historical fixture records remain
          subject to the disposable-project cleanup procedure; do not reset a
          shared target or erase history automatically.
          Code-error/connection-failure illustrations are simulated; other
          principal journeys use real test services. None proves actual SMTP
          delivery, scheduled Cron execution or production readiness.
        </p>
      </>
    ),
  },
  {
    id: "first-change-and-reading",
    title: "16. Make your first safe change",
    content: (
      <>
        <Steps>
          <li>
            Identify requirement, route, shared contract, service, SQL and
            affected historical data. Reuse an existing helper before adding
            logic.
          </li>
          <li>
            Add a focused regression reproducing the symptom. Change every
            coupled surface, including exports/preview/guards when relevant.
          </li>
          <li>
            Use a new migration for persistence/permissions. Validate fresh and
            upgrade paths on disposable data; never migrate production without
            authorisation.
          </li>
          <li>
            Exercise empty/loading/success/error/recovery states, current roles
            and phone keyboard flow. Preserve privacy and atomicity.
          </li>
          <li>
            Run focused checks, typecheck, lint and build. Update affected
            README/docs, native help, diagrams and only changed screenshots in
            the same change.
          </li>
          <li>
            Hand off actual commands/results, unrun checks and unresolved gates.
            Do not present deployment or a screenshot as approval.
          </li>
        </Steps>
        <p>
          Repository reading order: docs/PRD.md (scope and A1–A7),
          docs/DESIGN_SYSTEM.md (UX), docs/ARCHITECTURE.md (boundaries/source
          map), docs/DATABASE.md (columns, keys, grants), docs/API.md
          (contracts), docs/LOCAL_SETUP.md, docs/DEPLOYMENT.md and
          docs/OPERATIONS.md. docs/LAUNCH_AUDIT.md and docs/PILOT_READINESS.md
          retain unresolved approval/external-verification gates.
          docs/IMPLEMENTATION_PLAN.md is historical sequencing; current source
          and scripts govern implemented behavior.
        </p>
      </>
    ),
  },
];
