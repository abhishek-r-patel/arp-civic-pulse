import { z } from "zod";

export const PAGE_LIMITS = { default: 25, min: 1, max: 100 } as const;
export const CURSOR_MAX_LENGTH = 512;

const limit = z
  .string()
  .regex(/^\d{1,3}$/u, "Expected an integer.")
  .transform(Number)
  .pipe(z.number().int().min(PAGE_LIMITS.min).max(PAGE_LIMITS.max))
  .default(PAGE_LIMITS.default);

const cursor = z.string().min(1).max(CURSOR_MAX_LENGTH).optional();

// Query booleans are exactly "true" or "false".
export const queryBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/*
 * Unknown filters are rejected by the strict object, so unsupported query
 * parameters return a validation error rather than being ignored.
 */
export function listQuerySchema<Shape extends z.ZodRawShape>(filters: Shape) {
  return z.strictObject({ limit, cursor, ...filters });
}

export interface PageInfo {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}
