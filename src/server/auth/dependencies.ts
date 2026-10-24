import "server-only";
import { createAdminClient, createUserClient } from "@/server/db/clients";
import type { AuthDependencies } from "@/server/auth/otp";
import { getEnvironment } from "@/server/config/environment";
import { assertBrowserMutation } from "@/server/http/browser-protection";
import { readCsrfContext } from "@/server/http/csrf-cookie";

export async function authDependencies(): Promise<AuthDependencies> {
  return { client: await createUserClient(), admin: createAdminClient() };
}

// Every browser mutation requires an exact Origin match plus the CSRF token.
export async function assertAuthMutationAllowed(
  request: Request,
): Promise<void> {
  assertBrowserMutation(request, {
    appOrigin: getEnvironment().APP_ORIGIN,
    csrfContext: await readCsrfContext(),
  });
}
