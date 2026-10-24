import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getEnvironment } from "@/server/config/environment";
import { ApiError } from "@/server/http/errors";

function publicConfiguration(): { url: string; key: string } {
  const {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
  } = getEnvironment();
  // Missing configuration is a deployment fault, not a client error.
  if (!url || !key) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE");
  }
  return { url, key };
}

/*
 * Server client that carries the verified user's Supabase session through the
 * SDK's cookie integration. It uses only the public key: authorization is
 * decided by RLS and guarded SQL, never by this client. Cookies are written
 * HttpOnly because no browser-side Supabase client is used; Secure in
 * production.
 */
export async function createUserClient(): Promise<SupabaseClient> {
  const { url, key } = publicConfiguration();
  const store = await cookies();
  const secure = getEnvironment().NODE_ENV === "production";

  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          store.set(name, value, {
            ...options,
            // The PKCE verifier is only needed briefly; don't keep it for the SDK's default ~400 days.
            ...(name.includes("code-verifier") &&
              value !== "" && { maxAge: 10 * 60 }),
            httpOnly: true,
            secure,
            sameSite: "lax",
            path: "/",
          });
        }
      },
    },
  });
}

/*
 * Privileged client for server-only Auth administration and provisioning
 * routines. It bypasses RLS, so it is never used for ballots, results, exports
 * or any user-scoped read, and is never constructed for a browser.
 */
export function createAdminClient(): SupabaseClient {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } =
    getEnvironment();
  if (!url || !key) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
