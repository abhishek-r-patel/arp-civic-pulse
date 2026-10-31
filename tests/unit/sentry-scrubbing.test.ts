// Sentry privacy scrubbing and environment gating.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorEvent, Event } from "@sentry/nextjs";
import {
  redactText,
  scrubBreadcrumb,
  scrubEvent,
  sentryEnabled,
  stripUrlQuery,
} from "@/shared/observability/sentry";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("redactText", () => {
  it("masks emails, phone numbers, JWTs, Supabase keys and bearer tokens", () => {
    const text = redactText(
      "user resident@example.test phone +91 9876543210 jwt eyJhbGciOi.eyJzdWIi.sig key sb_secret_abc123 auth Bearer abc.def",
    );
    expect(text).toBe(
      "user [email] phone [phone] jwt [jwt] key [supabase-key] auth Bearer [token]",
    );
  });

  it("keeps ordinary error text and identifiers", () => {
    expect(
      redactText("Vote 3f2c1a00-0000-4000-8000-000000000001 failed: timeout"),
    ).toBe("Vote 3f2c1a00-0000-4000-8000-000000000001 failed: timeout");
  });
});

describe("stripUrlQuery", () => {
  it("drops query strings and fragments", () => {
    expect(
      stripUrlQuery(
        "https://x.supabase.co/rest/v1/accounts?email=eq.a@b.test#top",
      ),
    ).toBe("https://x.supabase.co/rest/v1/accounts");
  });
});

describe("scrubEvent", () => {
  it("removes request details, user identity and extras from errors", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: "failed for resident@example.test",
      user: {
        id: "user-1",
        email: "resident@example.test",
        ip_address: "1.2.3.4",
      },
      extra: { body: "secret" },
      server_name: "host-1",
      request: {
        method: "POST",
        url: "https://app.example.test/api/auth/code?email=a@b.test",
        headers: { cookie: "sb-access-token=abc", authorization: "Bearer x" },
        cookies: { session: "abc" },
        data: { email: "resident@example.test", code: "123456" },
        query_string: "email=a@b.test",
      },
      exception: {
        values: [{ type: "Error", value: "duplicate key for a@b.test" }],
      },
      breadcrumbs: [
        {
          category: "fetch",
          data: {
            url: "https://x.supabase.co/rest/v1/votes?id=eq.1",
            method: "GET",
            status_code: 500,
            body: "payload",
          },
        },
      ],
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
    expect(scrubbed.request).toEqual({
      method: "POST",
      url: "https://app.example.test/api/auth/code",
    });
    expect(scrubbed.message).toBe("failed for [email]");
    expect(scrubbed.exception?.values?.[0]?.value).toBe(
      "duplicate key for [email]",
    );
    expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({
      url: "https://x.supabase.co/rest/v1/votes",
      method: "GET",
      status_code: 500,
    });
    expect(JSON.stringify(scrubbed)).not.toMatch(
      /resident@|123456|sb-access-token|Bearer x/u,
    );
  });

  it("strips query strings from transaction spans", () => {
    const event: Event = {
      type: "transaction",
      transaction: "GET /api/votes?page=2",
      spans: [
        {
          span_id: "1",
          trace_id: "2",
          start_timestamp: 0,
          status: "ok",
          description:
            "GET https://x.supabase.co/rest/v1/accounts?email=eq.a@b.test",
          data: {
            "http.url":
              "https://x.supabase.co/rest/v1/accounts?email=eq.a@b.test",
            "http.query": "?email=eq.a@b.test",
            "http.response.status_code": 200,
          },
        },
      ],
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed.transaction).toBe("GET /api/votes");
    expect(scrubbed.spans?.[0]?.description).toBe(
      "GET https://x.supabase.co/rest/v1/accounts",
    );
    expect(scrubbed.spans?.[0]?.data).toEqual({
      "http.url": "https://x.supabase.co/rest/v1/accounts",
      "http.response.status_code": 200,
    });
  });
});

describe("scrubBreadcrumb", () => {
  it("redacts messages and navigation URLs", () => {
    expect(
      scrubBreadcrumb({
        category: "navigation",
        message: "visited by a@b.test",
        data: { from: "/sign-in?next=/admin", to: "/admin#x" },
      }),
    ).toEqual({
      category: "navigation",
      message: "visited by [email]",
      data: { from: "/sign-in", to: "/admin" },
    });
  });
});

describe("sentryEnabled", () => {
  it("runs only on Vercel Production or Preview with a DSN", () => {
    const dsn = "https://key@o1.ingest.us.sentry.io/2";

    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "production");
    expect(sentryEnabled(dsn)).toBe(true);
    expect(sentryEnabled(undefined)).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "preview");
    expect(sentryEnabled(dsn)).toBe(true);

    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "development");
    expect(sentryEnabled(dsn)).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "");
    expect(sentryEnabled(dsn)).toBe(false);
  });
});
