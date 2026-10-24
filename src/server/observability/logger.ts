import "server-only";

/*
 * Allowlisted operational logging. Only the fields below are ever written, and
 * only primitive values. Request bodies, headers, cookies, query strings,
 * emails, OTPs, tokens, vote payloads, error messages and stack traces are
 * never logged: callers cannot widen the allowlist by passing extra fields.
 */
const LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LEVELS)[number];

const ALLOWED_FIELDS = [
  "requestId",
  "route",
  "method",
  "status",
  "errorCode",
  "errorName",
  "durationMs",
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];
export type LogFields = Partial<Record<AllowedField, string | number>>;

const MAX_VALUE_LENGTH = 200;

export function sanitizeFields(
  fields: Readonly<Record<string, unknown>>,
): LogFields {
  const safe: LogFields = {};

  for (const key of ALLOWED_FIELDS) {
    const value = fields[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
    } else if (typeof value === "string") {
      safe[key] = value.replace(/[\r\n]+/gu, " ").slice(0, MAX_VALUE_LENGTH);
    }
  }
  return safe;
}

export function shouldLog(configured: LogLevel, level: LogLevel): boolean {
  return LEVELS.indexOf(level) <= LEVELS.indexOf(configured);
}

function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL;
  return LEVELS.find((level) => level === value) ?? "info";
}

export function log(
  level: LogLevel,
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  if (!shouldLog(configuredLevel(), level)) {
    return;
  }
  const line = JSON.stringify({ level, event, ...sanitizeFields(fields) });

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
