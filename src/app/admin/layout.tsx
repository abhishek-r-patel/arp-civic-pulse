// Explain committee observer access; page, API and database guards remain authoritative.
import type { ReactNode } from "react";
import { Notice } from "@/components/ui/notice";
import { getSessionState } from "@/server/authorization/account";

export default async function ManagementLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const session = await getSessionState();
  return (
    <div className="grid gap-6">
      {session.state === "account" && session.account.isReadonly ? (
        <Notice tone="info" heading="RWA ReadOnly">
          Management changes require the RWA Admin role. Your own voting access
          is unchanged.
        </Notice>
      ) : null}
      {children}
    </div>
  );
}
