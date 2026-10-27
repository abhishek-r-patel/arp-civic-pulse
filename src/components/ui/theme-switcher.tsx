/* Keyboard-accessible appearance menu, shared by signed-in and public pages. */
"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { APPEARANCE_MODES } from "@/shared/theme";

const subscribe = () => () => {};
const modeIcons = { light: Sun, dark: Moon, system: Monitor };
const modeLabels = { light: "Light", dark: "Dark", system: "System" };

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const preference =
    (mounted ? APPEARANCE_MODES.find((mode) => mode === theme) : undefined) ??
    "system";
  const Icon = modeIcons[preference];
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !details.current?.contains(event.target) &&
        details.current
      )
        details.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && details.current?.open) {
        details.current.open = false;
        summary.current?.focus();
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <details
      ref={details}
      className="relative shrink-0"
      data-theme-control
      data-theme-ready={mounted ? "true" : "false"}
    >
      <summary
        ref={summary}
        aria-label="Appearance"
        title={`Appearance: ${modeLabels[preference]}`}
        className="inline-flex touch-target cursor-pointer list-none items-center justify-center rounded-control border border-control-border bg-surface text-primary transition-colors hover:bg-primary/5 [&::-webkit-details-marker]:hidden"
      >
        <Icon aria-hidden="true" className="size-5" />
      </summary>
      <fieldset className="absolute top-full right-0 z-50 mt-2 grid w-48 gap-1 rounded-card border border-border bg-surface p-2 text-primary shadow-panel">
        <legend className="sr-only">Appearance mode</legend>
        {APPEARANCE_MODES.map((mode) => {
          const ModeIcon = modeIcons[mode];
          return (
            <label
              key={mode}
              className="flex touch-target cursor-pointer items-center gap-3 rounded-control px-3 text-body hover:bg-primary/5"
            >
              <input
                type="radio"
                name="appearance"
                value={mode}
                checked={preference === mode}
                disabled={!mounted}
                onChange={() => setTheme(mode)}
                className="size-4 accent-accent"
              />
              <ModeIcon aria-hidden="true" className="size-4" />
              {modeLabels[mode]}
            </label>
          );
        })}
      </fieldset>
    </details>
  );
}
