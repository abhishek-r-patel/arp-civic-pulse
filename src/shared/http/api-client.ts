/*
 * Browser-side helper for the application's own JSON API. Every mutation sends
 * the server-rendered CSRF token; the matching secret lives in an HttpOnly
 * cookie the script never sees. Responses are parsed into a discriminated
 * result so callers handle every failure explicitly.
 */
export interface ApiFieldError {
  field: string;
  code: string;
  message: string;
}

export interface ApiFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  fieldErrors: ApiFieldError[];
  context: Record<string, string | number | boolean | null>;
  requestId: string | null;
  retryAfterSeconds: number | null;
}

export type ApiResult<T> = { ok: true; status: number; data: T } | ApiFailure;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  csrfToken?: string | undefined;
}

const NETWORK_FAILURE: ApiFailure = {
  ok: false,
  status: 0,
  code: "NETWORK_ERROR",
  message:
    "We could not reach the server. Check your connection and try again.",
  fieldErrors: [],
  context: {},
  requestId: null,
  retryAfterSeconds: null,
};

export async function apiRequest<T>(
  path: string,
  { method = "GET", body, csrfToken }: RequestOptions = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(csrfToken && { "X-CSRF-Token": csrfToken }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return NETWORK_FAILURE;
  }

  if (response.status === 204) {
    return { ok: true, status: 204, data: undefined as T };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ...NETWORK_FAILURE,
      status: response.status,
      code: "INVALID_RESPONSE",
      message: "The server sent an unexpected response. Try again.",
    };
  }

  const envelope = payload as {
    data?: T;
    error?: {
      code?: string;
      message?: string;
      fieldErrors?: ApiFieldError[];
      context?: ApiFailure["context"];
    };
    requestId?: string;
  };

  if (response.ok && envelope.data !== undefined) {
    return { ok: true, status: response.status, data: envelope.data };
  }

  const retryAfter = Number(response.headers.get("retry-after"));
  return {
    ok: false,
    status: response.status,
    code: envelope.error?.code ?? "UNKNOWN_ERROR",
    message: envelope.error?.message ?? "Something went wrong. Try again.",
    fieldErrors: envelope.error?.fieldErrors ?? [],
    context: envelope.error?.context ?? {},
    requestId: envelope.requestId ?? null,
    retryAfterSeconds:
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  };
}
