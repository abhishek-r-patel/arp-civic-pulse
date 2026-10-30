// Click-to-reveal field help whose panel stays inside the viewport on narrow screens.
"use client";

import { Info } from "lucide-react";
import type { ReactNode, SyntheticEvent } from "react";
import { useRef } from "react";

// Matches the page gutter (px-4) so a shifted panel lines up with the content edge.
const VIEWPORT_GUTTER_PX = 16;

export function FieldInfo({
  label,
  id,
  children,
}: Readonly<{ label: string; id: string; children: ReactNode }>) {
  const panel = useRef<HTMLDivElement>(null);
  // The panel is anchored to the icon, which can sit near the right edge at
  // 320px or 200% text; nudge it left on open so it never widens the page.
  const keepInViewport = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const element = panel.current;
    if (!element || !event.currentTarget.open) return;
    element.style.translate = "";
    const box = element.getBoundingClientRect();
    const limit = document.documentElement.clientWidth - VIEWPORT_GUTTER_PX;
    const overflow = box.right - limit;
    if (overflow > 0) {
      const shift = Math.min(overflow, box.left - VIEWPORT_GUTTER_PX);
      element.style.translate = `${-Math.max(shift, 0)}px 0`;
    }
  };
  return (
    <details className="relative shrink-0" onToggle={keepInViewport}>
      <summary
        aria-label={`Information about ${label}`}
        className="flex size-12 cursor-pointer list-none items-center justify-center rounded-control text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden"
      >
        <Info aria-hidden="true" className="size-5" />
      </summary>
      <div
        ref={panel}
        id={id}
        className="absolute top-full left-0 z-30 mt-1 w-[min(24rem,calc(100vw_-_2rem))] rounded-card border border-accent/40 bg-surface p-4 text-body text-primary shadow-lg"
      >
        {children}
      </div>
    </details>
  );
}
