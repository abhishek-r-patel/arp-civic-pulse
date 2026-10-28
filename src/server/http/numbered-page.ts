// Authorized numbered UI windows reuse existing cursor-bound list projections.
import "server-only";
import { z } from "zod";
import { ApiError } from "@/server/http/errors";
import { encodeCursor, type CursorBinding } from "@/server/http/cursor";
import { callRoutine, type RegisterDeps } from "@/server/register/shared";
import type { NumberedPageInfo } from "@/shared/contracts/pagination";
import { pageNumberSchema } from "@/shared/contracts/pagination";

export function readPageNumber(value: string | undefined): number {
  const parsed = pageNumberSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", {
      fieldErrors: [
        {
          field: "page",
          code: "INVALID_PAGE",
          message: "Choose a page between 1 and 1000000.",
        },
      ],
    });
  }
  return parsed.data;
}

const windowSchema = z.object({
  totalCount: z.string().regex(/^\d+$/u),
  currentPage: z.number().int().positive(),
  totalPages: z.number().int().positive(),
  position: z.record(z.string(), z.string()).nullable(),
});

export async function numberedPage(
  deps: RegisterDeps,
  dataset:
    | "residents"
    | "admin-votes"
    | "member-votes"
    | "participation"
    | "audit"
    | "responses",
  requestedPage: number,
  limit: number,
  binding: CursorBinding,
): Promise<{ cursor: string | undefined; numbered: NumberedPageInfo }> {
  const parsed = windowSchema.safeParse(
    await callRoutine(deps.client, "get_list_page", {
      p_dataset: dataset,
      p_page: requestedPage,
      p_limit: limit,
      p_filters: Object.fromEntries(
        Object.entries(binding.filters ?? {}).filter(
          ([, value]) => value !== undefined,
        ),
      ),
      p_vote_id: binding.parentId ?? null,
    }),
  );
  if (!parsed.success) throw new ApiError("INTERNAL_ERROR");
  const { position, ...numbered } = parsed.data;
  const total = Number(numbered.totalCount);
  if (
    !Number.isSafeInteger(total) ||
    numbered.totalPages !== Math.max(1, Math.ceil(total / limit)) ||
    numbered.currentPage !== Math.min(requestedPage, numbered.totalPages) ||
    (numbered.currentPage > 1 && position === null)
  ) {
    throw new ApiError("INTERNAL_ERROR");
  }
  return {
    cursor: position ? encodeCursor(binding, position) : undefined,
    numbered,
  };
}
