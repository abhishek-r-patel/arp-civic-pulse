// Browser Sentry SDK: scrubbed errors and sampled navigation traces; no Session Replay.
import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "@/shared/observability/sentry";

Sentry.init(sharedSentryOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
