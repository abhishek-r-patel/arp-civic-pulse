// End-to-end resident instructions; live RWA terminology stays consistent with the application.
import type { HouseholdTerms } from "@/shared/contracts/household-terms";
import { Note, Screenshot, Steps, type GuideSection } from "./guide";

export function residentSections(terms: HouseholdTerms): GuideSection[] {
  return [
    {
      id: "before-you-start",
      title: "Before you start",
      content: (
        <>
          <p>
            Civic Pulse runs polls and elections for your RWA. One enabled
            representative votes for each selected {terms.household}. Signing in
            does not automatically make you eligible for every vote.
          </p>
          <Note>
            Pictures use synthetic people and example data. Emails and sign-in
            codes are masked. Read your live screen for the real RWA name,{" "}
            {terms.identifierLabel}, dates and deadlines. Confirmation pictures
            show only the popup. Some connection/code errors are deliberately
            simulated; screenshots do not prove email delivery or production
            readiness.
          </Note>
          <p>
            PUBLIC polls allow response changes until closing and publish
            authorised named responses after completion. PRIVATE elections
            accept one final submission and publish aggregate results only.
            PRIVATE means application-level privacy, not cryptographic anonymity
            from infrastructure operators or inference in very small elections.
          </p>
        </>
      ),
    },
    {
      id: "registration",
      title: "1. Register and wait for approval",
      content: (
        <>
          <Steps>
            <li>
              Open{" "}
              <a href="/register" className="text-accent underline">
                Register
              </a>{" "}
              from the footer or sign-in page. If your administrator already
              registered you, skip to sign-in; do not create another account.
            </li>
            <li>
              Enter your full name, email and {terms.identifierLabel}. If a
              configured list appears, choose your entry. Ask an administrator
              to add a missing entry rather than choosing another person&apos;s.
            </li>
            <li>
              Select <strong>Register</strong>. A received message means your
              details were saved, not that sign-in or voting is enabled.
            </li>
            <li>
              Your administrator checks your details, enables the account and
              separately approves {terms.household} voting eligibility. Wait for
              their confirmation before signing in.
            </li>
          </Steps>
          <Screenshot image="registration" />
          <Screenshot image="registered" />
          <p>
            An already-registered email or identifier is not solved by adding
            spaces or using a second identity. Ask your RWA administrator to
            find the original account and correct it.
          </p>
        </>
      ),
    },
    {
      id: "sign-in",
      title: "2. Sign in with an email code",
      content: (
        <>
          <Steps>
            <li>
              Open{" "}
              <a href="/sign-in" className="text-accent underline">
                Sign In
              </a>
              , enter your registered email and select{" "}
              <strong>Send Sign-In Code</strong>. There is no application
              password.
            </li>
            <li>
              Open the newest email, enter its six-digit code and select{" "}
              <strong>Verify and Sign In</strong>. Never share the code.
            </li>
            <li>
              If it expires, wait for the displayed cooldown and request a new
              one. Check spam and the address; repeated requests do not
              guarantee delivery. A generic message does not confirm whether an
              account exists.
            </li>
            <li>
              If you see <strong>Too many requests</strong>, wait about 15
              minutes and try again. Many neighbours signing in over the same
              shared Wi-Fi count together, so switching to mobile data may also
              help.
            </li>
          </Steps>
          <Screenshot image="signIn" />
          <Screenshot image="code" />
          <Screenshot image="codeError" />
          <p>
            A suspended or deleted account cannot be restored by requesting
            another code. Contact your administrator.
          </p>
        </>
      ),
    },
    {
      id: "find-votes",
      title: "3. Find the vote and check its status",
      content: (
        <>
          <Steps>
            <li>
              On <strong>Votes</strong>, review the overview, type/status
              filters and available votes. Use pagination for longer lists;
              changing filters starts at page 1.
            </li>
            <li>
              Open the intended vote. Check its title, instructions, type,
              opening time and closing deadline in the RWA time zone.
            </li>
            <li>
              <strong>Scheduled</strong> means not open yet.{" "}
              <strong>Active</strong> permits voting if you have the frozen
              entitlement. <strong>Completed</strong> permits authorised
              results. <strong>Cancelled</strong> has no valid result. Drafts
              are not visible to residents.
            </li>
          </Steps>
          <Screenshot image="votes" />
          <Screenshot image="scheduledResident" />
          <Note>
            Eligibility and the representative are fixed when an administrator
            activates or schedules the vote. Later account assignments do not
            move those rights. Clear filters before reporting a missing vote.
            Ask the administrator to check the frozen electorate; no role or URL
            grants an extra vote.
          </Note>
          <p>
            The countdown is informational. The database decides whether a
            submission arrived before the current deadline. Do not wait until
            the last seconds.
          </p>
        </>
      ),
    },
    {
      id: "public-voting",
      title: "4. Vote in a PUBLIC poll",
      content: (
        <>
          <Steps>
            <li>
              Read the background and privacy notice. A PUBLIC response will be
              attributable in authorised completed results.
            </li>
            <li>
              Select one radio option, or check the allowed options in a
              multi-select poll. Multi-select needs at least one choice and may
              impose a maximum.
            </li>
            <li>
              Select <strong>Review Selections</strong>, check your choices and
              return to edit if necessary.
            </li>
            <li>
              Select <strong>Submit Vote</strong> once and wait.{" "}
              <strong>Your vote is recorded.</strong> acknowledges committed
              participation.
            </li>
            <li>
              While the poll is active, use the change action to replace your
              response through the same review/submit flow. Only the latest
              option set counts; turnout still counts your {terms.household}{" "}
              once. Changes are impossible after closing.
            </li>
          </Steps>
          <Screenshot image="publicBallot" />
          <Screenshot image="multiBallot" />
          <Screenshot image="publicReview" />
          <Screenshot image="publicRecorded" />
        </>
      ),
    },
    {
      id: "private-voting",
      title: "5. Vote in a PRIVATE election",
      content: (
        <>
          <Steps>
            <li>
              Read the instructions for all offices. Choose exactly one
              candidate or <strong>NOTA (None of the Above)</strong> for every
              office.
            </li>
            <li>
              Select <strong>Review Selections</strong> and check every office
              carefully. Return to edit before submission if necessary.
            </li>
            <li>
              Select <strong>Submit Vote</strong> and wait for{" "}
              <strong>Vote submitted.</strong> This confirms participation, not
              a retrievable selection receipt.
            </li>
          </Steps>
          <Screenshot image="privateBallot" />
          <Screenshot image="privateReview" />
          <Screenshot image="privateRecorded" />
          <Note>
            A PRIVATE submission is final. No administrator can retrieve or edit
            your stored individual choices. NOTA is counted separately and
            cannot win: a positive highest-count candidate wins even when NOTA
            has more votes; candidate ties remain ties, and zero candidate votes
            elect nobody.
          </Note>
        </>
      ),
    },
    {
      id: "uncertain-submission",
      title: "6. Recover from a connection failure",
      content: (
        <>
          <Steps>
            <li>
              A timeout does not prove rejection. Keep the page open and select{" "}
              <strong>Check Again</strong>; do not blindly submit again.
            </li>
            <li>
              If the application confirms participation was recorded, treat the
              submission as accepted. PRIVATE choices cannot be recovered as a
              receipt.
            </li>
            <li>
              Only if it confirms{" "}
              <strong>Your vote has not been recorded yet</strong> and voting
              remains open, select <strong>Review and Try Again</strong>.
            </li>
            <li>
              If status remains unknown, wait and contact your administrator
              with the support/request ID if shown, never your choices or code.
            </li>
          </Steps>
          <Screenshot image="unknown" />
          <Screenshot image="notRecorded" />
        </>
      ),
    },
    {
      id: "live-results",
      title: "7. Watch live results or turnout",
      content: (
        <>
          <p>
            Use <strong>View Live Results</strong> for an active PUBLIC poll,
            even before you vote. You see option totals and turnout, not named
            choices. Use <strong>View Live Turnout</strong> for an active
            PRIVATE election; candidate and NOTA totals remain hidden. Results
            refresh about every ten seconds.
          </p>
          <Screenshot image="publicLive" />
          <Screenshot image="privateLive" />
          <p>
            A row such as Yes 2/4 50% means two of four frozen eligible{" "}
            {terms.households} selected Yes. Multi-select percentages can add up
            to more than 100%. A zero denominator has no meaningful percentage.
            Refresh to see an administrator&apos;s deadline change; the
            application sends no automatic reminder.
          </p>
        </>
      ),
    },
    {
      id: "completed-results",
      title: "8. Read final results and download",
      content: (
        <>
          <Steps>
            <li>
              After completion, open the vote&apos;s results. Expand{" "}
              <strong>Background</strong> or{" "}
              <strong>Instructions for voters</strong> if you need context.
            </li>
            <li>
              PUBLIC results show option totals and authorised{" "}
              <strong>Who chose what</strong> responses. PRIVATE results show
              totals by office and NOTA, never individual selections. Leaders,
              elected candidates and ties are labelled.
            </li>
            <li>
              Use pagination for named responses; on a phone, scroll inside the
              table if necessary. Downloads contain the full authorised result,
              not only the visible page.
            </li>
            <li>
              Choose <strong>CSV</strong> for a spreadsheet or{" "}
              <strong>PDF</strong> for a printable copy if enabled. If PDF
              cannot represent a character, use CSV. A failed download does not
              invalidate a vote; return to results and retry later rather than
              repeatedly starting downloads.
            </li>
          </Steps>
          <Screenshot image="publicResults" />
          <Screenshot image="privateResults" />
          <Screenshot image="cancelled" />
          <Note>
            Share PUBLIC named reports only with authorised people. Downloaded
            files cannot be recalled by signing out. Results are not signatures,
            legal certification, spending authorisation or backups. Cancelled
            votes publish neither results nor downloads.
          </Note>
        </>
      ),
    },
    {
      id: "help-and-sign-out",
      title: "9. Appearance, help and safe sign-out",
      content: (
        <>
          <p>
            The header&apos;s <strong>Appearance</strong> control offers Light,
            Dark and System. The choice is saved in this browser, not your RWA
            profile. Clearing browser storage restores System. Use labelled
            filters and page controls to navigate lists; dropdown values alone
            do not change your permissions.
          </p>
          <Screenshot image="appearance" />
          <p>
            Use{" "}
            <a href="/contact" className="text-accent underline">
              Contact
            </a>{" "}
            for help and{" "}
            <a href="/privacy" className="text-accent underline">
              Privacy Policy
            </a>{" "}
            for data handling. Contact may be unavailable until configured.
            Message accepted means the mail service accepted it, not guaranteed
            inbox delivery. Never include choices, codes, passwords or identity
            documents.
          </p>
          <p>
            Select <strong>Sign Out</strong> on shared devices. Close downloaded
            reports separately. If a vote is missing, a code never arrives or
            results are unavailable, ask your administrator to check the
            specific account/vote rather than creating duplicate registrations
            or attempting administrator URLs.
          </p>
        </>
      ),
    },
  ];
}
