// Shared quiet register/report tables with stable semantics and stacked phone rows.
import type { ReactNode } from "react";
import { cn } from "./cn";

/*
 * Data table (docs/DESIGN_SYSTEM.md section 06). A real table from the md
 * breakpoint; on phones each row becomes a stacked label/value card. Explicit
 * ARIA roles keep table semantics even where CSS changes the display type, so
 * reading order and header associations survive on every width. Nothing is
 * truncated: long text wraps, and wider tables scroll within their region.
 */
export interface Column<Row> {
  key: string;
  header: string;
  headerContent?: ReactNode;
  sortDirection?: "ascending" | "descending";
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
  className?: string;
}

type DataTableProps<Row> = Readonly<{
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  stackOnMobile?: boolean;
}>;

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  stackOnMobile = true,
}: DataTableProps<Row>) {
  return (
    <div
      data-data-table
      role="region"
      aria-label={`${caption} table`}
      tabIndex={0}
      className="min-w-0 overflow-x-auto rounded-card border border-border bg-surface shadow-panel"
    >
      <table
        role="table"
        className={cn(
          "w-full text-left text-body tabular-nums",
          stackOnMobile && "max-md:block",
        )}
      >
        <caption className="sr-only">{caption}</caption>
        <thead
          role="rowgroup"
          className={
            stackOnMobile
              ? columns.some((column) => column.headerContent)
                ? "max-md:hidden"
                : "max-md:sr-only"
              : undefined
          }
        >
          <tr
            role="row"
            className="border-b border-border bg-background text-caption text-muted"
          >
            {columns.map((column) => (
              <th
                key={column.key}
                data-column-key={column.key}
                role="columnheader"
                scope="col"
                aria-label={column.headerContent ? column.header : undefined}
                aria-sort={column.sortDirection}
                className={cn(
                  "px-4 py-3 font-semibold",
                  column.numeric && "text-right tabular-nums",
                )}
              >
                {column.headerContent ?? column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          role="rowgroup"
          className={stackOnMobile ? "max-md:block" : undefined}
        >
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              role="row"
              className={cn(
                "transition-colors hover:bg-primary/5",
                stackOnMobile
                  ? "max-md:block max-md:border-b max-md:border-border max-md:p-4 md:border-b md:border-border md:last:border-b-0"
                  : "border-b border-border last:border-b-0",
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-column-key={column.key}
                  role="cell"
                  className={cn(
                    "break-words",
                    stackOnMobile
                      ? "max-md:flex max-md:flex-wrap max-md:items-baseline max-md:gap-x-3 max-md:py-1 md:px-4 md:py-3"
                      : "px-4 py-3",
                    column.numeric &&
                      stackOnMobile &&
                      "md:text-right md:tabular-nums",
                    column.className,
                  )}
                >
                  {stackOnMobile ? (
                    <span className="text-caption font-semibold text-muted md:hidden">
                      {column.header}
                    </span>
                  ) : null}
                  <span className="min-w-0">{column.cell(row)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
