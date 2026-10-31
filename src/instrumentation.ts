// Server startup: initialize scrubbed Sentry, then fail fast on unsafe configuration.
import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "@/shared/observability/sentry";

export async function register() {
  Sentry.init(sharedSentryOptions());
  // Fail at server start, not on the first request, when configuration is unsafe.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnvironment } = await import("@/server/config/environment");
    getEnvironment();
  }
}

// Reports uncaught Server Component, route and proxy errors through the scrubber.
export const onRequestError = Sentry.captureRequestError;
