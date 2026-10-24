import { createHash, randomBytes } from "node:crypto";

/*
 * Pure CSRF helpers with no framework imports, so they can be shared by the
 * server modules, the proxy and end-to-end tests. See browser-protection.ts
 * for how they are used.
 */
const CSRF_DOMAIN = "civic-pulse:csrf:v1:";
export const CSRF_HEADER = "x-csrf-token";

// Set by the proxy on every page request so the page can render the token even
// when the cookie was only just created. The proxy always overwrites any value
// a client sends.
export const CSRF_CONTEXT_HEADER = "x-cp-csrf-context";

// Contexts are replaced at sign-in and sign-out; this bounds an unused one.
export const CSRF_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

export function csrfCookieName(production: boolean): string {
  return production ? "__Host-cp_csrf" : "cp_csrf";
}

export function createCsrfContext(): string {
  return randomBytes(32).toString("base64url");
}

// Only well-formed contexts (32 random bytes, base64url) are accepted.
export function isValidCsrfContext(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

export function csrfTokenFor(context: string): string {
  return createHash("sha256")
    .update(CSRF_DOMAIN + context)
    .digest("base64url");
}
