/*
 * Explicit Sentry reporting for failures the app catches and converts into
 * generic responses, which Sentry's automatic request hook never sees. Only the
 * error and allowlisted primitive tags are sent; the shared scrubber still runs.
 * Inside a request, the error ID (`error_id`, searchable in Sentry), area,
 * route, method, host and tenant from the request context are added as tags.
 */
import "server-only";
import * as Sentry from "@sentry/nextjs";
import { currentRequestContext } from "@/server/observability/request-context";

export interface ReportOptions {
  // Groups related events into one Sentry issue (for example code + route).
  fingerprint?: string[];
}

export function reportError(
  error: unknown,
  tags: Readonly<Record<string, string | number | undefined>>,
  options: ReportOptions = {},
): void {
  const context = currentRequestContext();
  const merged: Record<string, string> = {};
  if (context) {
    merged.error_id = context.requestId;
    merged.area = context.area;
    merged.route = context.route;
    merged.method = context.method;
    merged.host = context.host;
    merged.tenant = context.tenant;
  }
  for (const [key, value] of Object.entries(tags)) {
    if (value !== undefined) {
      merged[key] = String(value).slice(0, 200);
    }
  }
  Sentry.captureException(error, {
    tags: merged,
    ...(options.fingerprint && { fingerprint: options.fingerprint }),
  });
}
