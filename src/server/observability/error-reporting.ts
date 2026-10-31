/*
 * Explicit Sentry reporting for failures the app catches and converts into
 * generic responses, which Sentry's automatic request hook never sees. Only the
 * error and allowlisted primitive tags are sent; the shared scrubber still runs.
 */
import "server-only";
import * as Sentry from "@sentry/nextjs";

export function reportError(
  error: unknown,
  tags: Readonly<Record<string, string>>,
): void {
  Sentry.captureException(error, { tags });
}
