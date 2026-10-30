// Shared quiet page hierarchy, loading placeholders and explicit empty states in both themes.
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
      className="grid gap-3 border-y border-border py-8 md:py-10"
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
    <header
      data-page-header
      className="grid min-w-0 gap-2 border-b border-border pb-5 md:pb-6"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 sm:items-center">
        <h1 className="min-w-0 flex-1 font-heading text-page-title font-semibold md:text-page-title-lg">
          {title}
        </h1>
        {actions ? (
          // Allowed to shrink and wrap so long or enlarged labels never widen the page.
          <div className="ml-auto flex max-w-full min-w-0 flex-wrap justify-end gap-3">
            {actions}
          </div>
        ) : null}
      </div>
      {description ? (
        <p className="w-full text-body text-muted">{description}</p>
      ) : null}
    </header>
  );
}
