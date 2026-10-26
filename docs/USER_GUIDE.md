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

The 47 screenshots show the principal resident and administrator journeys, plus representative validation, privacy, access and recovery states. Resident screens use a narrow phone viewport; most administration screens use a desktop viewport. The same application adapts to the device.

These screenshots predate the public privacy/contact pages, breadcrumbs and
information footer. The current support and optional-analytics behavior is
described in section 1; those additions are not illustrated by these older
screenshots. Do not treat the images as proof of contact-email delivery.

Names, addresses, votes, household labels and counts are synthetic. Gray rectangles deliberately hide email addresses and sign-in codes. Some lists contain accumulated test records: a count such as “715 eligible” is **not** the size of your RWA, a product limit or a performance guarantee. Dates/time zones are examples; always read the actual vote's displayed deadline.

The invalid-code example and the uncertain-submission examples deliberately simulate errors in the real UI. Screenshots do not prove production email delivery. Dialog pictures for suspension and deletion show the confirmation stage, not an executed suspension/deletion of the illustrated resident.

Long pictures show the entire page. Zoom/open the original image when reading small details; the accompanying steps are the printable instructions.

## 2. Understand the vote before participating

| Topic                    | OPEN voting                                                                                               | CLOSED voting                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Typical use              | One question, such as a yes/no decision.                                                                  | Election with one or more offices and candidates.                                                |
| Your selection           | Choose exactly one option.                                                                                | Choose one candidate or **Abstain** for every office.                                            |
| Results after completion | Totals plus authorized named household responses.                                                         | Aggregate totals only, with abstentions.                                                         |
| Privacy                  | Your name, flat/household and choice are visible to entitled members and RWA admins, including downloads. | Residents and RWA admins cannot retrieve your selections through the app.                        |
| Important limit          | OPEN is not a private ballot.                                                                             | Not protection against privileged infrastructure access; very small totals can permit inference. |

For either type:

- You vote for your household entitlement, not once for every device.
- **Submitting is final. You cannot change or withdraw it.**
- You must review before submitting.
- Participation can be monitored, but no live choice totals are available, even to admins.
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
3. Select **Send sign-in code**.
4. Read the on-screen instructions. The response intentionally does not disclose whether an address exists in the register.

![01: Sign-in screen with registered email field](./images/user-guide/01-sign-in.png)

### Step 2: enter the emailed code

1. Check your inbox and spam/junk folders.
2. Enter the six-digit code in **Six-digit code**.
3. Select **Verify and sign in**.
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

When a vote appears, check its title, OPEN/CLOSED label, status, deadline and whether you have already submitted. Open the vote to continue.

![05: Resident list containing an active OPEN poll](./images/user-guide/05-vote-list.png)

Households and representatives are frozen when a vote is activated. A later register correction does not automatically give a new representative access to an existing vote. An administrator cannot simply transfer an already activated entitlement.

## 5. Submit an OPEN poll

### Step 1: read and choose

Open the vote, read its background, deadline and privacy warning. Select exactly one radio option. For OPEN voting, your name/household and choice will be included in authorized completed results.

![06: OPEN ballot with choices and the visible non-private-choice warning](./images/user-guide/06-open-ballot.png)

If you select **Review selections** without choosing, the form identifies the missing answer. Select an option and try the review step again. Nothing is submitted by this validation error.

![07: Required-choice validation on the OPEN ballot](./images/user-guide/07-ballot-validation.png)

### Step 2: review, then confirm

Select **Review selections**. Check the displayed choice carefully. Use the back/change control if it is wrong. Only select **Submit vote** when you are sure.

![08: OPEN review page and final-submission warning](./images/user-guide/08-review.png)

### Step 3: wait for acknowledgement

During submission, wait for the outcome. Do not close the page or repeatedly tap the button. **Vote submitted.** confirms the application's accepted state. The choices are then cleared from the page.

![11: Accepted OPEN submission, with no ballot-edit control](./images/user-guide/11-submitted.png)

This is not a changeable draft or a signed receipt. You cannot undo the submission or cast again from another browser.

## 6. If your connection drops during submission

A connection failure does not prove rejection: the server may have accepted your vote before the acknowledgement was lost. Civic Pulse checks your own recorded participation before offering another attempt.

![Recovery decision tree: check status before any retry](./images/user-guide/submission.svg)

### “We could not confirm your submission”

Keep the page open, restore your connection and select **Check again**. Do not assume you have not voted. While status remains unknown, the interface does not offer a blind resubmit.

![09: Simulated connection failure with unknown submission outcome and Check again](./images/user-guide/09-outcome-unknown.png)

### “Your vote has not been recorded yet”

This is a confirmed status check, not just a timeout. If voting is still allowed, select **Review and try again**, recheck the selections and submit. If the vote has closed, you cannot use this recovery to extend the deadline.

![10: Confirmed not-recorded status with a review-and-retry action](./images/user-guide/10-not-recorded.png)

If status says submitted, stop: your vote is already recorded. If access has ended or the vote has closed, follow the displayed guidance and contact your administrator with the support ID, if shown. Never send your choices or sign-in code to diagnose a connection problem.

## 7. Submit a CLOSED election

For each office, select one candidate **or Abstain**. Abstention means you participated in that office without selecting a candidate. Leaving an office unanswered is not the same as abstaining and prevents review.

![33: CLOSED election ballot with candidates and an explicit Abstain option](./images/user-guide/33-closed-ballot.png)

Select **Review selections**, check every office and then **Submit vote**. This demonstration intentionally selects Abstain for the Chair office.

![34: CLOSED review showing the example abstention before final submission](./images/user-guide/34-closed-review.png)

After acknowledgement, the screen confirms participation without revealing a stored selection receipt. The application does not provide a history of your CLOSED choices.

![35: CLOSED accepted-submission state](./images/user-guide/35-closed-submitted.png)

The same unknown-outcome recovery described in section 6 applies to CLOSED voting. An administrator cannot look up your selections to help.

## 8. View results, download and sign out

### While voting is still active

Results are not published while the vote is active, even if you have submitted. A results link or direct URL does not bypass this restriction.

![12: Results unavailable before completion](./images/user-guide/12-results-not-ready.png)

### OPEN completed results

When the vote is Completed, open its results. Read the frozen eligible-household count, submitted count, turnout, choice totals and named household responses. Follow response pagination if present; downloads contain the complete authorized result, not just the visible page.

![13: Completed OPEN results on a phone, including named responses](./images/user-guide/13-open-results.png)

The same result uses a wider layout on a computer:

![14: Completed OPEN results and download controls on desktop](./images/user-guide/14-desktop-results.png)

### CLOSED completed results

Read candidate totals and abstentions office by office. Results show totals only, not who chose which candidate. A tie is a tie; zero submissions do not manufacture a winner. Very small totals can still allow people to infer choices.

![36: Completed CLOSED election with aggregate-only and abstention results](./images/user-guide/36-closed-results.png)

Turnout uses the frozen eligible households. Candidate/abstention percentages use submitted ballots; a zero denominator is not a meaningful percentage. An early-completion reason is part of the result context.

### CSV and PDF

- Choose the available **CSV** or **PDF** download from completed results. The PDF option may be disabled by deployment configuration.
- CSV is for spreadsheet/tabular use; PDF is a printable presentation of the result.
- Handle OPEN files carefully: they contain named household choices. Do not publish them publicly or email them to unauthorized people.
- Downloads are normal browser links in the current application. There is no separate progress panel or guaranteed inline retry message. Avoid repeatedly starting the same download.
- If a download fails, return to results and retry later. If PDF cannot represent a character, use CSV and report the issue; the app does not silently remove unsupported text.
- An export is not a database backup, proof of completeness after a recovery, or a legal signature substitute.

### Sign out

Select **Sign out** in the application header, especially on shared devices. You return to sign-in. Close any downloaded files/tabs containing private information; sign-out does not delete files already saved to your computer.

![41: Sign-in screen after signing out](./images/user-guide/41-signed-out.png)

## 9. Administrator navigation

Only authorized, enabled administrators see the management tools. The main sections are **Households**, **Accounts**, **Manage votes** and **Audit history**. The resident **Votes** page remains available for their own entitlement.

![15: Administrator landing page with household register and management navigation](./images/user-guide/15-admin-home.png)

Administrators manage the register and lifecycle, not residents' selections. They cannot cast on behalf of households, edit accepted ballots or inspect live choice totals.

## 10. Add a resident: account, household, enable

Follow this order so a resident is not enabled before their household exists:

![Create suspended account, assign household, then enable](./images/user-guide/register.svg)

### Step 1: create the account

1. Open **Accounts** and the new-account action.
2. Enter the correct email and **Representative name**.
3. Leave **Administrator** unchecked unless the person actually requires that role.
4. Select **Create account**.

![16: New-account form](./images/user-guide/16-create-account.png)

The ordinary resident account starts **Suspended**. The example below has been created but is not yet enabled.

![42: Newly created example resident in Suspended state](./images/user-guide/42-created-suspended.png)

If you try to enable it too early, the app explains **A household is needed first**. This is an intentional safeguard, not something to bypass.

![43: Refusal to enable an ordinary resident before household assignment](./images/user-guide/43-household-required.png)

### Step 2: add and assign a household

1. Open **Households** and **Add household**.
2. Enter its unique, correct **Household identifier**.
3. Select the intended **Representative**. Verify the email as well as the name.
4. Set **Eligible to vote** according to the approved register.
5. Select **Add household**.

![20: Household form with identifier, representative and eligibility controls](./images/user-guide/20-add-household.png)

This shared test register shows a capped candidate-list warning. If a real form says the account list is incomplete, do not assume an omitted account is absent or choose the wrong person. Follow the displayed guidance/contact support; the form is not a bulk-import tool.

Verify the saved household and its representative:

![44: Newly created example household in the filtered register](./images/user-guide/44-household-created.png)

### Step 3: enable the account

Return to the account, select **Enable account**, review the dialog and confirm.

![45: Account-enable confirmation dialog](./images/user-guide/45-enable-dialog.png)

The account now shows Enabled and offers **Suspend account**. The resident can sign in; their ability to access a particular vote still depends on that vote's frozen entitlement.

![46: Example account after successful enablement](./images/user-guide/46-enabled-account.png)

### Account and household lists

Use list filters/pagination to find existing records rather than creating duplicates.

![47: Accounts list with status and role filters](./images/user-guide/47-accounts-list.png)

Open a household to update its identifier, representative or eligibility for future activations. Save and check the result. Existing active/completed votes keep historical household/representative details.

![21: Household edit form and representative assignment](./images/user-guide/21-household.png)

## 11. Edit, suspend or delete an account

Open an account to update its name/email or administrative role, then select **Save changes**. Grant administrator permissions sparingly and confirm the intended person.

![17: Account details and role/access controls](./images/user-guide/17-account.png)

Changing an email requires the sign-in service and register to remain consistent. If an error says setup is incomplete, do not tell the resident to continue with an assumed address. Resolve the surfaced issue and verify the final state.

### Suspend

**Suspend account** stops application access without deleting historical participation. Suspension can later be reversed. Read the confirmation before proceeding.

![18: Suspension confirmation, shown but not executed for this pictured resident](./images/user-guide/18-suspend-dialog.png)

### Delete

**Delete account** is irreversible in the application UI. Historical vote/audit identity is retained according to policy; this is not a way to erase an accepted ballot. Prefer suspension if the change is temporary.

![19: Irreversible-deletion confirmation, shown but not executed for this pictured resident](./images/user-guide/19-delete-dialog.png)

The system prevents removal of the last enabled administrator. If a provider operation fails partway through suspension/deletion, follow the reported recovery guidance; retrying the same status may finish a previously failed sign-in-service restriction. Do not create a second identity to conceal a partial failure.

## 12. Create and preview a vote

### Step 1: create a draft

Open **Manage votes**, choose the new-vote action, select **OPEN voting** or **CLOSED voting**, then **Create draft**.

![22: Choose voting type before creating a draft](./images/user-guide/22-voting-types.png)

Drafts may be incomplete and are not visible to residents. For OPEN voting, enter the question/background and at least two distinct options. Add/remove/reorder options as needed.

![24: OPEN draft editor with question, options, selected electorate and deadline](./images/user-guide/24-open-editor.png)

For CLOSED voting, enter the election details, offices and each office's candidates. The resident ballot includes explicit abstention. Verify candidate-to-office assignment and order carefully.

![32: CLOSED draft editor with offices and candidates](./images/user-guide/32-closed-editor.png)

Changing a draft's type removes the previous type's ballot content. Do not switch types casually after entering options/candidates.

### Step 2: choose households and deadline

- In **Electorate**, find and select the intended eligible households.
- Review the actual selected count and representatives. A filter changes what you see; do not assume it changed all selection behavior. “Select all eligible” is broader than manually ticking the one displayed household.
- Enter a future closing time in the RWA's displayed time zone and verify the resident-facing time.
- Select **Save draft**. Do not assume text typed into the form is already saved.
- Draft versions protect against two administrators overwriting one another. If a conflict appears, reload and review the latest version before editing again.

### Step 3: preview

Select **Preview ballot**. An incomplete draft clearly lists activation blockers, such as missing content/electorate/deadline or configuration approvals. Correct the listed problems and preview again.

![23: Incomplete preview with activation blockers](./images/user-guide/23-incomplete-preview.png)

A ready preview says **No problems found in this version**. Review the ballot, privacy notice, household count and deadline as a resident would. A successful preview is not production-launch approval; an administrator must still follow actual RWA approvals and operating policy.

![25: Ready, version-bound preview before activation](./images/user-guide/25-ready-preview.png)

## 13. Activate and monitor

Select **Activate vote**, read the confirmation and explicitly confirm. If the draft changed since preview, refresh and review again.

![26: Activation confirmation and irreversible-freeze warning](./images/user-guide/26-activate-dialog.png)

After activation, the title/content, type, options/candidates, electorate, representative snapshots and deadline are frozen. You cannot add a late household, extend the deadline or repair ballot wording in place.

![27: Active vote management with frozen content and lifecycle controls](./images/user-guide/27-active-vote.png)

Open **Participation** to see submitted/not-submitted household status and turnout. You cannot see live choices or candidate totals, including for OPEN votes before completion.

![28: Administrator participation monitor without individual choices](./images/user-guide/28-participation.png)

If serious frozen-content errors are found, use the approved cancellation process and prepare a new vote. Do not try to alter the database manually.

## 14. Complete or cancel

### Completion at the deadline

Submissions stop at the exact database-enforced deadline. Scheduled processing marks the vote Completed; processing delay does not extend voting. A countdown on a device is guidance, not the acceptance authority.

### Complete early

Where approved, an administrator may select **Complete vote early**. Enter a meaningful reason and confirm. The reason is recorded with the vote and completion is final.

![29: Early-completion dialog showing that a reason is required](./images/user-guide/29-complete-dialog.png)

After completion, confirm the status and open the results. Do not use early completion merely to inspect live totals: it permanently ends voting.

![30: Completed administrator view after early completion](./images/user-guide/30-completed-admin.png)

The management list helps distinguish Draft, Active, Completed and Cancelled records; use filters and pagination.

![31: Manage votes list after completion](./images/user-guide/31-admin-votes.png)

### Cancel an active vote

Select **Cancel vote**, enter the actual reason, review the warning and confirm. Cancellation invalidates the vote. There are no valid results/downloads and it cannot reopen.

![37: Cancellation dialog with required reason](./images/user-guide/37-cancel-dialog.png)

Residents then see that the vote was cancelled and cannot submit or view results.

![38: Resident view of a cancelled vote and its reason](./images/user-guide/38-cancelled-member.png)

Cancellation does not silently rewrite or hide the audit trail. Arrange a new vote through the proper draft/preview/activation process if needed.

## 15. Audit and access boundaries

Use **Audit history** to review recorded administrator actions, actor, target and time. Filter by action/record/time as offered, and use pagination. It is an operational history, not a way to inspect sign-in codes or CLOSED selections.

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
| Required choice missing                | Select one OPEN option or a candidate/Abstain for every CLOSED office, then review.                                                                           |
| “We could not confirm your submission” | Use Check again; do not blindly repeat submission.                                                                                                            |
| Confirmed not recorded                 | Use Review and try again only if the app offers it and voting remains allowed.                                                                                |
| Already submitted                      | Do not attempt another device/account. The accepted ballot is final.                                                                                          |
| Deadline passed                        | No new submission or retry can extend the deadline. Contact the admin about process questions, not a manual ballot edit.                                      |
| Results not ready                      | Wait until completion; active results and cancelled results are not available.                                                                                |
| Results pending integrity review       | Stop relying on that result and alert the administrator/operations team. Do not infer missing totals yourself.                                                |
| PDF fails or is unavailable            | Use CSV if available. Report unsupported text or recurring failure.                                                                                           |
| Session expired/access changed         | Sign in again if allowed. Unsaved selections are not a stored draft and may need to be re-entered.                                                            |
| Draft changed by someone else          | Reload the current version, reconcile changes and preview again.                                                                                              |
| Activation blocked                     | Correct listed ballot/register/configuration blockers. Do not approve policies you are not authorized to approve.                                             |
| Maintenance/service unavailable        | Wait for the RWA's service announcement and retry later. Maintenance is not an alternate voting channel.                                                      |
| Unexpected error                       | Keep the support ID and action/time. Contact the approved support channel without OTPs, cookies or CLOSED choices.                                            |

When asking for help, include the vote title, action, approximate time, visible error/support ID and device/browser. Redact email addresses and other households from screenshots unless the approved support process needs them. **Never include sign-in codes or CLOSED selections.**

## 17. Coverage, privacy and limits

This guide covers main resident/admin journeys and representative errors, not every possible combination of device, identity, network and ballot. The following are explained in text rather than all individually photographed: real SMTP failure/cooldown, every stale-revision conflict, deadline lock races, maintenance, provider partial failures, last-admin refusal, all browser download errors and every multi-office layout.

The pictures use a real application against synthetic test data. The invalid-code response and lost-connection sequence are intentionally simulated; no real SMTP deliverability claim is made. Actual completed OPEN/CLOSED submissions, results, account creation/assignment/enablement, activation, early completion, cancellation, audit access and sign-out are exercised by the capture journey.

This application does not provide public signup, anonymous public results, bulk register CSV import, delegated voting, ballot editing/withdrawal, deadline extension, messaging/reminders or legal signatures.

Before real use, the RWA/operator must complete approvals, production email/capacity/security verification, monitoring, backup/restore and manual device/accessibility acceptance. See [pilot readiness](./PILOT_READINESS.md) and the [launch audit](./LAUNCH_AUDIT.md). A screenshot guide is not launch approval.
