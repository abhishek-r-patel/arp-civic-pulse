import { cn } from "@/components/ui/cn";

/*
 * Result rows as "Label   count/total   percent" above a horizontal bar. The
 * text carries the full meaning (screen readers hear "4 of 10 eligible flats,
 * 40%"); bars are decorative. Leaders get the accent colour plus a visible
 * text tag, so the highlight never relies on colour alone. NOTA uses a muted
 * striped bar because it can never win.
 */
export type ResultBarRow = Readonly<{
  id: string;
  label: string;
  count: string;
  percent: string | null;
  tone: "leader" | "default" | "muted";
  tag?: string;
}>;

const percentText = (value: string | null) =>
  value === null ? "—" : `${value}%`;

export function ResultBars({
  label,
  rows,
  total,
  totalNoun,
}: Readonly<{
  label: string;
  rows: readonly ResultBarRow[];
  total: string;
  totalNoun: string;
}>) {
  return (
    <ul aria-label={label} className="grid max-w-ballot gap-4">
      {rows.map((row) => (
        <li key={row.id} className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-x-4">
            <span className="min-w-0 text-body font-semibold text-primary">
              {row.label}
              {row.tag ? (
                <span className="ml-2 inline-block rounded-full border border-accent px-2 text-caption font-semibold text-accent">
                  {row.tag}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-body whitespace-nowrap tabular-nums">
              <span aria-hidden="true">
                <span className="font-semibold">
                  {row.count}/{total}
                </span>{" "}
                <span className="text-muted">{percentText(row.percent)}</span>
              </span>
              <span className="sr-only">
                {row.count} of {total} {totalNoun}, {percentText(row.percent)}
              </span>
            </span>
          </div>
          <div
            aria-hidden="true"
            data-testid="result-bar"
            className="h-3 w-full overflow-hidden rounded-full bg-primary/10"
          >
            <div
              className={cn(
                "h-full rounded-full",
                row.tone === "leader"
                  ? "bg-accent"
                  : row.tone === "muted"
                    ? "bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_3px,transparent_3px_6px)]"
                    : "bg-muted",
              )}
              style={{
                width: `${row.percent === null ? 0 : Number(row.percent)}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
