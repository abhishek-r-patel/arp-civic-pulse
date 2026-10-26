import type { ApiFailure } from "@/shared/http/api-client";

/*
 * Plain-language messages for API failures. Server messages are already safe;
 * this adds the specific reason where the API supplies one and keeps wording
 * consistent across screens. No message ever includes submitted values.
 */
const CONFLICT_REASONS: Record<string, string> = {
  DUPLICATE_IDENTIFIER: "This value is already in use.",
  REPRESENTATIVE_ASSIGNED:
    "This account is already assigned elsewhere. Choose a different account.",
  REPRESENTATIVE_DELETED:
    "This account is unavailable. Choose a different account.",
  DUPLICATE_EMAIL: "Another account already uses this email address.",
  LAST_ADMIN:
    "At least one enabled administrator must remain. Make someone else an administrator first.",
  DELETED_PROFILE:
    "This account has been deleted and can no longer be changed.",
  DEADLINE_PASSED:
    "The deadline had already passed, so the vote was completed at its deadline and your action was not applied.",
  DRAFT: "This vote has not been activated yet.",
  ACTIVE: "This vote is already active.",
  COMPLETED: "This vote has already been completed.",
  CANCELLED: "This vote has already been cancelled.",
};

export function describeFailure(failure: ApiFailure): string {
  const reason = failure.context.reason;
  if (typeof reason === "string" && CONFLICT_REASONS[reason]) {
    return CONFLICT_REASONS[reason];
  }

  switch (failure.code) {
    case "RATE_LIMITED":
      return failure.retryAfterSeconds
        ? `Too many attempts. Try again in about ${failure.retryAfterSeconds} seconds.`
        : "Too many attempts. Wait a little and try again.";
    case "PROVISIONING_INCOMPLETE":
      return failure.context.profileBlocked
        ? "The change was only partly completed. The account has been left suspended so it cannot be used. Review it, then try again or enable it explicitly."
        : "The account was only partly set up. Nothing was lost; try the same action again.";
    case "CSRF_FAILED":
      return "Your page has expired. Reload it and try again.";
    case "AUTH_REQUIRED":
    case "SESSION_EXPIRED":
      return "Your session has ended. Sign in again to continue.";
    case "FORBIDDEN":
      return "You do not have access to do this.";
    case "NOT_FOUND":
      return "This record could not be found. It may have been removed.";
    case "DEPENDENCY_UNAVAILABLE":
    case "AUTH_UNAVAILABLE":
      return "The service is temporarily unavailable. Try again in a moment.";
    default:
      return failure.message;
  }
}

export function fieldErrorFor(
  failure: ApiFailure | null,
  field: string,
): string | undefined {
  return failure?.fieldErrors.find((error) => error.field === field)?.message;
}
