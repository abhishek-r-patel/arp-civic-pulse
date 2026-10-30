// Shared, viewport-aware column filter popover used by sortable data tables.
"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, Circle, Filter, Funnel, X } from "lucide-react";

export function SortFilterIcon() {
  return (
    <span aria-hidden="true" className="relative block size-5">
      <Funnel className="absolute bottom-0 left-0 size-4" />
      <ArrowUp className="absolute top-0 right-0 size-2" />
      <ArrowDown className="absolute top-2 right-0 size-2" />
    </span>
  );
}

export function ClearFiltersIcon() {
  return (
    <span aria-hidden="true" className="relative block size-5">
      <Funnel className="absolute bottom-0 left-0 size-4" />
      <Circle className="absolute top-0 right-0 size-3" />
      <X className="absolute top-0.5 right-0.5 size-2" />
    </span>
  );
}

export function TableFilterPopover({
  label,
  active,
  icon,
  children,
}: Readonly<{
  label: string;
  active?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}>) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 16, left: 16 });
  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const height =
      panel.current?.getBoundingClientRect().height || innerHeight * 0.7;
    setPosition({
      top: Math.max(16, Math.min(rect.bottom + 8, innerHeight - height - 16)),
      left: Math.max(16, Math.min(rect.left, innerWidth - 336)),
    });
  }, []);
  useEffect(() => {
    function resize() {
      if (panel.current?.matches(":popover-open")) place();
    }
    const observer = new ResizeObserver(resize);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [place]);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        popoverTarget={id}
        aria-label={label}
        title={label}
        aria-describedby={active ? `${id}-active` : undefined}
        className={`inline-flex size-12 shrink-0 items-center justify-center rounded-control hover:bg-accent/10 ${active ? "text-accent" : "text-muted"}`}
        onClick={place}
      >
        {icon ?? <Filter aria-hidden="true" className="size-4" />}
        {active ? (
          <span aria-hidden="true" className="text-caption">
            *
          </span>
        ) : null}
        {active ? (
          <span id={`${id}-active`} className="sr-only">
            Filter applied
          </span>
        ) : null}
      </button>
      <div
        id={id}
        ref={panel}
        popover="auto"
        role="dialog"
        onToggle={(event) => {
          if (event.newState === "open") place();
        }}
        aria-label={label}
        style={position}
        className="fixed inset-auto m-0 max-h-[70dvh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-card border border-border bg-surface p-4 text-left text-body font-normal text-primary shadow-panel"
      >
        <p className="mb-3 font-semibold">{label}</p>
        {children}
      </div>
    </>
  );
}
