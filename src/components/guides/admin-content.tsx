// RWA administrator journey ordered from association setup through reviewed final results.
import type { HouseholdTerms } from "@/shared/contracts/household-terms";
import { Note, Screenshot, Steps, type GuideSection } from "./guide";

export function adminSections(terms: HouseholdTerms): GuideSection[] {
  return [
    {
      id: "access-and-responsibility",
      title: "Before you start: administrator access",
      content: (
        <>
          <p>
            Your deployment operator provisions the first administrator; public
            registration never creates an administrator. Sign in with your
            registered email and newest six-digit code. See the{" "}
            <a
              href="/user-guide/resident#sign-in"
              className="text-accent underline"
            >
              illustrated sign-in steps
            </a>
            . Management navigation includes <strong>Residents</strong>,{" "}
            <strong>Manage Votes</strong>, the <strong>Settings</strong> gear
            and <strong>Audit History</strong> icon.
          </p>
          <Note>
            Follow this guide in order for a new RWA: Settings, resident review,
            eligibility, ballot setup, preview, activation/scheduling,
            monitoring, completion and results. The images use disposable
            synthetic data, not your actual association or proof of production
            approval. Confirmation popups are cropped; different values in an
            otherwise identical dropdown are not separate screenshots.
          </Note>
          <p>
            Only RWA Admin can mutate management records. RWA ReadOnly can
            inspect authorised records and downloads but cannot save changes;
            App Support is a separately controlled read-only identity. Neither
            management role grants another {terms.household}&apos;s vote.
            Administrators vote only through their own enabled, frozen
            entitlement.
          </p>
        </>
      ),
    },
    {
      id: "rwa-settings",
      title: "1. Configure the RWA settings first",
      content: (
        <>
          <Steps>
            <li>
              Open <strong>Settings</strong>. Set the RWA full name, alias and
              any address/contact details you want shown. Blank optional values
              stay hidden.
            </li>
            <li>
              Choose an accent colour, welcome message, the label for a{" "}
              {terms.household} and Number/ID identifier wording. These change
              presentation, not stored identifiers or voting rights.
            </li>
            <li>
              Set <strong>Default Households</strong> to the allowed identifiers
              if residents should choose from a list. A non-empty list restricts
              public registration and assignment pickers; an empty list permits
              typed identifiers. This list is visible on the public registration
              page, without resident names or assignment information.
            </li>
            <li>
              Set <strong>RWA Positions</strong> for suggested election offices.
              Save and check the resulting identity/wording on Votes. Lists are
              suggestions/configuration, not automatically created resident
              assignments or election offices.
            </li>
          </Steps>
          <Screenshot image="settings" />
          <p>
            Default Households permits up to 1000 distinct identifiers (100
            characters each); RWA Positions permits up to 50 distinct names (200
            characters each). The welcome message appears on Votes, not
            management lists. Current branding applies even to older results;
            historical vote snapshots remain internal.
          </p>
          <Note>
            The operator configures time zone, policy approvals, retention,
            Auth, email and deployment environment through controlled setup. A
            visually ready Settings page does not certify these launch gates.
            Resolve activation blockers with the operator; do not enter
            fictitious approvals.
          </Note>
        </>
      ),
    },
    {
      id: "add-residents",
      title: "2. Add residents and assign their identifier",
      content: (
        <>
          <Steps>
            <li>
              Open <strong>Residents → Add Resident</strong>. Enter the email
              and resident name; choose Voter, RWA Admin or RWA ReadOnly.
            </li>
            <li>
              A Voter must have a {terms.household} assigned. Choose an
              unassigned configured {terms.identifierLabel}, or type it when no
              default list is configured. Add a missing identifier in Settings
              first. Management accounts may intentionally have no assignment
              and therefore no vote.
            </li>
            <li>
              Independently approve <strong>Eligible to vote</strong> for future
              votes and <strong>Enable account now</strong> for sign-in. Both
              start off. Check identity before enabling an account with
              management privileges.
            </li>
            <li>
              Select <strong>Create Resident</strong> and review the saved
              status and assignment. If provisioning or enablement is
              incomplete, follow the explicit recovery message rather than
              creating a duplicate.
            </li>
          </Steps>
          <Screenshot image="createResident" />
          <Screenshot image="residentCreated" />
          <p>
            One representative account belongs to each {terms.household}.
            Access, current eligibility and a particular vote&apos;s frozen
            entitlement are three different checks. The final enabled
            administrator cannot be removed.
          </p>
        </>
      ),
    },
    {
      id: "review-registrations",
      title: "3. Review registrations and grant access",
      content: (
        <>
          <Steps>
            <li>
              Residents may register themselves at{" "}
              <a href="/register" className="text-accent underline">
                Register
              </a>
              . They start as suspended Voters with an assigned but ineligible{" "}
              {terms.household}.
            </li>
            <li>
              On Residents, open <strong>Sort &amp; Filter</strong> and select
              Source: Self-registered and Status: Suspended. Verify their name,
              email and identifier against your RWA records.
            </li>
            <li>
              Select verified rows and choose <strong>Make Eligible</strong> for
              future voting, then separately <strong>Enable Selected</strong>{" "}
              for sign-in. Read each confirmation. Either action alone does not
              grant the other permission.
            </li>
            <li>
              Review per-account outcomes. Each request commits separately; a
              later failure does not roll back earlier successes. Refresh and
              recheck before retrying an incomplete batch.
            </li>
          </Steps>
          <Screenshot image="selfRegistered" />
          <Screenshot image="eligible" />
          <Screenshot image="enable" />
          <p>
            Select All covers only actionable rows on the current page;
            selections clear when filters, sort, page or page size changes. The
            default role filter is Voter. Choose All Roles explicitly to include
            management accounts; enabling administrators displays an additional
            warning. Unknown registrations can remain suspended while you
            investigate.
          </p>
        </>
      ),
    },
    {
      id: "manage-residents",
      title: "4. Manage residents, roles and eligibility",
      content: (
        <>
          <p>
            Use Residents filters to find names, identifiers, roles, status,
            eligibility, source or a Last Changed range. Name/identifier
            matching is case-insensitive and literal: type a partial value, not
            wildcards. Name search does not search email. Filters and sorting
            apply before pagination. Clear filters returns to Voters and page 1
            while preserving ordering and page size.
          </p>
          <Screenshot image="residents" />
          <Screenshot image="residentFilters" />
          <Steps>
            <li>
              Open a row&apos;s <strong>Manage</strong> action. Save identity or
              role edits explicitly. The top close/navigation control leaves
              without saving unsent changes.
            </li>
            <li>
              Use <strong>Change eligibility</strong>, then{" "}
              <strong>Save Changes</strong> or Cancel. This affects future
              selections, never an existing frozen electorate.
            </li>
            <li>
              To correct an assignment, choose an unused identifier and confirm{" "}
              <strong>Move {terms.Household}</strong>. Moving frees the old
              identifier and preserves current eligibility, but cannot transfer
              scheduled, active or past vote rights.
            </li>
          </Steps>
          <Screenshot image="manageResident" />
          <Screenshot image="move" />
          <p>
            On phones, the table keeps key columns visible. Use Columns for
            optional fields, and scroll inside the table instead of the page.
            Column preferences are browser-local. Last Changed uses the device
            time zone (UTC until browser hydration); voting deadlines use the
            RWA time zone.
          </p>
          <Note>
            Changing an email crosses Supabase Auth and application records; it
            is not one distributed transaction. If a partial-failure warning
            appears, resolve it before telling the resident to use the new
            address. Never delete a replacement identity to conceal an uncertain
            outcome.
          </Note>
        </>
      ),
    },
    {
      id: "import-residents",
      title: "5. Import a resident CSV safely",
      content: (
        <>
          <Steps>
            <li>
              From Residents choose <strong>Import CSV</strong>. Prepare at most
              500 records / 256 KiB with columns{" "}
              <code className="break-all">
                identifier,representative_name,email,is_eligible
              </code>
              .
            </li>
            <li>
              Browse to the file, select <strong>Check Register</strong> and
              inspect every preview row. Nothing is imported yet. Exact matches
              are skipped; conflicts never overwrite identities, assignments,
              roles, eligibility or access.
            </li>
            <li>
              Confirm <strong>Import Residents</strong>. Inspect successes,
              skips and failures. A provider/connection failure may stop later
              rows; recheck the file against the register before retrying.
            </li>
            <li>
              Use <strong>Review Resident</strong>, check identity and
              explicitly enable sign-in afterwards. Imported accounts remain
              suspended even when their CSV eligibility is true.
            </li>
          </Steps>
          <Screenshot image="importPreview" />
          <Screenshot image="importConfirm" />
          <Screenshot image="importResult" />
          <p>
            The CSV preview stays in page memory, not browser storage. Treat
            resident CSVs as personal data; do not use production files for
            testing or share them publicly.
          </p>
        </>
      ),
    },
    {
      id: "suspend-delete-support",
      title: "6. Suspend, delete and control support access",
      content: (
        <>
          <p>
            <strong>Suspend Account</strong> is a reversible access block.{" "}
            <strong>Delete Account</strong> is irreversible in the application
            and blocks sign-in, voting, PUBLIC response changes and signed-in
            results even for existing sessions. Neither erases accepted
            participation, audit history or the current assignment. Use
            suspension when a reversible block is enough. Account-state actions
            do not save pending detail edits.
          </p>
          <Screenshot image="suspend" />
          <Screenshot image="deleteResident" />
          <p>
            In Settings, <strong>App Support Access</strong> is available only
            when an operator configured a support contact. Turn it on when
            assistance is needed, then off afterwards. Support signs in as
            itself and can read settings, the register, votes, participation,
            authorised results and audit history. It cannot change data, vote or
            retrieve PRIVATE choices. Both access changes are audited; the
            support identity is managed here, not in the resident editor.
          </p>
        </>
      ),
    },
    {
      id: "prepare-vote",
      title: "7. Create and save a complete vote draft",
      content: (
        <>
          <Steps>
            <li>
              Open <strong>Manage Votes → New Vote</strong>. Choose PUBLIC
              Voting for a community poll or PRIVATE Voting for an office
              election, then Create Draft. Type and lifecycle status are
              separate.
            </li>
            <li>
              Fill the title and background/instructions. PUBLIC needs at least
              two distinct options; choose exactly-one or multi-select.
              Multi-select requires at least one choice and may set a maximum of
              2–100, or no maximum.
            </li>
            <li>
              PRIVATE needs at least one office and one named candidate per
              office. Use RWA Positions suggestions or Add All Positions. NOTA
              is supplied automatically; do not add it as a candidate. Unopposed
              offices are allowed.
            </li>
            <li>
              Arrange options/offices/candidates using drag handles, or focus a
              handle and press Alt+Arrow Up/Down. Remove items with the adjacent
              bin icon.
            </li>
            <li>
              Set Voting opens (optional) and Voting closes using the RWA-zone
              date/time picker, including AM/PM. Apply saves the picker value;
              save the draft to persist it. The suggested closing time is not
              stored until you save.
            </li>
            <li>
              Under Who Can Vote select the intended eligible {terms.households}{" "}
              and verify the final count and representatives. Filters change
              visible rows; Select all eligible may include more than the
              displayed page. A lock warns that an account is not enabled.
            </li>
            <li>
              Save. If another administrator changed the revision, reload and
              review instead of overwriting. Drafts are not visible to
              residents.
            </li>
          </Steps>
          <Screenshot image="voteTypes" />
          <Screenshot image="publicDraft" />
          <Screenshot image="privateDraft" />
          <p>
            Wrong type? Cancel Vote can remove a just-created draft; otherwise
            it discards unsaved edits and keeps the saved draft. The explicit
            delete-draft bin action requires confirmation and only deletes
            drafts; it never deletes a live or terminal vote.
          </p>
          <Screenshot image="deleteDraft" />
        </>
      ),
    },
    {
      id: "preview-and-activate",
      title: "8. Preview and activate immediately",
      content: (
        <>
          <Steps>
            <li>
              Open <strong>Preview Ballot</strong>, or{" "}
              <strong>Save and Preview</strong>
              when edits remain. Inspect exactly what residents will see, the
              electorate count, times and Summary readiness.
            </li>
            <li>
              Resolve all blockers: ballot content, selected eligible
              representatives, a future closing deadline, and
              operator-controlled policy/retention prerequisites.
            </li>
            <li>
              For immediate opening, choose <strong>Activate Vote</strong>, read
              the freeze warning and confirm the same previewed revision.
            </li>
          </Steps>
          <Screenshot image="preview" />
          <Screenshot image="activate" />
          <Note>
            Activation freezes the ballot/type, electorate, representatives and
            historical names. Register edits cannot rewrite these. After
            activation only the guarded active-deadline workflow can change the
            deadline. Ready preview means implementation checks passed for that
            revision, not governance or launch approval.
          </Note>
        </>
      ),
    },
    {
      id: "schedule",
      title: "9. Schedule opening or return to draft",
      content: (
        <>
          <Steps>
            <li>
              Save a future Voting opens time and a later closing time. A saved
              plan alone does not schedule or freeze a draft.
            </li>
            <li>
              From the ready preview choose <strong>Schedule Vote</strong>, then{" "}
              <strong>Freeze and Schedule</strong>. The saved opening time is
              used; there is no second opening-time field.
            </li>
            <li>
              Check the scheduled state and opening countdown. Residents see
              only the summary, not options/candidates or early submission
              controls.
            </li>
            <li>
              Strictly before opening, choose <strong>Return to Draft</strong>,
              provide the actual reason and confirm. Review/save/preview again
              before rescheduling. At or after opening, withdrawal is refused.
            </li>
          </Steps>
          <Screenshot image="schedule" />
          <Screenshot image="scheduledAdmin" />
          <Screenshot image="withdraw" />
          <p>
            Database time controls opening and closing. A delayed job never
            permits early votes or late submissions; a missed entire window
            completes at the original deadline. Scheduling sends no automatic
            resident reminders.
          </p>
        </>
      ),
    },
    {
      id: "monitor",
      title: "10. Monitor turnout and participation",
      content: (
        <>
          <Steps>
            <li>
              Use Manage Votes to find the vote. Title/type/status/date filters
              and sorting apply across all pages. Turnout is submitted / frozen
              eligible, not current register size.
            </li>
            <li>
              Open the active vote, then Participation for follow-up. Show all,
              submitted or not submitted. Changing Show applies immediately;
              Clear restores all.
            </li>
            <li>
              Use active PUBLIC results for aggregate option totals. Active
              PRIVATE pages show turnout only, never candidate/NOTA totals. No
              participation screen reveals choices.
            </li>
          </Steps>
          <Screenshot image="active" />
          <Screenshot image="participation" />
          <p>
            Participation names and identifiers come from the frozen electorate.
            Follow up through your approved RWA process without asking residents
            to disclose choices. Observe the current deadline and refresh when
            it changes.
          </p>
        </>
      ),
    },
    {
      id: "change-deadline",
      title: "11. Change an active deadline",
      content: (
        <>
          <Steps>
            <li>
              While the vote is active and still before its current deadline,
              choose <strong>Change Deadline</strong>.
            </li>
            <li>
              Enter the new deadline in the RWA time zone, at least five minutes
              in the future, and a meaningful reason. Read the change summary
              and confirm.
            </li>
            <li>
              Check the saved time and Audit History. There is no maximum
              extension/count of changes; governance approval remains your
              responsibility. Residents see the change on refresh, without an
              automatic notification.
            </li>
          </Steps>
          <Screenshot image="deadline" />
          <p>
            This cannot reopen a completed/cancelled vote or change its
            ballot/electorate. The browser countdown never decides admission.
          </p>
        </>
      ),
    },
    {
      id: "finish-or-cancel",
      title: "12. Complete early or cancel with a reason",
      content: (
        <>
          <p>
            Normally let the vote reach its deadline. To finish early, obtain
            the required RWA authorisation, choose{" "}
            <strong>Complete Vote Early</strong>, enter a reason and confirm.
            Completion is final. To observe live totals, use live results rather
            than ending the vote.
          </p>
          <Screenshot image="complete" />
          <p>
            If the vote must be invalidated, choose <strong>Cancel Vote</strong>
            , provide the actual reason and confirm. Cancelled votes publish
            neither results nor downloads. There is no reopen operation and no
            editing accepted PRIVATE submissions.
          </p>
          <Screenshot image="cancel" />
        </>
      ),
    },
    {
      id: "results-and-audit",
      title: "13. Review final results, exports and audit",
      content: (
        <>
          <Steps>
            <li>
              After completion, open Results. PUBLIC shows totals and authorised
              named final responses. PRIVATE shows aggregate candidates/NOTA per
              office. A positive highest-count candidate wins even when NOTA has
              more votes; candidate ties remain ties, and zero candidate votes
              elect nobody.
            </li>
            <li>
              Check turnout against the frozen electorate. Multi-select option
              percentages can exceed 100% in total. Screen and downloads use the
              same validated projection; never repair or estimate totals
              manually.
            </li>
            <li>
              Download CSV, or PDF if enabled. Files contain the full authorised
              result, not only the current page. Protect named PUBLIC reports;
              downloaded files cannot be recalled.
            </li>
            <li>
              Open Audit History to inspect Who, Target, Action, Details and
              time. Reasons appear only for actions that recorded them. Search
              filters are case-insensitive; From includes its instant and Before
              excludes it, in your device time zone.
            </li>
          </Steps>
          <Screenshot image="adminResults" />
          <Screenshot image="audit" />
          <p>
            Target IDs and effective/processed times are initially hidden; use
            their Show controls and About this history when investigating
            delayed lifecycle work. Audit contains administrative events, not
            OTPs or PRIVATE selections. Reports are not signatures, legal
            certification, spending authorisation or backups.
          </p>
          <Note>
            If results are withheld, provisioning is partial or a submission
            outcome is unknown, record the safe request/support ID and escalate.
            Do not retry destructive operations blindly, alter database counters
            or reset the database. Sign out on shared devices.
          </Note>
          <p>
            For your own voting journey, follow the{" "}
            <a href="/user-guide/resident" className="text-accent underline">
              Resident guide
            </a>
            ; administrator privileges never bypass entitlement.
          </p>
        </>
      ),
    },
  ];
}
