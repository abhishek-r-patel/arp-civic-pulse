import { ApiError } from "@/server/http/errors";
import type { PageInfo } from "@/shared/contracts/pagination";

const JSON_TYPE = "application/json; charset=utf-8";

// Authenticated pages, JSON and errors are never stored by shared caches.
export const BASE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

// A random support identifier: it never encodes identity, selections or sessions.
export function newRequestId(): string {
  return crypto.randomUUID();
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
