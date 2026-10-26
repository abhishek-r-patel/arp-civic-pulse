# Design System

## 01 Brand Identity
Trustworthy, modern, calm, clear, inclusive.

The chosen favicon is concept F, **Open Conversation**: a white conversation
bubble and teal checkmark on an Accent-teal rounded square. Its scalable source
is `src/app/icon.svg`; Next.js publishes it automatically for app pages, and the
public user guide references the same `/icon.svg`. It is a brand mark, not a
ballot-acceptance indicator. Do not replace it with another concept without a
new design decision. No illustrated workflow or source screenshot changes are
required for this browser-tab icon.

Civic Pulse should feel like a well-run community notice board: confident but never flashy. Screens use generous whitespace, one clear action per screen, and plain language aimed at non-technical and older residents.

This document is the visual and UX specification for [PRD.md](./PRD.md), implemented through the Supabase and Tailwind direction in [ARCHITECTURE.md](./ARCHITECTURE.md). It describes target behavior, not a claim that every component already exists.

- Make eligibility, privacy, deadlines, consequences and the next safe action understandable.
- Keep voting type, lifecycle status and personal participation visually and verbally distinct.
- Require deliberate review/confirmation for ballots and consequential admin actions.
- Never show provisional choice totals or claim submission success before acknowledgement.
- Design administration as carefully for phones as the resident journey.
- Use restrained surfaces, borders and whitespace rather than decorative charts, gradients, nested cards or motion-heavy effects.

## 02 Colour Palette
| Name | Hex | Use for |
|----------------|---------|--------------------------------------------------------|
| Primary | #0F172A | Main text, headings, key UI, CLOSED badge |
| Accent | #0F766E | Primary buttons, links, highlights, selected options |
| Secondary | #4F46E5 | Secondary actions, OPEN badge, focus ring |
| Background | #F8FAFC | Page background |
| Surface | #FFFFFF | Cards, inputs, sheets |
| Success | #15803D | Success states, "Submitted", confirmations |
| Warning | #B45309 | Privacy and disclosure notices, closing-soon states |
| Error | #B91C1C | Errors, destructive actions, cancelled votes |
| Muted | #475569 | Secondary text, captions |
| Border | #CBD5E1 | Dividers and card outlines |
| Control Border | #64748B | Input, radio and secondary-button borders (3:1 contrast) |

- **Tints:** For badge and notice backgrounds, use a palette colour at 10% opacity on Surface. The text on it uses the full colour.
- **Colour is never the only signal.** Always pair it with an icon and a label (for example, a lock icon and "CLOSED voting").
- **Voting type:** OPEN is Secondary with an Eye icon. CLOSED is Primary with a Lock icon.
- **Status:** Draft is Muted, Active is Accent, Completed is Success, and Cancelled is Error.
- Use Border for decorative dividers and Control Border for essential input/control boundaries; do not substitute the lighter divider colour for controls.
- Verify actual foreground/background pairings, including tinted notices, selected states and focus indicators. Tokens alone do not establish accessibility.

## 03 Typography
- **Font:** Inter (self-hosted via `next/font`). If PDF export is implemented, use bundled Inter and an explicitly configured fallback such as Noto Sans Devanagari for approved scripts; verify rendering rather than assuming automatic fallback.
- **Display:** 48px, Bold (32px on mobile), reserved for introductory/brand content.
- **Page title:** 36px, Semibold (28px on mobile), for functional pages such as votes, register and setup.
- **Section heading:** 24px, Semibold (20px on mobile).
- **Card heading:** 20px, Semibold.
- **Body:** 16px, Regular (never smaller on inputs, so iOS does not zoom)
- **Caption:** 14px, Regular
- Line height is 1.5 for body text and 1.25 for headings. Keep line length to 70 characters or fewer.
- Show dates in the RWA timezone with a timezone label, for example "Sat 2 Nov, 6:00 PM IST".
- Use one semantic page-level heading and logical heading order; heading appearance does not dictate its HTML level.
- Use sentence case and plain action labels. Do not use long uppercase passages; keep OPEN/CLOSED terminology consistent.
- Use tabular numerals for counts/percentages and keep their denominators visible. Never shrink important instructions to caption size merely to fit a layout.

## 04 Spacing
Use the existing 8px-led scale with a 4px half-step: 4, 8, 16, 24, 32, 48, 64px.

- Page gutter is 16px on mobile and 24px on tablet and desktop. Content max-width is 1120px, and ballot and form pages are centred at 640px.
- Minimum touch target is 48 × 48px, with at least 8px between targets.
- Keep labels/help close to their controls and use larger gaps between sections. Prefer headings and dividers over nested cards.
- Treat target size as a minimum, not a fixed height: wrapped text and enlarged text must expand controls without clipping.

## 05 Border Radius
- Small elements (badges, inputs): 8px
- Cards: 12px
- Buttons: 8px

## 06 Components
- **Primary button:** Accent background, white text, 8px radius, at least 48px high, full width on mobile. One prominent primary action per view.
- **Secondary button:** White background, 1px Control Border grey border, Primary text
- **Destructive button:** Error background, white text. Always behind a confirmation dialog.
- **Inputs:** 1px Control Border grey border, 8px radius, accent border on focus, a visible label above (never placeholder-only), and an inline error message in Error colour with an icon.
- **Focus:** Every interactive element has a visible 2px Secondary focus ring with a 2px offset.
- **Vote card:** A card showing title, type badge, status badge, deadline, and the user's state ("Not voted", "Submitted").
- **Type badge and status badge:** 8px radius, icon plus text, using a tint with full-colour text.
- **Ballot option:** A full-width radio card at least 56px high. The selected state uses an Accent border, a check icon and a tint, so it is not colour-only.
- **Privacy notice:** A readable Warning-tint callout with an icon before selection and again at review. Use the approved copy in section 09; never promise secrecy from all infrastructure operators.
- **Review and confirm screen:** A summary list of choices, "Back" and "Submit vote" buttons, and a final warning that submission cannot be changed.
- **Results bar:** Completed results only, with label, count, percentage and denominator available as text. Use "Winner" only when approved election rules establish one, and "Tie" for tied positive leaders. Never show live bars or a "Leading" state.
- **Data table:** Semantic headers and right-aligned numeric values. Prefer stacked label/value rows on mobile while preserving reading order and associations. A labelled contained scroller is acceptable only where a genuinely two-dimensional table needs it; never create page-level horizontal scrolling or truncate decision-relevant text. Header rows repeat when printed.
- **Confirmation dialog:** A bottom sheet on mobile and a centred modal on desktop. Focus is trapped, Esc closes it, and the destructive action is named explicitly ("Cancel vote").
- **Feedback:** An inline Success or Error banner for form results. Skeleton loaders for lists, and every list has an empty state with a next step.
- **Print and optional PDF:** Follow section 15 when implemented. PDF availability is not a prerequisite for viewing completed results.

### Component states
- Define default, hover, pressed, focus, disabled and loading states using shared semantic tokens. Do not add ad-hoc colours or component-specific hex values.
- Never rely on hover for instructions. Disabled actions explain the prerequisite where needed; loading actions retain a meaningful accessible name.
- Use a 2px focus indicator with 2px offset, verify its contrast and ensure it is never clipped or hidden behind sticky UI.
- Status messages remain visible for important outcomes. Use polite live announcements for progress/success and appropriately urgent announcements for actionable errors; do not repeatedly announce every counter or move focus unexpectedly.
- Dialogs have accessible names/descriptions, initial focus, keyboard containment and focus return. Provide an explicit cancel action and do not auto-focus a destructive confirmation.
- Radio cards use native radio inputs, visible labels and semantic groups. A decorative check/icon does not replace the input's accessible state.

## 07 Icons
Use Lucide React. Line icons only, 1.5px stroke. Always label icons with text unless the control has an accessible name. Hide decorative icons from assistive technology. Defaults: `Lock` (CLOSED), `Eye` (OPEN), `Vote`, `CheckCircle2` (submitted), `Clock` (deadline), `FileDown` (exports), `Users`, `ShieldCheck`, `AlertTriangle` (notices).

## 08 Breakpoints
- Mobile: under 640px
- Tablet: 640px to below 1024px
- Desktop: 1024px and above

- Mobile: a single column and a simple header. A sticky primary action is optional, not mandatory.
- Tablet and desktop: add a sidebar or top navigation for admins and a two-column layout for results and the admin dashboard.
- Test 320-430 CSS-pixel phone widths and 1280-1440 CSS-pixel laptop widths, plus intermediate widths and enlarged text.
- Sticky actions must not obscure the last row, instructions, errors or keyboard focus. Account for safe-area insets and the mobile on-screen keyboard; use normal document flow if space is insufficient.
- Keep dialogs, menus and date/time controls within the viewport. Let names, labels and buttons wrap rather than clip.
- Do not require a mouse or hover for any member/admin journey. Verify mobile Safari, Android Chrome and supported laptop browsers.

## 09 Voting Language and Privacy Copy
- Always display OPEN or CLOSED as the voting type and lifecycle status separately. Do not substitute "anonymous" or "named poll" for the type.
- Vote summaries carry a short privacy explanation; detail and review show the full notice before submission.
- **OPEN notice:** "After voting ends, eligible members and RWA admins can see your name, flat and choice, including in downloadable results."
- **CLOSED notice:** "Your selections are not shown to residents or RWA admins. Results show totals only."
- **CLOSED privacy limits:** Provide an accessible explanation: "This protects choices within the app, not against privileged infrastructure access. Results from very small elections may allow people to infer choices." Do not hide this behind hover-only content.
- **Final submission:** "Your submission is final. You cannot change or withdraw it."
- **Accepted:** "Vote submitted." CLOSED acknowledgement shows participation only, never selections or a link to retrieve the ballot.
- **Cancelled:** "Cancelled; results not valid." Do not publish choices or offer results exports.
- Use "Submit vote", "Review selections", "Activate vote", "Complete vote early" and "Cancel vote", not technical labels such as "Commit ballot" or vague "OK".

## 10 Navigation and Information Architecture
- **Members:** Votes, account context and sign-out. Show eligible current votes first and keep authorised completed results accessible.
- **Admins:** Clearly identified Votes, Households and Audit history, with a visible way back to the member experience. Share the application shell rather than creating a separate app.
- Admin capability does not imply eligibility to vote; show personal submission status only for the admin's own entitlement.
- Unauthenticated screens do not reveal the register, ballot catalogue or results. Members do not get a general resident directory.
- Use descriptive titles and breadcrumbs for deeper admin workflows. Always provide a visible Back/Cancel route.
- Preserve permitted admin draft input within the setup flow where feasible. This must not introduce persistent storage of resident ballot selections.
- Empty/inaccessible destinations should provide a safe next step without disclosing another household's information.

## 11 Forms, OTP and Ballot Interaction
### General forms
- Persistent visible labels, required-field indicators, nearby format hints and specific inline errors.
- Associate labels, descriptions and errors programmatically. Use an error summary for long forms and move focus deliberately to that summary or the first invalid field after failed validation.
- Preserve valid inputs while correcting errors, subject to the ballot's page-memory-only boundary.
- Distinguish editable fields from frozen/read-only values. Section long forms rather than presenting an uninterrupted field list.

### Email and code verification
- Explain registered-member access without offering public self-registration.
- Use a single text input for the six-digit code with a numeric keyboard hint and one-time-code autocomplete. Support paste, leading zeros and accessible labelling; do not use a numeric-value input or six separate focus traps.
- Provide explicit verification, invalid/expired-code guidance and a resend cooldown with readable timing. Do not repeatedly announce a countdown every second.
- Use generic delivery wording such as "If this email is registered, a sign-in code will be sent." Do not promise delivery or confirm registration.
- Keep verification errors safe and actionable. Offer retry/support guidance when delivery is unavailable without exposing register details.

### Admin setup
- Organize into voting type, ballot content, electorate, deadline and preview.
- Explain OPEN/CLOSED before type selection. For elections, group candidates by office; for polls, show the single-choice options.
- Preview the complete resident-facing ballot, notices and timezone-labelled deadline.
- Before activation, explain that ballot content, type, electorate, representative assignments and deadline freeze. A stale preview requires refresh/review, not silent activation of a newer draft.

### Resident ballot
- Show title, type, lifecycle status, eligibility, deadline/timezone and instructions before controls.
- Use a labelled radio group per office or poll, with an explicit Abstain option for each election office. No candidate/option should be preselected.
- Require one choice or abstention for every office and submit the election as one whole ballot.
- Review all selections before final confirmation; Back permits correction before submission.
- Do not restore CLOSED selections from server records after submission. Refresh/navigation may discard unsent selections; explain this where needed without persisting them.
- When the deadline passes or access/state changes, prevent further selection/submission and explain the state. The displayed clock is informative; the server decides acceptance.

## 12 Loading, Empty and Recovery States
### Submission states
| State | Required presentation |
|-------|-----------------------|
| Submitting | "Submitting vote..." with repeat submission disabled; no optimistic success |
| Accepted | Persistent participation acknowledgement; no CLOSED selection receipt |
| Already submitted | Confirm submitted status; do not offer a replacement ballot |
| Outcome unknown | "We could not confirm whether your vote was received. Checking submission status." |
| Status check unavailable | Explain uncertainty and offer "Check submission status"; do not invite blind resubmission |
| Confirmed not submitted | Offer retry only if the current eligibility/state/deadline still permit it |
| Confirmed rejection | Explain the safe reason and next step without echoing sensitive selections |

- Keep unsent choices only in page memory while resolving uncertainty. Never falsely declare failure because the network response was lost.
- Use stable skeletons for lists/results without placeholder choice totals or misleading zero counts.
- Distinguish no eligible votes, no current votes, empty register, no admin votes, incomplete draft, zero turnout and no OPEN named responses.
- Empty states explain context and next steps. Zero turnout is not a winning outcome; CLOSED states never suggest individual responses are inspectable.
- Cover invalid/expired codes, suspension, ineligibility, forbidden access, validation, stale drafts, duplicate submissions, terminal votes and dependency failures.
- Keep completed results visible when an export fails; offer export retry without changing data or resubmitting a ballot.
- Never auto-dismiss important errors/acknowledgements. Distinguish a draft-save success from an accepted ballot.

## 13 Page-Level Specifications
| Page | Required content and behavior |
|------|-------------------------------|
| Sign-in / verify | Registered-member context, labelled email/code, resend/recovery, safe generic messages |
| Member home | Eligible votes, distinct type/status, deadline or completion time, own participation and authorised results links |
| Ballot / review | Privacy notice, eligibility, timezone deadline, grouped selections, full review and final confirmation |
| Results | Completion context, frozen eligible count, submitted count, turnout, counts/denominators, abstentions and approved tie/no-votes outcomes |
| Admin vote list | Clear drafts/active/completed/cancelled grouping and next valid action, without live choices |
| Draft editor | Sectioned setup, validation, electorate selection, preview and explicit activation |
| Household register | Household, representative, email and eligibility; add/edit/suspend feedback and frozen-electorate explanation |
| Lifecycle confirmation | Action-specific consequences; required reasons for early completion/cancellation |
| Audit history | Readable actor/action/record/time/reason with pagination; no codes or CLOSED selections |
| Privacy policy | Public, one H1 and logical section headings; explain OPEN/CLOSED handling, cookies, support mail, optional analytics and deployment-specific policy limits |
| Contact | Public, labelled name/reply-email/message fields when configured; warning against sending choices/codes; clear unavailable, validation, pending, uncertain and provider-accepted states |

The shared shell provides contextual breadcrumbs and footer links in this order:
**Sign In**, **User Guide**, **Privacy Policy**, **Contact**. Footer labels and
the credit use title case. **Civic Pulse By Abhishek Patel** sits outside the
navigation: it is centered on its own row below the tablet breakpoint, and
right-aligned beside the links at tablet/desktop widths. Links wrap without
overlap; a stacked credit is never right-aligned. The guide opens in the same tab,
with working Contents links and **Back to Civic Pulse** navigation. It retains
its existing offline/print layout and screenshots; this footer-only addition
does not require screenshot recapture. Breadcrumb record labels are generic, not resident data.
Public-to-auth navigation intentionally loads a new document to prevent an
executed tracker surviving into sign-in/voting. Optional public-page analytics
uses an unchecked-by-default checkbox and supports withdrawal; it is not a
prerequisite for contacting the administrator. Contact success is a polite
status announcement, not an additional page heading. Preserve exactly one H1.
Public pages use the same Tailwind tokens, including `text-section` and
`md:text-section-lg`, not an independent design system.

- Results never show active totals. CLOSED results contain aggregates only; OPEN named responses appear only after completion to authorised viewers.
- Show denominator labels next to percentages. Keep abstention separate from candidates; zero denominators are not applicable rather than invalid arithmetic.
- Zero ballots have no winner. Tied positive leaders show Tie; use "No candidate elected" for all-abstain offices only after the governance rule is approved.
- Label early completion and display its reason. Completed poll outcomes do not imply spending authorisation or legal approval.
- Cancelled details display the invalid-result notice without publishing choices.
- For long OPEN response lists, use accessible pagination and complete labels; an export contains the whole authorised dataset, not just the visible page.
- Admin monitoring may show participation/non-participation but never active choices. Do not expose another member's active participation in member views.

## 14 Accessibility and Interaction
- Meet WCAG 2.2 AA for core member/admin journeys. The 48px touch target is a project standard, not a claim about the exact WCAG minimum.
- Use semantic landmarks, a skip link, logical headings, native controls and descriptive link/button names.
- Normal text needs at least 4.5:1 contrast; large text at least 3:1. Essential control boundaries/state indicators need appropriate non-text contrast; verify focus against surrounding surfaces.
- Preserve keyboard operation, logical focus order and readable zoom/text resizing without hidden content/actions. Test 200% text resizing and reflow at a 320 CSS-pixel viewport.
- Keep validation, instructions and status announcements programmatically associated and avoid unexpected focus moves.
- Preserve semantic table headers/reading order in responsive layouts. Never encode results only in bar length, colour or position.
- Confirmations state consequences, irreversibility and the actual action. Dialog cancellation must not submit or mutate data.
- Use short, restrained transitions; respect reduced motion. Do not animate tallies, auto-advance selections or use celebratory effects that suggest a preferred outcome.
- Automated axe checks supplement, not replace, manual keyboard, screen-reader, zoom and real-device checks.

## 15 CSV, Optional PDF and Print
- Supabase PostgreSQL is authoritative; the screen and exports use the same completed-result projection.
- CSV is available only for authorised Completed votes. Show "Download PDF" only if the optional PDF feature is implemented; do not show a permanently disabled placeholder.
- A missing PDF feature does not block voting, results viewing or pilot readiness.
- Export generation shows progress and prevents duplicate in-progress requests. Errors keep results visible and provide safe retry.
- If PDF is included, support A4 portrait, grayscale, wrapped long text, repeated headers, page numbers and the complete maximum-electorate response list without clipping.
- Reports include RWA/title/type, question or offices, timezone-labelled activation/completion times, turnout/denominators, totals, abstentions/ties/no-votes, generation time and early-completion context.
- OPEN exports include authorised names, household identifiers and choices without emails. CLOSED exports contain aggregates only, never household/voter lists.
- Validate long names and approved scripts in the application and, when included, PDF. Font availability alone does not prove readable shaping/rendering.
- Printable exports are derived outcomes, not backups, signatures or legal certifications. No signature-replacement workflow is required for version 1.

## 16 Tailwind Rules and Design Acceptance
- Define palette, typography, spacing and surface tokens once in the Tailwind theme in `src/styles/globals.css`. Use shared token classes, not raw hex, arbitrary per-component values or a second palette.
- Preserve the current visual identity during migration from CSS Modules; do not copy the archive's alternate warm-neutral palette/system font.
- Add reusable components only where repeated UI needs them. Do not introduce a paid component kit or another design framework.
- Keep voting type/status and privacy vocabulary consistent across member, admin, review and results screens.
- Before release, verify both voting types and member/admin journeys at specified widths, including long labels, enlarged text, keyboard focus and mobile-keyboard/sticky-action behavior.
- Verify OTP paste/autofill/leading zeros, all submission states, cancellation and early-completion confirmations, hidden active totals, and no CLOSED selection receipt.
- Check every implemented component's states and actual contrast combinations, plus manual assistive-technology checks.
- Verify CSV authorization/completeness and export failures; PDF-specific checks apply only when the feature is included.
- This documentation update does not itself migrate components, Tailwind configuration or application behavior.
