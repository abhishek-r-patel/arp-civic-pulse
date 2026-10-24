import { redirect } from "next/navigation";
import { SignInForm } from "@/components/access/sign-in-form";
import { SignOutButton } from "@/components/access/sign-out-button";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { getSessionState } from "@/server/authorization/account";
import { getCsrfToken } from "@/server/http/csrf-cookie";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  const session = await getSessionState();
  if (session.state === "account") {
    redirect("/");
  }
  const csrfToken = await getCsrfToken();

  return (
    <div className="mx-auto grid w-full max-w-ballot gap-8">
      <PageHeader
        title="Sign in"
        description="Civic Pulse is for registered members of your Resident Welfare Association. There is no public sign-up. If you cannot sign in, contact your RWA administrator."
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
      ) : (
        <SignInForm csrfToken={csrfToken} />
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
