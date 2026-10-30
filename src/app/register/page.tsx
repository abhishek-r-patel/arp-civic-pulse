// Server-rendered public resident self-registration; not crawlable and never grants access by itself.
import { redirect } from "next/navigation";
import { SelfRegistrationForm } from "@/components/access/self-registration-form";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { getSessionState } from "@/server/authorization/account";
import { createAdminClient } from "@/server/db/clients";
import { getCsrfToken } from "@/server/http/csrf-cookie";
import { loadSelfRegistrationHouseholds } from "@/server/register/self-registration";
import {
  loadHouseholdTerms,
  loadPublicRwaIdentity,
} from "@/server/settings/rwa-profile";
import { privateMetadata } from "@/shared/metadata";

export const metadata = privateMetadata(
  "Register",
  "Create an account for your RWA. An administrator must enable it before you can sign in.",
);

export default async function RegisterPage() {
  const session = await getSessionState();
  if (session.state === "account") {
    redirect("/");
  }
  const csrfToken = await getCsrfToken();
  const [identity, terms, households] = await Promise.all([
    loadPublicRwaIdentity(),
    loadHouseholdTerms(),
    loadSelfRegistrationHouseholds(createAdminClient()).catch(() => null),
  ]);
  const organisation = identity
    ? `${identity.fullName} (${identity.alias})`
    : "your Resident Welfare Association";

  return (
    <div className="mx-auto grid w-full max-w-ballot gap-8">
      <PageHeader
        title="Register"
        description={`Create an account for ${organisation} Voting App - Civic Pulse. Each email address and ${terms.household} can be registered once.`}
      />
      {households ? (
        <SelfRegistrationForm
          csrfToken={csrfToken}
          terms={terms}
          households={households}
        />
      ) : (
        <Notice
          tone="warning"
          heading="Registration is temporarily unavailable"
        >
          Try again in a few minutes. If this keeps happening, contact your RWA
          administrator.
        </Notice>
      )}
      {csrfToken === undefined ? (
        <Notice tone="error" heading="This page could not be prepared">
          Reload the page. If this keeps happening, contact your RWA
          administrator.
        </Notice>
      ) : null}
    </div>
  );
}
