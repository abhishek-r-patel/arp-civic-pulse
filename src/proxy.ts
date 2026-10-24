import { NextResponse, type NextRequest } from "next/server";
import {
  CSRF_CONTEXT_HEADER,
  CSRF_COOKIE_MAX_AGE_SECONDS,
  createCsrfContext,
  csrfCookieName,
  isValidCsrfContext,
} from "@/server/http/csrf";
import { MAINTENANCE_PAGE, isMaintenanceMode } from "@/server/maintenance";

/*
 * Ensures every page request has a CSRF context (docs/API.md section 3.2) and
 * passes it to the page through a request header, because pages cannot set
 * cookies while rendering. Any client-supplied copy of the header is replaced.
 * The context is a secret held in an HttpOnly cookie; the page only ever
 * receives the one-way token derived from it.
 */
export function proxy(request: NextRequest) {
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

  const production = process.env.NODE_ENV === "production";
  const name = csrfCookieName(production);

  const existing = request.cookies.get(name)?.value;
  const reuse = isValidCsrfContext(existing);
  const context = reuse ? existing : createCsrfContext();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSRF_CONTEXT_HEADER, context);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
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
