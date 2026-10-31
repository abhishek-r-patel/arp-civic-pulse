// Allowlisted translation of database failures into public API errors.
import {
  ApiError,
  isApiErrorCode,
  type ApiErrorCode,
  type ErrorCause,
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
  "DUPLICATE_EMAIL",
  "UNKNOWN_HOUSEHOLD",
  "LAST_ADMIN",
  "DELETED_PROFILE",
  // Enabling (or demoting to) a resident without an assigned household.
  "HOUSEHOLD_REQUIRED",
  // App Support Access: the support account is managed only by its toggle.
  "APP_SUPPORT_MANAGED",
  "APP_SUPPORT_ACCOUNT",
  "APP_SUPPORT_EMAIL_IN_USE",
  // Lifecycle: the vote's current state or why an action did not apply.
  "DEADLINE_PASSED",
  "DRAFT",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  // Deadline change: why the requested new deadline was refused.
  "DEADLINE_TOO_SOON",
  "DEADLINE_UNCHANGED",
]);

const SQL_TOKEN = /^[A-Z][A-Z0-9_]{2,63}$/u;

/*
 * The SQLSTATE (or PostgREST code) and HTTP status for logs and Sentry. A
 * protected routine's token is appended (`P0001:INVARIANT_VIOLATION`) only
 * when it looks like a token, so free-form database text is never recorded.
 */
function databaseCause({ code, message, status }: DatabaseFailure): ErrorCause {
  return {
    source: "database",
    code:
      code === "P0001" && message && SQL_TOKEN.test(message)
        ? `P0001:${message}`
        : (code ?? "none"),
    status,
  };
}

export function toApiError(failure: DatabaseFailure): ApiError {
  const { code, message = "", details, status } = failure;
  const cause = databaseCause(failure);

  if (code === "P0001") {
    const mapped = TOKEN_TO_CODE[message] ?? message;
    // INVARIANT_VIOLATION and unknown tokens fall through to a safe 500.
    if (mapped !== "INTERNAL_ERROR" && isApiErrorCode(mapped)) {
      return details && SAFE_REASONS.has(details)
        ? new ApiError(mapped, { context: { reason: details }, cause })
        : new ApiError(mapped, { cause });
    }
    return new ApiError("INTERNAL_ERROR", { cause });
  }
  if (code === "42501") {
    return new ApiError("FORBIDDEN", { cause });
  }
  // A bounded lock wait or statement timeout is temporary, never a domain outcome.
  if (code === "55P03" || code === "57014") {
    return new ApiError("DEPENDENCY_UNAVAILABLE", { cause });
  }
  if (code === "23505") {
    return new ApiError("REGISTER_CONFLICT", { cause });
  }
  // Connectivity, timeouts and gateway failures are temporary, not domain outcomes.
  if (
    status === undefined ||
    status === 0 ||
    status >= 500 ||
    code?.startsWith("08")
  ) {
    return new ApiError("DEPENDENCY_UNAVAILABLE", { cause });
  }
  return new ApiError("INTERNAL_ERROR", { cause });
}
