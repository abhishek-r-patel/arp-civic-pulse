/*
 * Shared Sentry options and privacy scrubbing for browser and server runtimes.
 * Sentry is enabled only on Vercel Production/Preview builds with a DSN. Every
 * event passes through the scrubbers below: request headers, cookies, bodies,
 * query strings, user identity and free-form extras are removed, and emails,
 * phone numbers, credentials and tokens are masked in the text that remains.
 */
import type { Breadcrumb, Event } from "@sentry/nextjs";

const ENABLED_ENVIRONMENTS = new Set(["production", "preview"]);
export const TRACES_SAMPLE_RATE = 0.1;

const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/gu, "[jwt]"],
  [/\bsb_(?:secret|publishable)_[\w-]+/gu, "[supabase-key]"],
  [/\bBearer\s+[\w.~+/=-]+/giu, "Bearer [token]"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, "[email]"],
  [/(?:\+?91[\s-]?)?\b[6-9]\d{9}\b/gu, "[phone]"],
];

export function redactText(value: string): string {
  return REDACTIONS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

// Keeps the origin and path for grouping; drops query strings and fragments.
export function stripUrlQuery(value: string): string {
  return redactText(value.replace(/[?#].*$/su, ""));
}

const URL_KEYS = new Set(["url", "from", "to", "http.url", "url.full"]);
const DROPPED_DATA_KEYS = new Set([
  "http.query",
  "url.query",
  "http.fragment",
  "body",
  "request_body",
  "response_body",
  "arguments",
]);

type SafeData = Record<string, string | number | boolean>;

function scrubData(
  data: Readonly<Record<string, unknown>> | undefined,
): SafeData | undefined {
  if (!data) {
    return undefined;
  }
  const safe: SafeData = {};
  for (const [key, value] of Object.entries(data)) {
    if (DROPPED_DATA_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "string") {
      safe[key] = URL_KEYS.has(key) ? stripUrlQuery(value) : redactText(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    ...breadcrumb,
    message:
      breadcrumb.message === undefined
        ? undefined
        : redactText(breadcrumb.message),
    data: scrubData(breadcrumb.data),
  };
}

export function scrubEvent<T extends Event>(event: T): T {
  const scrubbed: T = { ...event };

  delete scrubbed.user;
  delete scrubbed.extra;
  delete scrubbed.server_name;

  if (scrubbed.request) {
    scrubbed.request = {
      method: scrubbed.request.method,
      url: scrubbed.request.url
        ? stripUrlQuery(scrubbed.request.url)
        : undefined,
    };
  }
  if (scrubbed.message) {
    scrubbed.message = redactText(scrubbed.message);
  }
  if (scrubbed.transaction) {
    scrubbed.transaction = stripUrlQuery(scrubbed.transaction);
  }
  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((value) => ({
        ...value,
        value: value.value === undefined ? undefined : redactText(value.value),
      })),
    };
  }
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(scrubBreadcrumb);
  }
  if (scrubbed.spans) {
    scrubbed.spans = scrubbed.spans.map((span) => ({
      ...span,
      description:
        span.description === undefined
          ? undefined
          : stripUrlQuery(span.description),
      data: scrubData(span.data) ?? {},
    }));
  }
  if (scrubbed.contexts?.trace?.data) {
    scrubbed.contexts = {
      ...scrubbed.contexts,
      trace: {
        ...scrubbed.contexts.trace,
        data: scrubData(scrubbed.contexts.trace.data),
      },
    };
  }
  return scrubbed;
}

export function sentryEnvironment(): string {
  return process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "local";
}

export function sentryEnabled(dsn: string | undefined): boolean {
  return Boolean(dsn) && ENABLED_ENVIRONMENTS.has(sentryEnvironment());
}

// Options shared by every runtime; each runtime adds its own integrations.
export function sharedSentryOptions() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  return {
    dsn,
    enabled: sentryEnabled(dsn),
    environment: sentryEnvironment(),
    sendDefaultPii: false,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
