import type { ZodError } from "zod";

/*
 * Error catalogue (docs/API.md section 6.2; operator meanings in
 * docs/OPERATIONS.md "Debug a reported error ID"). Each code has:
 * - status and a safe user `message` (no stack traces, SQL, provider bodies or
 *   echoed input);
 * - `category`: what kind of failure it is, used to filter logs and Sentry;
 * - `type`: `user` for expected outcomes of what the person did, `system` for
 *   faults the operator must look at (only these are reported to Sentry);
 * - `level`: the log level the request wrapper writes it at;
 * - `hint`: a plain-English meaning and first check for the operator. It is
 *   written to logs only, never sent to the browser.
 */
export type ErrorCategory =
  | "request"
  | "validation"
  | "authentication"
  | "authorization"
  | "security"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "dependency"
  | "data_integrity"
  | "internal";

export type ErrorType = "user" | "system";
export type ErrorLogLevel = "info" | "warn" | "error";

interface ErrorDefinition {
  readonly status: number;
  readonly message: string;
  readonly category: ErrorCategory;
  readonly type: ErrorType;
  readonly level: ErrorLogLevel;
  readonly hint: string;
}

function user(
  status: number,
  category: ErrorCategory,
  message: string,
  hint: string,
  level: ErrorLogLevel = "info",
): ErrorDefinition {
  return { status, message, category, type: "user", level, hint };
}

function system(
  status: number,
  category: ErrorCategory,
  message: string,
  hint: string,
): ErrorDefinition {
  return { status, message, category, type: "system", level: "error", hint };
}

const ERRORS = {
  MALFORMED_JSON: user(
    400,
    "request",
    "The request body is not valid JSON.",
    "The browser sent data the server could not read. Usually an old open page or a script; ask the person to reload the page.",
  ),
  AUTH_REQUIRED: user(
    401,
    "authentication",
    "Sign in to continue.",
    "The person was not signed in. They need to sign in again.",
  ),
  SESSION_EXPIRED: user(
    401,
    "authentication",
    "Your session has expired. Sign in again.",
    "The sign-in session ended. They need to sign in again.",
  ),
  FORBIDDEN: user(
    403,
    "authorization",
    "You do not have access to this resource.",
    "The account lacks the role for this action, or is suspended. Check the account's role and status in the register.",
  ),
  CSRF_FAILED: user(
    403,
    "security",
    "The request could not be verified. Reload the page and try again.",
    "Browser request protection failed: a stale page, a different site or host, or blocked cookies. Ask them to reload; repeated failures from one host may be an attack.",
    "warn",
  ),
  NOT_FOUND: user(
    404,
    "not_found",
    "The requested record was not found.",
    "The record does not exist, was removed, belongs to another RWA, or the site address (host) is not recognised.",
  ),
  EXPORT_FORMAT_UNAVAILABLE: user(
    404,
    "not_found",
    "This download format is not available.",
    "The requested download format is not offered for this vote.",
  ),
  METHOD_NOT_ALLOWED: user(
    405,
    "request",
    "This method is not supported.",
    "Something called the API in an unsupported way. Usually a script or an outdated page, not a person.",
  ),
  ALREADY_SUBMITTED: user(
    409,
    "conflict",
    "A response has already been recorded.",
    "This household had already voted; the second submission was refused. Expected behaviour.",
  ),
  STALE_REVISION: user(
    409,
    "conflict",
    "This draft changed. Refresh and review the latest version.",
    "Two people edited the same draft; the older save was refused. Ask them to refresh.",
  ),
  REGISTER_CONFLICT: user(
    409,
    "conflict",
    "This change conflicts with the current register.",
    "The change clashes with existing register data, such as a duplicate email or household. See `reason` in the log.",
  ),
  VOTE_FROZEN: user(
    409,
    "conflict",
    "This vote is active or finished and can no longer be edited.",
    "Someone tried to edit a vote that is already active or finished. Expected behaviour.",
  ),
  LIFECYCLE_CONFLICT: user(
    409,
    "conflict",
    "This action is not available in the current vote state.",
    "The action does not fit the vote's current state. See `reason` in the log for the state.",
  ),
  VOTING_CLOSED: user(
    409,
    "conflict",
    "Voting is closed.",
    "The person tried to vote after the deadline or after the vote ended.",
  ),
  RESULTS_UNAVAILABLE: user(
    409,
    "conflict",
    "Results are not available for this vote.",
    "Results were requested before the vote was completed.",
  ),
  ACTIVATION_BLOCKED: user(
    409,
    "conflict",
    "This vote cannot be activated yet.",
    "The draft is missing something required before activation. The administrator sees the blockers on screen.",
  ),
  REQUEST_TOO_LARGE: user(
    413,
    "request",
    "The request is too large.",
    "The upload or form was larger than the allowed size.",
  ),
  UNSUPPORTED_MEDIA_TYPE: user(
    415,
    "request",
    "Send the request as application/json.",
    "Something called the API with the wrong content type. Usually a script, not a person.",
  ),
  VALIDATION_FAILED: user(
    422,
    "validation",
    "Some fields need attention.",
    "Form fields failed validation. The person sees which fields to fix.",
  ),
  CODE_INVALID_OR_EXPIRED: user(
    422,
    "authentication",
    "The code is invalid or has expired. Request a new code.",
    "The sign-in code was wrong, already used or expired. Ask them to request a new code.",
  ),
  RATE_LIMITED: user(
    429,
    "rate_limit",
    "Too many requests. Wait before trying again.",
    "Too many attempts in a short time. They must wait; many of these from one place may be abuse.",
    "warn",
  ),
  INTERNAL_ERROR: system(
    500,
    "internal",
    "Something went wrong. Quote the error ID if you contact the administrator.",
    "An unexpected application fault. Open the Sentry issue for this error ID to see the exact code location.",
  ),
  DEPENDENCY_UNAVAILABLE: system(
    503,
    "dependency",
    "The service is temporarily unavailable. Try again shortly.",
    "A required service (database, email or configuration) failed. `causeSource` and `causeCode` in the log say which one.",
  ),
  AUTH_UNAVAILABLE: system(
    503,
    "dependency",
    "Sign-in is temporarily unavailable. Try again shortly.",
    "Supabase Auth or the sign-in rate limiter failed. Check Supabase status and the log's `causeStatus`.",
  ),
  PROVISIONING_INCOMPLETE: system(
    503,
    "dependency",
    "Account setup is incomplete. Contact the administrator.",
    "An account was only partly created or changed (Auth and register disagree). Review the account; retrying the same action is safe.",
  ),
  EXPORT_FAILED: system(
    503,
    "internal",
    "The download could not be prepared. Try again shortly.",
    "The CSV or PDF download could not be generated. See `causeCode`, and the Sentry issue for the render error.",
  ),
  RESULTS_INTEGRITY_ERROR: system(
    503,
    "data_integrity",
    "Results are temporarily unavailable pending a review.",
    "Stored results failed an integrity check. Do not change data; investigate before releasing results.",
  ),
} as const satisfies Record<string, ErrorDefinition>;

export type ApiErrorCode = keyof typeof ERRORS;

export function errorDefinition(code: ApiErrorCode): ErrorDefinition {
  return ERRORS[code];
}

export function listErrorCodes(): ApiErrorCode[] {
  return Object.keys(ERRORS) as ApiErrorCode[];
}

/*
 * Where a failure came from, for logs and Sentry only. `code` and `status`
 * are provider/SQL identifiers (for example SQLSTATE `57014` or Auth
 * `over_email_send_rate_limit`), never provider messages, which may contain
 * personal data. Codes that do not look like identifiers are replaced.
 */
export type ErrorCauseSource =
  | "database"
  | "supabase_auth"
  | "email_provider"
  | "rate_limiter"
  | "tenant_config"
  | "deployment_config"
  | "export"
  | "capacity"
  | "maintenance";

export interface ErrorCause {
  source: ErrorCauseSource;
  code?: string | undefined;
  status?: number | undefined;
}

const SAFE_CAUSE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/u;

function sanitizeCause(cause: ErrorCause | undefined): ErrorCause | undefined {
  if (!cause) {
    return undefined;
  }
  return {
    source: cause.source,
    ...(cause.code !== undefined && {
      code: SAFE_CAUSE_CODE.test(cause.code) ? cause.code : "unrecognized",
    }),
    ...(typeof cause.status === "number" &&
      Number.isInteger(cause.status) && { status: cause.status }),
  };
}

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
  // Safe origin of the failure for logs and Sentry; never sent to the browser.
  cause?: ErrorCause;
  /*
   * Set false for a system error that is expected or already reported (for
   * example planned maintenance), so it is logged but not sent to Sentry.
   */
  report?: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly category: ErrorCategory;
  readonly errorType: ErrorType;
  readonly logLevel: ErrorLogLevel;
  readonly hint: string;
  readonly safeCause: ErrorCause | undefined;
  readonly reportable: boolean;
  readonly fieldErrors: FieldError[] | undefined;
  readonly context: ApiErrorOptions["context"];
  readonly retryAfterSeconds: number | undefined;
  readonly allow: readonly string[] | undefined;

  constructor(
    readonly code: ApiErrorCode,
    options: ApiErrorOptions = {},
  ) {
    const definition: ErrorDefinition = ERRORS[code];
    super(options.message ?? definition.message);
    this.name = "ApiError";
    this.status = definition.status;
    this.category = definition.category;
    this.errorType = definition.type;
    this.logLevel = definition.level;
    this.hint = definition.hint;
    this.safeCause = sanitizeCause(options.cause);
    this.reportable = definition.type === "system" && options.report !== false;
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
