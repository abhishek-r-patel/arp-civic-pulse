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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldError(value: unknown): value is ApiFieldError {
  return (
    isRecord(value) &&
    typeof value.field === "string" &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

function isFailureContext(value: unknown): value is ApiFailure["context"] {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) =>
        entry === null ||
        typeof entry === "string" ||
        typeof entry === "boolean" ||
        (typeof entry === "number" && Number.isFinite(entry)),
    )
  );
}

function invalidResponse(status: number): ApiFailure {
  return {
    ...NETWORK_FAILURE,
    status,
    code: "INVALID_RESPONSE",
    message: "The server sent an unexpected response. Try again.",
  };
}

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
    return invalidResponse(response.status);
  }

  if (
    !isRecord(payload) ||
    (payload.requestId !== undefined && typeof payload.requestId !== "string")
  ) {
    return invalidResponse(response.status);
  }
  if (response.ok) {
    if (!Object.hasOwn(payload, "data") || Object.hasOwn(payload, "error")) {
      return invalidResponse(response.status);
    }
    return { ok: true, status: response.status, data: payload.data as T };
  }
  const error = payload.error;
  if (
    Object.hasOwn(payload, "data") ||
    !isRecord(error) ||
    typeof error.code !== "string" ||
    typeof error.message !== "string"
  ) {
    return invalidResponse(response.status);
  }
  const fieldErrors = error.fieldErrors === undefined ? [] : error.fieldErrors;
  const context = error.context === undefined ? {} : error.context;
  if (
    !Array.isArray(fieldErrors) ||
    !fieldErrors.every(isFieldError) ||
    !isFailureContext(context)
  ) {
    return invalidResponse(response.status);
  }

  const retryAfter = Number(response.headers.get("retry-after"));
  return {
    ok: false,
    status: response.status,
    code: error.code,
    message: error.message,
    fieldErrors,
    context,
    requestId: payload.requestId ?? null,
    retryAfterSeconds:
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  };
}
