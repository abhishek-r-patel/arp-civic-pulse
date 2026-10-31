// Server-rendered registered-member entry with public discovery metadata.
import { redirect } from "next/navigation";
import { publicMetadata } from "@/shared/metadata";
import { PublicStructuredData } from "@/components/ui/public-structured-data";
import { SignInForm } from "@/components/access/sign-in-form";
import { DemoPersonaSignIn } from "@/components/demo/demo-persona-sign-in";
import { getRequestTenantContext } from "@/server/config/tenant-context";
import { SignOutButton } from "@/components/access/sign-out-button";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { getSessionState } from "@/server/authorization/account";
import { getCsrfToken } from "@/server/http/csrf-cookie";
import {
  loadHouseholdTerms,
  loadPublicRwaIdentity,
} from "@/server/settings/rwa-profile";

export const metadata = publicMetadata("/sign-in");

export default async function SignInPage() {
  const session = await getSessionState();
  if (session.state === "account") {
    redirect("/");
  }
  const csrfToken = await getCsrfToken();
  const demo = (await getRequestTenantContext()).kind === "demo";
  const [identity, terms] = await Promise.all([
    loadPublicRwaIdentity(),
    loadHouseholdTerms(),
  ]);
  const organisation = identity
    ? `${identity.fullName} (${identity.alias})`
    : "your Resident Welfare Association";

  return (
    <div className="mx-auto grid w-full max-w-ballot gap-8">
      <PublicStructuredData path="/sign-in" />
      <PageHeader
        title="Sign in"
        description={`Civic Pulse is for registered members of ${organisation}. Residents need an assigned ${terms.household}; administrators may sign in without one. New residents can register; an RWA administrator must enable the account before it can sign in. If you cannot sign in, contact your RWA administrator.`}
      />

      {session.state === "blocked" ? (
        <Notice
          tone="warning"
          heading="This account cannot use Civic Pulse yet"
        >
          <p>
            You are signed in, but your account is not enabled. Contact your RWA
            administrator, or sign out and try a different email address.
          </p>
          <div className="pt-3">
            <SignOutButton csrfToken={csrfToken} />
          </div>
        </Notice>
      ) : demo ? (
        <DemoPersonaSignIn csrfToken={csrfToken} />
      ) : (
        <SignInForm csrfToken={csrfToken} />
      )}

      {demo ? null : (
        <p className="text-body text-muted">
          New resident?{" "}
          <a href="/register" className="text-accent underline">
            Register
          </a>
          .
        </p>
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
