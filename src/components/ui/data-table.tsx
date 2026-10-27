// Shared quiet register/report tables with stable semantics and stacked phone rows.
import type { ReactNode } from "react";
import { cn } from "./cn";

/*
 * Data table (docs/DESIGN_SYSTEM.md section 06). A real table from the md
 * breakpoint; on phones each row becomes a stacked label/value card. Explicit
 * ARIA roles keep table semantics even where CSS changes the display type, so
 * reading order and header associations survive on every width. Nothing is
 * truncated: long text wraps.
 */
export interface Column<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
  className?: string;
}

type DataTableProps<Row> = Readonly<{
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
}>;

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
}: DataTableProps<Row>) {
  return (
    <div
      data-data-table
      className="rounded-card border border-border bg-surface shadow-panel"
    >
      <table
        role="table"
        className="w-full text-left text-body tabular-nums max-md:block"
      >
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup" className="max-md:sr-only">
          <tr
            role="row"
            className="border-b border-border bg-background text-caption text-muted"
          >
            {columns.map((column) => (
              <th
                key={column.key}
                role="columnheader"
                scope="col"
                className={cn(
                  "px-4 py-3 font-semibold",
                  column.numeric && "text-right tabular-nums",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-md:block">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              role="row"
              className="transition-colors hover:bg-primary/5 max-md:block max-md:border-b max-md:border-border max-md:p-4 md:border-b md:border-border md:last:border-b-0"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  role="cell"
                  className={cn(
                    "break-words md:px-4 md:py-3",
                    "max-md:flex max-md:flex-wrap max-md:items-baseline max-md:gap-x-3 max-md:py-1",
                    column.numeric && "md:text-right md:tabular-nums",
                    column.className,
                  )}
                >
                  <span className="text-caption font-semibold text-muted md:hidden">
                    {column.header}
                  </span>
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
