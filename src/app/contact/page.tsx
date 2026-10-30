// Server-rendered public support page; sending is enabled only with complete provider configuration.
import { ContactForm } from "@/components/access/contact-form";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { PublicStructuredData } from "@/components/ui/public-structured-data";
import { getSessionState } from "@/server/authorization/account";
import { contactEnabled } from "@/server/contact";
import { createUserClient } from "@/server/db/clients";
import { getCsrfToken } from "@/server/http/csrf-cookie";
import { ApiError } from "@/server/http/errors";
import { log } from "@/server/observability/logger";
import { getEnabledRwaAdminNames } from "@/server/settings/rwa-profile";
import { publicMetadata } from "@/shared/metadata";

export const metadata = publicMetadata("/contact");

export default async function ContactPage() {
  const csrfToken = await getCsrfToken();
  const session = await getSessionState();
  let adminNames: string[] | null = null;
  let adminDirectoryUnavailable = false;
  if (session.state === "account" && !session.account.isAppSupport) {
    try {
      adminNames = await getEnabledRwaAdminNames(await createUserClient());
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      log("warn", "contact.admin_directory_unavailable", {
        code: error.code,
      });
      adminDirectoryUnavailable = true;
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-ballot gap-8">
      <PublicStructuredData path="/contact" />
      <PageHeader
        title="Contact"
        description="Need help with your account, service or privacy? Contact your RWA administrator. This page is not for emergencies."
      />
      {contactEnabled() ? (
        <ContactForm csrfToken={csrfToken} />
      ) : (
        <Notice tone="warning" heading="Online contact is unavailable">
          Contact your RWA administrator directly.
        </Notice>
      )}
      {adminNames ? (
        <section aria-labelledby="rwa-admins" className="grid gap-3">
          <h2 id="rwa-admins" className="text-section font-semibold">
            RWA Admins
          </h2>
          <p className="text-body text-muted">
            Contact an RWA Admin using your usual contact method.
          </p>
          {adminNames.length > 0 ? (
            <ul className="grid gap-2">
              {adminNames.map((name, index) => (
                <li key={`${name}-${index}`} className="text-body">
                  {name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body">No active RWA Admins were found.</p>
          )}
        </section>
      ) : null}
      {adminDirectoryUnavailable ? (
        <Notice
          tone="warning"
          heading="RWA Admin names are unavailable right now"
        >
          Contact your RWA administrator directly.
        </Notice>
      ) : null}
    </div>
  );
}
