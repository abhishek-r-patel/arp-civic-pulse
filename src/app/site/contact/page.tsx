// Main product website contact page: a plain email link, no form or stored message.
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { PublicStructuredData } from "@/components/ui/public-structured-data";
import { mainSiteLinks, requireMainHost } from "@/server/site/main-host";
import { mainPublicMetadata } from "@/shared/metadata";

export const metadata = mainPublicMetadata("/contact");

/*
 * The main website has no database, so it cannot rate-limit a form. Enquiries
 * use the visitor's own email client instead; nothing is sent or stored here.
 */
export default async function MainContactPage() {
  await requireMainHost();
  const { salesEmail } = mainSiteLinks();
  const subject = encodeURIComponent("Civic Pulse enquiry");

  return (
    <div className="mx-auto grid w-full max-w-ballot gap-6">
      <PublicStructuredData path="/contact" />
      <PageHeader
        title="Contact sales"
        description="Ask about Civic Pulse for your Resident Welfare Association. Annual plans are quoted per association."
      />
      {salesEmail ? (
        <div className="grid gap-3 text-body text-muted">
          <p>
            Email{" "}
            <a
              href={`mailto:${salesEmail}?subject=${subject}`}
              className="font-semibold text-accent underline"
            >
              {salesEmail}
            </a>{" "}
            with your association&apos;s name, city and roughly how many homes
            it has. We will reply with a quote and next steps.
          </p>
          <p>
            Already a customer? Use the Contact page on your association&apos;s
            own Civic Pulse site, or speak to your RWA administrator.
          </p>
        </div>
      ) : (
        <Notice heading="Enquiries are not open yet">
          The sales contact address has not been published yet. Please check
          back soon.
        </Notice>
      )}
      <Notice tone="warning" heading="Never send sign-in codes">
        Civic Pulse will never ask for a sign-in code, a password or how you
        voted.
      </Notice>
    </div>
  );
}
