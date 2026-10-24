import { z } from "zod";

/*
 * Field bounds mirror the database checks (docs/DATABASE.md section 2,
 * docs/API.md section 6.1). They are technical safeguards, not voting rules.
 */
export const FIELD_LIMITS = {
  email: 254,
  householdLabel: 100,
  name: 200,
  title: 300,
  longText: 10_000,
  reason: 2_000,
} as const;

// Single-line plain text rejects every control character.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/u;
// Multi-line text permits only tab and line feed (carriage returns are normalized first).
const DISALLOWED_MULTILINE_CONTROLS =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;
const MARKUP = /<\/?[a-z!][^>]*>/iu;

function plainText(maxLength: number, multiline: boolean, allowEmpty: boolean) {
  const forbidden = multiline
    ? DISALLOWED_MULTILINE_CONTROLS
    : CONTROL_CHARACTERS;

  return z
    .string()
    .transform((value) =>
      (multiline ? value.replace(/\r\n?/gu, "\n") : value)
        .normalize("NFC")
        .trim(),
    )
    .pipe(
      z
        .string()
        .min(allowEmpty ? 0 : 1, "Enter a value.")
        .max(maxLength, `Use at most ${maxLength} characters.`)
        .refine((value) => !forbidden.test(value), "Remove control characters.")
        .refine(
          (value) => !MARKUP.test(value),
          "Formatting markup is not allowed.",
        ),
    );
}

export const singleLineText = (maxLength: number) =>
  plainText(maxLength, false, false);
export const multilineText = (maxLength: number) =>
  plainText(maxLength, true, false);

export const nameText = singleLineText(FIELD_LIMITS.name);
export const titleText = singleLineText(FIELD_LIMITS.title);
// Drafts may have an empty title; activation validation requires one.
export const draftTitleText = plainText(FIELD_LIMITS.title, false, true);
export const longText = multilineText(FIELD_LIMITS.longText);
export const reasonText = multilineText(FIELD_LIMITS.reason);

// Trim and lowercase only; no provider-specific rewriting.
export const emailAddress = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .max(FIELD_LIMITS.email, `Use at most ${FIELD_LIMITS.email} characters.`)
      .pipe(z.email("Enter a valid email address.")),
  );

export const uuid = z.uuid();

export const otpCode = z
  .string()
  .regex(/^\d{6}$/u, "Enter the six-digit code.");

export const positiveInteger = z.number().int().min(1).max(2_147_483_647);
export const revision = positiveInteger;
export const position = positiveInteger;

// Decimal-string bigint (counts, audit IDs): no sign, no leading zeros, no exponent.
export const decimalString = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/u, "Expected a nonnegative decimal string.")
  .refine(
    (value) => BigInt(value) <= 9_223_372_036_854_775_807n,
    "Out of range.",
  );

/*
 * RFC 3339 instant with an explicit offset. Local or ambiguous date-times are
 * rejected. The value is returned as a UTC ISO string.
 */
export const offsetInstant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

export const ianaTimezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Expected a valid IANA time zone.");

export const confirmed = z.literal(true, {
  error: "Confirmation is required.",
});
