/*
 * Which paths each kind of host serves (docs/ARCHITECTURE.md, "Host kinds").
 *
 * - The main product website has no RWA backend. It serves only its own pages
 *   (rendered from `src/app/site`) and shared public assets; every RWA route,
 *   sign-in and API other than the health check is a 404 there.
 * - The demo host is a normal, writable RWA site shared by every visitor and
 *   restored by `npm run ops -- demo-reset`. It has no email delivery, so only
 *   the email-dependent writes (code sign-in, self-registration, contact) are
 *   refused there; visitors use the persona sign-in instead.
 * Pure functions so the proxy, the API wrapper and unit tests share one list.
 */

/** Public main-website pages: browser path -> internal `/site` route. */
export const MAIN_SITE_ROUTES: Readonly<Record<string, string>> = {
  "/": "/site",
  "/contact": "/site/contact",
  "/privacy": "/site/privacy",
};

// Shared metadata files and app icons rendered by the root app directory.
const MAIN_PASSTHROUGH = new Set([
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image",
  "/icon.svg",
]);

// Rewriting here (not to an existing page) renders the root 404 page.
export const MAIN_NOT_FOUND_ROUTE = "/site/not-found";

/**
 * Where a main-host page request should be served from: the internal `/site`
 * route, the same path for shared assets, or the 404 route for anything else.
 */
export function mainHostRoute(pathname: string): string {
  const site = MAIN_SITE_ROUTES[pathname];
  if (site) return site;
  if (MAIN_PASSTHROUGH.has(pathname)) return pathname;
  return MAIN_NOT_FOUND_ROUTE;
}

/** API paths the main website answers. Everything else is a 404 there. */
export function mainHostApiAllowed(pathname: string): boolean {
  return pathname === "/api/internal/health";
}

const DEMO_EMAIL_PATHS = new Set([
  "/api/auth/code",
  "/api/auth/verify",
  "/api/register",
  "/api/contact",
]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The demo accepts every request except writes that would need email delivery. */
export function demoRequestAllowed(method: string, pathname: string): boolean {
  return (
    READ_METHODS.has(method.toUpperCase()) || !DEMO_EMAIL_PATHS.has(pathname)
  );
}
