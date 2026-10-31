# Product Requirements Document

## 01 Product Overview
- **Product Name:** Civic Pulse
- **Tagline:** Fair, printable voting for your apartment community, from committee elections to everyday polls.
- **Status:** Proposed MVP requirements. This document defines product scope and acceptance criteria, not a claim that the current application implements them. Assumptions A1-A7 require explicit RWA approval before real voting.
- **Description:** Civic Pulse is a mobile-first web app that also works on tablets and laptops. It lets one Resident Welfare Association (RWA) run **PRIVATE voting** for committee elections and **PUBLIC voting** for attributable community polls, such as "Buy a water treatment plant from the corpus? Yes / No" or "Which day for the Annual GBM? Mon / Tue / Sat / Sun".
- **Privacy distinction:** PRIVATE voting exposes only aggregate choices, never a retrievable individual ballot or an identity-to-choice mapping through the application. This is application-level privacy with the limitations in A2. PUBLIC voting publishes respondent names, households and choices only to authorized Residents, RWA Admins and RWA ReadOnly observers after completion.
- **Authoritative results:** Supabase PostgreSQL is the source of truth. Completed outcomes are shown in the application and exported as CSV. A readable, printable PDF export is optional and may be deferred beyond version 1; it is not a backup, authoritative record or signature-replacement workflow.
- **Terminology:** PUBLIC and PRIVATE are voting types. Draft, Scheduled, Active, Completed and Cancelled are separate lifecycle statuses. Neither voting type implies a lifecycle status.

### SaaS direction: S01, 31 October 2026

The [SaaS product and commercial boundaries](./IMPLEMENTATION_PLAN.md#s01---product-and-commercial-boundaries)
record confirmed development direction: operator-assisted customer onboarding,
a separate Supabase project per RWA behind a shared application, a separate
product/pricing/contact website, a synthetic read-only demo and manual annual
billing. The deployed application remains single-RWA. S03 adds a locally tested,
disabled-by-default server routing foundation; no customer hosts or directory
are configured, and the website, demo and billing controls are not implemented.

S01 remains partially complete. The selected starting policies (both vote types,
a 10-RWA pilot cap and a 7-day billing grace default) are recorded in the
[implementation plan](./IMPLEMENTATION_PLAN.md#s01---product-and-commercial-boundaries).
Actual domain, pricing/included services, households and peak voters per RWA,
and service/offboarding terms are pending. The historical MVP capacity and free-tier budget objectives below
are not an approved SaaS service commitment, commercial pricing or evidence of
fleet capacity. A1-A7 still require per-RWA approval before real voting.

## 02 Problem
RWAs run votes through WhatsApp groups, show-of-hands at meetings, paper slips and spreadsheets. In practice:
- Nobody can be sure each household voted only once, or that only eligible households voted.
- Committee elections are not truly secret. Slips get seen, and WhatsApp replies are public.
- Community polls get lost in chat noise, and the final decision is hard to prove later.
- Counting is manual and slow, and disputes follow.
- Decisions need physical signatures from many people, and the paper record gets lost.
- Many residents are on phones only, and tools built for laptops frustrate them.

## 03 Goals and Success Metrics
Let a 500-household RWA run a complete vote, from admin setup through resident voting to correct on-screen results, with zero duplicate or partial ballots. Printable PDF export is an optional enhancement.

### Product and pilot targets
- **Setup:** An admin creates, previews and activates a vote in under 10 minutes using an already prepared household register. Measure both voting types in the pilot.
- **Login:** At least 90% of invited residents log in successfully on their first attempt; report non-attempts separately so invitation reach is not confused with login failure.
- **Independent use:** At least 90% of participating pilot members complete sign-in and their first submission without admin assistance. Measure separately from first-attempt login success.
- **Voting speed:** Median time from opening a ballot to receiving submission acknowledgement is under 60 seconds on mobile.
- **Pilot coverage:** One real RWA runs at least one PUBLIC poll and one PRIVATE election end-to-end after the release gates pass.
- **Adoption:** At least 60% household turnout in the pilot vote. This is an adoption target, not a software release gate.
- **Measurement privacy:** Use an agreed pilot checklist and aggregate operational measurements without recording PRIVATE selections.

### Correctness and service targets
- Zero duplicate, partial or post-deadline ballots, and no PRIVATE identity-to-choice disclosure through application interfaces, exports, logs or ordinary stored records.
- CSV totals match authoritative completed results and the screen 100% of the time. If PDF export is included, it must match those results and print legibly on A4 in grayscale.
- Page and API response time is under two seconds at the 95th percentile at 500 households and about 100 concurrent users. Vote acknowledgement is within three seconds at the 95th percentile. Measure server-backed journeys under representative connectivity, excluding email delivery and poor client connectivity.
- **Budget objective:** ₹0 per month for hosting and required services on free tiers, with an optional domain excluded. Validate email capacity, database and backup limits before launch, and PDF execution limits if included. This is a feasibility objective, not permission to weaken privacy, correctness or recovery; obtain approval if a paid tier is required.

## 04 Target Users
- **Resident (`voter`, household representative):** One designated adult per household who votes on a phone or laptop. Many are non-technical, and some are elderly.
- **RWA Admin (`rwa-admin`, committee member):** Maintains the register, creates and runs votes, monitors participation, and downloads results. The role does not grant voting entitlement; admins vote only through their own eligible household.
- **RWA ReadOnly (`rwa-readonly`, committee observer):** Reads authorized management information and downloads but cannot make changes. The observer votes only through its own eligible household entitlement.
- **Result viewer:** An eligible household representative or admin reviewing completed outcomes and downloading records. This is a use case, not a separate permission role.

## 05 Assumptions and Decisions Requiring Approval
These are proposed operating defaults, not recorded RWA approvals. Development may use them provisionally. Record the approving authority, date and decision before real voting; do not infer approval from this document.

| ID | Proposed default | Approval required |
|----|------------------|-------------------|
| A1 | One vote per household, cast by one designated adult representative from an RWA-approved register. | Confirm whether bylaws instead require individual, owner-only or multiple votes per property. |
| A2 | PRIVATE privacy is application-level, not cryptographically verifiable anonymity. Store participation separately from plain aggregate counters, with no PRIVATE per-ballot rows. While voting is active, eligible members see aggregate turnout only; RWA Admins and RWA ReadOnly observers may view household participation for follow-up without choices. | Confirm this assurance level and live-turnout disclosure are sufficient. Infrastructure operators may infer choices from privileged access or changes over time; aggregate turnout can reveal participation rates, authorized management readers can identify participation, and small or unopposed elections may reveal choices by inference. Separating records alone is not proof of anonymity. |
| A3 | While a PUBLIC poll is Active, eligible voters and authorized management readers can see aggregate counts/turnout only and an eligible voter may replace their own selection set until closure. While a PRIVATE election is Active, eligible members see aggregate turnout only; RWA Admins and RWA ReadOnly observers may additionally see household participation status for individual follow-up, never choices. Candidate/NOTA totals and outcomes remain hidden until completion. Publish frozen PUBLIC names, household identifiers and final selections only after completion. PRIVATE ballots remain immutable. | Confirm live PUBLIC aggregates and replace-until-closure semantics, approve the live PRIVATE turnout/authorized-management follow-up access, and approve the identity-disclosure notice and downloadable named records. |
| A4 | Admin-managed register with optional resident self-registration (created suspended and voting-ineligible until an RWA Admin reviews and enables it), no Supabase Auth public sign-up, and login by a six-digit email code. | Confirm all representatives can access email and approve the email provider and session policy. Approve resident self-registration, including that its specific duplicate errors reveal whether an email or household is already registered. Any approval recorded before self-registration was added does not cover it. |
| A5 | PUBLIC polls are configured per vote for single-select or multi-select. Each household submits one ballot with at least one selected option; multi-select may have a maximum from 2 to 100 or no maximum. PRIVATE voters choose one candidate or NOTA (None of the Above) per office. NOTA is counted separately but never wins; the candidate with the highest count among candidates is elected even when NOTA has more votes. No candidate is elected if no candidate receives a vote; ties among top candidates remain ties. | Confirm bylaws, whether polls are advisory or binding, the selection rules and limits, NOTA treatment and permission for early completion with a recorded reason. A poll result does not authorise spending. |
| A6 | Launch scale is 500 households and about 100 concurrent users. Retention is limited by an approved policy, not indefinite by default. | Approve durations and deletion rules for PUBLIC responses, participation, identity snapshots, audit records, service-retained exports and backup expiry. Approve backup frequency and recovery objectives, and validate free-tier feasibility. |
| A7 | The database is authoritative. Optional PDF export is only a printable outcome, not a backup, digital signature, signature certificate or legal certification. Replacing physical signatures is not a version 1 requirement. | Acknowledge these limits. Any future signature-replacement claim requires separate bylaw/legal approval. |

## 06 Scope

### Approved Appearance Review Slice

The user-approved correction requires Votes to faithfully realize the concept:
compact branded header, three-column own-entitlement summary, compact status/type/
history navigation, rich turnout/participation cards and dated scheduled entries.
Retain the agreed top navigation, All/Cancelled discovery, pagination and all
voting safeguards. Counts are real, identity-scoped and filter-independent;
Your Responses refers to active-vote participation. Active turnout is aggregate
only, no PRIVATE candidate totals or individual choices. Unavailable reads must
not be shown as zero or sample values. The user guide must show actual-app
captures, not present the original design mockup as implemented behavior.

Use Platinum light/Obsidian dark with Sora headings and Manrope body text,
self-hosted in both themes. A header Light/Dark/System control defaults to device
appearance, remembers a non-sensitive per-browser preference, follows live device
changes in System mode, recovers from corrupt/blocked storage and is available
before sign-in. RWA accent settings remain independent and contrast-checked in
both modes. Print/PDF remain light/readable. The shared theme foundation applies
globally. After approval of the corrected Votes screen, the user authorized the
same visual language across the remaining public, admin and resident workflows,
retaining top navigation and all voting safeguards. This is presentation work,
not approval to change counting, access, eligibility or failure/recovery behavior.
The earlier User Guide screenshot hold was subsequently lifted. The current
persona-first guide uses refreshed themed captures; the prior guide/screenshots
remain archived separately for comparison.
### Version 1
- Single-RWA, mobile-first web access for members and admins.
- Admin-managed households, registered-member email login and role-based access.
- PRIVATE multi-office elections and PUBLIC single-choice polls.
- Preview, explicit immediate activation or scheduled opening, frozen electorate and ballot, deadlines, completion and cancellation.
- Reviewed CSV import of households and representative accounts, without public signup, overwriting existing records or automatic account enablement.
- Resident self-registration at `/register` for larger RWAs: name, email and household identifier create a suspended account and an ineligible household; administrators review and enable.
- Atomic one-time submission, participation monitoring, completed on-screen results, CSV exports and administrative audit history.
- PDF export is optional and may be deferred; it does not block version 1 or pilot readiness.

### Public launch surface

The requested launch additions are a public service surface, not new voting or
notification capabilities. Sign-in, privacy and contact pages use server
rendering, page-specific titles/descriptions/canonicals, public social metadata,
Organization/breadcrumb schema and related navigation. Discovery files list only
public pages; member, ballot, results and administrator routes remain no-indexed
and authorization-protected. No existing URLs were renamed.

Public contact sends a bounded enquiry through a separately configured provider,
with Origin/CSRF protection, shared send budgets and no message storage in the
application database. Provider acceptance must not be presented as confirmed
inbox delivery. This does not add vote reminders, messaging or ballot emails.
Optional Google Analytics is opt-in on privacy/contact only, never authentication
or voting workflows; Search Console uses a configured public verification token.
Deployment-specific legal identity, retention, providers and actual delivery
still require approval and external evidence. See the
[launch checklist](./LAUNCH_AUDIT.md#public-site-checklist-26-october-2026).

Residents and administrators can open the illustrated **User Guide** from the
footer without signing in. `/user-guide` links to separate Resident and RWA Admin
pages with complete persona journeys, refreshed synthetic screenshots and
bookmarkable contents sections. Only materially different screen states need
separate images; confirmations show only the popup. These public user pages
participate in discovery but not analytics. The junior-developer reference is
public only by direct `/tech-guide` URL, unlinked and noindex/nofollow, with
source/route maps, flow diagrams, ERD and safe debugging guidance. An unlisted
URL is not access protection. Standalone guide copies and old images are retired.

### Out of scope
- Multiple RWAs or societies; native iOS/Android apps.
- Self-registration that grants access or eligibility without administrator review, social login, or SMS/WhatsApp login.
- Voting reminders and notifications by email, SMS or WhatsApp, apart from login-code delivery. User-initiated public support enquiries are separate from these excluded notifications.
- Proxy/delegated, weighted, ranked-choice, multi-seat or multi-select voting; quorum rules and recurring polls.
- Candidate nominations, campaigning pages, comments and attachments.
- Digital signatures, signature certification, blockchain or cryptographically verifiable voting.
- Payments and fund-spending approvals.
- Multi-language UI. Resident names and ballot labels may use other scripts; validate their display in the application. If PDF export is included, validate font coverage and rendering for the RWA's approved scripts before enabling it rather than silently dropping unsupported characters.

## 07 Core Journeys
- **Admin setup:** Maintain the register, choose PUBLIC or PRIVATE, configure the ballot and opening/closing times, preview the ballot and privacy notice, validate, and deliberately activate.
- **Resident using the `voter` role, PRIVATE election:** Sign in, open an eligible election, select a candidate or NOTA for every office, review, confirm and submit once without exposing choices.
- **Resident using the `voter` role, PUBLIC poll:** Sign in, read the question, deadline and notice about live aggregate counts and post-close identity disclosure, select one or more options as configured, review and submit; replace the ballot until the poll closes.
- **Results viewer:** During an active PUBLIC poll, review live aggregate turnout/counts without identities. During an active PRIVATE election, Residents see aggregate turnout only; RWA Admins and RWA ReadOnly observers can review household participation status for follow-up without seeing choices. After completion, authorized personas review final results, see PUBLIC named responses where permitted, and download CSV or PDF when PDF export is available.
- **Admin correcting a mistake:** Edit a draft. Never silently change an active ballot; cancel an invalid active vote with a reason and create a replacement.
- **Member recovering from a network failure:** Check whether participation was accepted before retrying. Never require the member to retrieve a PRIVATE ballot to confirm submission.

## 08 Functional Requirements
### FR1 - Register and access
- The Residents review table (one admin tab combining people and their flats) defaults to the implicit `voter` role and shows flat assignment/eligibility alongside identity, role and access, ordered by flat then name with people without a flat last, with Status, Role, Source, Voting eligibility (eligible / not eligible / no flat) and exact-flat filters. Administrators may select actionable rows on the current page and independently confirm **Enable Selected** (access only) or **Make Eligible** (assigned-flat eligibility for future votes only). Explicit All Roles/Administrators filtering permits administrator selection with an access warning. Page/filter/size changes clear selection; no hidden pages are selected. Each existing protected operation commits/audits separately, stops subsequent rows on failure, and exposes completed/uncertain outcomes without altering frozen entitlements. Missing flat assignments block voter enablement, not administrator enablement; unassigned rows cannot be made eligible.
- Administrator CSV import accepts exactly `identifier,representative_name,email,is_eligible` (column order may vary), up to 500 records/256 KiB. Validate the whole file before contacting the register, report duplicate identifiers/emails and invalid fields, then preview existing-record conflicts. Import only ready residents after explicit confirmation. Each resident is processed independently; exact matches are skipped and conflicts never overwrite names, flat assignments, roles, eligibility or access. Newly imported residents remain unable to sign in until separately enabled. Provider/connection failures stop further rows with an uncertain/partial-state warning and a recheck-before-retry path. No CSV data is persisted in browser storage.
- Store a unique household identifier, representative name, registered email and eligibility status. **Residents → Add Resident** creates the account and household together in one form: a household is required for voters in this admin form, optional for management-role accounts; eligibility and immediate enablement are separate opt-ins. Existing account APIs retain optional-household provisioning. Admins assign or move an existing account's household, edit eligibility inline with Save/Cancel on resident details and suspend entries from Residents. The standalone eligibility route is removed; eligibility is edited only inline. Eligibility changes apply to future votes without changing account access or frozen electorates. Settings → Default Households defines allowed identifiers, not pre-created assignments; when configured, only listed, unassigned identifiers can be chosen. Without a configured list the identifier is typed.
- Support the lowercase `voter`, `rwa-admin` and `rwa-readonly` roles, presented as the Resident, RWA Admin and RWA ReadOnly personas. Only an RWA Admin assigns roles. Readonly committee members can read the authorized administrative register, account emails, drafts, settings, audit history, participation, results and exports, but all management controls are disabled and database/API mutations remain denied. Both management roles can be enabled without a household but receive no ballot without their own frozen entitlement. Management role never transfers or expands a frozen electorate.
- Let administrators configure one RWA-wide display label for that identifier (default "Household identifier"); use it consistently in register, electorate-selection, participation, results and printable reports. Derive plural wording for display only. Changing the label never changes stored identifiers, normalization, uniqueness or historical data; historical pages use the current label.
- Reject duplicate household identifiers and ambiguous account-to-household assignments. Use stable internal identifiers rather than names or emails as record keys.
- Verify email ownership through an expiring, single-use six-digit code before access. Provide recovery for invalid and expired codes.
- Provision the first admin through a controlled setup process, not public registration.
- Residents may self-register with name, email and household identifier. When the RWA has configured Default Households, the identifier is chosen from that list (type to filter or open the list) and anything else is rejected; with no list it is free text. The whole configured list is visible on the public page; which flats are taken is not shown. The account starts suspended and the household ineligible; nothing about self-registration grants a role, access or a ballot. A repeated email (whatever its account status) is rejected with an email-specific error before an already registered household is rejected with a household-specific error. Administrators can filter Residents by source and use the existing enable/eligibility actions.
- Persist secure sessions so residents need not log in for every visit, subject to the approved session policy; provide sign-out and enforce suspension.

### FR2 - PRIVATE election setup
- Require a title, instructions, at least one office, at least one named candidate per office, eligible households and a future closing date/time.
- Restrict candidate selection to the relevant office. Allow unopposed offices.
- Include an explicit NOTA (None of the Above) choice for each office; require one candidate or NOTA for every office.
- Display PRIVATE voting and its privacy notice in the preview, ballot and review.

### FR3 - PUBLIC poll setup
- Require a title/question, optional context, at least two distinct non-empty options, eligible households and a future closing date/time.
- Let the administrator configure single-select or multi-select. Every household must select at least one option; multi-select may have a maximum from 2 to 100 or no maximum. One household still submits one ballot and participates only once.
- During voting, eligible Residents and authorized RWA Admin/ReadOnly readers can see aggregate option counts and turnout, not individual responses. Before submission, explain that the member's name, household identifier and final selection(s) will be visible to authorized viewers after completion and in downloadable records, and that the ballot can be replaced until closure.

### FR4 - Lifecycle and freezing
- Support Draft -> Active or Draft -> Scheduled -> Active, then Active -> Completed or Active -> Cancelled. Completed and Cancelled votes cannot reopen or accept submissions.
- A draft may save a planned opening time in the RWA time zone; this does not schedule or freeze it. Scheduling still requires the same revision-bound preview, policy and register checks as activation, confirms a future opening before closure, and freezes the ballot/electorate/representatives immediately. Before opening, residents see only title/instructions/times/countdown, never candidates/options or controls. Database time, not the countdown or Cron timing, governs admission. Before opening only, a confirmed withdrawal with an audit reason returns to draft, clears snapshots/zero counters and advances the revision; edits require preview again. No late electorate transfer or late withdrawal is allowed. No reminders are added.
- Activation requires validation, preview and an explicit admin action.
- Freeze voting type, title/context/instructions, offices, candidates/options, household entitlements and representative assignments on activation. The closing deadline is set at activation; an optional draft opening plan is used only when scheduling is explicitly confirmed.
- While a vote is Active and before its deadline, an administrator may move the deadline later or earlier (for example after low turnout) for PUBLIC and PRIVATE votes. The change needs confirmation and a reason recorded only in the audit trail, must be at least 5 minutes in the future and differ from the current deadline; there is no limit on how far or how often. Residents are not notified separately; countdowns and admission follow the new deadline. A Completed or Cancelled vote's deadline never changes.
- Later register changes apply only to future votes and must not transfer an existing entitlement. Emergency suspension may block access without changing the frozen electorate or removing accepted votes.
- Complete at the deadline or through an explicitly confirmed admin action. Early completion requires a reason and must be labelled in results and exports.
- Show eligible voters and administrators a live countdown to the current deadline throughout the active vote, including after a member submits or replaces a ballot. At zero, refresh the vote state; the timer is informational and does not authorize or reject submissions.
- Record activation and effective completion times. Scheduled completion uses the deadline as the effective completion time even if background processing runs later.
- Cancellation requires confirmation and a reason. Show "Cancelled; results not valid," preserve the audit history, and do not publish choices or enable result exports.

### FR5 - Submission and deadline enforcement
- Show review and confirmation. An accepted PRIVATE submission is final and cannot be edited or withdrawn. A PUBLIC response can be replaced while the poll remains Active and before its deadline; only the latest selected option set counts.
- Validate identity, frozen eligibility, suspension, lifecycle state, deadline, selection validity and previous participation on the server. PUBLIC resubmission replaces the selected options without increasing participation; PRIVATE resubmission is rejected.
- Accept all offices of a PRIVATE ballot atomically, or accept nothing. Prevent duplicates across retries, double-taps, concurrent requests and multiple devices.
- Use the server clock. The authoritative deadline check occurs inside the guarded voting transaction after acquiring the vote lock, immediately before accepting participation and choices. The check must be strictly before the deadline; client click time or request arrival alone does not reserve eligibility.
- Show a live countdown on active voter, result and administrator vote pages; keep it visible after submission while the vote remains active. At zero, refresh the page state. A client countdown is guidance only and must never replace the database deadline check.
- A request that waits for the lock until the deadline is rejected. A transaction that passes the check before the deadline may commit afterwards. Serialize submission with completion/cancellation so their ordering cannot produce an accepted ballot after a terminal transition.
- Reject late submissions even if the displayed status has not refreshed. Outages do not automatically extend a deadline.
- Return success only once the whole submission is durable. Acknowledge participation without a receipt exposing PRIVATE selections. A member can subsequently see "Submitted" but cannot retrieve a PRIVATE ballot.

### FR6 - Results and counting
- For ACTIVE PUBLIC polls, show aggregate option counts and turnout to authorized Residents and RWA Admin/ReadOnly readers, never individual responses; refresh the display periodically. For ACTIVE PRIVATE elections, show aggregate turnout to eligible Residents and authorized management readers, never candidate/NOTA totals or outcomes; RWA Admins and RWA ReadOnly observers may see household participation status for follow-up. Monitoring must not reveal individual choices.
- Show eligible households, submitted ballots, turnout, counts and percentages with explicit denominators.
- Turnout uses the frozen eligible-household count. Results display each candidate, NOTA and PUBLIC option count out of the eligible households with that percentage and a bar (the API also keeps the share of submitted ballots). In multi-select polls these percentages can sum to more than 100%. Display zero denominators as not applicable rather than dividing by zero.
- For every office, candidate counts plus NOTA count equal submitted ballots. NOTA is a counted response but never competes to win; the candidate with the highest count among candidates is elected even when NOTA's count is higher. No candidate is elected if no candidate receives a vote, and tied leading candidates remain tied. PUBLIC option counts measure selections (and may exceed participation); each participating household has at least one valid response and participation totals reconcile with ballots.
- A zero-ballot vote has no winner. Mark tied leading candidates/options "Tie" without selecting a winner.
- PUBLIC results show respondent names, household identifiers and all selected options to authorised viewers. PRIVATE results show aggregates only.
- Do not present a poll outcome as automatic spending authorisation or legal certification.

### FR7 - Administration and audit
- RWA Admins and RWA ReadOnly observers can monitor participation counts and who has not voted, without seeing individual PUBLIC choices or any individual PRIVATE ballot.
- Record actor, action, affected record, timestamp and relevant reason for register changes, activation, early completion and cancellation.
- Audit records must not contain authentication codes, vote payloads or PRIVATE choices.
- Preserve completed results and historical identity snapshots despite later register edits, subject to the approved retention policy.

### FR8 - Exports
- CSV is required for version 1. PDF is optional; show its controls only when implemented. The requirements below apply to each available format.
- Allow results exports only for Completed votes and apply the same server-side permissions as results viewing.
- Generate PDF and CSV from authoritative completed data, not an independently editable report dataset.
- PUBLIC exports include the complete named-response list and totals, but no email addresses. PRIVATE exports contain aggregates only, with no voter lists, individual ballots or identity-to-choice mappings.
- PDF/CSV generation or download failures must not change participation or results, or return a truncated report as a successful export.

## 09 Roles and Permissions
All permissions are enforced server-side on every request, including direct result and export URLs.

| Capability | Unauthenticated visitor | Eligible member | Admin |
|------------|-------------------------|-----------------|-------|
| Sign in | Yes | Yes | Yes |
| Discover ballots/member details | No | Only ballots in own frozen electorate; no general member directory | Register and votes needed for administration |
| Cast a vote | No | Once through own frozen household entitlement | Only through own eligible household; never for others |
| View participation while Active | No | Own submission status only | Participation counts and household participation status |
| View active PUBLIC aggregates | No | Entitled votes: aggregate counts and turnout, whether submitted or not | Aggregate counts and turnout |
| View/export Completed results | No | Only votes in own frozen electorate, including PUBLIC named responses | Yes, including PUBLIC named responses |
| Retrieve individual PRIVATE selections | No | No, including own ballot | No |
| Manage register, drafts and lifecycle; view audit history | No | No | Yes |

An authenticated account remains subject to suspension and session checks; membership in an electorate does not bypass blocked access.

## 10 Data Integrity and Privacy Requirements
- **Core records:** RWA name/timezone, accounts/roles, households and representatives, votes and separate lifecycle status, frozen electorates, offices/candidates or options, participation, PRIVATE aggregate counters, PUBLIC named responses and audit events.
- **Historical identity:** Freeze representative assignments and PUBLIC respondent name/household snapshots so later edits cannot rewrite the historical record.
- **PRIVATE storage:** Retain the existing counters-only design: no per-ballot PRIVATE rows. Keep participation separately and update it atomically with counters. Do not store voter/account/household/session identifiers, shared ballot identifiers or correlatable per-response timestamps alongside PRIVATE choices.
- **Privacy across surfaces:** Never expose PRIVATE selections through APIs, receipts, logs, request tracing, error reporting, analytics, notifications or PDF/CSV exports. Do not persist unsent selections in browser storage; keep them in page memory only.
- **Assurance documentation:** [ARCHITECTURE.md](./ARCHITECTURE.md) must explain how atomic submission, counters and participation separation coexist, and disclose privileged-operator and small-electorate inference limitations under A2.
- **Retention:** Before launch, record approved retention durations, deletion triggers, backup expiry and responsibility for execution. Cover primary data, identity snapshots, audit records and service-retained exports. Downloaded PDFs/CSVs and printed copies cannot be remotely revoked or deleted and may outlive application retention.

## 11 Pages and Interaction States
### Screens
- **Access:** Email entry, code verification, expired-code recovery, access-denied state and sign-out.
- **Member home:** Eligible votes with voting type, separate lifecycle status, deadline and own submission status.
- **Vote detail/ballot:** Question or offices, options/candidates, eligibility, privacy notice, timezone-labelled deadline, selection, review, confirmation and acknowledgement.
- **Results:** Completed totals and turnout, authorised PUBLIC response list, candidate ties/NOTA/no-votes, early-completion label/reason, CSV action and PDF action only when implemented. Cancelled votes show invalid-result status without publishing choices.
- **Administration:** Register, RWA settings, vote list, draft editor with explicit voting type, preview, lifecycle confirmations, participation monitoring and audit history. Administrators personalize the RWA's full name, alias, household label (for example Flat or Villa, replacing “household” across the app) and identifier label (Number or ID) (required) and an optional address, email, phone, website, one of six contrast-checked accent palettes and welcome message. Residents never open the settings page; they see the values where useful: alias in the “Civic Pulse for {alias}” header, full name on the Votes, vote and results pages, a contact block in the signed-in footer, the welcome message on the Votes page, and the palette. Blank optional values are hidden. The public sign-in page shows the name and alias and the privacy page the name and address. Changes apply immediately everywhere, including existing votes and results. All workflows work on phones and laptops.

### Loading, empty and error states
- Paginated Votes, Residents, Manage Votes, Audit History, participation and
  completed PUBLIC named-response lists show filtered result totals,
  **Page X of Y**, **First / Previous / Next / Last**, and **Per page** choices
  of 10/25/50/100 that apply immediately on selection. Navigation controls
  are icons with accessible names and hover titles; a compact
  **Page X of Y · N results** replaces the separate record-range line.
  Filters persist through
  navigation; changing size resets to page one. Empty lists show 0 results
  and Page 1 of 1, with navigation disabled. These controls do not expose
  PRIVATE/active individual responses or change complete-result downloads.
- Use stable loading placeholders, visible submission progress and disabled repeat-submit controls. Never show success before acknowledgement or provisional/optimistic results; active PUBLIC totals must come from the authorized database projection.
- Show export-generation progress and prevent duplicate in-progress export requests.
- Distinguish no eligible votes, no current votes, empty register, incomplete draft, zero turnout and no named responses. Incomplete drafts cannot activate.
- Give actionable recovery for invalid/expired codes, email failures, validation errors, ineligibility, suspension, duplicate submission, terminal lifecycle states and network/server errors.
- Login responses must not reveal whether an email is registered; provide delivery/retry guidance without account enumeration.
- When submission outcome is uncertain, check own participation before offering a retry. If that check also fails, show an unresolved state with a retry/check action rather than claiming the vote failed.
- Preserve unsent selections only in page memory. On export failure, leave completed results visible and offer a retry without resubmitting a ballot.

## 12 Printable PDF and CSV Requirements
- CSV is required; PDF-specific requirements in this section apply only when the optional PDF feature is included. PDF is a derived printable outcome, never the source of truth or a database recovery mechanism.
- Generate downloadable PDFs server-side using a maintained library compatible with the selected stack; no paid/external PDF service or desktop-only workflow.
- Include the current RWA name (and, in the PDF header only, its address, email and phone), vote title/type, question or offices and candidates/options, activation and effective completion times with timezone, frozen eligibility, submitted count, turnout, final totals, percentage denominators, NOTA counts, ties/no-votes where applicable, and generation time. CSV carries the RWA full name but no address or contact details. A character the PDF fonts cannot display in these RWA values fails the PDF with the usual message to use the CSV, so keep them to supported scripts.
- Include the early-completion label/reason where applicable and state that the record is not a digital signature or legal certification.
- PUBLIC PDFs and CSVs include the full respondent-name, household-identifier and choice list, without emails. PRIVATE reports contain aggregates only.
- PDFs support A4 portrait, grayscale, wrapped long text, repeated table headers, page numbers and multiple pages without clipping, truncation or missing rows.
- Verify font coverage and legible rendering for the RWA's approved scripts, including long names and labels.
- Downloads work from phone and laptop browsers and can be stored and printed offline.
- CSVs carry equivalent result data and denominators in a tabular form. Escape cells to prevent spreadsheet formula injection; treat report text as untrusted input.

## 13 Non-Functional and Operational Requirements
- **Integrations:** Transactional email, persistent storage and managed HTTPS hosting. Provider selection and capacity require approval. No payments, social login, external PDF service or e-signature integration.
- **Security:** Enforce server-side permissions, encrypted transport, encryption at rest for stored data/backups, secure sessions, expiring single-use codes and rate limits for code requests/verification. Keep secrets out of source control.
- **Tracking:** No third-party trackers or analytics on voting screens. Operational monitoring must not record choices, vote payloads, authentication codes or personal data.
- **Accessibility:** Meet WCAG 2.2 AA for core member and admin journeys, with labelled controls, keyboard access, visible focus, readable contrast and no colour-only meaning.
- **Responsive design:** Test 320-430 CSS-pixel phone widths and 1280-1440 CSS-pixel laptop widths without overlapping text or page-level horizontal scrolling. Adapt long lists rather than clipping them. Follow the existing design system's 48px touch targets and 16px minimum input text.
- **Browsers:** Support current Chrome, Safari, Edge and Firefox on their supported mobile/desktop platforms. Explicitly verify mobile Safari and Android Chrome.
- **Timezone:** Use the RWA timezone and a visible timezone label for deadlines and lifecycle times; the server remains authoritative.
- **Monitoring:** Monitor availability, submission failures and email failures without recording selections.
- **Backup and recovery:** Maintain automated encrypted backups under an approved schedule and test restoration before launch. Approve recovery-point and recovery-time objectives under A6. Recovery must reconcile accepted participation and counters; never resume an interrupted election with uncertain integrity or silently discard acknowledged votes. A PDF alone is not a database recovery mechanism.
- **Outages:** Document incident handling, integrity checks and cancellation/replacement procedures. Do not automatically extend deadlines or reopen Completed/Cancelled votes.

## 14 Acceptance Criteria and Release Gates
### Mandatory acceptance
- Demonstrate both voting types end-to-end, including mobile admin setup, preview, activation, member submission, completion, results and CSV export. Include PDF export only if implemented.
- Verify voting type stays unchanged through lifecycle transitions, frozen ballot/eligibility/representative assignments, later register edits and emergency suspension.
- Verify permissions through both UI and direct API/export requests, including admin-without-voting-entitlement and ineligible/suspended accounts.
- Test concurrent requests, retries, multiple devices, atomic multi-office submission, failed transactions and acknowledgement loss. Reconcile participation against all counters/responses.
- Test requests before, exactly at and after the deadline, including lock waits that cross it and races with completion/cancellation, using FR5's acceptance point.
- Verify active PUBLIC aggregate updates and response replacement, no active PUBLIC identities, active PRIVATE aggregate turnout for Residents, RWA Admins and RWA ReadOnly, authorized-management household participation follow-up, hidden live PRIVATE candidate/NOTA totals, cancellation privacy, completed-only exports, denominators, NOTA counts not affecting candidate winners, ties, and zero-vote states.
- Verify early completion requires confirmation/reason and is labelled consistently in on-screen results and exports.

### Privacy acceptance
- Inspect application interfaces, APIs, receipts, PDF/CSV exports, logs and ordinary stored records for PRIVATE identity-to-choice disclosure.
- Demonstrate there are no PRIVATE per-ballot rows or persisted selection receipts, and that the documented privacy boundary matches the implementation.
- Explain privileged-operator and inference limitations and obtain A2 approval before using real election data.

### Mobile, accessibility and report acceptance
- Complete sign-in, ballot review, submission, results and CSV download on mobile Safari, Android Chrome and a laptop browser; verify the remaining supported browser coverage. Verify PDF download if included.
- Exercise mobile register management, vote creation and lifecycle actions at the stated widths; pass core-journey WCAG 2.2 AA checks.
- If PDF is included, test multi-page PDFs at the launch maximum electorate with long names/options and approved scripts. All PUBLIC rows render, headers repeat, no content clips, and totals match the application and CSV; verify A4/grayscale printing.
- For every available export format, verify no PRIVATE voter identities, unauthorised export rejection and recovery from failed generation.
- Pass the response-time targets at launch scale and validate email capacity and operating costs.

### Launch approval
- Record explicit approval of A1-A7, including election/NOTA rules, early completion, retention, backup/recovery objectives and the limits of optional printable exports. Signature-replacement approval is not a version 1 gate.
- Validate backup restoration and reconcile all accepted submissions with results.
- Reconcile supporting [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [API.md](./API.md) and [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) with these requirements before release. The target stack is Supabase and Tailwind, with PostgreSQL authoritative and automated encrypted backups required. Documentation decisions do not imply the implementation or remaining detailed documents have been migrated.
- Any lost/duplicate/partial or post-deadline accepted ballot, incorrect tally, unauthorised response disclosure or exposed PRIVATE selection blocks release.
- Pilot adoption and budget objectives must be reported separately from correctness gates; no target waives integrity, privacy, accessibility or required governance approvals.
