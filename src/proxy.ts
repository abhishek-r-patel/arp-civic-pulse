import { NextResponse, type NextRequest } from "next/server";
import {
  CSRF_CONTEXT_HEADER,
  CSRF_COOKIE_MAX_AGE_SECONDS,
  createCsrfContext,
  csrfCookieName,
  isValidCsrfContext,
} from "@/server/http/csrf";
import { refreshSessionCookies } from "@/server/auth/proxy-session";
import {
  tenantContextForProxy,
  type TenantContext,
} from "@/server/config/tenant-context";
import { ApiError } from "@/server/http/errors";
import { MAINTENANCE_PAGE, isMaintenanceMode } from "@/server/maintenance";
import { mainHostRoute } from "@/shared/host-routes";

/*
 * Ensures every page request has a CSRF context (docs/API.md section 3.2) and
 * passes it to the page through a request header, because pages cannot set
 * cookies while rendering. Any client-supplied copy of the header is replaced.
 * The context is a secret held in an HttpOnly cookie; the page only ever
 * receives the one-way token derived from it.
 *
 * It also refreshes an expiring Supabase session and hands the new cookies to
 * both the page being rendered and the browser (see proxy-session.ts). That is
 * session upkeep only; authorization is decided later, per request, on the server.
 */
export async function proxy(request: NextRequest) {
  let tenant: TenantContext;
  try {
    tenant = tenantContextForProxy(request.headers.get("host"));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return new NextResponse(null, {
      status: error.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  if (isMaintenanceMode()) {
    return new NextResponse(MAINTENANCE_PAGE, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Retry-After": "300",
      },
    });
  }

  // The main product website has no RWA backend, sessions or forms: it only
  // maps its public pages to `src/app/site` and 404s everything else.
  if (tenant.kind === "main") {
    return NextResponse.rewrite(
      new URL(mainHostRoute(request.nextUrl.pathname), request.url),
    );
  }

  const production = process.env.NODE_ENV === "production";
  const name = csrfCookieName(production);

  const existing = request.cookies.get(name)?.value;
  const reuse = isValidCsrfContext(existing);
  const context = reuse ? existing : createCsrfContext();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSRF_CONTEXT_HEADER, context);

  const refreshed = await refreshSessionCookies(request, tenant);
  if (refreshed) {
    requestHeaders.set("cookie", refreshed.cookieHeader);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const { name: cookieName, value, options } of refreshed?.setCookies ??
    []) {
    response.cookies.set(cookieName, value, options);
  }
  if (!reuse) {
    response.cookies.set(name, context, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      path: "/",
      maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
    });
  }
  return response;
}

export const config = {
  // Pages only: API handlers read the cookie directly and never need the header.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|fonts).*)"],
};
