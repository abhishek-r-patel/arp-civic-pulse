// Public persona landing page; technical documentation deliberately has no navigation link.
import { Guide, Note } from "@/components/guides/guide";
import { publicMetadata } from "@/shared/metadata";

export const metadata = publicMetadata("/user-guide");

export default function UserGuidePage() {
  return (
    <Guide
      title="User Guide"
      description="Choose your role for a complete illustrated journey, with a table of contents on every guide."
      sections={[
        {
          id: "resident",
          title: "Resident",
          content: (
            <>
              <p>
                Register, get approved, sign in, find your votes, cast PUBLIC
                and PRIVATE ballots, recover safely from a connection failure,
                and read/download results.
              </p>
              <a
                href="/user-guide/resident"
                className="inline-flex touch-target w-fit items-center font-semibold text-accent underline"
              >
                Open the Resident guide
              </a>
              <a
                href="/user-guide/resident#registration"
                className="inline-flex touch-target w-fit items-center text-accent underline"
              >
                Go straight to registration
              </a>
              <a
                href="/user-guide/resident#completed-results"
                className="inline-flex touch-target w-fit items-center text-accent underline"
              >
                Go straight to results
              </a>
            </>
          ),
        },
        {
          id: "rwa-admin",
          title: "RWA Admin",
          content: (
            <>
              <p>
                Configure the RWA first, add/review/import residents, manage
                access and eligibility, prepare and schedule votes, monitor
                participation, close voting and inspect results/audit.
              </p>
              <a
                href="/user-guide/rwa-admin"
                className="inline-flex touch-target w-fit items-center font-semibold text-accent underline"
              >
                Open the RWA Admin guide
              </a>
              <a
                href="/user-guide/rwa-admin#rwa-settings"
                className="inline-flex touch-target w-fit items-center text-accent underline"
              >
                Go straight to RWA setup
              </a>
              <a
                href="/user-guide/rwa-admin#prepare-vote"
                className="inline-flex touch-target w-fit items-center text-accent underline"
              >
                Go straight to vote setup
              </a>
            </>
          ),
        },
        {
          id: "using-the-guides",
          title: "Using these guides",
          content: (
            <>
              <p>
                Choose On this page to jump to a section, or bookmark a section
                URL. Screenshots load only when needed; open an image in a new
                tab for full size. The guide text remains available without
                signing in.
              </p>
              <Note>
                Examples use synthetic data with redacted emails/codes. Read
                live screens for actual settings, deadlines and permissions. RWA
                ReadOnly can inspect authorised management screens but cannot
                change records; this release has dedicated pages for Resident
                and RWA Admin only.
              </Note>
              <p>
                For account help use{" "}
                <a href="/contact" className="text-accent underline">
                  Contact
                </a>
                . Never send ballot choices or sign-in codes.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
