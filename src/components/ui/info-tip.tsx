"use client";
// Compact (i) disclosure: explanatory text stays hidden until the reader
// hovers over or clicks/taps the icon. Escape or an outside click closes it.
import { Info } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

type InfoTipProps = Readonly<{
  /** Content shown before the icon, for example a section heading. */
  heading: ReactNode;
  /** Accessible name of the icon button, for example "About NOTA". */
  label: string;
  children: ReactNode;
}>;

export function InfoTip({ heading, label, children }: InfoTipProps) {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHovered(false);
        setPinned(false);
        button.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setHovered(false);
        setPinned(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // Only a real mouse hover opens the panel; touch relies on the tap toggle.
  const hoverProps = {
    onPointerEnter: (event: ReactPointerEvent) => {
      if (event.pointerType !== "mouse") return;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      setHovered(true);
    },
    onPointerLeave: (event: ReactPointerEvent) => {
      if (event.pointerType !== "mouse") return;
      // A short grace period lets the pointer travel from the icon to the panel.
      closeTimer.current = setTimeout(() => setHovered(false), 150);
    },
  };

  return (
    <div ref={root} className="relative">
      <div className="flex flex-wrap items-center gap-1">
        {heading}
        <button
          ref={button}
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setPinned((current) => !current)}
          className="inline-flex touch-target items-center justify-center rounded-control text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          {...hoverProps}
        >
          <Info aria-hidden="true" className="size-5" />
        </button>
      </div>
      <div
        id={panelId}
        hidden={!open}
        className="absolute top-full left-0 z-20 mt-1 w-full max-w-ballot rounded-card border border-accent/40 bg-surface p-4 text-body text-primary shadow-lg"
        {...hoverProps}
      >
        <p className="pb-1 font-semibold text-accent">{label}</p>
        {children}
      </div>
    </div>
  );
}
