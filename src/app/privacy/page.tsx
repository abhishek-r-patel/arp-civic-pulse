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
    <article className="mx-auto grid w-full max-w-ballot gap-6 text-body text-muted">
      <PublicStructuredData path="/privacy" />
      <PageHeader
        title="Privacy policy"
        description="Last updated: 26 October 2026"
      />
      <p>
        Civic Pulse supports voting and polls for your Resident Welfare
        Association (RWA). Your RWA administers the register of{" "}
        {terms.households} and member access.{" "}
        {identity
          ? "The organisation responsible for this deployment is shown below. Contact your RWA administrator about its approved data policies."
          : "Contact your RWA administrator to identify the organisation responsible for your deployment and its approved data policies."}
      </p>
      {identity ? (
        <section aria-label="Responsible organisation" className="grid gap-1">
          <p className="font-semibold text-primary">
            {identity.fullName} ({identity.alias})
          </p>
          {identity.address ? (
            <address className="whitespace-pre-line not-italic">
              {identity.address}
            </address>
          ) : null}
        </section>
      ) : null}
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          Information we use
        </h2>
        <p>
          The service uses registered email addresses, representative names,{" "}
          {terms.household} membership, account roles and status to manage
          access and voting eligibility. It records participation, vote
          configuration, completed results and administrative audit events.
          Sign-in is available only to registered members.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          PUBLIC polls and PRIVATE elections
        </h2>
        <p>
          PUBLIC polls retain attributable responses, which authorised members
          can see after completion. PRIVATE elections retain participation and
          aggregate choice counters, not individual stored ballots. This is
          application-level privacy, not cryptographic anonymity: privileged
          operators and very small electorates may still infer information.
          Choice totals are not published while voting is active.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          Cookies and optional analytics
        </h2>
        <p>
          Essential cookies support authentication and request security. They
          are not advertising cookies. If enabled for this deployment, Google
          Analytics runs only on the privacy and contact pages after you choose
          to allow it. It receives only those page paths, not form content,
          email addresses, URL query strings, sign-in activity or voting
          selections. You can refuse or withdraw analytics using the analytics
          control on these public pages. Google may process technical device and
          network information, including IP addresses, under its own policies.
        </p>
        <p>
          Your Light, Dark or System appearance preference is kept in this
          browser&apos;s local storage, separately from analytics consent. It
          contains no account details or voting selections and is not synced
          through your account. Clearing it restores the device-based default;
          if browser storage is blocked, the choice lasts only for the open
          page.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          Contact messages and providers
        </h2>
        <p>
          If online contact is enabled, your name, reply email address and
          message are sent through Resend to the configured administrator
          mailbox. Do not send ballot selections, codes, passwords or identity
          documents. Supabase provides authentication and database services; the
          deployment host serves the application. Authorised administrators and
          necessary service providers process information to operate and protect
          the service. Messages are not saved in the application database.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-section font-semibold text-primary md:text-section-lg">
          Retention, security and your requests
        </h2>
        <p>
          Access is restricted by account and {terms.household} eligibility.
          Audit records, voting data, mailboxes and encrypted backups have
          different retention needs. Ask your RWA administrator for the approved
          retention periods, hosting regions and provider arrangements for your
          association. Requests to access or correct your register details,
          raise a concern, or seek deletion must be assessed against voting
          integrity, historical records and applicable obligations. No service
          can guarantee absolute security.
        </p>
      </section>
      <p>
        For privacy questions,{" "}
        <Link href="/contact" className="text-accent underline">
          contact the administrator
        </Link>
        . Registered members can{" "}
        <a href="/sign-in" className="text-accent underline">
          sign in to Civic Pulse
        </a>
        .
      </p>
    </article>
  );
}
