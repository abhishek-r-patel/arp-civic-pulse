import "server-only";
import { cookies } from "next/headers";
import { getEnvironment } from "@/server/config/environment";
import { createCsrfContext } from "@/server/http/browser-protection";

/*
 * Holds the CSRF context secret (docs/API.md section 3.2). The cookie is
 * HttpOnly, SameSite=Strict, and __Host- prefixed (Secure, no Domain, path /)
 * in production, so page script never sees it; the matching token is derived
 * from it and rendered into the server-delivered document. It is replaced on
 * authentication and on sign-out. Cookies can only be written from route
 * handlers or server actions, not while rendering a page.
 */
const MAX_AGE_SECONDS = 12 * 60 * 60;

function cookieName(): string {
  return getEnvironment().NODE_ENV === "production"
    ? "__Host-cp_csrf"
    : "cp_csrf";
}

export async function readCsrfContext(): Promise<string | undefined> {
  const value = (await cookies()).get(cookieName())?.value;
  // Only well-formed contexts are accepted (32 random bytes, base64url).
  return value && /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : undefined;
}

export async function rotateCsrfContext(): Promise<string> {
  const context = createCsrfContext();
  (await cookies()).set(cookieName(), context, {
    httpOnly: true,
    secure: getEnvironment().NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return context;
}
