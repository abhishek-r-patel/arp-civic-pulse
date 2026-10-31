/*
 * Which paths each kind of host serves (docs/ARCHITECTURE.md, "Host kinds").
 *
 * - The main product website has no RWA backend. It serves only its own pages
 *   (rendered from `src/app/site`) and shared public assets; every RWA route,
 *   sign-in and API other than the health check is a 404 there.
 * - The demo host is a normal RWA site whose changes are turned off. Its only
 *   writes are the demo persona sign-in and sign-out.
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

const DEMO_WRITE_PATHS = new Set(["/api/demo/session", "/api/auth/sign-out"]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The demo accepts reads, persona sign-in and sign-out; every other write is refused. */
export function demoRequestAllowed(method: string, pathname: string): boolean {
  return (
    READ_METHODS.has(method.toUpperCase()) || DEMO_WRITE_PATHS.has(pathname)
  );
}
