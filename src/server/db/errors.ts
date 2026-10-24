import {
  ApiError,
  isApiErrorCode,
  type ApiErrorCode,
} from "@/server/http/errors";

/*
 * Maps database/PostgREST failures to the API error vocabulary. Protected SQL
 * routines raise a stable code as the exception message (SQLSTATE P0001); only
 * allowlisted codes are surfaced. Messages, details and hints from the
 * database are never forwarded to clients.
 */
export interface DatabaseFailure {
  code?: string | undefined;
  message?: string | undefined;
  details?: string | null | undefined;
  status?: number | undefined;
}

// Database-internal tokens that translate to a public API code.
const TOKEN_TO_CODE: Record<string, ApiErrorCode> = {
  AUTH_IDENTITY_MISSING: "PROVISIONING_INCOMPLETE",
  BALLOT_TYPE_MISMATCH: "VALIDATION_FAILED",
  IMMUTABLE_IDENTITY: "LIFECYCLE_CONFLICT",
  IMMUTABLE_RECORD: "LIFECYCLE_CONFLICT",
};

// DETAIL tokens that are safe to expose as a machine-readable conflict reason.
const SAFE_REASONS = new Set([
  "DUPLICATE_IDENTIFIER",
  "REPRESENTATIVE_ASSIGNED",
  "REPRESENTATIVE_DELETED",
  "LAST_ADMIN",
  "DELETED_PROFILE",
]);

export function toApiError(failure: DatabaseFailure): ApiError {
  const { code, message = "", details, status } = failure;

  if (code === "P0001") {
    const mapped = TOKEN_TO_CODE[message] ?? message;
    // INVARIANT_VIOLATION and unknown tokens fall through to a safe 500.
    if (mapped !== "INTERNAL_ERROR" && isApiErrorCode(mapped)) {
      return details && SAFE_REASONS.has(details)
        ? new ApiError(mapped, { context: { reason: details } })
        : new ApiError(mapped);
    }
    return new ApiError("INTERNAL_ERROR");
  }
  if (code === "42501") {
    return new ApiError("FORBIDDEN");
  }
  if (code === "23505") {
    return new ApiError("REGISTER_CONFLICT");
  }
  // Connectivity, timeouts and gateway failures are temporary, not domain outcomes.
  if (
    status === undefined ||
    status === 0 ||
    status >= 500 ||
    code?.startsWith("08")
  ) {
    return new ApiError("DEPENDENCY_UNAVAILABLE");
  }
  return new ApiError("INTERNAL_ERROR");
}

/** Throws the mapped ApiError when a Supabase response carries an error. */
export function unwrap<T>(result: {
  data: T | null;
  error: { code?: string; message?: string; details?: string | null } | null;
  status?: number;
}): T {
  if (result.error) {
    throw toApiError({ ...result.error, status: result.status });
  }
  if (result.data === null) {
    throw new ApiError("INTERNAL_ERROR");
  }
  return result.data;
}
