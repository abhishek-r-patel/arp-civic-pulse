import "server-only";
import { notFound, redirect } from "next/navigation";
import { getSessionState } from "@/server/authorization/account";
import { createAdminClient, createUserClient } from "@/server/db/clients";
import { getCsrfToken } from "@/server/http/csrf-cookie";
import type { RegisterDeps } from "@/server/register/shared";

/*
 * Page-level guard for administrator screens. The session was verified once for
 * this request (getSessionState is cached); data access still runs under the
 * administrator's own session, so RLS and the guarded routines re-check the
 * caller. Anyone who is not a current administrator gets a plain not-found.
 */
export async function adminPageContext(): Promise<
  RegisterDeps & { csrfToken: string | undefined }
> {
  const session = await getSessionState();
  if (session.state !== "account") {
    redirect("/sign-in");
  }
  if (!session.account.isAdmin) {
    notFound();
  }

  return {
    client: await createUserClient(),
    admin: createAdminClient(),
    actor: session.account,
    csrfToken: await getCsrfToken(),
  };
}

/*
 * Page-level guard for resident screens: any verified, enabled account. Whether
 * a particular vote is visible is decided by the database from the frozen
 * electorate, never by this layer.
 */
export async function memberPageContext(): Promise<
  RegisterDeps & { csrfToken: string | undefined }
> {
  const session = await getSessionState();
  if (session.state !== "account") {
    redirect("/sign-in");
  }

  return {
    client: await createUserClient(),
    admin: createAdminClient(),
    actor: session.account,
    csrfToken: await getCsrfToken(),
  };
}
