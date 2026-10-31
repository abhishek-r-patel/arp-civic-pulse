import { ApiError } from "@/server/http/errors";
import { newErrorId, type ErrorArea } from "@/shared/observability/error-id";
import type { PageInfo } from "@/shared/contracts/pagination";

const JSON_TYPE = "application/json; charset=utf-8";

// Authenticated pages, JSON and errors are never stored by shared caches.
export const BASE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

/*
 * A random, readable error/support ID such as `VOTE-7K3QX-M2PTA` (see
 * src/shared/observability/error-id.ts). The prefix names the product area;
 * it never encodes identity, selections or sessions.
 */
export function newRequestId(area: ErrorArea = "API"): string {
  return newErrorId(area);
}

function respond(
  body: unknown,
  requestId: string,
  status: number,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": JSON_TYPE,
      "X-Request-ID": requestId,
      ...extra,
    },
  });
}

export function ok<T>(data: T, requestId: string, status = 200): Response {
  return respond({ data, requestId }, requestId, status);
}

export function paginated<T>(
  data: readonly T[],
  page: PageInfo,
  requestId: string,
): Response {
  return respond({ data, page, requestId }, requestId, 200);
}

// One document (not a list) whose embedded list is paged, e.g. a result with named responses.
export function okWithPage<T>(
  data: T,
  page: PageInfo | null,
  requestId: string,
): Response {
  return respond({ data, ...(page && { page }), requestId }, requestId, 200);
}

export function noContent(requestId: string): Response {
  return new Response(null, {
    status: 204,
    headers: { ...BASE_HEADERS, "X-Request-ID": requestId },
  });
}

export function errorResponse(error: ApiError, requestId: string): Response {
  const extra: Record<string, string> = {};
  if (error.retryAfterSeconds !== undefined) {
    extra["Retry-After"] = String(error.retryAfterSeconds);
  }
  if (error.allow) {
    extra.Allow = error.allow.join(", ");
  }

  return respond(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fieldErrors && { fieldErrors: error.fieldErrors }),
        ...(error.context && { context: error.context }),
      },
      requestId,
    },
    requestId,
    error.status,
    extra,
  );
}
