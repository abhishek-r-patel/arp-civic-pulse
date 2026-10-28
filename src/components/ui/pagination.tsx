// Compact list navigation with filtered totals and automatic page-size submission.
"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { controlClasses } from "@/components/ui/field";
import type { PageInfo } from "@/shared/contracts/pagination";

type PaginationProps = Readonly<{
  basePath: string;
  params: Readonly<Record<string, string | undefined>>;
  page: PageInfo;
}>;

const linkClasses =
  "inline-flex touch-target items-center justify-center gap-2 rounded-control border border-control-border bg-surface px-3 py-3 font-semibold text-primary hover:bg-primary/5";

export function Pagination({ basePath, params, page }: PaginationProps) {
  const { numbered, limit } = page;
  if (!numbered) throw new Error("Numbered pagination metadata is required.");
  const { currentPage, totalPages, totalCount } = numbered;
  const filters = Object.entries(params).filter(
    ([key, value]) =>
      !["cursor", "page", "limit", "notice"].includes(key) &&
      value !== undefined,
  );
  function href(target: number) {
    const search = new URLSearchParams();
    for (const [key, value] of filters) {
      if (value !== undefined) search.set(key, value);
    }
    search.set("limit", String(limit));
    search.set("page", String(target));
    return `${basePath}?${search}`;
  }
  const controls = [
    {
      label: "First",
      target: 1,
      disabled: currentPage === 1,
      Icon: ChevronsLeft,
    },
    {
      label: "Previous",
      target: currentPage - 1,
      disabled: currentPage === 1,
      Icon: ArrowLeft,
    },
    {
      label: "Next",
      target: currentPage + 1,
      disabled: currentPage === totalPages,
      Icon: ArrowRight,
    },
    {
      label: "Last",
      target: totalPages,
      disabled: currentPage === totalPages,
      Icon: ChevronsRight,
    },
  ];
  return (
    <nav
      aria-label="Pagination"
      className="grid gap-4 border-t border-border pt-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <form
          action={basePath}
          method="get"
          className="flex items-center gap-3"
        >
          {filters.map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <label
            htmlFor="pagination-limit"
            className="text-body font-semibold whitespace-nowrap text-primary"
          >
            Per page
          </label>
          <select
            id="pagination-limit"
            name="limit"
            defaultValue={String(limit)}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className={`${controlClasses} w-auto border-control-border`}
          >
            {[...new Set([10, 25, 50, 100, limit])]
              .sort((a, b) => a - b)
              .map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
          </select>
        </form>
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
          {controls.map(({ label, target, disabled, Icon }, index) => (
            <div key={label} className="contents">
              {index === 2 ? (
                <p
                  className="order-first w-full py-2 text-center text-caption tabular-nums sm:order-none sm:w-auto sm:px-2"
                  aria-current="page"
                  aria-live="polite"
                >
                  Page {currentPage} of {totalPages} · {totalCount} results
                </p>
              ) : null}
              {disabled ? (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  aria-label={`${label} page`}
                  title={`${label} page`}
                  className={`${linkClasses} opacity-50`}
                >
                  <Icon aria-hidden="true" className="size-4" />
                </button>
              ) : (
                <Link
                  href={href(target)}
                  aria-label={`${label} page`}
                  title={`${label} page`}
                  rel={
                    label === "Next"
                      ? "next"
                      : label === "Previous"
                        ? "prev"
                        : undefined
                  }
                  className={linkClasses}
                >
                  <Icon aria-hidden="true" className="size-4" />
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}
