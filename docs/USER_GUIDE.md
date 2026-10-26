# Civic Pulse: illustrated resident and administrator guide

This guide shows how to use the implemented Civic Pulse application. Residents can follow sections 1-8; administrators should also read sections 9-15. No programming knowledge is needed.

**Important:** These are demonstration screens from an isolated test environment, not a live RWA. Production launch is still awaiting the controls and approvals in the [launch audit](./LAUNCH_AUDIT.md). Obtain the real application address and support contact from your RWA; do not use a developer's test address.

Open **User Guide** in the application footer to read this illustrated guide
without signing in. It opens at `/user-guide.html`; use Contents to jump to a
topic and **Back to Civic Pulse** to return. The web copy includes the screenshots
and supports browser Print / Save as PDF. Repository-only supporting-document
links are not active in the web copy; the technical guide is not published by the
application.

Printable/offline repository copy: [USER_GUIDE.html](./USER_GUIDE.html). Open that file in a browser and choose Print / Save as PDF. Developers: [technical guide](./TECHNICAL_GUIDE.md).

## 1. Start here

You need:

- An email address already registered by your administrator.
- Access to that email inbox to receive a six-digit sign-in code.
- An enabled account and a household assignment to vote as an ordinary resident.
- A phone, tablet or computer with an up-to-date browser and an internet connection.

There is **no public signup** and no application password. Ask your RWA administrator to correct your register entry if necessary. Never share your emailed code.

The footer links, in order, to **Sign In**, **User Guide**, **Privacy Policy** and
**Contact**. The guide and information pages do not require sign-in.
When online contact is enabled, supply your name, reply email and a short message;
never include selections, codes, passwords or identity documents. **Message
accepted** confirms the mail service accepted the enquiry, not that it reached
the administrator's inbox. If delivery cannot be confirmed, keep your text and
wait before retrying, or use your RWA's usual support channel. If online contact
is not available, the page says so rather than presenting a non-working form.
Where configured, optional Google Analytics is off by default and can be allowed
or withdrawn using the checkbox on privacy/contact pages. It does not track
sign-in or voting screens.

![Who does what, from administrator setup to resident results](./images/user-guide/overview.svg)

### How to read these pictures

The 53 screenshots show the principal resident and administrator journeys, plus representative validation, privacy, access and recovery states. Resident screens use a narrow phone viewport; most administration screens use a desktop viewport. The same application adapts to the device.

The pictures use an example RWA profile: **Lakeview Residents Welfare Association** (alias **Lakeview RWA**), the Teal accent colour, a sample welcome message, **Flat** as the household label and **Number** as the identifier label, so screens say **Flats** and **Flat Number** where a default installation says **Households** and **Household Number**. The example website is left blank, so no website link appears in the footer. Your RWA's name, contact details, colour and wording will differ. The public Privacy and Contact pages and the optional-analytics checkbox are described in section 1 but not pictured. Do not treat the images as proof of contact-email delivery.

Names, addresses, votes, household labels and counts are synthetic. Gray rectangles deliberately hide email addresses (including the example RWA email in the footer and settings form) and sign-in codes. Some lists contain accumulated test records: a count such as “715 eligible” is **not** the size of your RWA, a product limit or a performance guarantee. Dates/time zones are examples; always read the actual vote's displayed deadline.

The invalid-code example and the uncertain-submission examples deliberately simulate errors in the real UI. Screenshots do not prove production email delivery. Countdown values shown are a snapshot; a real page counts down live. Dialog pictures for suspension and deletion show the confirmation stage, not an executed suspension/deletion of the illustrated resident.

Long pictures show the entire page. Zoom/open the original image when reading small details; the accompanying steps are the printable instructions.

## 2. Understand the vote before participating

| Topic                    | PUBLIC voting                                                                                               | PRIVATE voting                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Typical use              | One question, such as a yes/no decision.                                                                  | Election with one or more offices and candidates.                                                |
| Your selection           | Select one option, or multiple options when the administrator enables it. Multi-select polls require at least one choice and may have a maximum. | Choose one candidate or **NOTA (None of the Above)** for every office. |
| Results while active / after completion | Every entitled voter and enabled admin can view live aggregate counts and turnout while active, whether or not they have voted; after completion, totals plus authorized named household responses. | No results while active; aggregate totals only after completion, including NOTA counts. |
| Privacy                  | Your name, flat/household and final selection(s) are visible to entitled members and RWA admins after completion, including downloads. | Residents and RWA admins cannot retrieve your selections through the app. |
| Important limit          | PUBLIC is not a private ballot.                                                                             | Not protection against privileged infrastructure access; very small totals can permit inference. |

For either type:

- You vote for your household entitlement, not once for every device.
- A PUBLIC ballot can be replaced while the poll is active; its latest selected option(s) count. A PRIVATE election submission is final and cannot be changed or withdrawn.
- You must review before submitting.
- Participation can be monitored. Active PUBLIC results show aggregate counts only, not who chose what. During a live PRIVATE election, members see aggregate turnout only; admins can see household participation status for follow-up, but not choices. Candidate and NOTA totals stay hidden until the election ends.
- Being an administrator does not give extra votes or allow voting on behalf of another household.

### Status is different from type

![Draft becomes Active, then Completed or Cancelled; neither terminal state reopens](./images/user-guide/lifecycle.svg)

| Status    | Meaning for a resident                                                    |
| --------- | ------------------------------------------------------------------------- |
| Draft     | Not visible to residents. Administrators are still preparing it.          |
| Active    | Entitled households can submit before the deadline.                       |
| Completed | No more submissions; authorized results/downloads become available.       |
| Cancelled | The vote is invalidated. It cannot accept submissions or publish results. |

## 3. Sign in and recover from a code error

### Step 1: request a code

1. Open your RWA's Civic Pulse address.
2. Enter your **Registered email address**.
3. Select **Send Sign-In Code**.
4. Read the on-screen instructions. The response intentionally does not disclose whether an address exists in the register.

![01: Sign-in screen with registered email field](./images/user-guide/01-sign-in.png)

### Step 2: enter the emailed code

1. Check your inbox and spam/junk folders.
2. Enter the six-digit code in **Six-digit code**.
3. Select **Verify and Sign In**.
4. If needed, use the offered resend/change-email control. Observe any wait/cooldown shown; repeatedly clicking does not improve delivery.

![02: Six-digit code entry and verification](./images/user-guide/02-code-entry.png)

### If the code is invalid or expired

Request a fresh code when allowed, use the newest message and check that the email address is correct. Do not send the code to support. If email does not arrive, ask your administrator to verify the register and email service.

![03: Simulated invalid or expired code with an inline recovery message](./images/user-guide/03-code-error.png)

If the application says your account is blocked or incomplete, a new code does not repair that condition. An administrator must resolve the account/household status.

## 4. Find your vote

After signing in, the **Votes** page shows only votes you are allowed to access. Use status/type filters where offered, and **Next page** for more records.

An empty page can be legitimate: no vote may yet have been activated for your household, or the selected filters may match nothing. Clear filters first, then contact the administrator if you believe an active vote is missing.

![04: Empty resident vote list](./images/user-guide/04-empty-votes.png)

When a vote appears, check its title, PUBLIC/PRIVATE label, status, deadline and whether you have already submitted. Open the vote to continue.

![05: Resident list containing an active PUBLIC poll](./images/user-guide/05-vote-list.png)

Households and representatives are frozen when a vote is activated. A later register correction does not automatically give a new representative access to an existing vote. An administrator cannot simply transfer an already activated entitlement.

## 5. Submit a PUBLIC poll

### Step 1: read and choose

Open the vote, read its background, deadline and privacy warning. Select one option, or tick multiple options if the ballot shows checkboxes. A multi-select ballot requires at least one option and may show a maximum. Authorized voters and admins can see aggregate counts while the poll is active, but not individual choices. After completion, your name/household and final selection(s) appear in authorized results.

While the vote is active, a live countdown (shown in red) to the displayed deadline appears on the vote and results pages, including after your household has submitted. It reaches zero at the deadline and the page refreshes its status. The countdown is guidance only; the server decides whether a submission is on time.

![06: PUBLIC ballot with choices and the visible non-private-choice warning](./images/user-guide/06-open-ballot.png)

If you select **Review Selections** without choosing, or exceed the displayed maximum, the form explains what to correct. Select a valid set of options and try the review step again. Nothing is submitted by this validation error.

![07: Required-choice validation on the PUBLIC ballot](./images/user-guide/07-ballot-validation.png)

A multi-select poll shows checkboxes and the heading **Choose one or more options**. Tick every option that applies (for example, every meeting date you can attend):

![50: Multi-select PUBLIC ballot with two options ticked](./images/user-guide/50-multi-select-ballot.png)

### Step 2: review, then confirm

Select **Review Selections**. Check every displayed choice carefully. Use the back control if they are wrong. Only select **Submit Vote** when you are ready; you can replace a PUBLIC ballot again until the poll closes.

![08: PUBLIC review page with the privacy notice and Submit Vote](./images/user-guide/08-review.png)

### Step 3: wait for acknowledgement

During submission, wait for the outcome. Do not close the page or repeatedly tap the button. **Your vote is recorded.** confirms the application's accepted state. The choices are then cleared from the page.

![11: Accepted PUBLIC submission, with a control to change the vote before closure](./images/user-guide/11-submitted.png)

This is the current response, not a draft or a signed receipt. Select **Change Your Vote** to choose and submit a replacement while voting remains open. Only the latest ballot and its selected options count; the household is counted once in turnout.

## 6. If your connection drops during submission

A connection failure does not prove rejection: the server may have accepted your vote before the acknowledgement was lost. Civic Pulse checks your own recorded participation before offering another attempt.

![Recovery decision tree: check status before any retry](./images/user-guide/submission.svg)

### “We could not confirm your submission”

Keep the page open, restore your connection and select **Check Again**. Do not assume you have not voted. While status remains unknown, the interface does not offer a blind resubmit.

![09: Simulated connection failure with unknown submission outcome and Check again](./images/user-guide/09-outcome-unknown.png)

If this happened while replacing a PUBLIC ballot, your household remains recorded as participating, but the current selection(s) may be the previous or replacement set. Because the server keeps only the latest ballot, it cannot show which one is current during an uncertain outcome. If the poll is still open, you can safely submit the same intended replacement again; a closed poll will reject it. Check the poll status if you need to confirm whether it remains open.

### “Your vote has not been recorded yet”

This is a confirmed status check, not just a timeout. If voting is still allowed, select **Review and Try Again**, recheck the selections and submit. If the vote has closed, you cannot use this recovery to extend the deadline.

![10: Confirmed not-recorded status with a review-and-retry action](./images/user-guide/10-not-recorded.png)

If status says submitted, your vote is recorded. For a PUBLIC poll that is still active, you can use **Change Your Vote** if you want to replace it. If access has ended or the vote has closed, follow the displayed guidance and contact your administrator with the support ID, if shown. Never send your choices or sign-in code to diagnose a connection problem.

## 7. Submit a PRIVATE election

For each office, select one candidate or **NOTA (None of the Above)**. Select the **(i)** icon beside **Choose for each office** (or hover over it with a mouse) to read the NOTA rule; press Escape or select elsewhere to close it. NOTA means you are voting but do not support any listed candidate. It is counted separately and cannot win. The candidate with the most votes among candidates is elected even if NOTA receives more votes; ties among candidates remain ties. If no candidate receives a vote, no candidate is elected. You must select a candidate or NOTA for every office before you can review.

![33: PRIVATE election ballot with candidates and an explicit NOTA option](./images/user-guide/33-closed-ballot.png)

![52: NOTA explanation opened from the (i) icon beside “Choose for each office”](./images/user-guide/52-nota-info.png)

Select **Review Selections**, check every office and then **Submit Vote**. This demonstration intentionally selects NOTA for the Chair office.

![34: PRIVATE review showing the example NOTA choice before final submission](./images/user-guide/34-closed-review.png)

After acknowledgement, the screen confirms participation without revealing a stored selection receipt. The active vote page continues to show the deadline countdown, but the application does not provide a history of your PRIVATE choices.

![35: PRIVATE accepted-submission state](./images/user-guide/35-closed-submitted.png)

The same unknown-outcome recovery described in section 6 applies to PRIVATE voting. An administrator cannot look up your selections to help.

## 8. View results, download and sign out

### While voting is still active

For an active PUBLIC poll, choose **View Live Results** on the vote page to see aggregate turnout and option counts. This link is available whether or not your household has voted, so you can check the current totals after submitting and then return to the ballot to change your PUBLIC selection(s) before the deadline. Counts include the latest selections from participating households; households are counted once in turnout. Each option is a row such as **Yes 2/4 50%** with a bar underneath: the count out of the eligible households and its percentage, with the current leader highlighted in the accent colour and tagged **Leading** (or **Tied**). In multi-select polls these percentages may add up to more than 100%. The page refreshes automatically about every 10 seconds. It never shows individual choices while voting is active.

During a live PRIVATE election, choose **View Live Turnout** to see a turnout bar showing how many eligible households have voted, for example **3/4 75%**. It refreshes automatically about every 10 seconds. Candidate and NOTA totals stay hidden until the election ends. Members see no household names or individual participation status; admins can use the separate **Participation** page to follow up with households that have or have not voted, without seeing their choices.

![12: Live PUBLIC poll results with aggregate counts and no named responses](./images/user-guide/12-results-not-ready.png)

Live results for a multi-select poll explain that percentages are shares of eligible households and can add up to more than 100%. A tie notice appears when options share the highest count:

![51: Live multi-select PUBLIC results with a tie notice and per-option shares](./images/user-guide/51-multi-live-results.png)

Live PRIVATE turnout shows only the number and percentage of eligible households that have voted, with the countdown:

![49: Live PRIVATE election turnout with candidate and NOTA totals hidden](./images/user-guide/49-closed-live-turnout.png)

### PUBLIC completed results

When the vote is Completed, open its results. Read the frozen eligible-household count, submitted count, turnout, final option totals and named household responses. A multi-select response lists all selected options; each option row shows its count out of the eligible households, its percentage and a bar, and multi-select percentages can total more than 100%. Follow response pagination if present; downloads contain the complete authorized result, not just the visible page.

![13: Completed PUBLIC results on a phone, including named responses](./images/user-guide/13-open-results.png)

The same result uses a wider layout on a computer:

![14: Completed PUBLIC results and download controls on desktop](./images/user-guide/14-desktop-results.png)

### PRIVATE completed results

After the election is Completed, read candidate and NOTA totals office by office. Results show totals only, not who chose which candidate. Select the **(i)** beside **How NOTA is counted** for the rule: NOTA never wins; the highest-count candidate is elected even if NOTA receives more votes. Tied candidate totals remain a tie, and if no candidate receives a vote no candidate is elected. Very small totals can still allow people to infer choices.

![36: Completed PRIVATE election with aggregate-only and NOTA results](./images/user-guide/36-closed-results.png)

Every result row reads like **Asha 3/8 38%** above a bar: the count out of the frozen eligible households and its percentage, rounded to a whole number (half up). Turnout, candidates, NOTA and PUBLIC options all use that same denominator, so multi-select percentages can add up to more than 100%. Leaders are highlighted in the accent colour and tagged **Elected**, **Leading** or **Tied**; NOTA has a muted striped bar because it can never win. The PDF prints the same bars. A zero denominator is not a meaningful percentage. An early-completion reason is part of the result context.

### CSV and PDF

- Choose the available **CSV** or **PDF** download from completed results. The PDF option may be disabled by deployment configuration.
- CSV is for spreadsheet/tabular use; PDF is a printable presentation of the result.
- Handle PUBLIC files carefully: they contain named household choices. Do not publish them publicly or email them to unauthorized people.
- Downloads are normal browser links in the current application. There is no separate progress panel or guaranteed inline retry message. Avoid repeatedly starting the same download.
- If a download fails, return to results and retry later. If PDF cannot represent a character, use CSV and report the issue; the app does not silently remove unsupported text.
- An export is not a database backup, proof of completeness after a recovery, or a legal signature substitute.

### Sign out

Select **Sign Out** at the right end of the tab row in the application header, especially on shared devices. You return to sign-in. Close any downloaded files/tabs containing private information; sign-out does not delete files already saved to your computer.

![41: Sign-in screen after signing out](./images/user-guide/41-signed-out.png)

## 9. Administrator navigation

Only authorized, enabled administrators see the management tools. The main sections are **Households**, **Accounts**, **Manage Votes** and **Audit History**. The resident **Votes** page remains available for their own entitlement.

![15: Administrator landing page with household register and management navigation](./images/user-guide/15-admin-home.png)

Administrators manage the register and lifecycle, not residents' selections. They cannot cast on behalf of households, edit accepted ballots or inspect live choice totals. During a live PRIVATE election, the admin-only **Participation** page identifies which households have or have not submitted so administrators can follow up; it never shows their selections.

## 10. Add a resident: account, household, enable

Follow this order so a resident is not enabled before their household exists:

![Create suspended account, assign household, then enable](./images/user-guide/register.svg)

### Step 1: create the account

1. Open **Accounts** and the new-account action.
2. Enter the correct email and **Representative name**.
3. Leave **Administrator** unchecked unless the person actually requires that role.
4. Select **Create Account**.

![16: New-account form](./images/user-guide/16-create-account.png)

The ordinary resident account starts **Suspended**. The example below has been created but is not yet enabled.

![42: Newly created example resident in Suspended state](./images/user-guide/42-created-suspended.png)

If you try to enable it too early, the app explains **A household is needed first**. This is an intentional safeguard, not something to bypass.

![43: Refusal to enable an ordinary resident before household assignment](./images/user-guide/43-household-required.png)

### Configure the identifier wording

Administrators can open **RWA Settings** to personalize how the RWA appears. Fields marked **\*** are required: **RWA Full Name**, **RWA Alias**, **Household Label** and **Identifier Label**. Everything else is optional and unmarked: **RWA Address**, **RWA Email**, **RWA Phone**, **RWA Website**, the **Accent Colour** (a handful of accessible presets, previewed on the form) and a **Welcome Message** (plain text, up to 300 characters). Leave an optional field blank to hide it everywhere; for example, a blank phone number is simply not shown in the footer or on PDF results. Residents never open this page; they see the values on other pages:

- **Alias:** the header of every page reads **Civic Pulse for** your alias (for example **Civic Pulse for Lakeview RWA**), and the alias is the first breadcrumb on signed-in pages; the alias and full name also appear on the sign-in page.
- **Full name:** the Votes page, each vote page, results, CSV and PDF exports, and the footer.
- **Address, email, phone, website:** a contact block in the signed-in footer; the address also appears on the public privacy page, and address, email and phone appear at the top of PDF results.
- **Accent colour:** links, buttons and highlights.
- **Welcome message:** the Votes page, plus the administrator Households and Manage Votes pages. Leave it blank to show nothing.

Two optional lists at the end of the form save typing later. Both are administrator-only suggestions: residents never see them, and they never create anything by themselves.

- **Default Households:** a comma-separated list of identifiers, such as `H-501, H-502, H-503`. When you add a household, identifiers from this list that are not yet in the register are offered as type-ahead suggestions. Up to 1000 entries, each up to 100 characters.
- **RWA Positions:** a comma-separated list of office names, prefilled with **President, Vice-President, Secretary, Joint-Secretary, Treasurer**. In a PRIVATE draft these names are offered as suggestions for each office, and **Add All Positions** adds every listed position as an office in one step. Up to 50 entries, each up to 200 characters.

Entries in each list must be unique; the form names any duplicate it finds.

![48: RWA Settings form with profile, accent colour, welcome message, household wording, default households and RWA positions](./images/user-guide/48-rwa-settings.png)

Changes apply immediately everywhere, including votes and results that already exist. If you rename the RWA, older results will show the new name. PDF results can only print characters the report fonts support; if a PDF refuses an unusual character in these values, use the CSV or simplify the text.

Two settings control household wording:

- **Household Label** is what one home is called in your RWA, in the singular, such as **Flat**, **Apartment** or **Villa** (suggestions are offered, but any short plain text works). It replaces the word “household” everywhere: the menu, page titles, register forms, electorate selection, participation, results, notices and CSV/PDF exports. The app works out the plural (for example **Flats**) and lower-case sentence wording automatically.
- **Identifier Label** is either **Number** or **ID**. Combined with the household label it names each identifier, for example **Flat Number**, **Apartment Number** or **Villa ID**.

The form shows a live wording preview. The defaults are **Household** and **Number**. Changing either setting changes display wording only; it does not rename saved identifiers or alter duplicate matching. This guide uses “household” for the generic concept; your screens show your RWA's label instead.

### Step 2: add and assign a household

1. Open **Households** and **Add household**.
2. Enter the unique, correct identifier using the label configured for your RWA (for example **Flat Number**, **Apartment Number** or **Villa ID**). If **Default Households** is set in RWA Settings, start typing to pick one of the listed identifiers that is not registered yet.
3. Select the intended **Representative**. Verify the email as well as the name.
4. Set **Eligible to vote** according to the approved register.
5. Select **Add household**.

![20: Household form with identifier, representative and eligibility controls](./images/user-guide/20-add-household.png)

This shared test register shows a capped candidate-list warning. If a real form says the account list is incomplete, do not assume an omitted account is absent or choose the wrong person. Follow the displayed guidance/contact support; the form is not a bulk-import tool.

Verify the saved household and its representative:

![44: Newly created example household in the filtered register](./images/user-guide/44-household-created.png)

### Step 3: enable the account

Return to the account, select **Enable Account**, review the dialog and confirm.

![45: Account-enable confirmation dialog](./images/user-guide/45-enable-dialog.png)

The account now shows Enabled and offers **Suspend Account**. The resident can sign in; their ability to access a particular vote still depends on that vote's frozen entitlement.

![46: Example account after successful enablement](./images/user-guide/46-enabled-account.png)

### Account and household lists

Use list filters/pagination to find existing records rather than creating duplicates.

![47: Accounts list with status and role filters](./images/user-guide/47-accounts-list.png)

Open a household to update its identifier, representative or eligibility for future activations. Save and check the result. Existing active/completed votes keep their historical household/representative data. The RWA-wide household and identifier labels are managed in **RWA Settings**; changing them updates the display wording across the app without changing saved identifiers or their matching rules.

![21: Household edit form and representative assignment](./images/user-guide/21-household.png)

## 11. Edit, suspend or delete an account

Open an account to update its name/email or administrative role, then select **Save Changes**. Grant administrator permissions sparingly and confirm the intended person.

![17: Account details and role/access controls](./images/user-guide/17-account.png)

Changing an email requires the sign-in service and register to remain consistent. If an error says setup is incomplete, do not tell the resident to continue with an assumed address. Resolve the surfaced issue and verify the final state.

### Suspend

**Suspend Account** stops application access without deleting historical participation. Suspension can later be reversed. Read the confirmation before proceeding.

![18: Suspension confirmation, shown but not executed for this pictured resident](./images/user-guide/18-suspend-dialog.png)

### Delete

**Delete Account** is irreversible in the application UI. Historical vote/audit identity is retained according to policy; this is not a way to erase an accepted ballot. Prefer suspension if the change is temporary.

![19: Irreversible-deletion confirmation, shown but not executed for this pictured resident](./images/user-guide/19-delete-dialog.png)

The system prevents removal of the last enabled administrator. If a provider operation fails partway through suspension/deletion, follow the reported recovery guidance; retrying the same status may finish a previously failed sign-in-service restriction. Do not create a second identity to conceal a partial failure.

## 12. Create and preview a vote

### Step 1: create a draft

Open **Manage Votes**, choose the new-vote action, select **PUBLIC voting** or **PRIVATE voting**, then **Create Draft**.

![22: Choose voting type before creating a draft](./images/user-guide/22-voting-types.png)

Drafts may be incomplete and are not visible to residents. For PUBLIC voting, enter the question/background and at least two distinct options. Choose whether a household selects one option or multiple options; multi-select requires at least one and can have a maximum from 2 to 100 or no maximum. Each household still submits one ballot and counts once in turnout. Add/remove/reorder options as needed.

![24: PUBLIC draft editor with question, options, selected electorate and deadline](./images/user-guide/24-open-editor.png)

For PRIVATE voting, enter the election details, offices and each office's candidates. Office names suggest the **RWA Positions** from RWA Settings as you type. **Add All Positions** fills any blank offices that have no candidates yet, then adds the remaining positions as new offices; positions that are already offices are skipped, and the 50-office limit still applies. The resident ballot includes NOTA automatically; do not add it as a candidate. Verify candidate-to-office assignment and order carefully.

![32: PRIVATE draft editor with offices, candidates and Add All Positions](./images/user-guide/32-closed-editor.png)

Changing a draft's type removes the previous type's ballot content. Do not switch types casually after entering options/candidates.

### Step 2: choose households and deadline

- In **Electorate**, find and select the intended eligible households.
- Review the actual selected count and representatives. A filter changes what you see; do not assume it changed all selection behavior. “Select all eligible” is broader than manually ticking the one displayed household.
- Enter a future closing time in the RWA's displayed time zone and verify the resident-facing time.
- Select **Save Draft**. Do not assume text typed into the form is already saved.
- Draft versions protect against two administrators overwriting one another. If a conflict appears, reload and review the latest version before editing again.

### Step 3: preview

Select **Preview Ballot**. An incomplete draft clearly lists activation blockers, such as missing content/electorate/deadline or configuration approvals. Correct the listed problems and preview again.

![23: Incomplete preview with activation blockers](./images/user-guide/23-incomplete-preview.png)

A ready preview says **No problems found in this version**. Review the ballot, privacy notice, household count and deadline as a resident would. A successful preview is not production-launch approval; an administrator must still follow actual RWA approvals and operating policy.

![25: Ready, version-bound preview before activation](./images/user-guide/25-ready-preview.png)

## 13. Activate and monitor

Select **Activate Vote**, read the confirmation and explicitly confirm. If the draft changed since preview, refresh and review again.

![26: Activation confirmation and irreversible-freeze warning](./images/user-guide/26-activate-dialog.png)

After activation, the title/content, type, selection rule, options/candidates, electorate and representative snapshots are frozen. You cannot add a late household or repair ballot wording in place. Only the deadline can still be moved while voting is open (see [Change the deadline](#change-the-deadline)).

![27: Active vote management with frozen content, Change Deadline and lifecycle controls](./images/user-guide/27-active-vote.png)

Open **Participation** to see submitted/not-submitted household status and turnout. You cannot see live choices or candidate totals, including for PUBLIC votes before completion.

![28: Administrator participation monitor without individual choices](./images/user-guide/28-participation.png)

If serious frozen-content errors are found, use the approved cancellation process and prepare a new vote. Do not try to alter the database manually.

### Change the deadline

If turnout is low, or the committee decides voting should close sooner, an administrator can move the deadline of an **Active** vote, for PUBLIC and PRIVATE votes alike.

1. Open the active vote and select **Change Deadline**.
2. Enter the new closing time in the RWA's time zone. The dialog shows what residents will see and whether the deadline is extended or brought forward, and by how much.
3. Enter the reason and confirm with **Change Deadline**.

![53: Change Deadline dialog extending an active vote by two days, with a required reason](./images/user-guide/53-change-deadline.png)

- The new deadline must be at least 5 minutes from now and different from the current one. To stop voting immediately, use **Complete Vote Early** instead.
- There is no limit on how often or how far the deadline is moved.
- It works only while the vote is Active and before its current deadline. Once the deadline passes the vote completes and cannot be reopened or extended.
- The reason and the previous and new deadlines are recorded in **Audit History** as **Vote deadline changed**. Residents never see the reason.
- Residents are not notified. Their vote pages simply show the new deadline and countdown, and a page left open refreshes when the old countdown reaches zero.

## 14. Complete or cancel

### Completion at the deadline

Submissions stop at the exact database-enforced deadline (the latest one, if an administrator changed it). Scheduled processing marks the vote Completed; processing delay does not extend voting. A countdown on a device is guidance, not the acceptance authority.

### Complete early

Where approved, an administrator may select **Complete Vote Early**. Enter a meaningful reason and confirm. The reason is recorded with the vote and completion is final.

![29: Early-completion dialog showing that a reason is required](./images/user-guide/29-complete-dialog.png)

After completion, confirm the status and open the results. For an active PUBLIC poll, use its live results page rather than completing early; early completion permanently ends voting.

![30: Completed administrator view after early completion](./images/user-guide/30-completed-admin.png)

The management list helps distinguish Draft, Active, Completed and Cancelled records; use filters and pagination.

![31: Manage Votes list after completion](./images/user-guide/31-admin-votes.png)

### Cancel an active vote

Select **Cancel Vote**, enter the actual reason, review the warning and confirm. Cancellation invalidates the vote. There are no valid results/downloads and it cannot reopen.

![37: Cancellation dialog with required reason](./images/user-guide/37-cancel-dialog.png)

Residents then see that the vote was cancelled and cannot submit or view results.

![38: Resident view of a cancelled vote and its reason](./images/user-guide/38-cancelled-member.png)

Cancellation does not silently rewrite or hide the audit trail. Arrange a new vote through the proper draft/preview/activation process if needed.

## 15. Audit and access boundaries

Use **Audit History** to review recorded administrator actions, actor, target and time. Filter by action/record/time as offered, and use pagination. It is an operational history, not a way to inspect sign-in codes or PRIVATE selections.

![39: Administrator audit history](./images/user-guide/39-audit.png)

A resident who enters an admin URL receives a plain not-found page. This deliberately avoids disclosing protected administrative information. Going back to **Votes** or signing in again does not grant an administrator role.

![40: Resident request to an administrator page receives not found](./images/user-guide/40-no-admin-access.png)

## 16. Troubleshooting and safe recovery

| Situation                              | What to do                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No sign-in email                       | Check the typed address, newest mail and spam folder. Wait for resend cooldown. Ask the admin to check provisioning/SMTP; do not create a new public account. |
| Invalid/expired code                   | Request a new code when allowed and use the latest message. Never share it.                                                                                   |
| Too many requests                      | Follow the wait/retry guidance. Repeated rapid attempts can prolong disruption.                                                                               |
| Account suspended/incomplete           | Ask the administrator to resolve the register/provider workflow. A valid email code is not sufficient authorization.                                          |
| Empty Votes list                       | Clear filters and check with the admin whether your frozen household was included in an activated vote.                                                       |
| Required choice missing                | Select one PUBLIC option or a candidate/NOTA for every PRIVATE office, then review.                                                                               |
| “We could not confirm your submission” | Use Check again; do not blindly repeat submission.                                                                                                            |
| Confirmed not recorded                 | Use Review and try again only if the app offers it and voting remains allowed.                                                                                |
| Already submitted                      | Do not attempt another device/account. The accepted ballot is final.                                                                                          |
| Deadline passed                        | No new submission or retry can extend the deadline, and a closed vote cannot be reopened. Contact the admin about process questions, not a manual ballot edit. |
| Results not ready                      | Active results are available only for PUBLIC polls; wait until completion for PRIVATE results. Cancelled votes do not publish results.                           |
| Results pending integrity review       | Stop relying on that result and alert the administrator/operations team. Do not infer missing totals yourself.                                                |
| PDF fails or is unavailable            | Use CSV if available. Report unsupported text or recurring failure.                                                                                           |
| Session expired/access changed         | Sign in again if allowed. Unsaved selections are not a stored draft and may need to be re-entered.                                                            |
| Draft changed by someone else          | Reload the current version, reconcile changes and preview again.                                                                                              |
| Activation blocked                     | Correct listed ballot/register/configuration blockers. Do not approve policies you are not authorized to approve.                                             |
| Maintenance/service unavailable        | Wait for the RWA's service announcement and retry later. Maintenance is not an alternate voting channel.                                                      |
| Unexpected error                       | Keep the support ID and action/time. Contact the approved support channel without OTPs, cookies or PRIVATE choices.                                            |

When asking for help, include the vote title, action, approximate time, visible error/support ID and device/browser. Redact email addresses and other households from screenshots unless the approved support process needs them. **Never include sign-in codes or PRIVATE selections.**

## 17. Coverage, privacy and limits

This guide covers main resident/admin journeys and representative errors, not every possible combination of device, identity, network and ballot. The following are explained in text rather than all individually photographed: real SMTP failure/cooldown, every stale-revision conflict, deadline lock races, maintenance, provider partial failures, last-admin refusal, all browser download errors and every multi-office layout.

The pictures use a real application against synthetic test data. The invalid-code response and lost-connection sequence are intentionally simulated; no real SMTP deliverability claim is made. Actual completed PUBLIC/PRIVATE submissions, results, account creation/assignment/enablement, activation, early completion, cancellation, audit access and sign-out are exercised by the capture journey.

This application does not provide public signup, anonymous public results, bulk register CSV import, delegated voting, ballot editing/withdrawal, reopening a closed vote, messaging/reminders or legal signatures.

Before real use, the RWA/operator must complete approvals, production email/capacity/security verification, monitoring, backup/restore and manual device/accessibility acceptance. See [pilot readiness](./PILOT_READINESS.md) and the [launch audit](./LAUNCH_AUDIT.md). A screenshot guide is not launch approval.
