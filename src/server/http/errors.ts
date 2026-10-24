import type { ZodError } from "zod";

/*
 * Stable error codes and statuses (docs/API.md section 6.2). Messages are safe
 * defaults: no stack traces, SQL, provider bodies or echoed input.
 */
const ERRORS = {
  MALFORMED_JSON: [400, "The request body is not valid JSON."],
  AUTH_REQUIRED: [401, "Sign in to continue."],
  SESSION_EXPIRED: [401, "Your session has expired. Sign in again."],
  FORBIDDEN: [403, "You do not have access to this resource."],
  CSRF_FAILED: [
    403,
    "The request could not be verified. Reload the page and try again.",
  ],
  NOT_FOUND: [404, "The requested record was not found."],
  EXPORT_FORMAT_UNAVAILABLE: [404, "This download format is not available."],
  METHOD_NOT_ALLOWED: [405, "This method is not supported."],
  ALREADY_SUBMITTED: [409, "A response has already been recorded."],
  STALE_REVISION: [
    409,
    "This draft changed. Refresh and review the latest version.",
  ],
  REGISTER_CONFLICT: [409, "This change conflicts with the current register."],
  VOTE_FROZEN: [
    409,
    "This vote is active or finished and can no longer be edited.",
  ],
  LIFECYCLE_CONFLICT: [
    409,
    "This action is not available in the current vote state.",
  ],
  VOTING_CLOSED: [409, "Voting is closed."],
  RESULTS_UNAVAILABLE: [409, "Results are not available for this vote."],
  ACTIVATION_BLOCKED: [409, "This vote cannot be activated yet."],
  REQUEST_TOO_LARGE: [413, "The request is too large."],
  UNSUPPORTED_MEDIA_TYPE: [415, "Send the request as application/json."],
  VALIDATION_FAILED: [422, "Some fields need attention."],
  CODE_INVALID_OR_EXPIRED: [
    422,
    "The code is invalid or has expired. Request a new code.",
  ],
  RATE_LIMITED: [429, "Too many requests. Wait before trying again."],
  INTERNAL_ERROR: [
    500,
    "Something went wrong. Quote the support ID if you contact the administrator.",
  ],
  DEPENDENCY_UNAVAILABLE: [
    503,
    "The service is temporarily unavailable. Try again shortly.",
  ],
  AUTH_UNAVAILABLE: [
    503,
    "Sign-in is temporarily unavailable. Try again shortly.",
  ],
  PROVISIONING_INCOMPLETE: [
    503,
    "Account setup is incomplete. Contact the administrator.",
  ],
  EXPORT_FAILED: [
    503,
    "The download could not be prepared. Try again shortly.",
  ],
  RESULTS_INTEGRITY_ERROR: [
    503,
    "Results are temporarily unavailable pending a review.",
  ],
} as const;

export type ApiErrorCode = keyof typeof ERRORS;

export function isApiErrorCode(value: string): value is ApiErrorCode {
  return Object.hasOwn(ERRORS, value);
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export interface ApiErrorOptions {
  message?: string;
  fieldErrors?: FieldError[];
  context?: Record<string, string | number | boolean | null>;
  retryAfterSeconds?: number;
  allow?: readonly string[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: FieldError[] | undefined;
  readonly context: ApiErrorOptions["context"];
  readonly retryAfterSeconds: number | undefined;
  readonly allow: readonly string[] | undefined;

  constructor(
    readonly code: ApiErrorCode,
    options: ApiErrorOptions = {},
  ) {
    const [status, defaultMessage] = ERRORS[code];
    super(options.message ?? defaultMessage);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = options.fieldErrors;
    this.context = options.context;
    this.retryAfterSeconds =
      options.retryAfterSeconds === undefined
        ? undefined
        : Math.max(1, Math.ceil(options.retryAfterSeconds));
    this.allow = options.allow;
  }
}

const ISSUE_CODES: Record<string, string> = {
  invalid_type: "INVALID_TYPE",
  invalid_format: "INVALID_FORMAT",
  invalid_value: "INVALID_VALUE",
  invalid_union: "INVALID_SHAPE",
  too_small: "TOO_SMALL",
  too_big: "TOO_BIG",
  unrecognized_keys: "UNKNOWN_FIELD",
  custom: "INVALID",
};

// Field paths look like `selections[0].candidateId`; values are never included.
export function formatFieldPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${segment}]`;
    }
    const name = String(segment);
    return result ? `${result}.${name}` : name;
  }, "");
}

export function validationError(error: ZodError): ApiError {
  const fieldErrors = error.issues.map<FieldError>((issue) => ({
    field: formatFieldPath(issue.path),
    code: ISSUE_CODES[issue.code] ?? "INVALID",
    // Unrecognized-key messages quote submitted names, so use a fixed message.
    message:
      issue.code === "unrecognized_keys"
        ? "This field is not accepted."
        : issue.message,
  }));

  return new ApiError("VALIDATION_FAILED", { fieldErrors });
}
