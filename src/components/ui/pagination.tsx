import Link from "next/link";
import { ArrowRight, RotateCcw } from "lucide-react";
import type { PageInfo } from "@/shared/contracts/pagination";

/*
 * Keyset pagination only moves forward (docs/API.md section 2.2): there is no
 * offset or page count. Filters are preserved in the link; "First page" resets.
 */
type PaginationProps = Readonly<{
  basePath: string;
  // Active filters, excluding the cursor.
  params: Readonly<Record<string, string | undefined>>;
  page: PageInfo;
  hasCursor: boolean;
}>;

function href(
  basePath: string,
  params: Readonly<Record<string, string | undefined>>,
  cursor?: string,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  if (cursor) {
    search.set("cursor", cursor);
  }
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

const linkClasses =
  "inline-flex touch-target items-center gap-2 rounded-control border border-control-border bg-surface px-4 py-3 font-semibold text-primary hover:bg-primary/5";

export function Pagination({
  basePath,
  params,
  page,
  hasCursor,
}: PaginationProps) {
  if (!page.hasMore && !hasCursor) {
    return null;
  }

  return (
    <nav aria-label="Pagination" className="flex flex-wrap gap-3">
      {hasCursor ? (
        <Link href={href(basePath, params)} className={linkClasses}>
          <RotateCcw aria-hidden="true" className="size-4" />
          First page
        </Link>
      ) : null}
      {page.hasMore && page.nextCursor ? (
        <Link
          href={href(basePath, params, page.nextCursor)}
          className={linkClasses}
          rel="next"
        >
          Next page
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
    </nav>
  );
}
