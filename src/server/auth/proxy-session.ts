import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import type { TenantContext } from "@/server/config/tenant-context";
import { getEnvironment } from "@/server/config/environment";
import { publicConfiguration } from "@/server/db/clients";
import {
  hardenSessionCookie,
  isTenantSessionCookie,
  sessionCookieName,
  type SessionCookieOptions,
} from "@/server/auth/session-cookies";

/*
 * Keeps a signed-in browser signed in. Access tokens are short-lived; once one
 * is about to expire the SDK must exchange the refresh token for a new pair AND
 * the browser must receive the new cookies. A Server Component cannot set
 * cookies, so without this step every session would end at the first page
 * render after the access token expired (about an hour), and the spent refresh
 * token could never be recovered.
 *
 * This only REFRESHES. It is never authorization: getSession() is not used to
 * decide anything. Every page and API call still verifies the user with the
 * Auth server (getUser) and re-reads the current profile.
 */
export interface RefreshedSession {
  /** The request's Cookie header with the refreshed values, for the page to read. */
  cookieHeader: string;
  /** What to set on the response. */
  setCookies: { name: string; value: string; options: SessionCookieOptions }[];
}

const encode = (value: string) => encodeURIComponent(value);

export async function refreshSessionCookies(
  request: NextRequest,
  tenant: TenantContext,
): Promise<RefreshedSession | null> {
  const configuration = publicConfiguration(tenant);
  if (!configuration || !tenant.tenantId) return null;
  const { url, key } = configuration;
  const secure = getEnvironment().NODE_ENV === "production";
  const cookieName = sessionCookieName(tenant.tenantId, secure);
  // Anonymous visitors and sign-in pages cost nothing: no cookie, no work.
  if (
    !request.cookies
      .getAll()
      .some(({ name }) => isTenantSessionCookie(name, cookieName))
  ) {
    return null;
  }

  const jar = new Map(
    request.cookies.getAll().map(({ name, value }) => [name, value]),
  );
  const setCookies: RefreshedSession["setCookies"] = [];

  const supabase = createServerClient(url, key, {
    cookieOptions: { name: cookieName },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          if (value === "" || options.maxAge === 0) {
            jar.delete(name);
          } else {
            jar.set(name, value);
          }
          setCookies.push({
            name,
            value,
            options: hardenSessionCookie(name, value, options, secure),
          });
        }
      },
    },
  });

  try {
    // Refreshes only when the access token is expired or about to be; otherwise no network call.
    await supabase.auth.getSession();
  } catch {
    // An Auth outage must not break page delivery; the page verifies the user itself.
    return null;
  }
  if (setCookies.length === 0) {
    return null;
  }
  return {
    cookieHeader: [...jar]
      .map(([name, value]) => `${name}=${encode(value)}`)
      .join("; "),
    setCookies,
  };
}
