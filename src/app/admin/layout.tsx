// Explain committee observer and App Support access; page, API and database guards remain authoritative.
import type { ReactNode } from "react";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { getSessionState } from "@/server/authorization/account";
import { loadAppSupportActive } from "@/server/settings/app-support";

export default async function ManagementLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const session = await getSessionState();
  const account = session.state === "account" ? session.account : null;
  // Administrators always see when outside support can read their RWA data.
  const supportActive =
    account?.isAdmin === true && (await loadAppSupportActive());
  return (
    <div className="grid gap-6">
      {account?.isAppSupport ? (
        <Notice tone="info" heading="App Support Access">
          This RWA has granted you temporary read-only access. You cannot make
          changes or vote, and an RWA Admin can turn this access off at any
          time.
        </Notice>
      ) : account?.isReadonly ? (
        <Notice tone="info" heading="RWA ReadOnly">
          Management changes require the RWA Admin role. Your own voting access
          is unchanged.
        </Notice>
      ) : null}
      {supportActive ? (
        <Notice tone="warning" heading="App Support Access Is On">
          The app developer can currently view this RWA&apos;s data read-only.{" "}
          <Link
            href="/admin/settings#app-support"
            className="font-semibold underline underline-offset-2"
          >
            Turn it off in Settings
          </Link>{" "}
          when you no longer need help.
        </Notice>
      ) : null}
      {children}
    </div>
  );
}
