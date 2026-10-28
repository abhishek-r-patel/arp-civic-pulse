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
  "Register as a resident. Your account stays suspended until your RWA administrator enables it.",
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
        description={`Register as a resident of ${organisation}. One account per email address and one per ${terms.household}. Your account stays suspended until your RWA administrator reviews and enables it.`}
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
      <p className="text-body text-muted">
        Already registered?{" "}
        <a href="/sign-in" className="text-accent underline">
          Sign in
        </a>
        . Questions?{" "}
        <a href="/contact" className="text-accent underline">
          Contact us
        </a>
        .
      </p>
      {csrfToken === undefined ? (
        <Notice tone="error" heading="This page could not be prepared">
          Reload the page. If this keeps happening, contact your RWA
          administrator.
        </Notice>
      ) : null}
    </div>
  );
}
