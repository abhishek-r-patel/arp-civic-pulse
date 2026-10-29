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

The approved appearance direction is **Platinum** (light) and **Obsidian** (dark),
using one consistent layout and Sora/Manrope typography. Following approval of
the concept-aligned Votes screen, the user authorized rollout across all screen
families. Top navigation, ballot rules, authorization, privacy and confirmations
remain unchanged. The User Guide and its screenshots are explicitly excluded
from this rollout; use temporary test captures for verification until that hold
is lifted.

This document is the visual and UX specification for [PRD.md](./PRD.md), implemented through the Supabase and Tailwind direction in [ARCHITECTURE.md](./ARCHITECTURE.md). It describes target behavior, not a claim that every component already exists.

Record approved design decisions here in their owning sections in the same turn.
Apply reusable decisions consistently to matching UI across the app, using shared
components where possible. Identify screen-specific content explicitly, and keep
documented rules, implemented rollout, verification and user approval distinct.

- Make eligibility, privacy, deadlines, consequences and the next safe action understandable.
- Keep voting type, lifecycle status and personal participation visually and verbally distinct.
- Require deliberate review/confirmation for ballots and consequential admin actions.
- Never show active PRIVATE candidate/NOTA totals or claim submission success before acknowledgement. Active PUBLIC polls may show aggregate option counts/turnout; active PRIVATE elections may show aggregate turnout only. Never show active choices.
- Design administration as carefully for phones as the resident journey.
- Use restrained surfaces, borders and whitespace rather than decorative charts, gradients, nested cards or motion-heavy effects.

## 02 Colour Palette
| Name | Hex | Use for |
|----------------|---------|--------------------------------------------------------|
| Primary | #1D2522 | Main text, headings, key UI, PRIVATE badge |
| Accent | #0C6953 | Primary buttons, links, highlights, selected options |
| Secondary | #275D79 | Secondary actions, PUBLIC badge, focus ring |
| Background | #F4F6F5 | Page background |
| Surface | #FFFFFF | Cards, inputs, sheets |
| Success | #166534 | Success states, "Submitted", confirmations |
| Warning | #92400E | Privacy and disclosure notices, closing-soon states; readable on selected-row tints |
| Error | #B91C1C | Errors, destructive actions, cancelled votes |
| Muted | #52635A | Secondary text, captions |
| Border | #D7DFDA | Dividers and card outlines |
| Control Border | #687B70 | Input, radio and secondary-button borders (3:1 contrast) |

Obsidian overrides: background `#111616`, surface `#1A2020`, primary `#EDF2EF`,
muted `#A9B5B0`, secondary `#A4D5EF`, control border `#7F9188`, divider `#35403C`,
success `#9CDDA8`, warning `#EDC681` and error `#FFAAA5`. Dark accent variants
are Teal `#8BE4C8`, Blue `#93C5FD`, Forest `#A3D9A5`, Plum `#D8B4FE`, Slate
`#CBD5E1` and Amber `#FCD34D` (light Amber is `#92400E`). Filled actions use
`on-accent`/`on-error` foreground tokens, not fixed
white text. Light text/control and all dark accent pairs have automated contrast
gates; tinted/selected combinations also require rendered axe checks.

### Appearance Preferences

- Offer a labelled icon menu in the header on signed-in and public pages, using
	native Light/Dark/System radios, Escape dismissal, outside dismissal and focus return.
- Default to System and follow live device changes. Persist only the explicit mode
	under `civic-pulse-theme` in local storage; never account data or selections.
	The choice is per browser, survives sign-out, and is not synced across devices.
- Normalize invalid stored values before paint. Blocked storage falls back to
	System at startup and permits an in-memory choice until reload. `next-themes`
	handles preference/media/cross-tab updates; theme-change transitions are disabled.
- Resolve appearance before rendering rather than flashing the opposite mode.
	No new CSP permission is introduced; the small static bootstrap uses the existing
	inline-script policy and accepts only known mode values.
- Keep RWA accent selection independent. Print always uses light surfaces and
	readable light accent variants; PDFs and the script-free offline/public guides
	keep their existing light presentation.

- **Tints:** For badge and notice backgrounds, use a palette colour at 10% opacity on Surface. The text on it uses the full colour.
- **Colour is never the only signal.** Always pair it with an icon and a label (for example, a lock icon and "PRIVATE voting").
- **Voting type:** PUBLIC is Secondary with an Eye icon. PRIVATE is Primary with a Lock icon.
- **Status:** Draft is Muted, Scheduled is Secondary with a clock icon, Active is Accent, Completed is Success, and Cancelled is Error.
- Use Border for decorative dividers and Control Border for essential input/control boundaries; do not substitute the lighter divider colour for controls.
- Verify actual foreground/background pairings, including tinted notices, selected states and focus indicators. Tokens alone do not establish accessibility.

## 03 Typography
- **Fonts:** Sora headings and Manrope body/control text, self-hosted through `next/font` in both themes. Browser requests never go to Google Fonts. PDF export retains bundled Inter and Noto Sans Devanagari; it does not inherit the interface theme or new font choice.
- **Display:** 48px, Bold (32px on mobile), reserved for introductory/brand content.
- **Page title:** 36px, Semibold (28px on mobile), for functional pages such as votes, register and setup.
- **Section heading:** 24px, Semibold (20px on mobile).
- **Card heading:** 20px, Semibold.
- **Body:** 16px, Regular (never smaller on inputs, so iOS does not zoom)
- **Caption:** 14px, Regular
- Line height is 1.5 for body text and 1.25 for headings. Keep line length to 70 characters or fewer.
- Letter spacing is zero. Keep appearance changes from changing font families or causing layout jumps between modes.
- Show voting dates/deadlines in the RWA timezone with a timezone label, for example "Sat 2 Nov, 6:00 PM IST". Residents Last Changed is an exception: use the viewer's browser time zone without a repeated zone suffix, exposing the zone on hover.
- Use one semantic page-level heading and logical heading order; heading appearance does not dictate its HTML level.
- Use sentence case and plain action labels. Do not use long uppercase passages; keep PUBLIC/PRIVATE terminology consistent.
- Use tabular numerals for counts/percentages and keep their denominators visible. Never shrink important instructions to caption size merely to fit a layout.

## 04 Spacing
Use the existing 8px-led scale with a 4px half-step: 4, 8, 16, 24, 32, 48, 64px.

- Page gutter is 16px on mobile and 24px on tablet and desktop. The shared content container uses the available viewport width without a desktop max-width cap, consistently across pages, headers, footers and public information screens. Individual ballot/form and short explanatory blocks retain their 640px readability limit; do not constrain an entire table/list page to that width.
- Page-header titles and descriptions fill the available space beside their action buttons rather than retaining a 640px copy limit. Keep actions right-aligned on larger screens and stacked below on phones; description text wraps naturally without widening the page.
- **Form-focused pages:** Center the complete page-content unit (back link, title, description, guidance and form) in a `w-full max-w-ballot` column with automatic horizontal margins. Keep text left-aligned within that column. This applies to resident creation/detail/eligibility, RWA Settings, vote creation/editing/lifecycle detail, ballot preview and the resident ballot. Sign-in, self-registration, contact and privacy already use the same centered readable width. Keep register/import-review, audit, participation, vote lists and results workspaces wide; do not center individual fields separately or narrow their tables. Phones use the available width inside existing gutters. Breadcrumbs and global header/footer remain in the full-width shell.
- Minimum touch target is 48 × 48px, with at least 8px between targets.
- Keep labels/help close to their controls and use larger gaps between sections. Prefer headings and dividers over nested cards.
- Center the Manage Resident Save/Suspend-or-Enable/Delete action group horizontally within Details; preserve its wrapping/full-width phone behavior.
- Suspend/Delete account buttons expose native hover titles and screen-reader descriptions of the resident's lost sign-in, voting and signed-in page access after confirmation. Explain that suspension is reversible, deletion is permanent and existing vote records remain. Keep confirmation dialogs as the touch-accessible explanation before any mutation.
- The Delete Account confirmation explicitly lists lost sign-in, ballot/PUBLIC response-update and signed-in votes/results access, including existing sessions. Prominently recommend cancelling and using Suspend Account for reversible access blocking; explain deletion cannot be undone and retains votes, audit history and household assignment. Cancel retains initial focus; do not mutate until the red confirmation is selected.
- **Manage Resident actions:** Group Save Changes, Suspend/Enable Account and Delete Account in one row below Details, wrapping on phones/enlarged text. Replace the bottom Cancel link with a right-aligned circled close icon (`CircleX`) beside Details: a 48px navigation link labelled "Close resident details", with a "Close without saving" hover title, returning to Residents. Suspend uses the shared amber warning button variant; Delete uses the red destructive variant. Enable retains its secondary appearance. Account-state buttons remain non-submit actions with existing confirmation dialogs; saving details stays separate from access changes. Status and role badges remain above Details without duplicate action buttons.
- **Common form frame:** Use the shared `form-panel` utility for standalone forms and action/input panels: a 1px theme border, 8px radius, surface background and 16px phone/24px desktop padding. Applies to access/contact/registration, resident details and assignment/eligibility, Settings/support, vote setup/lifecycle/ballot, import and standalone list-filter forms. Keep headings outside or inside according to their existing section ownership. Do not double-frame nested forms, popover filters or modal contents that already have a container. On Manage Resident, the Status heading and badges share one wrapping row; action buttons stay below. Wrap only when the viewport/text size requires it.
- Treat target size as a minimum, not a fixed height: wrapped text and enlarged text must expand controls without clipping.

## 05 Border Radius
- Small elements (badges, inputs): 8px
- Cards: 8px
- Buttons: 8px

## 06 Components
- **Primary button:** Accent background, contrast-safe `on-accent` text (white in light mode, dark ink in dark mode), 8px radius, at least 48px high, full width on mobile. One prominent primary action per view.
- **Secondary button:** Surface background, 1px Control Border, Primary text in either theme.
- **Destructive button:** Error background and contrast-safe `on-error` text. Always behind a confirmation dialog.
- **Inputs:** 1px Control Border grey border, 8px radius, accent border on focus, a persistent visible label (never placeholder-only), and an inline error message in Error colour with an icon. Follow the responsive label/help layout in section 11.
- Keep each required-field asterisk attached to the label's last word with a non-breaking space, so it never wraps onto a line by itself.
- Inline fields allocate one-third of the available column space to the label/help group and two-thirds to the control, with a 16px gap. This keeps short required labels such as **Resident name \*** on one line in the bordered 640px form without changing font sizes. Phones still stack labels above controls; longer labels may wrap naturally.
- **Focus:** Every interactive element has a visible 2px Secondary focus ring with a 2px offset.
- **Vote card:** A card showing title, type badge, status badge, deadline, and the user's state ("Not voted", "Submitted").
- **Type badge and status badge:** 8px radius, icon plus text, using a tint with full-colour text.
- **Role badges:** Use the shared semantic status colours: Voter is success green, RWA ReadOnly and App Support (ReadOnly) are warning amber, and RWA Admin is error red. Use tinted backgrounds/borders like account status badges, in both themes. Retain the role's visible text and icon; these colours identify roles, not account access or voting eligibility.
- **Ballot option:** A full-width radio card at least 56px high. The selected state uses an Accent border, a check icon and a tint, so it is not colour-only.
- **Privacy notice:** A readable Warning-tint callout with an icon before selection and again at review. Use the approved copy in section 09; never promise secrecy from all infrastructure operators.
- **Review and confirm screen:** A summary list of choices, "Back" and "Submit Vote" buttons, and a final warning that submission cannot be changed.
- **Results bar** (`ResultBars`): one row per option, candidate, NOTA or turnout, with the label (and optional tag) on the left, `count/eligible percent%` in tabular numerals on the right, and a full-width bar below. Leaders use the accent fill with a "Leading" (live PUBLIC), "Elected" (completed PRIVATE) or "Tied" tag; other rows use a neutral fill; NOTA uses a muted striped fill because it cannot win. The text carries the meaning and is read as "count of total eligible households"; bars are decorative and hidden from assistive technology. Never show candidate bars for a live PRIVATE election, only turnout. The PDF draws the same rows in greyscale with a hatched NOTA bar.
- **Data table:** Semantic headers and right-aligned numeric values. Prefer stacked label/value rows on mobile while preserving reading order and associations. A labelled contained scroller is acceptable only where a genuinely two-dimensional table needs it; never create page-level horizontal scrolling or truncate decision-relevant text. Header rows repeat when printed.
- **Pagination:** Every potentially paginated list shows **Page X of Y · N results**, a Per page selector (10/25/50/100, default 25) that applies immediately, and icon-only First/Previous/Next/Last controls with accessible names and hover titles. No separate record-range line or apply button is shown. The inline **Per page** label sits beside its dropdown on the same line as navigation (wrapping only on narrow phones), without an optional marker or hint. Disabled ends are not links. Filters and page size persist through navigation; applying filters or selecting a page size starts at page 1. Keep controls for empty/single-page lists, with page 1 of 1, 0 results when empty, and disabled navigation. Wrap controls without page overflow on phones. Larger page sizes may expose wider table content; the shared labelled, keyboard-focusable table region contains horizontal scrolling on tablets/desktops rather than widening the page.
- **Dropdowns:** Keep each menu anchored to its trigger and exactly within the trigger's width, including on narrow screens. Use a keyboard-operable listbox with visible focus/active state; support arrows, Home/End, type-to-select, Enter/Space and Escape, and dismiss on outside click. Do not rely on native select popup sizing.
- **Confirmation dialog:** Centre horizontally and vertically in the viewport on phones, tablets and desktops, including after scrolling the underlying page. Keep at least 16px horizontal gutters, a bounded width and a 90dvh maximum height with internal scrolling so long content and actions remain reachable. Focus is trapped, Esc closes it, and the destructive action is named explicitly ("Cancel vote"). Dropdowns, autocomplete lists and menus remain anchored to their triggering controls rather than becoming centred modals.
- **Feedback:** An inline Success or Error banner for form results. Skeleton loaders for lists, and every list has an empty state with a next step.
- **Print and optional PDF:** Follow section 15 when implemented. PDF availability is not a prerequisite for viewing completed results.

### Component states
- Shared page headers use a quiet bottom divider and compact heading/action hierarchy, not decorative enclosing cards. Empty states use unframed bands. All form controls retain 16px text/48px targets with improved padding and focus/disabled contrast. Notices use a restrained left rule and body-scale heading, keeping icon/text/live-region semantics. Tables retain semantic headers and stacked mobile rows, with quiet header tint and hover/selection feedback.
- Ballot radio and multi-select options use 56px rows, essential-control borders and a checked tint/inset marker. Keep native controls and the existing choose/review/submit state machine; review summaries use dividers rather than nested cards. Results use slimmer comparison bars with explicit counts/denominators and worded outcomes; NOTA keeps its non-winner stripe. Read-only lifecycle facts use unframed separators; editable setup/action panels use the common form frame. Dialogs remain native centred modal controls with a restrained accent top rule, unchanged confirmation order and focus handling.
- Define default, hover, pressed, focus, disabled and loading states using shared semantic tokens. Do not add ad-hoc colours or component-specific hex values.
- Never rely on hover for instructions. Disabled actions explain the prerequisite where needed; loading actions retain a meaningful accessible name.
- Use a 2px focus indicator with 2px offset, verify its contrast and ensure it is never clipped or hidden behind sticky UI.
- Status messages remain visible for important outcomes. Use polite live announcements for progress/success and appropriately urgent announcements for actionable errors; do not repeatedly announce every counter or move focus unexpectedly.
- Dialogs have accessible names/descriptions, initial focus, keyboard containment and focus return. Provide an explicit cancel action and do not auto-focus a destructive confirmation.
- Radio cards use native radio inputs, visible labels and semantic groups. A decorative check/icon does not replace the input's accessible state.

## 07 Icons
Use Lucide React. Line icons only, 1.5px stroke. Always label icons with text unless the control has an accessible name. Hide decorative icons from assistive technology. Defaults: `Lock` (PRIVATE), `Eye` (PUBLIC), `Vote`, `CheckCircle2` (submitted), `Clock` (deadline), `FileDown` (exports), `Users`, `ShieldCheck`, `AlertTriangle` (notices).

## 08 Breakpoints
- Mobile: under 640px
- Tablet: 640px to below 1024px
- Desktop: 1024px and above

- Mobile: a single column and a simple header. A sticky primary action is optional, not mandatory.
- Header (all widths): the first row holds "Civic Pulse for {alias}" and the signed-in name; the second row holds the navigation tabs on the left and **Sign Out** right-aligned on the same line, so the button never drops onto its own row. Tabs wrap beneath one another while Sign Out stays at the top right of that row.
- Tablet and desktop: add a sidebar or top navigation for admins and a two-column layout for results and the admin dashboard.
- Test 320-430 CSS-pixel phone widths and 1280-1440 CSS-pixel laptop widths, plus intermediate widths and enlarged text.
- Sticky actions must not obscure the last row, instructions, errors or keyboard focus. Account for safe-area insets and the mobile on-screen keyboard; use normal document flow if space is insufficient.
- Keep dialogs, menus and date/time controls within the viewport. Let names, labels and buttons wrap rather than clip.
- Do not require a mouse or hover for any member/admin journey. Verify mobile Safari, Android Chrome and supported laptop browsers.

## 09 Voting Language and Privacy Copy
- Always display PUBLIC or PRIVATE as the voting type and lifecycle status separately. Do not substitute "anonymous" or "named poll" for the type.
- Vote summaries carry a short privacy explanation; detail and review show the full notice before submission.
- **PUBLIC notice:** "While voting is open, eligible members, RWA Admins and RWA ReadOnly observers can see aggregate counts only. You can change your selection until voting closes. After it ends, your name, flat and final selections are visible in authorized results and downloads."
- **PRIVATE notice:** "Your selections are not shown to the Resident, RWA Admin or RWA ReadOnly personas through the app. Results show totals only."
- **PRIVATE privacy limits:** Provide an accessible explanation: "This protects choices within the app, not against privileged infrastructure access. Results from very small elections may allow people to infer choices." Do not hide this behind hover-only content.
- **Final submission (PRIVATE only):** "Your PRIVATE election submission is final. You cannot change or withdraw it." PUBLIC ballots never show it because their selections can be changed until closing.
- **Accepted:** PUBLIC acknowledgement confirms the current choice and offers a change action while active. PRIVATE acknowledgement shows participation only, never selections or a link to retrieve the ballot.
- **Cancelled:** "Cancelled; results not valid." Do not publish choices or offer results exports.
- Write button labels in Title Case (minor words such as "a", "and", "to" stay lowercase unless first), for example "Submit Vote", "Review Selections", "Activate Vote", "Complete Vote Early", "Cancel Vote" and "Sign Out", not technical labels such as "Commit ballot" or vague "OK".

## 10 Navigation and Information Architecture
- Compact branding uses the existing chosen icon, the Civic Pulse name and the RWA alias on a separate line; the brand link retains the full accessible "Civic Pulse for {alias}" name. Authenticated initials are supplementary and never replace the signed-in identity. Keep the previously agreed top navigation and sign-out controls rather than introducing the mockup's sidebar in this correction.
- **Residents (`voter`):** Votes, account context and sign-out. Show eligible current votes first and keep authorized completed results accessible.
- **RWA Admins (`rwa-admin`):** Clearly identify management destinations and provide a visible way back to the Resident experience. Share the application shell rather than creating a separate app.
- **RWA ReadOnly (`rwa-readonly`):** Show the same authorized management destinations as RWA Admin and a persistent read-only notice. Keep management controls visible but natively disabled; filters, navigation, previews, results/downloads and the Resident's own ballot remain usable. Do not rely on disabled controls for authorization.
- RWA Admin capability does not imply eligibility to vote; show personal submission status only for that account's own entitlement.
- Unauthenticated screens do not reveal the register, ballot catalogue or results. Members do not get a general resident directory.
- Use descriptive titles and breadcrumbs for deeper admin workflows. Always provide a visible Back/Cancel route.
- Preserve permitted admin draft input within the setup flow where feasible. This must not introduce persistent storage of resident ballot selections.
- Empty/inaccessible destinations should provide a safe next step without disclosing another household's information.

## 11 Forms, OTP and Ballot Interaction
### General forms
- Persistent visible labels, required-field indicators, specific inline errors and click-to-open (i) help for field explanations. Keep each info icon immediately beside its label, consistently left-aligned rather than pushed to the opposite edge or wrapped to another row. Single-line text, select and combobox controls place the label/help control beside the input when space allows and stack on narrow screens. Keep textareas stacked; keep checkbox/radio choices and their labels together, with checkbox help beside the checkbox label.
- Write field help in compact, plain language; omit redundant wording and keep internal codes out of user-facing choices. Resident role selectors and filters use **Role**, with **Voter**, **RWA Admin** and **RWA ReadOnly** as the option labels; saved/API role codes and permissions do not change.
- Put supplementary form introductions in a collapsed-by-default, keyboard-operable summary with a chevron and short points, rather than a large always-visible notice. Keep errors, consequential warnings and required voting/privacy disclosures visible. Add Resident uses **Before you add a resident** with three reminders: household assignment, initial sign-in suspension and separate voting eligibility. Field-specific (i) help remains available.
- **Add Resident form:** Enclose the complete form, from collapsed guidance through action buttons, in one subtle `border-border` surface with the card radius and 16px phone/24px desktop padding. Keep the page heading outside. Place **Eligible to vote** and **Enable account now** side by side in one wrapping row, retaining independent state, click-to-open help and 48px label targets. Wrap on narrow screens or with enlarged text instead of shrinking labels or causing horizontal overflow.
- Associate labels, descriptions and errors programmatically. Use an error summary for long forms and move focus deliberately to that summary or the first invalid field after failed validation.
- Use Title Case for filter headings. Residents free-text filters (Representative and identifier) use literal case-insensitive contains-anywhere matching, not exact or typo-tolerant matching. Type **Abhi**, not wildcard syntax. The identifier filter uses the configured Identifier Label without an "Exact" prefix and suggests all Default Households from RWA Settings (including assigned entries), while accepting partial/custom text. With no suggestions it is a plain text box. Blank includes all identifiers; existing identifier bookmarks now use contains matching. Onboarding still restricts choices to configured, unassigned entries.
- **Compact list filters:** Omit redundant optional markers. When inline labels would become narrow multi-line columns, place labels directly above their controls rather than squeezing them beside inputs. Keep 16px text, 48px targets and adjacent (i) help. Size standalone dropdown filters to their labels and longest option instead of equal-width columns, keeping menus within their field width. Do not hard-code a column count.
- **Sortable/filterable tables:** Keep controls next to the relevant column rather than repeating a large filter form above the table. Sorting and filtering must cover the entire authorized dataset before pagination, with exact matching totals; never silently sort only the visible page. Use named sort links, directional icons and `aria-sort`; mark applied filters with a non-colour indicator and accessible description. Header labels wrap between words, never inside words; contain any necessary horizontal scrolling in the table region. Keep menus above scroll containers with viewport-constrained, dismissible popovers. Inside scrolling filter panels, dropdown options expand in flow to avoid clipping. Shared table headers support this pattern; other tables retain their existing behavior until separately approved.
- **Residents table controls:** Representative, configured household, Status, Role, Voting Eligibility, Last Changed and Source have sortable headings and column filter buttons. Source sits immediately before Actions and uses icon-only Self-registered (person)/Admin-registered (shield) disclosures with hover titles, accessible names and click/tap text, like Status; remove the former self-registration caption under Representative. Use distinct silhouettes rather than two similar person icons. Source ascending groups Admin-registered first, descending Self-registered first, with name/ID tie-breakers. No dedicated Source filter remains above the table; phones use **Sort & Filter** for all fields and ordering because rows stack. Representative searches names only, not Auth email. Last Changed accepts an inclusive start/exclusive end in the browser time zone. **Reset Table** sits beside Select All and the selection count in the same wrapping toolbar as the right-aligned bulk actions, not alone on a separate row. Reset/mobile controls remain outside disabled management fieldsets. Reset restores default Voter filtering and household/name ascending order. Changing filters, ordering or page size returns to page 1 and clears selection. Empty results retain controls. ReadOnly observers can sort/filter but cannot select or mutate rows.
- Preserve valid inputs while correcting errors, subject to the ballot's page-memory-only boundary.
- Residents omits the identifier filter's (i) control in both picker and manual-entry modes; onboarding identifier help is unchanged. Its Source filter uses **Self-registered** and **Admin-registered**, without changing the underlying `selfRegistered` values.
- In every single-field Residents filter popup (Representative, household, Status, Role, Voting Eligibility and Source), show **Filter [column]** followed directly by the control, without repeating its label visually. Retain programmatic labels, including identifier picker and manual-entry modes. The date range retains distinct **Changed From / Changed Before** labels, and the multi-field mobile panel retains visible field labels.
- Bulk selection toolbars keep **Select All** and the selection count on the left, with action buttons grouped and right-aligned. Allow wrapping on narrow screens while preserving right alignment. Select All remains limited to actionable rows on the current page; shortening its label never expands selection scope.
- Residents columns are **Select**, **Representative**, configured household name (for example **Flat**), **Status**, **Role**, **Voting Eligibility**, **Last Changed**, **Actions**, in that order. Last Changed uses the viewer's browser time zone without a visible zone suffix; its hover title identifies the zone. Server rendering retains explicitly labelled UTC until the browser hydrates, avoiding server-local or hydration-dependent guesses. Stored timestamps and RWA-zone voting deadlines remain unchanged.
- Residents Status cells show only the distinct enabled/check, suspended/pause or deleted/ban icon. Provide the full status name through a native hover title and screen-reader text, plus a tap/keyboard-toggle disclosure for non-mouse access. Keep the 48px target. Other account status badges retain their visible text.
- Residents Actions uses a compact person/edit icon instead of visible **Manage** text. Keep a 48px square target, a **Manage [resident name]** accessible name and hover tooltip, and the same resident-detail destination. Icon-only navigation remains available to ReadOnly observers.
- Distinguish editable fields from frozen/read-only values. Section long forms rather than presenting an uninterrupted field list.

### Email and code verification
- Explain registered-member access. Link new residents to `/register`, and say plainly that a new registration stays suspended until an RWA administrator enables it.
- Choosing from a configured list uses the shared combobox: persistent label, visible chevron to open the full list, type-to-filter, arrow/Enter/Escape keys, a polite match-count announcement and a field error when nothing valid is chosen.
- Use a single text input for the six-digit code with a numeric keyboard hint and one-time-code autocomplete. Support paste, leading zeros and accessible labelling; do not use a numeric-value input or six separate focus traps.
- Provide explicit verification, invalid/expired-code guidance and a resend cooldown with readable timing. Do not repeatedly announce a countdown every second.
- Use generic delivery wording such as "If this email is registered, a sign-in code will be sent." Do not promise delivery or confirm registration.
- Keep verification errors safe and actionable. Offer retry/support guidance when delivery is unavailable without exposing register details.

### Admin setup
- Use one **Residents** tab for account access, household assignment and eligibility, with **Add Resident** and **Import CSV** actions. Show role/status/source plus name/identifier-contains and eligibility filters. Require a household for new voters in the admin form, allow household-free management roles, and keep enablement and eligibility independent opt-ins. Settings owns the allowed identifier list; it does not create assignments.
- The Residents review slice uses column filters, a consistent action strip and a visible selected-row tint/inset marker in either theme. The Votes correction must match the approved concept, not merely recolour the previous form: compact chosen logo/alias branding, history beside the title at phone widths, a three-column Active/Scheduled/Your Responses strip, compact status links and a type-filter menu, restrained records with inline state/deadline metadata, real turnout, and participation/action footer. These totals cover only the user's frozen entitlements across pages/filters; administrator role does not broaden them. The filter menu retains Cancelled/Clear access and All retains unfiltered discovery. Scheduled entries use a compact dated upcoming row. Administrator shortcuts remain available in a disclosure, leaving top navigation unchanged.
- Vote-card metadata and deadline chips may use 12px text, while body copy and inputs stay at least 16px and actionable targets stay at least 48px. Do not achieve concept fidelity by making body text too small. Keep recorded-response/result actions on one line where they fit, but allow coherent wrapping at narrower widths. Status navigation must not show clipped partial labels. Selected/recorded states, real aggregate turnout and unavailable-data states must all be captured in actual-app examples, never mock values. Compact countdowns are informational and refresh at zero; full authoritative deadline behavior is unchanged.
- Residents supports page-scoped checkboxes, an indeterminate **Select All**, and distinct **Enable Selected** and **Make Eligible** commands with affected counts. The Role filter defaults to Voters (`voter`); All Roles is explicit. Show name/email, flat identifier, eligibility, role, access status and last change together. Confirmation lists use separate name/email/identifier lines; include a warning for administrator access. Keep per-row results visible and distinguish uncertain/failed requests from durable completion. Existing mobile stacked-table semantics remain in use; never make enabled state imply voting eligibility.
- The register offers a CSV template and labelled file input, whole-file validation, a horizontally scrollable row preview, sequential progress, confirmation and persistent outcomes. Exact matches and conflicts are distinct; successful entries link to account review, not automatic enablement. Stop on provider/network/rate-limit failure and offer a register recheck before retry. Use configured household wording and never store the CSV in browser storage.
- Keep the import table at least 64rem wide inside its own scroll container, with non-wrapping headers; narrow screens must scroll the table rather than breaking headers and names into vertical letters. Documentation may crop confirmation screenshots to the dialog for legibility without changing the actual controls.
- A ready preview offers immediate activation or **Schedule Opening**, entered in the RWA time zone with the existing DST-safe converter and a confirmation of both times and immediate freezing. Scheduled administration shows the opening countdown and a reasoned **Return to Draft** dialog, refused once opening is reached. Residents see only summary/instructions and times/countdown until opening, with no candidates/options, participation badge or voting controls. Countdown refreshes state but is never admission authority.
- Organize into voting type, ballot content, electorate, deadline and preview.
- Provide an administrator-editable RWA Settings page, also available read-only to committee observers, for the full name, alias, address, email, phone, optional website, accent palette, welcome message, household label (free text with suggestions such as Flat, Apartment or Villa) and identifier label (a Number/ID radio group). Keep field explanations concise and compact, using a consistent plain-language style. Put value-location guidance behind a collapsed-by-default disclosure; show the RWA Full Name explanation only after the administrator opens its adjacent (i) control. Preview the chosen accent on the form, show a live wording preview (singular, plural, identifier and plural identifier), and warn that changes apply everywhere immediately. Use Title Case for the page title, section headings and field labels (for example “RWA Full Name”). Mark only the required fields (RWA Full Name, RWA Alias, Household Label and Identifier Label) with `*`; show no marker on optional fields, and hide any blank optional value (address, email, phone, website, welcome message) everywhere it would appear. Accent palettes are a fixed set of presets that each meet 4.5:1 contrast on the surface and background; only the accent token changes through a `data-palette` wrapper. The header reads “Civic Pulse for {alias}” (plain “Civic Pulse” when no RWA identity is available). User-visible copy never hard-codes “household”: it uses the configured household terms (capitalised for headings and labels, lower case mid-sentence). Residents do not see this page; committee observers can inspect its values without changing them. The footer contact block and welcome message use plain text with 48px link targets.
- Explain PUBLIC/PRIVATE before type selection. For PUBLIC polls, let admins set single-select or multi-select and show the optional multi-select maximum. For elections, group candidates by office.
- Show the configured Welcome Message only on the resident-facing Votes page (`/`), including when committee members visit that page. Do not show it on Residents, Manage Votes or other administration screens; Settings help must describe this scope. Blank still hides it.
- Preview the complete resident-facing ballot, notices and timezone-labelled deadline.
- Before activation, explain that ballot content, type, electorate, representative assignments and deadline freeze. A stale preview requires refresh/review, not silent activation of a newer draft.

### Resident ballot
- Show title, type, lifecycle status, eligibility, deadline/timezone and instructions before controls.
- Show an informational `HH:MM:SS` deadline countdown on active voter and administrator vote pages, including after submission; include days for longer intervals and display "Deadline reached" at zero. Render the countdown text and clock icon in the semibold error (red) colour so the deadline stands out; the clock icon and wording keep the meaning from relying on colour alone. Refresh state at zero and keep the database as the only submission authority. A deadline changed by an administrator reaches residents on their next page load; a page left open refreshes when its old countdown reaches zero and then counts down to the new deadline.
- Use a labelled radio group for single-select polls and a checkbox group for multi-select polls; show the required minimum and any maximum. Use a labelled radio group per PRIVATE office with an explicit NOTA (None of the Above) option. The NOTA rule sits behind an (i) disclosure button beside the office-choice heading: it opens on mouse hover or click/tap, exposes `aria-expanded`, and closes on Escape (returning focus) or an outside click. No candidate/option should be preselected.
- Require at least one PUBLIC choice within the configured maximum, or a candidate/NOTA choice for every PRIVATE office; submit one whole ballot.
- Review all selections before final confirmation; Back permits correction before submission.
- Do not restore PRIVATE selections from server records after submission. Refresh/navigation may discard unsent selections; explain this where needed without persisting them.
- Explain that each multi-select option count is a selection, not another household turnout; option shares use submitted households and can sum above 100%.
- When the deadline passes or access/state changes, prevent further selection/submission and explain the state. The displayed clock is informative; the server decides acceptance.
- Name identifier-value columns and form fields with the current RWA-configured label; keep "household" for the household as a voting/eligibility entity.

## 12 Loading, Empty and Recovery States
### Submission states
| State | Required presentation |
|-------|-----------------------|
| Submitting | "Submitting vote..." with repeat submission disabled; no optimistic success |
| Accepted | Persistent participation acknowledgement; no PRIVATE selection receipt |
| Already submitted | Confirm submitted status; do not offer a replacement ballot |
| Outcome unknown | "We could not confirm whether your vote was received. Checking submission status." |
| Status check unavailable | For a first submission, explain uncertainty and offer "Check submission status"; do not invite blind resubmission. For a PUBLIC replacement, preserve the prior-participation assurance and allow retrying the same intended choice only while the poll remains active |
| Confirmed not submitted | Offer retry only if the current eligibility/state/deadline still permit it |
| Confirmed rejection | Explain the safe reason and next step without echoing sensitive selections |

- Keep unsent choices only in page memory while resolving uncertainty. Never falsely declare failure because the network response was lost.
- Use stable skeletons for lists/results without placeholder choice totals or misleading zero counts.
- Distinguish no eligible votes, no current votes, empty register, no admin votes, incomplete draft, zero turnout and no PUBLIC named responses.
- Empty states explain context and next steps. Zero turnout is not a winning outcome; PRIVATE states never suggest individual responses are inspectable.
- Cover invalid/expired codes, suspension, ineligibility, forbidden access, validation, stale drafts, duplicate submissions, terminal votes and dependency failures.
- Keep completed results visible when an export fails; offer export retry without changing data or resubmitting a ballot.
- Never auto-dismiss important errors/acknowledgements. Distinguish a draft-save success from an accepted ballot.

## 13 Page-Level Specifications
| Page | Required content and behavior |
|------|-------------------------------|
| Sign-in / verify | Registered-member context, labelled email/code, resend/recovery, safe generic messages |
| Member home | Eligible votes, distinct type/status, deadline or completion time, own participation and authorised results links |
| Ballot / review | Privacy notice, eligibility, timezone deadline, grouped selections, full review and final confirmation |
| Results | Completion context, frozen eligible count, submitted count, turnout, counts/denominators, NOTA and tie/no-votes outcomes |
| Admin vote list | Clear drafts/active/completed/cancelled grouping and next valid action, without live choices |
| Draft editor | Sectioned setup, validation, electorate selection, preview and explicit activation; PRIVATE office names suggest the RWA Positions list, and **Add All Positions** adds them as offices |
| Household register | Household, representative, email and eligibility; Change eligibility expands a checkbox and centered Save/Cancel inline in the resident's household panel, without a nested border or navigation. Keep the current badge and explain that existing votes are unchanged. Cancel discards edits; errors remain visible for retry. Hide the move form while eligibility is being edited. Existing standalone editor links remain valid. Households are added and moved from account pages, where the identifier picker offers only unassigned Default Households when configured |
| Lifecycle confirmation | Action-specific consequences; required reasons for early completion/cancellation and deadline changes |
| Change Deadline | Active votes only: current deadline, a new time in the RWA zone with a live "extended/brought forward by" preview, and a required audit-only reason; refuses times under 5 minutes ahead or equal to the current deadline |
| Audit History | Readable actor/action/record/time/reason with pagination; no codes or PRIVATE selections |
| Privacy policy | Public, one H1 and logical section headings; explain PUBLIC/PRIVATE handling, cookies, support mail, optional analytics and deployment-specific policy limits |
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

- Active PUBLIC results show aggregate option counts and turnout; active PRIVATE results show aggregate turnout only. Refresh live aggregates automatically and do not reveal active choices. Hide PRIVATE candidate/NOTA totals until completion. Completed PRIVATE results contain aggregates only; PUBLIC named responses appear only after completion to authorised viewers.
- Show denominator labels next to percentages. Keep NOTA separate from candidates; zero denominators are not applicable rather than invalid arithmetic.
- Zero ballots have no winner. Tied positive candidate leaders show Tie. NOTA is counted separately but cannot win; the highest-count candidate is elected even if NOTA has more votes. If no candidate receives a vote, no candidate is elected. On PRIVATE results this rule sits behind the same (i) disclosure, beside a **How NOTA is counted** heading; the **Totals only** privacy notice stays visible.
- Label early completion and display its reason. Completed poll outcomes do not imply spending authorisation or legal approval.
- Cancelled details display the invalid-result notice without publishing choices.
- For long PUBLIC response lists, use accessible pagination and complete labels; an export contains the whole authorised dataset, not just the visible page.
- Admin monitoring may show participation/non-participation for follow-up but never active choices. During active PRIVATE elections, members see aggregate turnout only and never another household's participation status.

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
- Reports include RWA/title/type, question or offices, timezone-labelled activation/completion times, turnout/denominators, totals, NOTA/ties/no-votes, generation time and early-completion context.
- PUBLIC exports include authorised names, household identifiers and choices without emails. PRIVATE exports contain aggregates only, never household/voter lists.
- Validate long names and approved scripts in the application and, when included, PDF. Font availability alone does not prove readable shaping/rendering.
- Printable exports are derived outcomes, not backups, signatures or legal certifications. No signature-replacement workflow is required for version 1.

## 16 Tailwind Rules and Design Acceptance
- Define palette, typography, spacing and surface tokens once in the Tailwind theme in `src/styles/globals.css`. Use shared token classes, not raw hex, arbitrary per-component values or a second palette.
- Preserve the current visual identity during migration from CSS Modules; do not copy the archive's alternate warm-neutral palette/system font.
- Add reusable components only where repeated UI needs them. Do not introduce a paid component kit or another design framework.
- Keep voting type/status and privacy vocabulary consistent across member, admin, review and results screens.
- Before release, verify both voting types and member/admin journeys at specified widths, including long labels, enlarged text, keyboard focus and mobile-keyboard/sticky-action behavior.
- Verify OTP paste/autofill/leading zeros, PUBLIC vote replacement and active aggregate refresh, PRIVATE one-time submission/hidden active totals, cancellation and early-completion confirmations, and no PRIVATE selection receipt.
- Check every implemented component's states and actual contrast combinations, plus manual assistive-technology checks.
- Verify CSV authorization/completeness and export failures; PDF-specific checks apply only when the feature is included.
- This documentation update does not itself migrate components, Tailwind configuration or application behavior.
