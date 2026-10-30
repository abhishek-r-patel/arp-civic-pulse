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
	under `civic-pulse-theme` in local storage; never account data or ballot
	selections. The choice is per browser, survives sign-out, and is not synced
	across devices.
- Save the Residents narrow-table optional-column choice in local storage under
	`civic-pulse-resident-columns`. This stores only display preferences, is not
	account-linked, and applies below the large-screen breakpoint.
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
- In shared page headers, keep the title and actions on one top row, with actions aligned to the right of the title. Let the title and actions wrap only when they cannot fit together; put the description on its own row below and let it use the full available header width. Description text wraps naturally without widening the page or using a fixed copy-width cap.
- **Form-focused pages:** Center the complete page-content unit (back link, title, description, guidance and form) in a `w-full max-w-ballot` column with automatic horizontal margins. Keep text left-aligned within that column. This applies to resident creation/detail/eligibility and CSV import, Settings, vote creation/editing/lifecycle detail and the resident ballot. Ballot preview is the exception described below. Sign-in, self-registration and contact retain the centered 640px readable width. The long-form Privacy Policy uses that width on phones and expands to 896px on large screens. Keep audit, participation, vote lists and results workspaces wide; do not center individual fields separately or narrow their tables. On CSV import, keep the heading and file controls centered, then show Check Register preview/results in a separate full-content-width table region using the Residents responsive-table pattern. Phones use the available width inside existing gutters. Breadcrumbs and global header/footer remain in the full-width shell.
- Minimum touch target is 48 × 48px, with at least 8px between targets. Short inline text links (breadcrumbs, footer, status tabs, vote-card titles) use the `touch-target` utility for both minimum height and width, not height alone.
- Header action groups, the account navigation row, pagination and standalone filter rows wrap instead of shrinking or overflowing at 320px or 200% text; fixed-width selects cap at the available width. Scroll regions that may contain visually hidden (`sr-only`) text are positioned (`relative`) so that text cannot escape the clip and widen the page.
- Keep labels/help close to their controls and use larger gaps between sections. Prefer headings and dividers over nested cards.
- Left-align the Manage Resident Save/Suspend-or-Enable/Delete action group with the Details form content; preserve its wrapping behavior on phones and enlarged text.
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
- **Icon-only button:** Preserve the 48 × 48px touch target while removing shared text-button padding; prevent the icon from shrinking.
- **Draft deadline picker:** Use a theme-styled calendar modal with month/year selection and 12-hour time controls for Voting opens/closes. Display and return times as `hh:mm:ss AM/PM` (converting to 24-hour local values for timezone handling). Support keyboard date navigation, Escape/cancel, focus return and the RWA timezone.
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
- **Results bar** (`ResultBars`): one row per option, candidate, NOTA or turnout, with the label (and optional tag) on the left, `count/eligible percent%` in tabular numerals on the right, and a full-width bar below. Leaders use the accent fill with a "Leading" (live PUBLIC), "Elected" (completed PRIVATE) or "Tied" tag; other rows use a neutral fill; NOTA uses a muted striped fill because it cannot win. The text carries the meaning and is read as "count of total eligible households"; bars are decorative and hidden from assistive technology. PUBLIC totals use a centered card the same width as one PRIVATE office card, with full-width result bars within the card. PRIVATE office cards use the full available results workspace in a fixed two-column layout at the large-screen breakpoint. If the number of offices is odd, center the last card without changing its column width; a single office follows this rule. On smaller screens they stack at full width. Keep named PUBLIC responses unframed and outside the totals card; the **Who chose what** section and table span the available results workspace. Never show candidate bars for a live PRIVATE election, only turnout. The PDF draws the same rows in greyscale with a hatched NOTA bar.
- **Data table:** Semantic headers and right-aligned numeric values. Prefer stacked label/value rows on mobile while preserving reading order and associations. The Residents register and completed PUBLIC **Who chose what** results stay in table format at every width; keep the PUBLIC privacy description aligned to the full table width. Labelled, contained scrollers keep columns available without page-level horizontal scrolling. Other genuinely two-dimensional tables may also use a contained scroller. Never truncate decision-relevant text. Header rows repeat when printed.
- **Pagination:** Every potentially paginated list shows **Page X of Y · N results** (**1 result** when singular), a Per page selector (10/25/50/100, default 25) that applies immediately, and icon-only First/Previous/Next/Last controls with accessible names and hover titles. No separate record-range line or apply button is shown. The inline **Per page** label sits beside its dropdown on the same line as navigation (wrapping only on narrow phones), without an optional marker or hint. Disabled ends are not links. Filters and page size persist through navigation; applying filters or selecting a page size starts at page 1. Keep controls for empty/single-page lists, with page 1 of 1, 0 results when empty, and disabled navigation. Wrap controls without page overflow on phones. Larger page sizes may expose wider table content; the shared labelled, keyboard-focusable table region contains horizontal scrolling on tablets/desktops rather than widening the page.
- **Dropdowns:** Keep each menu anchored to its trigger and exactly within the trigger's width, including on narrow screens. Use a keyboard-operable listbox with visible focus/active state; support arrows, Home/End, type-to-select, Enter/Space and Escape, and dismiss on outside click. Do not rely on native select popup sizing.
- **Confirmation dialog:** Centre horizontally and vertically in the viewport on phones, tablets and desktops, including after scrolling the underlying page. Keep at least 16px horizontal gutters, a bounded width and a 90dvh maximum height with internal scrolling so long content and actions remain reachable. Focus is trapped, Esc closes it, and the destructive action is named explicitly ("Cancel vote"). Dropdowns, autocomplete lists and menus remain anchored to their triggering controls rather than becoming centred modals.
- **Feedback:** An inline Success or Error banner for form results. Skeleton loaders for lists, and every list has an empty state with a next step.
- **Print and optional PDF:** Follow section 15 when implemented. PDF availability is not a prerequisite for viewing completed results.

### Component states
- Shared page headers use a quiet bottom divider and compact heading/action hierarchy, not decorative enclosing cards. Empty states use unframed bands. All form controls retain 16px text/48px targets with improved padding and focus/disabled contrast. Notices use a restrained left rule and body-scale heading, keeping icon/text/live-region semantics. Tables retain semantic headers and stacked mobile rows, with quiet header tint and hover/selection feedback.
- On the Residents page, keep the heading and Import CSV/Add Resident actions together on the first row; place its supporting description below at full content width so it is not squeezed beside the actions. Allow wrapping on narrow screens without horizontal overflow.
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
- **PUBLIC notice:** Heading "Your vote is not private"; body "While voting is open, RWA members see only total counts. You can change your vote until voting closes. After that, RWA members can see your name, flat number and final vote in results and downloads." Keep it plain-language: say "RWA members" rather than naming roles. Access remains limited to authorized members as defined in the PRD permission matrix.
- **PRIVATE notice:** One line (ballot and results): bold "Your vote is private" followed by ". Only totals are shown, never who chose what." No separate heading, (i) or caveat on screen.
- **New Vote type choices:** Label the types **PUBLIC Voting** and **PRIVATE Voting**. Show each short description and its familiar example on separate lines, followed by a plain-language privacy/results summary. Keep this introductory summary concise; the detailed privacy notice remains available before submission.
- **Vote editor type:** Select PUBLIC Voting or PRIVATE Voting during New Vote creation. Use their established type colours to distinguish the choice cards: PUBLIC uses Secondary blue, PRIVATE uses Primary. Apply a stronger matching border and tint to the selected card; keep labels and privacy copy readable in both themes and do not rely on colour alone. Do not repeat the type selector in the draft editor; begin its numbered sections with Details.
- **Vote editor Details:** The PUBLIC Question and PRIVATE Title fields do not need a separate (i) help popover.
- **Vote editor title field:** Stack the Question/Title label above its full-width input; apply this layout only to that field.
- **Vote editor deadline:** Show **Voting opens** and **Voting closes** in two separate rows at all screen sizes. Each help message puts the RWA time zone on its own first line and the field-specific guidance on the second line. Hide optional markers on both. Show seconds and AM/PM for both values. When no closing deadline is saved, prefill seven local calendar days after draft creation at 23:59:59 in the RWA time zone; this suggestion is persisted with the next draft save. The opening time is a saved plan; scheduling and freezing still require confirmation from Preview.
- **Vote editor actions:** Keep **Save Draft** and Preview actions together on the left. **Save Draft** uses the secondary style; the Preview action (**Preview Ballot**, or **Save and Preview** with unsaved edits) uses the primary green style because it continues the normal flow. With unsaved edits, the Preview action reads **Save and Preview**: it saves the draft, then opens the preview of that new saved version; if saving fails, stay on the editor and show the error. Preview never shows unsaved values. **Cancel Vote** discards unsaved edits and returns to Manage Votes; for a just-created revision-1 draft, confirm and roll back that draft. Keep a separate, right-aligned, borderless bin-with-X icon in error red for permanently deleting a saved draft, distinct from the plain bin icons that remove ballot rows; require confirmation and an accessible name.
- **PUBLIC Background field:** Keep the field optional, but omit the visible optional marker and (i) popover.
- **PUBLIC choice mode:** Show the one-option and multiple-options radio choices side by side when there is enough width, stacking them on narrow screens.
- **Draft ballot ordering:** Provide pointer/touch drag-and-drop for options, offices and candidates, with Alt+ArrowUp/Alt+ArrowDown keyboard alternatives. Place borderless, icon-only drag and remove buttons beside each field, use 24px icons within the existing 48px touch targets, and give both controls accessible names.
- **PUBLIC option rows:** Order each row as drag handle, visible **Opt N** label, text box and remove icon on one line; keep the form label accessible to assistive technology.
- **Who Can Vote list:** Show a lock icon for rows whose representative account is not enabled; expose the reason on hover and keyboard focus, and keep it available to assistive technology.
- **PRIVATE privacy limits:** By owner decision, the caveat about system operators and small-vote inference is not shown on screen or in the CSV/PDF downloads. Launch gate A2 (privacy is application-level only) remains unresolved and must be addressed before launch; the Privacy Policy page still describes these limits.
- **Final submission (PRIVATE only):** "Your PRIVATE election submission is final. You cannot change or withdraw it." PUBLIC ballots never show it because their selections can be changed until closing.
- **Accepted:** PUBLIC acknowledgement confirms the current choice and offers a change action while active. PRIVATE acknowledgement shows participation only, never selections or a link to retrieve the ballot.
- **Cancelled:** "Cancelled; results not valid." Do not publish choices or offer results exports.
- Write button labels in Title Case (minor words such as "a", "and", "to" stay lowercase unless first), for example "Submit Vote", "Review Selections", "Activate Vote", "Complete Vote Early", "Cancel Vote" and "Sign Out", not technical labels such as "Commit ballot" or vague "OK".

## 10 Navigation and Information Architecture
- Compact branding uses the existing chosen icon, the Civic Pulse name and the RWA alias on a separate line; the brand link retains the full accessible "Civic Pulse for {alias}" name. Authenticated initials are supplementary and never replace the signed-in identity. Keep the previously agreed top navigation and sign-out controls rather than introducing the mockup's sidebar in this correction.
- **Residents (`voter`):** Votes, account context and sign-out. Show eligible current votes first and keep authorized completed results accessible.
- **RWA Admins (`rwa-admin`):** Clearly identify management destinations and provide a visible way back to the Resident experience. Keep Residents and Manage Votes as text tabs; place 48px Settings and Audit History icon links, in that order, immediately before Sign Out at the right edge. Give the icons accessible names and hover titles matching their destination. Share the application shell rather than creating a separate app.
- **RWA ReadOnly (`rwa-readonly`):** Show the same authorized management destinations and Settings then Audit History icon links before Sign Out as RWA Admin, plus a persistent read-only notice. Keep management controls visible but natively disabled; filters, navigation, previews, results/downloads and the Resident's own ballot remain usable. Do not rely on disabled controls for authorization.
- RWA Admin capability does not imply eligibility to vote; show personal submission status only for that account's own entitlement.
- Unauthenticated screens do not reveal the register, ballot catalogue or results. Members do not get a general resident directory.
- Use descriptive titles and breadcrumbs for deeper admin workflows. Always provide a visible Back/Cancel route.
- Preserve permitted admin draft input within the setup flow where feasible. This must not introduce persistent storage of resident ballot selections.
- Empty/inaccessible destinations should provide a safe next step without disclosing another household's information.

## 11 Forms, OTP and Ballot Interaction
### General forms
- Persistent visible labels, required-field indicators, specific inline errors and click-to-open (i) help for field explanations. Keep each info icon immediately beside its label, consistently left-aligned rather than pushed to the opposite edge or wrapped to another row. Single-line text, select and combobox controls place the label/help control beside the input when space allows and stack on narrow screens. Keep textareas stacked; keep checkbox/radio choices and their labels together, with checkbox help beside the checkbox label. An opened help panel shifts left as needed so it stays inside the viewport with a 16px margin.
- Write field help in compact, plain language; omit redundant wording and keep internal codes out of user-facing choices. Resident role selectors and filters use **Role**, with **Voter**, **RWA Admin** and **RWA ReadOnly** as the option labels; saved/API role codes and permissions do not change.
- Put supplementary form introductions in a collapsed-by-default, keyboard-operable summary with a chevron and short points, rather than a large always-visible notice. Keep errors, consequential warnings and required voting/privacy disclosures visible. Add Resident uses **Before you add a resident** with three reminders: household assignment, initial sign-in suspension and separate voting eligibility. Field-specific (i) help remains available.
- **Add Resident form:** Enclose the complete form, from collapsed guidance through action buttons, in one subtle `border-border` surface with the card radius and 16px phone/24px desktop padding. Keep the page heading outside. Place **Eligible to vote** and **Enable account now** side by side in one wrapping row, retaining independent state, click-to-open help and 48px label targets. Wrap on narrow screens or with enlarged text instead of shrinking labels or causing horizontal overflow.
- Associate labels, descriptions and errors programmatically. Use an error summary for long forms and move focus deliberately to that summary or the first invalid field after failed validation.
- Use Title Case for filter headings. Residents free-text filters (Representative and identifier) use literal case-insensitive contains-anywhere matching, not exact or typo-tolerant matching. Type **Abhi**, not wildcard syntax. The identifier filter uses the configured Identifier Label without an "Exact" prefix and suggests all Default Households from Settings (including assigned entries), while accepting partial/custom text. With no suggestions it is a plain text box. Blank includes all identifiers; existing identifier bookmarks now use contains matching. Onboarding still restricts choices to configured, unassigned entries.
- **Compact list filters:** Omit redundant optional markers. When inline labels would become narrow multi-line columns, place labels directly above their controls rather than squeezing them beside inputs. Keep 16px text, 48px targets and adjacent (i) help. Size standalone dropdown filters to their labels and longest option instead of equal-width columns, keeping menus within their field width. Do not hard-code a column count.
- **Sortable/filterable tables:** Keep controls next to the relevant column rather than repeating a large filter form above the table. Sorting and filtering must cover the entire authorized dataset before pagination, with exact matching totals; never silently sort only the visible page. Use named sort links, directional icons and `aria-sort`; mark applied filters with a non-colour indicator and accessible description. Header labels wrap between words, never inside words; contain any necessary horizontal scrolling in the table region. Keep menus above scroll containers with viewport-constrained, dismissible popovers. Inside scrolling filter panels, dropdown options expand in flow to avoid clipping. Shared table headers support this pattern; other tables retain their existing behavior until separately approved.
- **Residents table controls:** Keep column headings plain, without duplicate sort or filter icons. The single **Sort & Filter** popover provides sorting and filters for Representative, configured household, Status, Role, Voting Eligibility, Last Changed and Source at every viewport; retain `aria-sort` on the active heading. Use a matching icon-only funnel with small up/down arrows at the upper right for **Sort & Filter** and a funnel with a circled X at the upper right for **Clear filters**. Keep both icon drawings 20px and their controls at 48px, with accessible names and hover titles. Keep Select All/count, the sort/filter controls, both compact bulk actions and the **Columns** chooser on one non-wrapping toolbar row. Use compact button text, icons and horizontal padding while preserving the 48px minimum interactive target. Let the scrollable controls region scroll horizontally when the viewport is too narrow, without widening the page; keep the Columns menu outside that scrolling region so it is not clipped. If enlarged text would squeeze the scrolling region below about 8rem, the Columns menu wraps to its own line. Source sits immediately before Actions and uses icon-only Self-registered (person)/Admin-registered (shield) disclosures with hover titles, accessible names and click/tap text, like Status; remove the former self-registration caption under Representative. Use distinct silhouettes rather than two similar person icons. Source ascending groups Admin-registered first, descending Self-registered first, with name/ID tie-breakers. No dedicated Source filter remains above the table. On narrow screens the table remains a table: Select, Representative, configured household, Status and Actions stay visible; **Columns** toggles Role, Voting Eligibility, Last Changed and Source. Save only this optional-column choice in browser local storage, not account data. Keep sorting and filters available when optional columns are hidden. Representative searches names only, not Auth email. Last Changed accepts an inclusive start/exclusive end in the browser time zone. Reset/mobile controls remain outside disabled management fieldsets. Clear filters restores the default Voter filtering while preserving current sort, direction and page size. Changing filters, ordering or page size returns to page 1 and clears selection. Empty results retain controls. ReadOnly observers can sort/filter but cannot select or mutate rows.
- **Manage Votes table controls:** Keep column headings plain, without duplicate sort or filter icons. One **Sort & Filter** popover provides title, Type, Status, Deadline and Last Changed filters plus Sort By and Sort Direction at every viewport. Use the same icon-only funnel with small up/down arrows at the upper right for **Sort & Filter** and the funnel with a circled X for **Clear filters**; match the Residents 20px icons, accessible names, hover titles and 48px controls. Vote title uses literal case-insensitive contains matching; Type and Status use exact options. Deadline ranges use inclusive Closing From and exclusive Closing Before in the browser time zone and match `closes_at` only, including for scheduled votes whose opening time is also displayed; Last Changed ranges use inclusive Changed From and exclusive Changed Before. Sort and filter the full authorized dataset before pagination, with exact totals and stable UUID tie-breakers; deadline sorting puts missing deadlines last. Default ordering remains Last Changed descending. **Clear filters** preserves page size and current ordering, and reopening **Sort & Filter** afterwards shows the cleared fields empty. The final **Turnout** column shows submitted / frozen eligible households and an exact whole percentage for Active and Completed votes only; Draft/Scheduled show **Not open**, and Cancelled shows **Not available**. It never shows option or candidate totals and is informational, not sortable or filterable.
- On compact screens, keep **Vote**, **Status** and **Turnout** visible in Manage Votes; a **Columns** chooser toggles **Type**, **Deadline** and **Last Changed**. Persist only these display preferences in browser local storage, not account data; desktop always shows every column.
- **Audit History table controls:** Put browser-local date/time range, Who, Target, Action and Details filters beside their respective column headings in that order; Details includes any supplied reason and searches that reason plus only the keys already shown in the allowlisted audit projection. Use a combined **Filter Audit History** popover on phones where table headings are hidden. Keep explanations of reasons, detail timestamps and target IDs in a collapsed **About this history** disclosure rather than showing them persistently; it must support multiple paragraphs and keyboard use. Hide target record IDs and effective/processed timestamps by default while leaving target type and filter visible; provide separate page-only **Show Target IDs**, **Show Effective Time** and **Show Processed Time** checkboxes above the table, all off by default and reset when leaving the page. Audit timestamps and date filters use the browser's local time zone; API values remain UTC instants. Text filters use bounded, case-insensitive literal contains matching. Omit repeated visible labels in single-field popovers while preserving accessible names; keep labels visible in the mobile form and keep distinct From/Before labels in the date popover. The start is inclusive and the end is exclusive. Filtering remains server-side across pages and always preserves the fixed newest-first event order and exact totals. **Clear filters** preserves the page size. Actions without a requested reason simply have no Reason entry in Details; detail timestamps label when an event took effect and when the system processed it.
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
- The resident import offers a CSV template and labelled file input with a themed **Browse files** control and selected filename, whole-file validation, a full-content-width preview/results table after Check Register, sequential progress, confirmation and persistent outcomes. Keep the underlying file input keyboard accessible and announce filename changes. Use Resident consistently for the page, action, confirmation and row messages; explain that new residents have suspended sign-in until enabled. Exact matches and conflicts are distinct; successful entries link to resident review, not automatic enablement. Stop on provider/network/rate-limit failure and offer a register recheck before retry. Never store the CSV in browser storage.
- Keep the import controls centered. Show the separate preview/results table only after Check Register; reuse the Residents table's responsive layout, stacking label/value rows on phones and wrapping long values at larger widths. Avoid fixed minimum widths and page-level horizontal overflow. Documentation may crop confirmation screenshots to the dialog for legibility without changing the actual controls.
- A ready preview offers immediate activation and, when a future opening is saved in the draft's Deadline section, **Schedule Vote** using that time; do not ask for a second opening time on the preview. Without a saved opening, explain the prerequisite and disable scheduling. Confirm both times and immediate freezing. Scheduled administration shows the opening countdown and a reasoned **Return to Draft** dialog, refused once opening is reached. Residents see only summary/instructions and times/countdown until opening, with no candidates/options, participation badge or voting controls. Countdown refreshes state but is never admission authority.
- Organize into voting type, ballot content, electorate, deadline and preview.
- Provide an administrator-editable Settings page, also available read-only to committee observers, for the full name, alias, address, email, phone, optional website, accent palette, welcome message, household label (free text with suggestions such as Flat, Apartment or Villa) and identifier label (a Number/ID radio group). Keep field explanations concise and compact, using a consistent plain-language style. Put value-location guidance behind a collapsed-by-default disclosure; show the RWA Full Name explanation only after the administrator opens its adjacent (i) control. The App Support Access explanation uses plain language to say that support can view the register, settings, votes, participation, results and audit history, but cannot change anything or vote, has no household, cannot see PRIVATE ballot choices and is audited when toggled; ask administrators to turn it off when no longer needed. Preview the chosen accent on the form, show a live wording preview (singular, plural, identifier and plural identifier), and warn that changes apply everywhere immediately. Use Title Case for the page title, section headings and field labels (for example “RWA Full Name”). Mark only the required fields (RWA Full Name, RWA Alias, Household Label and Identifier Label) with `*`; show no marker on optional fields, and hide any blank optional value (address, email, phone, website, welcome message) everywhere it would appear. Accent palettes are a fixed set of presets that each meet 4.5:1 contrast on the surface and background; only the accent token changes through a `data-palette` wrapper. The header reads “Civic Pulse for {alias}” (plain “Civic Pulse” when no RWA identity is available). User-visible copy never hard-codes “household”: it uses the configured household terms (capitalised for headings and labels, lower case mid-sentence). Residents do not see this page; committee observers can inspect its values without changing them. The footer contact block and welcome message use plain text with 48px link targets.
- Explain PUBLIC/PRIVATE before type selection. For PUBLIC polls, let admins set single-select or multi-select and show the optional multi-select maximum. For elections, group candidates by office.
- Show the configured Welcome Message only on the resident-facing Votes page (`/`), including when committee members visit that page. Do not show it on Residents, Manage Votes or other administration screens; Settings help must describe this scope. Blank still hides it.
- Preview the complete resident-facing ballot, notices and timezone-labelled deadline in a collapsible **What residents will see** section that starts expanded; its 640px ballot width is unchanged.
- **Ballot preview layout:** Keep one **Back to Editing** link at the top. Put readiness or blockers, the Who can vote count, saved Voting opens/closes times and the freezing rule in one compact **Summary** card. When ready, put **Activate Vote** and **Schedule Vote** side by side in one **Ready to start** card; their confirmations remain unchanged. On large screens, show the ballot on the left and a sticky summary/actions panel on the right. On smaller screens, stack summary, ballot, then actions.
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
| Register | Public self-registration identifies the association's Voting App - Civic Pulse, states once that each email and household can be registered once, and gives one review/eligibility notice; keep sign-in and contact navigation in the shared footer |
| Member home | Eligible votes, distinct type/status, deadline or completion time, own participation and authorised results links |
| Ballot / review | Privacy notice, eligibility, timezone deadline, grouped selections, full review and final confirmation |
| Results | Completion context, frozen eligible count, submitted count, turnout, counts/denominators, NOTA and tie/no-votes outcomes |
| Admin vote list | Clear drafts/active/completed/cancelled grouping and next valid action, without live choices |
| Draft editor | Sectioned setup, validation, electorate selection, preview and explicit activation; PRIVATE office names suggest the RWA Positions list, and **Add All Positions** adds them as offices |
| Household register | Household, representative, email and eligibility; Change eligibility expands a checkbox and centered Save/Cancel inline in the resident's household panel, without a nested border or navigation. Keep the current badge and explain that existing votes are unchanged. Cancel discards edits; errors remain visible for retry. Hide the move form while eligibility is being edited. Eligibility has no separate screen. Households are added and moved from account pages, where the identifier picker offers only unassigned Default Households when configured |
| Lifecycle confirmation | Action-specific consequences; required reasons for early completion/cancellation and deadline changes |
| Change Deadline | Active votes only: current deadline, a new time in the RWA zone with a live "extended/brought forward by" preview, and a required audit-only reason; refuses times under 5 minutes ahead or equal to the current deadline |
| Audit History | Readable actor/action/record/time/reason with pagination; no codes or PRIVATE selections |
| Privacy policy | Public, one H1 and plain-language sections for responsibility, information collected and use, voting privacy, cookies/browser storage, sharing, retention/security, and requests; explain PUBLIC/PRIVATE handling and deployment-specific policy limits |
| Contact | Public, labelled name/reply-email/message fields when configured; warning against sending choices/codes; clear unavailable, validation, pending, uncertain and provider-accepted states. Use short, plain-language guidance. Signed-in enabled RWA members (except App Support) also see enabled RWA Admin names only, with no email or household details; if that directory cannot load, show a simple warning and keep the rest of Contact usable. Keep sign-in and privacy-policy navigation in the shared footer rather than repeating it in page content. |

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
- Zero ballots have no winner. Tied positive candidate leaders show Tie. NOTA is counted separately but cannot win; the highest-count candidate is elected even if NOTA has more votes. If no candidate receives a vote, no candidate is elected. On PRIVATE results this rule sits behind the same (i) disclosure, beside a **How NOTA is counted** heading; the **Your vote is private** notice stays visible.
- A single winner (**Elected candidate** or PUBLIC **Leading option**) appears as a clearly framed success card: visible success border and tint, subtle panel shadow, a trophy in a success-tinted circle, a small uppercase label and the name in card-heading size. Ties and no-winner outcomes keep the standard notices.
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
