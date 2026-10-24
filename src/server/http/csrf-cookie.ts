import "server-only";
import { cookies, headers } from "next/headers";
import { getEnvironment } from "@/server/config/environment";
import {
  CSRF_CONTEXT_HEADER,
  CSRF_COOKIE_MAX_AGE_SECONDS,
  createCsrfContext,
  csrfCookieName,
  csrfTokenFor,
  isValidCsrfContext,
} from "@/server/http/csrf";

/*
 * Holds the CSRF context secret (docs/API.md section 3.2). The cookie is
 * HttpOnly, SameSite=Strict, and __Host- prefixed (Secure, no Domain, path /)
 * in production, so page script never sees it; the matching token is derived
 * from it and rendered into the server-delivered document. It is replaced on
 * authentication and on sign-out. Cookies can only be written from route
 * handlers, server actions or the proxy, not while rendering a page; the proxy
 * creates the first context and hands it to the page in a request header.
 */
function production(): boolean {
  return getEnvironment().NODE_ENV === "production";
}

export async function readCsrfContext(): Promise<string | undefined> {
  const value = (await cookies()).get(csrfCookieName(production()))?.value;
  return isValidCsrfContext(value) ? value : undefined;
}

export async function rotateCsrfContext(): Promise<string> {
  const context = createCsrfContext();
  (await cookies()).set(csrfCookieName(production()), context, {
    httpOnly: true,
    secure: production(),
    sameSite: "strict",
    path: "/",
    maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
  });
  return context;
}

/*
 * The token to embed in the current document. The proxy sets the context
 * header on every page request (creating the cookie when absent); the cookie
 * is only a fallback.
 */
export async function getCsrfToken(): Promise<string | undefined> {
  const fromProxy = (await headers()).get(CSRF_CONTEXT_HEADER) ?? undefined;
  const context = isValidCsrfContext(fromProxy)
    ? fromProxy
    : await readCsrfContext();
  return context ? csrfTokenFor(context) : undefined;
}
