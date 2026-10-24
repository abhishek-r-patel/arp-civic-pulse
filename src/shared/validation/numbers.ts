/*
 * Shared numeric policy (docs/API.md sections 2.1 and 5.1).
 * Counts are bigint decimal strings; percentages are decimal strings rounded
 * half-up to two places using exact integer arithmetic (no floating point).
 */

const DECIMAL_COUNT = /^(0|[1-9]\d*)$/u;

export function parseCount(value: string | bigint): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new RangeError("Counts cannot be negative.");
    }
    return value;
  }
  if (!DECIMAL_COUNT.test(value)) {
    throw new RangeError("Counts must be nonnegative decimal strings.");
  }
  return BigInt(value);
}

export function formatCount(value: bigint): string {
  return parseCount(value).toString();
}

// Returns null when the denominator is zero; never NaN, infinity or a guess.
export function percentage(
  numerator: string | bigint,
  denominator: string | bigint,
): string | null {
  const top = parseCount(numerator);
  const bottom = parseCount(denominator);

  if (bottom === 0n) {
    return null;
  }
  if (top > bottom) {
    throw new RangeError("Numerator cannot exceed the denominator.");
  }

  // Hundredths of a percent, rounded half-up: floor((top * 10000 * 2 + bottom) / (bottom * 2)).
  const hundredths = (top * 20_000n + bottom) / (bottom * 2n);
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, "0");

  return `${whole}.${fraction}`;
}
