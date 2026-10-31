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
      TENANT_ROUTING_ENABLED: false,
    });
  });

  it("requires a directory for routed production and rejects legacy shared backend keys", () => {
    const routed = {
      NODE_ENV: "production",
      APP_ORIGIN: "https://example.test",
      RATE_LIMIT_HMAC_KEY: "x".repeat(32),
      TENANT_ROUTING_ENABLED: "true",
      TENANT_DIRECTORY_JSON: JSON.stringify({
        version: 1,
        entries: [{ host: "example.test", kind: "main", state: "active" }],
      }),
    };

    expect(parseEnvironment(routed).TENANT_ROUTING_ENABLED).toBe(true);
    expect(
      messageFor({
        ...routed,
        TENANT_DIRECTORY_JSON: undefined,
      }),
    ).toContain("TENANT_DIRECTORY_JSON");
    expect(
      messageFor({
        ...routed,
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toContain("must be unset when tenant routing is enabled");
    expect(
      messageFor({
        TENANT_DIRECTORY_JSON: routed.TENANT_DIRECTORY_JSON,
      }),
    ).toContain("TENANT_ROUTING_ENABLED");
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

  it.each([
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://app.localhost",
  ])("rejects loopback production endpoints: %s", (origin) => {
    const message = messageFor({
      ...validProduction,
      APP_ORIGIN: origin,
      NEXT_PUBLIC_SUPABASE_URL: origin,
    });
    expect(message).toContain("APP_ORIGIN: must not use a loopback host");
    expect(message).toContain(
      "NEXT_PUBLIC_SUPABASE_URL: must not use a loopback host",
    );
  });

  it.each([
    "https://project.example.test/rest/v1",
    "https://:private-password@project.example.test",
  ])(
    "rejects a non-canonical production Supabase URL without exposing it",
    (url) => {
      const message = messageFor({
        ...validProduction,
        NEXT_PUBLIC_SUPABASE_URL: url,
      });
      expect(message).toContain(
        "NEXT_PUBLIC_SUPABASE_URL: must be a bare origin",
      );
      expect(message).not.toContain(url);
      expect(message).not.toContain("private-password");
    },
  );

  it("rejects a password-only application URL", () => {
    expect(
      messageFor({ APP_ORIGIN: "https://:private-password@vote.example.test" }),
    ).toContain("APP_ORIGIN: must be a bare origin");
  });

  it.each(["sb_secret_placeholder", validProduction.SUPABASE_SERVICE_ROLE_KEY])(
    "refuses server-only keys in the browser-visible setting",
    (key) => {
      const message = messageFor({
        ...validProduction,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
      });
      expect(message).toContain("must not contain a server-only credential");
      expect(message).not.toContain(key);
    },
  );

  it.each(["service_role", "authenticated"])(
    "rejects a legacy %s token in public configuration",
    (role) => {
      const token = `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
      const message = messageFor({
        ...validProduction,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: token,
      });
      expect(message).toContain(
        "legacy public keys must carry only the anon role",
      );
      expect(message).not.toContain(token);
    },
  );

  it("accepts the legacy anon public-key format", () => {
    const token = `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`;
    expect(
      parseEnvironment({
        ...validProduction,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: token,
      }),
    ).toBeDefined();
  });

  it("reports malformed legacy claims without exposing the token", () => {
    const token = "header.private-malformed-claims.signature";
    const message = messageFor({
      ...validProduction,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: token,
    });
    expect(message).toContain(
      "legacy public keys must contain valid JSON claims",
    );
    expect(message).not.toContain(token);
  });
});
