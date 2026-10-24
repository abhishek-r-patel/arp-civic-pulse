# Product Requirements Document

## 01 Product Overview
- **Product Name:** Civic Pulse
- **Tagline:** Fair, printable voting for your apartment community, from committee elections to everyday polls.
- **Status:** Proposed MVP requirements. This document defines product scope and acceptance criteria, not a claim that the current application implements them. Assumptions A1-A7 require explicit RWA approval before real voting.
- **Description:** Civic Pulse is a mobile-first web app that also works on tablets and laptops. It lets one Resident Welfare Association (RWA) run **CLOSED voting** for committee elections and **OPEN voting** for attributable community polls, such as "Buy a water treatment plant from the corpus? Yes / No" or "Which day for the Annual GBM? Mon / Tue / Sat / Sun".
- **Privacy distinction:** CLOSED voting exposes only aggregate choices, never a retrievable individual ballot or an identity-to-choice mapping through the application. This is application-level privacy with the limitations in A2. OPEN voting publishes respondent names, households and choices to eligible voters and admins only after completion.
- **Authoritative results:** Supabase PostgreSQL is the source of truth. Completed outcomes are shown in the application and exported as CSV. A readable, printable PDF export is optional and may be deferred beyond version 1; it is not a backup, authoritative record or signature-replacement workflow.
- **Terminology:** OPEN and CLOSED are voting types. Draft, Active, Completed and Cancelled are separate lifecycle statuses. Neither voting type implies a lifecycle status.

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
- **Pilot coverage:** One real RWA runs at least one OPEN poll and one CLOSED election end-to-end after the release gates pass.
- **Adoption:** At least 60% household turnout in the pilot vote. This is an adoption target, not a software release gate.
- **Measurement privacy:** Use an agreed pilot checklist and aggregate operational measurements without recording CLOSED selections.

### Correctness and service targets
- Zero duplicate, partial or post-deadline ballots, and no CLOSED identity-to-choice disclosure through application interfaces, exports, logs or ordinary stored records.
- CSV totals match authoritative completed results and the screen 100% of the time. If PDF export is included, it must match those results and print legibly on A4 in grayscale.
- Page and API response time is under two seconds at the 95th percentile at 500 households and about 100 concurrent users. Vote acknowledgement is within three seconds at the 95th percentile. Measure server-backed journeys under representative connectivity, excluding email delivery and poor client connectivity.
- **Budget objective:** ₹0 per month for hosting and required services on free tiers, with an optional domain excluded. Validate email capacity, database and backup limits before launch, and PDF execution limits if included. This is a feasibility objective, not permission to weaken privacy, correctness or recovery; obtain approval if a paid tier is required.

## 04 Target Users
- **Resident (household representative):** One designated adult per household who votes on a phone or laptop. Many are non-technical, and some are elderly.
- **RWA admin (committee member):** Maintains the register, creates and runs votes, monitors participation, and downloads results. Admin status does not grant voting entitlement; admins vote only through their own eligible household.
- **Result viewer:** An eligible household representative or admin reviewing completed outcomes and downloading records. This is a use case, not a separate permission role.

## 05 Assumptions and Decisions Requiring Approval
These are proposed operating defaults, not recorded RWA approvals. Development may use them provisionally. Record the approving authority, date and decision before real voting; do not infer approval from this document.

| ID | Proposed default | Approval required |
|----|------------------|-------------------|
| A1 | One vote per household, cast by one designated adult representative from an RWA-approved register. | Confirm whether bylaws instead require individual, owner-only or multiple votes per property. |
| A2 | CLOSED privacy is application-level, not cryptographically verifiable anonymity. Store participation separately from plain aggregate counters, with no CLOSED per-ballot rows. | Confirm this assurance level is sufficient. Infrastructure operators may infer choices from privileged access or changes over time; small or unopposed elections may reveal choices by inference. Separating records alone is not proof of anonymity. |
| A3 | Hide all choice totals and OPEN named responses while Active. Publish them only after completion to eligible voters and admins. | Confirm after-completion publication rather than live publication, and approve the identity-disclosure notice and downloadable named records. |
| A4 | Admin-managed register, no public sign-up, and login by a six-digit email code. | Confirm all representatives can access email and approve the email provider and session policy. |
| A5 | Single-choice OPEN polls; one candidate or explicit abstention per CLOSED office; highest-votes-wins with no quorum or approval threshold. Ties do not pick a winner. Proposed all-abstain outcome: "No candidate elected." | Confirm bylaws, whether polls are advisory or binding, the all-abstain outcome, and permission for early completion with a recorded reason. A poll result does not authorise spending. |
| A6 | Launch scale is 500 households and about 100 concurrent users. Retention is limited by an approved policy, not indefinite by default. | Approve durations and deletion rules for OPEN responses, participation, identity snapshots, audit records, service-retained exports and backup expiry. Approve backup frequency and recovery objectives, and validate free-tier feasibility. |
| A7 | The database is authoritative. Optional PDF export is only a printable outcome, not a backup, digital signature, signature certificate or legal certification. Replacing physical signatures is not a version 1 requirement. | Acknowledge these limits. Any future signature-replacement claim requires separate bylaw/legal approval. |

## 06 Scope
### Version 1
- Single-RWA, mobile-first web access for members and admins.
- Admin-managed households, registered-member email login and role-based access.
- CLOSED multi-office elections and OPEN single-choice polls.
- Preview, explicit activation, frozen electorate and ballot, deadlines, completion and cancellation.
- Atomic one-time submission, participation monitoring, completed on-screen results, CSV exports and administrative audit history.
- PDF export is optional and may be deferred; it does not block version 1 or pilot readiness.

### Out of scope
- Multiple RWAs or societies; native iOS/Android apps.
- Public self-registration, social login, or SMS/WhatsApp login.
- Reminders and notifications by email, SMS or WhatsApp, apart from login-code delivery.
- Bulk CSV import of the register, planned after the pilot; CSV results export remains in scope.
- Proxy/delegated, weighted, ranked-choice, multi-seat or multi-select voting; quorum rules and recurring polls.
- Candidate nominations, campaigning pages, comments and attachments.
- Digital signatures, signature certification, blockchain or cryptographically verifiable voting.
- Payments and fund-spending approvals.
- Multi-language UI. Resident names and ballot labels may use other scripts; validate their display in the application. If PDF export is included, validate font coverage and rendering for the RWA's approved scripts before enabling it rather than silently dropping unsupported characters.

## 07 Core Journeys
- **Admin setup:** Maintain the register, choose OPEN or CLOSED, configure the ballot and deadline, preview the ballot and privacy notice, validate, and deliberately activate.
- **CLOSED voter:** Sign in, open an eligible election, select a candidate or explicitly abstain for every office, review, confirm and submit once without exposing choices.
- **OPEN voter:** Sign in, read the question, deadline and identity-disclosure notice, select one option, review, confirm and submit once.
- **Results viewer:** After completion, review turnout and totals, see OPEN named responses where authorised, and download CSV or PDF when PDF export is available.
- **Admin correcting a mistake:** Edit a draft. Never silently change an active ballot; cancel an invalid active vote with a reason and create a replacement.
- **Member recovering from a network failure:** Check whether participation was accepted before retrying. Never require the member to retrieve a CLOSED ballot to confirm submission.

## 08 Functional Requirements
### FR1 - Register and access
- Store a unique household identifier, representative name, registered email and eligibility status. Admins can add, edit and suspend entries.
- Reject duplicate household identifiers and ambiguous account-to-household assignments. Use stable internal identifiers rather than names or emails as record keys.
- Verify email ownership through an expiring, single-use six-digit code before access. Provide recovery for invalid and expired codes.
- Provision the first admin through a controlled setup process, not public registration.
- Persist secure sessions so residents need not log in for every visit, subject to the approved session policy; provide sign-out and enforce suspension.

### FR2 - CLOSED election setup
- Require a title, instructions, at least one office, at least one named candidate per office, eligible households and a future closing date/time.
- Restrict candidate selection to the relevant office. Allow unopposed offices.
- Include an explicit "Abstain" choice for each office; require one candidate or abstention for every office.
- Display CLOSED voting and its privacy notice in the preview, ballot and review.

### FR3 - OPEN poll setup
- Require a title/question, optional context, at least two distinct non-empty options, eligible households and a future closing date/time.
- Require exactly one selected option.
- Before submission, prominently explain that the member's name, household identifier and choice will be visible to eligible voters and admins in completed results and downloadable records.

### FR4 - Lifecycle and freezing
- Support Draft -> Active -> Completed, and Active -> Cancelled. Completed and Cancelled votes cannot reopen or accept submissions.
- Activation requires validation, preview and an explicit admin action.
- Freeze voting type, title/context/instructions, offices, candidates/options, household entitlements, representative assignments and deadline on activation.
- Later register changes apply only to future votes and must not transfer an existing entitlement. Emergency suspension may block access without changing the frozen electorate or removing accepted votes.
- Complete at the deadline or through an explicitly confirmed admin action. Early completion requires a reason and must be labelled in results and exports.
- Record activation and effective completion times. Scheduled completion uses the deadline as the effective completion time even if background processing runs later.
- Cancellation requires confirmation and a reason. Show "Cancelled; results not valid," preserve the audit history, and do not publish choices or enable result exports.

### FR5 - Submission and deadline enforcement
- Show review and final confirmation. An accepted submission is final and cannot be edited or withdrawn.
- Validate identity, frozen eligibility, suspension, lifecycle state, deadline, selection validity and previous participation on the server.
- Accept all offices of a CLOSED ballot atomically, or accept nothing. Prevent duplicates across retries, double-taps, concurrent requests and multiple devices.
- Use the server clock. The authoritative deadline check occurs inside the guarded voting transaction after acquiring the vote lock, immediately before accepting participation and choices. The check must be strictly before the deadline; client click time or request arrival alone does not reserve eligibility.
- A request that waits for the lock until the deadline is rejected. A transaction that passes the check before the deadline may commit afterwards. Serialize submission with completion/cancellation so their ordering cannot produce an accepted ballot after a terminal transition.
- Reject late submissions even if the displayed status has not refreshed. Outages do not automatically extend a frozen deadline.
- Return success only once the whole submission is durable. Acknowledge participation without a receipt exposing CLOSED selections. A member can subsequently see "Submitted" but cannot retrieve a CLOSED ballot.

### FR6 - Results and counting
- Hide choice totals from everyone, including admins, until Completed. Admin participation monitoring must not reveal selections.
- Show eligible households, submitted ballots, turnout, counts and percentages with explicit denominators.
- Turnout uses the frozen eligible-household count. Election candidate and abstention percentages use submitted ballots; poll option percentages use accepted responses. Display zero denominators as not applicable rather than dividing by zero.
- For every office, candidate counts plus abstentions equal submitted ballots. Poll option counts equal accepted responses; participation totals reconcile with accepted ballots.
- A zero-ballot vote has no winner. Mark tied leading candidates/options "Tie" without selecting a winner. Do not treat abstention as a candidate; apply the proposed all-abstain outcome only after A5 approval.
- OPEN results show respondent names, household identifiers and choices to authorised viewers. CLOSED results show aggregates only.
- Do not present a poll outcome as automatic spending authorisation or legal certification.

### FR7 - Administration and audit
- Admins can monitor participation counts and who has not voted, without seeing active choices or any individual CLOSED ballot.
- Record actor, action, affected record, timestamp and relevant reason for register changes, activation, early completion and cancellation.
- Audit records must not contain authentication codes, vote payloads or CLOSED choices.
- Preserve completed results and historical identity snapshots despite later register edits, subject to the approved retention policy.

### FR8 - Exports
- CSV is required for version 1. PDF is optional; show its controls only when implemented. The requirements below apply to each available format.
- Allow results exports only for Completed votes and apply the same server-side permissions as results viewing.
- Generate PDF and CSV from authoritative completed data, not an independently editable report dataset.
- OPEN exports include the complete named-response list and totals, but no email addresses. CLOSED exports contain aggregates only, with no voter lists, individual ballots or identity-to-choice mappings.
- PDF/CSV generation or download failures must not change participation or results, or return a truncated report as a successful export.

## 09 Roles and Permissions
All permissions are enforced server-side on every request, including direct result and export URLs.

| Capability | Unauthenticated visitor | Eligible member | Admin |
|------------|-------------------------|-----------------|-------|
| Sign in | Yes | Yes | Yes |
| Discover ballots/member details | No | Only ballots in own frozen electorate; no general member directory | Register and votes needed for administration |
| Cast a vote | No | Once through own frozen household entitlement | Only through own eligible household; never for others |
| View participation while Active | No | Own submission status only | Participation counts and household participation status |
| View active choice totals | No | No | No |
| View/export Completed results | No | Only votes in own frozen electorate, including OPEN named responses | Yes, including OPEN named responses |
| Retrieve individual CLOSED selections | No | No, including own ballot | No |
| Manage register, drafts and lifecycle; view audit history | No | No | Yes |

An authenticated account remains subject to suspension and session checks; membership in an electorate does not bypass blocked access.

## 10 Data Integrity and Privacy Requirements
- **Core records:** RWA name/timezone, accounts/roles, households and representatives, votes and separate lifecycle status, frozen electorates, offices/candidates or options, participation, CLOSED aggregate counters, OPEN named responses and audit events.
- **Historical identity:** Freeze representative assignments and OPEN respondent name/household snapshots so later edits cannot rewrite the historical record.
- **CLOSED storage:** Retain the existing counters-only design: no per-ballot CLOSED rows. Keep participation separately and update it atomically with counters. Do not store voter/account/household/session identifiers, shared ballot identifiers or correlatable per-response timestamps alongside CLOSED choices.
- **Privacy across surfaces:** Never expose CLOSED selections through APIs, receipts, logs, request tracing, error reporting, analytics, notifications or PDF/CSV exports. Do not persist unsent selections in browser storage; keep them in page memory only.
- **Assurance documentation:** [ARCHITECTURE.md](./ARCHITECTURE.md) must explain how atomic submission, counters and participation separation coexist, and disclose privileged-operator and small-electorate inference limitations under A2.
- **Retention:** Before launch, record approved retention durations, deletion triggers, backup expiry and responsibility for execution. Cover primary data, identity snapshots, audit records and service-retained exports. Downloaded PDFs/CSVs and printed copies cannot be remotely revoked or deleted and may outlive application retention.

## 11 Pages and Interaction States
### Screens
- **Access:** Email entry, code verification, expired-code recovery, access-denied state and sign-out.
- **Member home:** Eligible votes with voting type, separate lifecycle status, deadline and own submission status.
- **Vote detail/ballot:** Question or offices, options/candidates, eligibility, privacy notice, timezone-labelled deadline, selection, review, confirmation and acknowledgement.
- **Results:** Completed totals and turnout, authorised OPEN response list, ties/abstentions/no-votes, early-completion label/reason, CSV action and PDF action only when implemented. Cancelled votes show invalid-result status without publishing choices.
- **Administration:** Register, vote list, draft editor with explicit voting type, preview, lifecycle confirmations, participation monitoring and audit history. All workflows work on phones and laptops.

### Loading, empty and error states
- Use stable loading placeholders, visible submission progress and disabled repeat-submit controls. Never show success before acknowledgement or provisional choice totals while Active.
- Show export-generation progress and prevent duplicate in-progress export requests.
- Distinguish no eligible votes, no current votes, empty register, incomplete draft, zero turnout and no named responses. Incomplete drafts cannot activate.
- Give actionable recovery for invalid/expired codes, email failures, validation errors, ineligibility, suspension, duplicate submission, terminal lifecycle states and network/server errors.
- Login responses must not reveal whether an email is registered; provide delivery/retry guidance without account enumeration.
- When submission outcome is uncertain, check own participation before offering a retry. If that check also fails, show an unresolved state with a retry/check action rather than claiming the vote failed.
- Preserve unsent selections only in page memory. On export failure, leave completed results visible and offer a retry without resubmitting a ballot.

## 12 Printable PDF and CSV Requirements
- CSV is required; PDF-specific requirements in this section apply only when the optional PDF feature is included. PDF is a derived printable outcome, never the source of truth or a database recovery mechanism.
- Generate downloadable PDFs server-side using a maintained library compatible with the selected stack; no paid/external PDF service or desktop-only workflow.
- Include RWA name, vote title/type, question or offices and candidates/options, activation and effective completion times with timezone, frozen eligibility, submitted count, turnout, final totals, percentage denominators, abstentions, ties/no-votes where applicable, and generation time.
- Include the early-completion label/reason where applicable and state that the record is not a digital signature or legal certification.
- OPEN PDFs and CSVs include the full respondent-name, household-identifier and choice list, without emails. CLOSED reports contain aggregates only.
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
- Verify hidden active totals, cancellation privacy, completed-only exports, denominators, abstentions, ties, zero ballots and the approved all-abstain outcome.
- Verify early completion requires confirmation/reason and is labelled consistently in on-screen results and exports.

### Privacy acceptance
- Inspect application interfaces, APIs, receipts, PDF/CSV exports, logs and ordinary stored records for CLOSED identity-to-choice disclosure.
- Demonstrate there are no CLOSED per-ballot rows or persisted selection receipts, and that the documented privacy boundary matches the implementation.
- Explain privileged-operator and inference limitations and obtain A2 approval before using real election data.

### Mobile, accessibility and report acceptance
- Complete sign-in, ballot review, submission, results and CSV download on mobile Safari, Android Chrome and a laptop browser; verify the remaining supported browser coverage. Verify PDF download if included.
- Exercise mobile register management, vote creation and lifecycle actions at the stated widths; pass core-journey WCAG 2.2 AA checks.
- If PDF is included, test multi-page PDFs at the launch maximum electorate with long names/options and approved scripts. All OPEN rows render, headers repeat, no content clips, and totals match the application and CSV; verify A4/grayscale printing.
- For every available export format, verify no CLOSED voter identities, unauthorised export rejection and recovery from failed generation.
- Pass the response-time targets at launch scale and validate email capacity and operating costs.

### Launch approval
- Record explicit approval of A1-A7, including all-abstain behavior, early completion, retention, backup/recovery objectives and the limits of optional printable exports. Signature-replacement approval is not a version 1 gate.
- Validate backup restoration and reconcile all accepted submissions with results.
- Reconcile supporting [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [API.md](./API.md) and [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) with these requirements before release. The target stack is Supabase and Tailwind, with PostgreSQL authoritative and automated encrypted backups required. Documentation decisions do not imply the implementation or remaining detailed documents have been migrated.
- Any lost/duplicate/partial or post-deadline accepted ballot, incorrect tally, unauthorised response disclosure or exposed CLOSED selection blocks release.
- Pilot adoption and budget objectives must be reported separately from correctness gates; no target waives integrity, privacy, accessibility or required governance approvals.
