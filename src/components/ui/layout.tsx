import type { ReactNode } from "react";
import { cn } from "./cn";

// Stable placeholder shapes only: no fake values, counts or zero totals.
export function Skeleton({ className }: Readonly<{ className?: string }>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-control bg-border/60", className)}
    />
  );
}

export function ListSkeleton({
  label = "Loading",
  rows = 5,
}: Readonly<{ label?: string; rows?: number }>) {
  return (
    <div role="status" className="grid gap-3">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

// An empty state explains the situation and offers the next safe step.
export function EmptyState({
  title,
  children,
  action,
}: Readonly<{ title: string; children: ReactNode; action?: ReactNode }>) {
  return (
    <section
      aria-labelledby="empty-state-title"
      className="grid gap-3 rounded-card border border-dashed border-control-border bg-surface p-6"
    >
      <h2
        id="empty-state-title"
        className="text-card-heading font-semibold text-primary"
      >
        {title}
      </h2>
      <div className="grid max-w-ballot gap-2 text-body text-muted">
        {children}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: Readonly<{
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}>) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="grid max-w-ballot gap-2">
        <h1 className="text-page-title font-semibold md:text-page-title-lg">
          {title}
        </h1>
        {description ? (
          <p className="text-body text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}
