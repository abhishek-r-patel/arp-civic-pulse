// Public privacy notice reflecting implemented data handling without promising cryptographic anonymity.
import Link from "next/link";
import { PageHeader } from "@/components/ui/layout";
import { PublicStructuredData } from "@/components/ui/public-structured-data";
import { publicMetadata } from "@/shared/metadata";
import {
  loadHouseholdTerms,
  loadPublicRwaIdentity,
} from "@/server/settings/rwa-profile";

export const metadata = publicMetadata("/privacy");

export default async function PrivacyPage() {
  const [identity, terms] = await Promise.all([
    loadPublicRwaIdentity(),
    loadHouseholdTerms(),
  ]);

  return (
    <article className="mx-auto grid w-full max-w-ballot gap-6 text-body text-muted lg:max-w-4xl">
      <PublicStructuredData path="/privacy" />
      <PageHeader
        title="Privacy policy"
        description="Last updated: 26 October 2026"
      />
      <p>
        Civic Pulse helps your Resident Welfare Association (RWA) run polls and
        elections. Your RWA manages its register of {terms.households} and
        member access.
      </p>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          Who is responsible?
        </h2>
        {identity ? (
          <>
            <p>
              The organisation responsible for this service is listed below. Ask
              your RWA administrator about the policies that apply to your
              association.
            </p>
            <div className="grid gap-1">
              <p className="font-semibold text-primary">
                {identity.fullName} ({identity.alias})
              </p>
              {identity.address ? (
                <address className="whitespace-pre-line not-italic">
                  {identity.address}
                </address>
              ) : null}
            </div>
          </>
        ) : (
          <p>
            Ask your RWA administrator which organisation runs this service and
            what policies apply to your association.
          </p>
        )}
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          Information we collect
        </h2>
        <p>
          We use registered email addresses, representative names,{" "}
          {terms.household} membership, account roles and status to manage
          accounts and voting eligibility. We also record participation, vote
          settings, completed results and administrative audit records. Only
          registered members can sign in.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          How we use your information
        </h2>
        <p>
          We use this information to provide account access, check who can vote,
          run polls and elections, show results to people who are allowed to see
          them, and keep a record of administrative changes.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          How voting privacy works
        </h2>
        <p>
          In PUBLIC polls, authorised members can see who chose each option
          after the poll ends. PRIVATE elections store who took part and totals
          for each choice, but do not store an individual ballot linked to a
          person&apos;s choice. This is not a promise of complete anonymity:
          system operators or people in a very small election may still work out
          how someone voted. Choice totals are hidden while voting is open.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          Cookies and browser storage
        </h2>
        <p>
          Essential cookies help you sign in and protect the service. They are
          not used for advertising. If Google Analytics is enabled for your RWA,
          it runs only on the Privacy and Contact pages after you allow it. It
          records visits to those pages, not form messages, email addresses, URL
          query values, sign-in activity or votes. Google may also process
          technical device and network information, such as IP addresses, under
          its own policies. You can refuse or turn off analytics using the
          control on either page.
        </p>
        <p>
          Your Light, Dark or System appearance choice and Residents table
          column choice are saved in this browser only. They are not linked to
          your account and do not contain voting selections. Clearing browser
          storage resets these choices. If storage is blocked, a choice may last
          only for the current page.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          How we share information
        </h2>
        <p>
          If online contact is available, your name, reply email and message are
          sent through Resend to the configured administrator mailbox. Contact
          messages are not saved in the Civic Pulse database. Do not send ballot
          choices, sign-in codes, passwords or identity documents.
        </p>
        <p>
          Supabase provides sign-in and database services, and the hosting
          provider serves the application. RWA administrators and necessary
          service providers handle information to run and protect the service.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          How long we keep information
        </h2>
        <p>
          Register details, voting records, audit history, contact messages and
          encrypted backups may be kept for different periods. Ask your RWA
          administrator about the approved retention periods, hosting regions
          and service providers for your association.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          Security and your requests
        </h2>
        <p>
          Access is limited based on account and {terms.household} eligibility.
          You can ask your RWA administrator to access or correct your register
          details, raise a concern or request deletion. Requests are reviewed
          against voting integrity, historical records and applicable
          requirements. No online service can promise complete security.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          Questions or requests?
        </h2>
        <p>
          Contact your{" "}
          <Link href="/contact" className="text-accent underline">
            RWA administrator
          </Link>{" "}
          with privacy questions or requests. Registered members can also{" "}
          <a href="/sign-in" className="text-accent underline">
            sign in to Civic Pulse
          </a>
          .
        </p>
      </section>
    </article>
  );
}
