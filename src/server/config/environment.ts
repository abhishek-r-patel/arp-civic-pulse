import "server-only";
import { z } from "zod";

/*
 * Runtime configuration for the Next.js server (docs/API.md section 10).
 *
 * Deployment-only credentials (SUPABASE_ACCESS_TOKEN, MIGRATION_DATABASE_URL)
 * are intentionally not read here. SMTP, Auth and Cron settings live in
 * Supabase/provider configuration, not in application variables.
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
  })
  .superRefine((environment, context) => {
    const fail = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });

    if (environment.APP_ORIGIN) {
      const url = new URL(environment.APP_ORIGIN);
      if (url.pathname !== "/" || url.search || url.hash || url.username) {
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
      if (value && new URL(value).protocol !== "https:") {
        fail(key, "must use HTTPS in production");
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
