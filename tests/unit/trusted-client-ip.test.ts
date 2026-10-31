import { describe, expect, it } from "vitest";
import { trustedClientIp } from "@/server/auth/trusted-client-ip";
import { ApiError } from "@/server/http/errors";

const trustedVercel = {
  NODE_ENV: "production",
  TRUSTED_PROXY_CONFIG: "vercel",
  VERCEL: "1",
} as const;

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof ApiError) return error.safeCause?.code;
    throw error;
  }
  return undefined;
}

function request(forwardedFor?: string): Request {
  const headers = new Headers();
  if (forwardedFor !== undefined) {
    headers.set("x-forwarded-for", forwardedFor);
  }
  return new Request("https://vote.example.test/api/auth/code", { headers });
}

describe("trusted Vercel client IP", () => {
  it("accepts a valid IPv4 address", () => {
    expect(trustedClientIp(request("203.0.113.42"), trustedVercel)).toBe(
      "203.0.113.42",
    );
  });

  it("canonicalizes IPv6 addresses before rate-limit hashing", () => {
    expect(trustedClientIp(request("2001:0db8:0:0::42"), trustedVercel)).toBe(
      "2001:db8::42",
    );
  });

  it("leaves local development unmetered when no proxy is configured", () => {
    expect(
      trustedClientIp(request("203.0.113.42"), { NODE_ENV: "development" }),
    ).toBeUndefined();
  });

  it("fails closed in production when proxy configuration is missing", () => {
    expect(
      errorCode(() =>
        trustedClientIp(request("203.0.113.42"), {
          NODE_ENV: "production",
          VERCEL: "1",
        }),
      ),
    ).toBe("CONFIG_MISSING");
  });

  it("requires the configured Vercel runtime", () => {
    expect(
      errorCode(() =>
        trustedClientIp(request("203.0.113.42"), {
          ...trustedVercel,
          VERCEL: undefined,
        }),
      ),
    ).toBe("VERCEL_RUNTIME_REQUIRED");
  });

  it("fails closed for missing, invalid or ambiguous forwarding values", () => {
    expect(errorCode(() => trustedClientIp(request(), trustedVercel))).toBe(
      "CLIENT_IP_MISSING",
    );
    expect(
      errorCode(() =>
        trustedClientIp(
          new Request("https://vote.example.test/api/auth/code", {
            headers: { "x-real-ip": "203.0.113.42" },
          }),
          trustedVercel,
        ),
      ),
    ).toBe("CLIENT_IP_MISSING");
    expect(
      errorCode(() => trustedClientIp(request("spoofed"), trustedVercel)),
    ).toBe("CLIENT_IP_INVALID");
    expect(
      errorCode(() =>
        trustedClientIp(request("203.0.113.42, 198.51.100.7"), trustedVercel),
      ),
    ).toBe("CLIENT_IP_INVALID");
  });
});
