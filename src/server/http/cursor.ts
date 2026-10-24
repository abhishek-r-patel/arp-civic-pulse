import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/server/http/errors";
import {
  CURSOR_MAX_LENGTH,
  type PageInfo,
} from "@/shared/contracts/pagination";

/*
 * Opaque keyset cursors (docs/API.md section 2.2). A cursor carries only the
 * last-seen sort position and a digest binding it to one endpoint, its filters
 * and the parent vote. It is not an authorization token: every page rechecks
 * access, and a forged position can only change where listing resumes.
 */
const VERSION = 1;

export interface CursorBinding {
  endpoint: string;
  parentId?: string;
  filters?: Readonly<
    Record<string, string | number | boolean | null | undefined>
  >;
}

function digest(binding: CursorBinding): string {
  const filters = Object.entries(binding.filters ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1));

  return createHash("sha256")
    .update(
      JSON.stringify([binding.endpoint, binding.parentId ?? null, filters]),
    )
    .digest("base64url")
    .slice(0, 22);
}

const envelopeSchema = z.strictObject({
  v: z.literal(VERSION),
  b: z.string(),
  p: z.record(z.string(), z.string()),
});

export type CursorPosition = Record<string, string>;

export function encodeCursor(
  binding: CursorBinding,
  position: CursorPosition,
): string {
  const cursor = Buffer.from(
    JSON.stringify({ v: VERSION, b: digest(binding), p: position }),
  ).toString("base64url");

  if (cursor.length > CURSOR_MAX_LENGTH) {
    throw new Error("Cursor exceeds the permitted length.");
  }
  return cursor;
}

function invalidCursor(): ApiError {
  return new ApiError("VALIDATION_FAILED", {
    fieldErrors: [
      {
        field: "cursor",
        code: "INVALID_CURSOR",
        message: "The cursor is not valid for this request.",
      },
    ],
  });
}

export function decodeCursor<Position extends z.ZodType<CursorPosition>>(
  cursor: string,
  binding: CursorBinding,
  positionSchema: Position,
): z.output<Position> {
  if (cursor.length > CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(cursor)) {
    throw invalidCursor();
  }

  let envelope: z.infer<typeof envelopeSchema>;
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) {
      throw invalidCursor();
    }
    envelope = parsed.data;
  } catch {
    throw invalidCursor();
  }

  if (envelope.b !== digest(binding)) {
    throw invalidCursor();
  }

  const position = positionSchema.safeParse(envelope.p);
  if (!position.success) {
    throw invalidCursor();
  }
  return position.data;
}

/*
 * Callers fetch `limit + 1` rows; the extra row proves another page exists and
 * is dropped. The cursor is built from the last returned row.
 */
export function buildPage<Row>(
  rows: readonly Row[],
  limit: number,
  binding: CursorBinding,
  positionOf: (row: Row) => CursorPosition,
): { rows: Row[]; page: PageInfo } {
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);

  return {
    rows: visible,
    page: {
      limit,
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor(binding, positionOf(last)) : null,
    },
  };
}
