import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getEnvironment } from "@/server/config/environment";
import {
  getRequestTenantContext,
  serviceRoleKeyIsValid,
  type TenantContext,
} from "@/server/config/tenant-context";
import {
  hardenSessionCookie,
  sessionCookieName,
} from "@/server/auth/session-cookies";
import { ApiError } from "@/server/http/errors";

export function publicConfiguration(
  tenant: TenantContext,
): { url: string; key: string } | undefined {
  const { url, key } = {
    url: tenant.projectUrl,
    key: tenant.publishableKey,
  };
  if (tenant.kind === "main") return undefined;
  return url && key ? { url, key } : undefined;
}

function requirePublicConfiguration(tenant: TenantContext): {
  url: string;
  key: string;
} {
  const configuration = publicConfiguration(tenant);
  // Missing configuration is a deployment fault, not a client error.
  if (!configuration) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      cause: { source: "deployment_config", code: "SUPABASE_PUBLIC_CONFIG" },
    });
  }
  return configuration;
}

/*
 * Server client that carries the verified user's Supabase session through the
 * SDK's cookie integration. It uses only the public key: authorization is
 * decided by RLS and guarded SQL, never by this client. Cookies are written
 * HttpOnly because no browser-side Supabase client is used; Secure in
 * production.
 */
export async function createUserClient(
  tenant?: TenantContext,
): Promise<SupabaseClient> {
  const resolvedTenant = tenant ?? (await getRequestTenantContext());
  const { url, key } = requirePublicConfiguration(resolvedTenant);
  const store = await cookies();
  const secure = getEnvironment().NODE_ENV === "production";
  if (!resolvedTenant.tenantId) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      cause: { source: "tenant_config", code: "TENANT_ID_MISSING" },
    });
  }

  return createServerClient(url, key, {
    cookieOptions: {
      name: sessionCookieName(resolvedTenant.tenantId, secure),
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          try {
            store.set(
              name,
              value,
              hardenSessionCookie(name, value, options, secure),
            );
          } catch {
            // A Server Component cannot write cookies. That is safe: the request
            // proxy has already refreshed an expiring session for this request
            // (src/proxy.ts), and route handlers, which can write, take this path.
          }
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
export async function createAdminClient(
  tenant?: TenantContext,
): Promise<SupabaseClient> {
  const resolvedTenant = tenant ?? (await getRequestTenantContext());
  const url = resolvedTenant.projectUrl;
  const key = resolvedTenant.serviceRoleKeyRef
    ? process.env[resolvedTenant.serviceRoleKeyRef]
    : undefined;
  if (
    resolvedTenant.kind === "main" ||
    !url ||
    !key ||
    (resolvedTenant.kind !== "single" && !serviceRoleKeyIsValid(key))
  ) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      cause: {
        source: "deployment_config",
        code:
          resolvedTenant.kind === "main"
            ? "ADMIN_CLIENT_ON_MAIN_HOST"
            : !url
              ? "SUPABASE_URL_MISSING"
              : !key
                ? "SERVICE_KEY_MISSING"
                : "SERVICE_KEY_INVALID",
      },
    });
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
