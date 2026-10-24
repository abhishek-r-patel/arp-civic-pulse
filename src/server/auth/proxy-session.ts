import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { getEnvironment } from "@/server/config/environment";
import {
  hardenSessionCookie,
  isSupabaseAuthCookie,
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
): Promise<RefreshedSession | null> {
  // Anonymous visitors and sign-in pages cost nothing: no cookie, no work.
  if (
    !request.cookies.getAll().some(({ name }) => isSupabaseAuthCookie(name))
  ) {
    return null;
  }

  const {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
  } = getEnvironment();
  if (!url || !key) {
    return null;
  }
  const secure = getEnvironment().NODE_ENV === "production";

  const jar = new Map(
    request.cookies.getAll().map(({ name, value }) => [name, value]),
  );
  const setCookies: RefreshedSession["setCookies"] = [];

  const supabase = createServerClient(url, key, {
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
