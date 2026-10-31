/*
 * One definition of how Supabase session cookies are written, shared by the
 * request proxy and the server client so they can never drift apart.
 *
 * The SDK marks its auth cookie as valid for ~400 days. Real access ends when
 * Auth refuses the refresh token, but a cookie that lives for over a year on a
 * shared or lost device is needless exposure, so the browser-side lifetime is
 * capped. The SDK rewrites the cookie each time it refreshes the session (about
 * hourly while the app is in use), so this is a sliding inactivity window, not
 * a fixed deadline. It is a provisional default pending the A4 session policy:
 * native idle/absolute timeouts and single-session enforcement need Supabase
 * Pro or higher and are NOT claimed here.
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
const VERIFIER_MAX_AGE_SECONDS = 10 * 60;

export interface SessionCookieOptions {
  maxAge?: number;
  expires?: Date;
  domain?: string;
  [key: string]: unknown;
}

export function sessionCookieName(tenantId: string, secure: boolean): string {
  if (!/^[a-z0-9-]+$/u.test(tenantId)) {
    throw new Error("Invalid tenant ID for session cookie");
  }
  return `${secure ? "__Host-" : ""}cp-${tenantId}-auth-token`;
}

export function isTenantSessionCookie(
  name: string,
  sessionName: string,
): boolean {
  return name === sessionName || name.startsWith(`${sessionName}.`);
}

export function hardenSessionCookie(
  name: string,
  value: string,
  options: SessionCookieOptions,
  secure: boolean,
): SessionCookieOptions {
  const removing = value === "" || options.maxAge === 0;
  let maxAge = options.maxAge;
  if (!removing) {
    // The PKCE verifier is needed only briefly.
    maxAge = name.includes("code-verifier")
      ? VERIFIER_MAX_AGE_SECONDS
      : Math.min(
          options.maxAge ?? SESSION_COOKIE_MAX_AGE_SECONDS,
          SESSION_COOKIE_MAX_AGE_SECONDS,
        );
  }
  const { expires: _expires, domain: _domain, ...rest } = options;
  void _expires;
  void _domain;
  return {
    ...rest,
    ...(maxAge !== undefined && { maxAge }),
    // No browser-side Supabase client exists, so script never needs these cookies.
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  };
}
