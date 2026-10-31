import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_MAX_AGE_SECONDS,
  hardenSessionCookie,
  isTenantSessionCookie,
  sessionCookieName,
} from "@/server/auth/session-cookies";

const DAY = 86_400;

describe("hardenSessionCookie", () => {
  it("always sets HttpOnly, SameSite=Lax and a root path, and Secure in production", () => {
    const options = hardenSessionCookie(
      "sb-x-auth-token",
      "value",
      {
        maxAge: DAY,
        httpOnly: false,
        secure: false,
        sameSite: "none",
        path: "/elsewhere",
        domain: ".example.test",
      },
      true,
    );
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    expect("domain" in options).toBe(false);
    expect(
      hardenSessionCookie("sb-x-auth-token", "v", { maxAge: DAY }, false)
        .secure,
    ).toBe(false);
  });

  it("caps the SDK's 400-day lifetime, but never extends a shorter one", () => {
    expect(
      hardenSessionCookie("sb-x-auth-token", "v", { maxAge: 400 * DAY }, true)
        .maxAge,
    ).toBe(SESSION_COOKIE_MAX_AGE_SECONDS);
    expect(
      hardenSessionCookie("sb-x-auth-token", "v", { maxAge: 3600 }, true)
        .maxAge,
    ).toBe(3600);
    expect(hardenSessionCookie("sb-x-auth-token", "v", {}, true).maxAge).toBe(
      SESSION_COOKIE_MAX_AGE_SECONDS,
    );
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBeLessThanOrEqual(30 * DAY);
  });

  it("drops an absolute expiry that could outlive the cap", () => {
    const options = hardenSessionCookie(
      "sb-x-auth-token",
      "v",
      { maxAge: DAY, expires: new Date("2099-01-01") },
      true,
    );
    expect("expires" in options).toBe(false);
  });

  it("keeps the short-lived PKCE verifier short, and leaves removals as removals", () => {
    expect(
      hardenSessionCookie(
        "sb-x-auth-token-code-verifier",
        "v",
        { maxAge: 400 * DAY },
        true,
      ).maxAge,
    ).toBe(600);
    const removal = hardenSessionCookie(
      "sb-x-auth-token",
      "",
      { maxAge: 0 },
      true,
    );
    expect(removal.maxAge).toBe(0);
    expect(removal.httpOnly).toBe(true);
    expect(
      hardenSessionCookie("sb-x-auth-token", "", {}, true).maxAge,
    ).toBeUndefined();
  });
});

describe("tenant session cookie names", () => {
  it("uses a host-only __Host name per tenant in production", () => {
    const alpha = sessionCookieName(
      "11111111-1111-4111-8111-111111111111",
      true,
    );
    const beta = sessionCookieName(
      "22222222-2222-4222-8222-222222222222",
      true,
    );

    expect(alpha).toBe(
      "__Host-cp-11111111-1111-4111-8111-111111111111-auth-token",
    );
    expect(beta).not.toBe(alpha);
    expect(isTenantSessionCookie(alpha, alpha)).toBe(true);
    expect(isTenantSessionCookie(`${alpha}.0`, alpha)).toBe(true);
    expect(isTenantSessionCookie(beta, alpha)).toBe(false);
    expect(isTenantSessionCookie(`${alpha}-code-verifier`, alpha)).toBe(false);
  });

  it("uses a non-prefixed name for local HTTP and rejects unsafe identifiers", () => {
    expect(sessionCookieName("single-rwa", false)).toBe(
      "cp-single-rwa-auth-token",
    );
    expect(() => sessionCookieName("tenant.with.dot", true)).toThrow(
      "Invalid tenant ID for session cookie",
    );
  });
});
