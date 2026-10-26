// Server-rendered public support page; sending is enabled only with complete provider configuration.
import Link from "next/link";
import { ContactForm } from "@/components/access/contact-form";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { PublicStructuredData } from "@/components/ui/public-structured-data";
import { contactEnabled } from "@/server/contact";
import { getCsrfToken } from "@/server/http/csrf-cookie";
import { publicMetadata } from "@/shared/metadata";

export const metadata = publicMetadata("/contact");

export default async function ContactPage() {
  const csrfToken = await getCsrfToken();
  return (
    <div className="mx-auto grid w-full max-w-ballot gap-8">
      <PublicStructuredData path="/contact" />
      <PageHeader
        title="Contact"
        description="For account access, service questions or privacy enquiries, contact your RWA administrator. This is not an emergency service."
      />
      {contactEnabled() ? (
        <ContactForm csrfToken={csrfToken} />
      ) : (
        <Notice tone="warning" heading="Online contact is not available yet">
          Please contact your RWA administrator using your association&apos;s
          usual contact details.
        </Notice>
      )}
      <p className="text-body text-muted">
        Already registered?{" "}
        <a href="/sign-in" className="text-accent underline">
          Sign in
        </a>
        . Learn how we handle enquiries in our{" "}
        <Link href="/privacy" className="text-accent underline">
          privacy policy
        </Link>
        .
      </p>
    </div>
  );
}
