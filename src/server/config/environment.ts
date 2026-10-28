// Validates runtime server settings without exposing submitted values in diagnostics.
import "server-only";
import { z } from "zod";

/*
 * Email validation is inlined (not imported from "@/shared/...") so the
 * operator CLI can load this module by relative path under plain Node TS
 * stripping, which does not resolve the "@/" alias.
 */
const emailAddress = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email("Enter a valid email address."));

/*
 * Runtime configuration for the Next.js server (docs/API.md section 10).
 *
 * Deployment-only credentials (SUPABASE_ACCESS_TOKEN, MIGRATION_DATABASE_URL)
 * are intentionally not read here. OTP SMTP, Auth and Cron settings live in
 * Supabase/provider configuration. Optional Resend settings are contact-only.
 */

const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = z.preprocess(
  blankToUndefined,
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(blankToUndefined, z.url().optional());

const NON_PRODUCTION_ORIGIN = "http://localhost:3000";

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_ORIGIN: optionalUrl,
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalText,
    SUPABASE_SERVICE_ROLE_KEY: optionalText,
    RATE_LIMIT_HMAC_KEY: optionalText,
    LOG_LEVEL: z.preprocess(
      blankToUndefined,
      z.enum(["error", "warn", "info", "debug"]).default("info"),
    ),
    TRUSTED_PROXY_CONFIG: optionalText,
    RESEND_API_KEY: optionalText,
    CONTACT_EMAIL_FROM: z.preprocess(blankToUndefined, z.email().optional()),
    CONTACT_EMAIL_TO: z.preprocess(blankToUndefined, z.email().optional()),
    GOOGLE_ANALYTICS_ID: z.preprocess(
      blankToUndefined,
      z
        .string()
        .regex(/^G-[A-Z0-9]+$/)
        .optional(),
    ),
    GOOGLE_SITE_VERIFICATION: optionalText,
    // The only identity App Support Access may enable; RWA admins cannot change it.
    APP_SUPPORT_EMAIL: z.preprocess(blankToUndefined, emailAddress.optional()),
  })
  .superRefine((environment, context) => {
    const fail = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });

    const contactKeys = [
      "RESEND_API_KEY",
      "CONTACT_EMAIL_FROM",
      "CONTACT_EMAIL_TO",
    ] as const;
    if (contactKeys.some((key) => environment[key])) {
      for (const key of contactKeys) {
        if (!environment[key])
          fail(key, "is required when contact email is enabled");
      }
    }

    if (environment.APP_ORIGIN) {
      const url = new URL(environment.APP_ORIGIN);
      if (
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      ) {
        fail("APP_ORIGIN", "must be a bare origin without path or credentials");
      }
    }

    if (environment.NODE_ENV !== "production") {
      return;
    }

    const required = [
      "APP_ORIGIN",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "RATE_LIMIT_HMAC_KEY",
    ] as const;
    for (const key of required) {
      if (!environment[key]) {
        fail(key, "is required in production");
      }
    }

    for (const key of ["APP_ORIGIN", "NEXT_PUBLIC_SUPABASE_URL"] as const) {
      const value = environment[key];
      if (!value) {
        continue;
      }
      const url = new URL(value);
      if (url.protocol !== "https:") {
        fail(key, "must use HTTPS in production");
      }
      if (
        url.hostname === "localhost" ||
        url.hostname.endsWith(".localhost") ||
        url.hostname === "[::1]" ||
        /^127\./.test(url.hostname)
      ) {
        fail(key, "must not use a loopback host in production");
      }
      if (
        key === "NEXT_PUBLIC_SUPABASE_URL" &&
        (url.pathname !== "/" ||
          url.search ||
          url.hash ||
          url.username ||
          url.password)
      ) {
        fail(key, "must be a bare origin without path or credentials");
      }
    }

    const publicKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (
      publicKey &&
      (publicKey.startsWith("sb_secret_") ||
        publicKey === environment.SUPABASE_SERVICE_ROLE_KEY)
    ) {
      fail(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "must not contain a server-only credential",
      );
    }
    const keySegments = publicKey?.split(".");
    const encodedClaims = keySegments?.[1];
    if (keySegments?.length === 3 && encodedClaims !== undefined) {
      try {
        const payload: unknown = JSON.parse(
          Buffer.from(encodedClaims, "base64url").toString("utf8"),
        );
        if (!z.object({ role: z.literal("anon") }).safeParse(payload).success) {
          fail(
            "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
            "legacy public keys must carry only the anon role",
          );
        }
      } catch {
        fail(
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          "legacy public keys must contain valid JSON claims",
        );
      }
    }

    if (
      environment.RATE_LIMIT_HMAC_KEY &&
      environment.RATE_LIMIT_HMAC_KEY.length < 32
    ) {
      fail("RATE_LIMIT_HMAC_KEY", "must be at least 32 characters");
    }
  })
  .transform((environment) => ({
    ...environment,
    APP_ORIGIN: environment.APP_ORIGIN
      ? new URL(environment.APP_ORIGIN).origin
      : NON_PRODUCTION_ORIGIN,
  }));

export type Environment = z.output<typeof environmentSchema>;

const environmentKeys = [
  "NODE_ENV",
  "APP_ORIGIN",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RATE_LIMIT_HMAC_KEY",
  "LOG_LEVEL",
  "TRUSTED_PROXY_CONFIG",
  "RESEND_API_KEY",
  "CONTACT_EMAIL_FROM",
  "CONTACT_EMAIL_TO",
  "GOOGLE_ANALYTICS_ID",
  "GOOGLE_SITE_VERIFICATION",
  "APP_SUPPORT_EMAIL",
] as const;

// Reports variable names and rule messages only, never submitted values.
export function parseEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Environment {
  const values = Object.fromEntries(
    environmentKeys.map((key) => [key, source[key]]),
  );
  const parsed = environmentSchema.safeParse(values);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
      )
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}

let cachedEnvironment: Environment | undefined;

export function getEnvironment(): Environment {
  cachedEnvironment ??= parseEnvironment(process.env);
  return cachedEnvironment;
}
