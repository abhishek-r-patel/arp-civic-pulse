import { describe, expect, it } from "vitest";
import { parseEnvironment } from "@/server/config/environment";

const validProduction = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://vote.example.test",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.example.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "server-key-placeholder",
  RATE_LIMIT_HMAC_KEY: "x".repeat(32),
};

function messageFor(source: Record<string, string | undefined>): string {
  try {
    parseEnvironment(source);
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }
  }
  throw new Error("Expected the environment to be rejected.");
}

describe("parseEnvironment", () => {
  it("allows local development without provider credentials", () => {
    expect(parseEnvironment({})).toMatchObject({
      NODE_ENV: "development",
      APP_ORIGIN: "http://localhost:3000",
      LOG_LEVEL: "info",
    });
  });

  it("treats blank values as unset", () => {
    expect(
      parseEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "", LOG_LEVEL: " " }),
    ).toMatchObject({ NEXT_PUBLIC_SUPABASE_URL: undefined, LOG_LEVEL: "info" });
  });

  it("accepts complete production configuration", () => {
    expect(parseEnvironment(validProduction).APP_ORIGIN).toBe(
      "https://vote.example.test",
    );
  });

  it("requires every production setting", () => {
    const message = messageFor({ NODE_ENV: "production" });

    for (const key of [
      "APP_ORIGIN",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "RATE_LIMIT_HMAC_KEY",
    ]) {
      expect(message).toContain(key);
    }
  });

  it("rejects insecure production origins and short rate-limit keys", () => {
    const message = messageFor({
      ...validProduction,
      APP_ORIGIN: "http://vote.example.test",
      NEXT_PUBLIC_SUPABASE_URL: "http://project.example.test",
      RATE_LIMIT_HMAC_KEY: "short",
    });

    expect(message).toContain("APP_ORIGIN: must use HTTPS");
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL: must use HTTPS");
    expect(message).toContain("RATE_LIMIT_HMAC_KEY: must be at least 32");
  });

  it("rejects origins that carry a path", () => {
    expect(messageFor({ APP_ORIGIN: "http://localhost:3000/app" })).toContain(
      "APP_ORIGIN: must be a bare origin",
    );
  });

  it("never includes configured values in error messages", () => {
    const message = messageFor({
      ...validProduction,
      APP_ORIGIN: "http://secret-host.example.test",
      RATE_LIMIT_HMAC_KEY: "too-short-secret",
    });

    expect(message).not.toContain("secret-host");
    expect(message).not.toContain("too-short-secret");
  });
});
