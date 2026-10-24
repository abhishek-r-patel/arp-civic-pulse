import "server-only";
import { timingSafeEqual } from "node:crypto";
import { ApiError } from "@/server/http/errors";
import { CSRF_HEADER, csrfTokenFor } from "@/server/http/csrf";

export {
  CSRF_HEADER,
  createCsrfContext,
  csrfTokenFor,
} from "@/server/http/csrf";

/*
 * Browser mutation protection (docs/API.md section 3.2): an exact Origin match
 * plus an X-CSRF-Token bound to a secret context.
 *
 * The context is a random value held in a Secure, HttpOnly cookie (a session-
 * bound value once signed in, a short-lived pre-authentication value before).
 * The token is a one-way digest of it, rendered into the server-delivered
 * document, so page script never needs to read the cookie and the token cannot
 * reveal it. The context must be replaced at authentication; cookie handling
 * belongs to the session integration. This is not a session token.
 */

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface BrowserMutationOptions {
  appOrigin: string;
  // The secret context read from the cookie; undefined when the cookie is absent.
  csrfContext: string | undefined;
}

export function assertBrowserMutation(
  request: Request,
  { appOrigin, csrfContext }: BrowserMutationOptions,
): void {
  const origin = request.headers.get("origin");
  if (origin === null || origin !== appOrigin) {
    throw new ApiError("CSRF_FAILED");
  }

  const token = request.headers.get(CSRF_HEADER);
  if (
    !csrfContext ||
    !token ||
    !constantTimeEqual(token, csrfTokenFor(csrfContext))
  ) {
    throw new ApiError("CSRF_FAILED");
  }
}
