import "server-only";
import { createAdminClient, createUserClient } from "@/server/db/clients";
import type { AuthDependencies } from "@/server/auth/otp";
import { getRequestTenantContext } from "@/server/config/tenant-context";
import { assertBrowserMutation } from "@/server/http/browser-protection";
import { readCsrfContext } from "@/server/http/csrf-cookie";

export async function authDependencies(): Promise<AuthDependencies> {
  const tenant = await getRequestTenantContext();
  return {
    tenant,
    client: await createUserClient(tenant),
    admin: await createAdminClient(tenant),
  };
}

// Every browser mutation requires an exact Origin match plus the CSRF token.
export async function assertAuthMutationAllowed(
  request: Request,
): Promise<void> {
  const tenant = await getRequestTenantContext();
  assertBrowserMutation(request, {
    appOrigin: tenant.canonicalOrigin,
    csrfContext: await readCsrfContext(),
  });
}
