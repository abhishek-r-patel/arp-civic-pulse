// Main product website privacy notice; each RWA site keeps its own policy.
import { PageHeader } from "@/components/ui/layout";
import { PublicStructuredData } from "@/components/ui/public-structured-data";
import { requireMainHost } from "@/server/site/main-host";
import { mainPublicMetadata } from "@/shared/metadata";

export const metadata = mainPublicMetadata("/privacy");

export default async function MainPrivacyPage() {
  await requireMainHost();
  const sectionHeading =
    "text-section font-semibold text-primary md:text-section-lg";

  return (
    <article className="mx-auto grid w-full max-w-ballot gap-6 text-body text-muted lg:max-w-4xl">
      <PublicStructuredData path="/privacy" />
      <PageHeader
        title="Website privacy notice"
        description="This notice covers this product website only."
      />
      <section className="grid gap-2">
        <h2 className={sectionHeading}>What this website collects</h2>
        <p>
          This website has no accounts, sign-in or forms, and it does not store
          anything you type. Our hosting provider keeps short-lived technical
          logs (such as the page requested and the time) to keep the service
          secure and working.
        </p>
        <p>
          If you allow it with the checkbox at the bottom of the page, Google
          Analytics measures visits to this website&apos;s public pages. It is
          off unless you turn it on, and you can turn it off again at any time.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className={sectionHeading}>If you email us</h2>
        <p>
          We use your email only to reply to your enquiry and to prepare a
          quote. We do not sell it or add it to marketing lists.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className={sectionHeading}>Your association&apos;s own site</h2>
        <p>
          Each Resident Welfare Association using Civic Pulse has its own site
          and separate database. Resident and voting information is handled
          there, under that site&apos;s own privacy policy, and is never shared
          with this website or with other associations.
        </p>
      </section>
    </article>
  );
}
