import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_MAX_AGE_SECONDS,
  hardenSessionCookie,
  isSupabaseAuthCookie,
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
      },
      true,
    );
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
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

describe("isSupabaseAuthCookie", () => {
  it("recognises the SDK's session cookie and its chunks only", () => {
    for (const name of [
      "sb-abc-auth-token",
      "sb-abc-auth-token.0",
      "sb-abc-auth-token.1",
    ]) {
      expect(isSupabaseAuthCookie(name), name).toBe(true);
    }
    for (const name of [
      "cp_csrf",
      "__Host-cp_csrf",
      "session",
      "sb-abc-other",
      "theme",
    ]) {
      expect(isSupabaseAuthCookie(name), name).toBe(false);
    }
  });
});
