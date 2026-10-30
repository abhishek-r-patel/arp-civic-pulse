// Curated synthetic screenshots shared by the capture runner and native guides.
export const GUIDE_IMAGES = {
  registration: [
    "resident",
    "77-register",
    "Register with your name, email and configured identifier.",
  ],
  registered: [
    "resident",
    "78-register-received",
    "Registration received; administrator review is still required.",
  ],
  signIn: [
    "resident",
    "01-sign-in",
    "Sign in using your registered email address.",
  ],
  code: [
    "resident",
    "02-code-entry",
    "Enter the newest six-digit sign-in code.",
  ],
  codeError: [
    "resident",
    "03-code-error",
    "An invalid or expired code can be replaced with a fresh code.",
  ],
  appearance: [
    "resident",
    "74-appearance-menu",
    "Choose Light, Dark or System appearance for this browser.",
  ],
  votes: [
    "resident",
    "05-vote-list",
    "Find your votes and check their current status.",
  ],
  scheduledResident: [
    "resident",
    "59-scheduled-member",
    "A scheduled vote shows its opening time, not its ballot.",
  ],
  publicBallot: [
    "resident",
    "06-open-ballot",
    "Read the PUBLIC privacy notice and select your response.",
  ],
  multiBallot: [
    "resident",
    "50-multi-select-ballot",
    "A multi-select PUBLIC poll uses checkboxes instead of radio buttons.",
  ],
  publicReview: [
    "resident",
    "08-review",
    "Review the PUBLIC selections before submitting.",
  ],
  publicRecorded: [
    "resident",
    "11-submitted",
    "Recorded participation and the option to change an active PUBLIC response.",
  ],
  unknown: [
    "resident",
    "09-outcome-unknown",
    "An uncertain outcome must be checked before retrying.",
  ],
  notRecorded: [
    "resident",
    "10-not-recorded",
    "Retry only after the application confirms no submission was recorded.",
  ],
  publicLive: [
    "resident",
    "12-results-not-ready",
    "Active PUBLIC results show totals without named choices.",
  ],
  publicResults: [
    "resident",
    "13-open-results",
    "Completed PUBLIC results include authorised named responses and downloads.",
  ],
  privateBallot: [
    "resident",
    "33-closed-ballot",
    "Choose a candidate or NOTA for every PRIVATE election office.",
  ],
  privateReview: [
    "resident",
    "34-closed-review",
    "Review every office before the final PRIVATE submission.",
  ],
  privateRecorded: [
    "resident",
    "35-closed-submitted",
    "PRIVATE participation is acknowledged without a selection receipt.",
  ],
  privateLive: [
    "resident",
    "49-closed-live-turnout",
    "Active PRIVATE elections show turnout, never candidate totals.",
  ],
  privateResults: [
    "resident",
    "36-closed-results",
    "Completed PRIVATE results show aggregate candidate and NOTA totals.",
  ],
  cancelled: [
    "resident",
    "38-cancelled-member",
    "A cancelled vote has no valid results or downloads.",
  ],
  settings: [
    "rwa-admin",
    "48-rwa-settings",
    "Set the RWA identity, wording, appearance and suggestion lists first.",
  ],
  createResident: [
    "rwa-admin",
    "16-create-account",
    "Add a resident with separate sign-in and voting-eligibility approvals.",
  ],
  residentCreated: [
    "rwa-admin",
    "82-account-created-with-flat",
    "Resident created with an assigned identifier and explicitly approved access.",
  ],
  residents: [
    "rwa-admin",
    "47-accounts-list",
    "Manage residents, filters, page-local selections and eligibility.",
  ],
  residentFilters: [
    "rwa-admin",
    "90-resident-filters",
    "Find residents using labelled sorting and filtering controls.",
  ],
  selfRegistered: [
    "rwa-admin",
    "84-self-registered-accounts",
    "Review suspended self-registered residents before granting access.",
  ],
  manageResident: [
    "rwa-admin",
    "17-account",
    "Manage identity, role, access and the resident's assignment.",
  ],
  move: [
    "rwa-admin",
    "83-move-flat-dialog",
    "Confirm an assignment move; existing frozen voting rights do not move.",
  ],
  suspend: [
    "rwa-admin",
    "18-suspend-dialog",
    "Confirm a reversible suspension of account access.",
  ],
  deleteResident: [
    "rwa-admin",
    "19-delete-dialog",
    "Read the irreversible-deletion warning before confirming.",
  ],
  eligible: [
    "rwa-admin",
    "64-make-eligible",
    "Confirm future eligibility independently from sign-in access.",
  ],
  enable: [
    "rwa-admin",
    "65-enable-selected",
    "Confirm enabling the selected accounts.",
  ],
  importPreview: [
    "rwa-admin",
    "54-import-preview",
    "Check the CSV preview before importing any residents.",
  ],
  importConfirm: [
    "rwa-admin",
    "55-import-confirm",
    "Confirm import; imported accounts remain suspended.",
  ],
  importResult: [
    "rwa-admin",
    "56-import-result",
    "Review each import outcome before enabling residents.",
  ],
  voteTypes: [
    "rwa-admin",
    "22-voting-types",
    "Choose PUBLIC polling or a PRIVATE election before creating a draft.",
  ],
  publicDraft: [
    "rwa-admin",
    "24-open-editor",
    "Prepare a PUBLIC ballot, deadline and selected electorate.",
  ],
  deleteDraft: [
    "rwa-admin",
    "91-delete-draft",
    "Confirm deleting a saved draft; live and terminal votes cannot be deleted here.",
  ],
  privateDraft: [
    "rwa-admin",
    "32-closed-editor",
    "Prepare PRIVATE offices and candidates; NOTA is supplied automatically.",
  ],
  preview: [
    "rwa-admin",
    "25-ready-preview",
    "Review the saved ballot, readiness and frozen-electorate warning.",
  ],
  activate: [
    "rwa-admin",
    "26-activate-dialog",
    "Confirm immediate activation and the data that will freeze.",
  ],
  schedule: [
    "rwa-admin",
    "57-schedule-confirm",
    "Confirm scheduling; the ballot and electorate freeze now.",
  ],
  scheduledAdmin: [
    "rwa-admin",
    "58-scheduled-admin",
    "Monitor a scheduled vote or return it to draft before opening.",
  ],
  withdraw: [
    "rwa-admin",
    "60-withdraw-schedule",
    "Returning a schedule to draft requires a reason.",
  ],
  active: [
    "rwa-admin",
    "27-active-vote",
    "Manage an active vote without changing its frozen ballot.",
  ],
  participation: [
    "rwa-admin",
    "28-participation",
    "Monitor submitted and not-submitted participation without seeing choices.",
  ],
  deadline: [
    "rwa-admin",
    "53-change-deadline",
    "Change an active deadline with an audited reason.",
  ],
  complete: [
    "rwa-admin",
    "29-complete-dialog",
    "Early completion requires confirmation and a meaningful reason.",
  ],
  cancel: [
    "rwa-admin",
    "37-cancel-dialog",
    "Cancellation requires a reason and publishes no valid result.",
  ],
  adminResults: [
    "rwa-admin",
    "14-desktop-results",
    "Review the same authorised result projection used for downloads.",
  ],
  audit: [
    "rwa-admin",
    "39-audit",
    "Inspect administrative actions, reasons and times in Audit History.",
  ],
} as const;

export type GuideImage = keyof typeof GUIDE_IMAGES;

export function guideImagePath(image: GuideImage): string {
  const [persona, name] = GUIDE_IMAGES[image];
  return `/guides/${persona}/${name}.png`;
}
