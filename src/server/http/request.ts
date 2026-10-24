import type { z } from "zod";
import { ApiError, validationError } from "@/server/http/errors";

export const BODY_LIMITS = {
  // Authentication, submission and lifecycle bodies.
  small: 16 * 1024,
  // Draft edits carry ballot configuration and the electorate.
  draft: 512 * 1024,
} as const;

const MAX_JSON_DEPTH = 16;

function isJsonMediaType(header: string | null): boolean {
  if (!header) {
    return false;
  }
  const [type, ...parameters] = header.split(";").map((part) => part.trim());
  if (type?.toLowerCase() !== "application/json") {
    return false;
  }
  return parameters.every((parameter) => {
    const [name, value] = parameter.split("=").map((part) => part.trim());
    return (
      name?.toLowerCase() !== "charset" ||
      value?.replace(/^"|"$/gu, "").toLowerCase() === "utf-8"
    );
  });
}

// Reads at most `maxBytes`, aborting as soon as the limit is exceeded.
async function readBounded(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    throw new ApiError("REQUEST_TOO_LARGE");
  }
  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError("REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function exceedsDepth(value: unknown, depth: number): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (depth > MAX_JSON_DEPTH) {
    return true;
  }
  return Object.values(value).some((child) => exceedsDepth(child, depth + 1));
}

export async function readJson(
  request: Request,
  maxBytes: number = BODY_LIMITS.small,
): Promise<unknown> {
  if (!isJsonMediaType(request.headers.get("content-type"))) {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
  }

  const bytes = await readBounded(request, maxBytes);

  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError("MALFORMED_JSON");
  }

  if (exceedsDepth(parsed, 1)) {
    throw new ApiError("REQUEST_TOO_LARGE");
  }
  return parsed;
}

export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  maxBytes: number = BODY_LIMITS.small,
): Promise<z.output<Schema>> {
  const result = schema.safeParse(await readJson(request, maxBytes));
  if (!result.success) {
    throw validationError(result.error);
  }
  return result.data;
}

// Repeated parameters are ambiguous and rejected rather than silently collapsed.
export function parseQuery<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): z.output<Schema> {
  const values = new Map<string, string>();

  for (const [key, value] of new URL(request.url).searchParams) {
    if (values.has(key)) {
      throw new ApiError("VALIDATION_FAILED", {
        fieldErrors: [
          {
            field: key,
            code: "DUPLICATE_PARAMETER",
            message: "Provide this parameter once.",
          },
        ],
      });
    }
    values.set(key, value);
  }

  const result = schema.safeParse(Object.fromEntries(values));
  if (!result.success) {
    throw validationError(result.error);
  }
  return result.data;
}

export function parseParams<Schema extends z.ZodType>(
  params: unknown,
  schema: Schema,
): z.output<Schema> {
  const result = schema.safeParse(params);
  if (!result.success) {
    // A malformed identifier is indistinguishable from an inaccessible record.
    throw new ApiError("NOT_FOUND");
  }
  return result.data;
}
