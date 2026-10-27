/*
 * Shows informational opening/deadline countdowns and refreshes at zero;
 * server/database state remains authoritative for accepting submissions.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import {
  formatCompactCountdown,
  formatCountdown,
  secondsUntilDeadline,
} from "@/shared/time/countdown";

export function DeadlineCountdown({
  deadline,
  opening = false,
  compact = false,
}: Readonly<{ deadline: string; opening?: boolean; compact?: boolean }>) {
  const router = useRouter();
  const [remaining, setRemaining] = useState<number | null>(null);
  const refreshRequested = useRef(false);

  useEffect(() => {
    // A changed deadline (an administrator moved it) may need its own refresh.
    refreshRequested.current = false;
    const update = () => {
      const next = secondsUntilDeadline(deadline, Date.now());
      setRemaining(next);
      if (next === 0 && !refreshRequested.current) {
        refreshRequested.current = true;
        router.refresh();
      }
    };

    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [deadline, router]);

  // Red draws attention to the deadline; the clock icon and text keep it from
  // relying on colour alone.
  return (
    <p
      title={deadline}
      className={
        compact
          ? "inline-flex max-w-full items-center gap-1 rounded-control bg-warning/10 px-2 py-1 text-xs font-semibold text-warning"
          : "flex items-center gap-2 text-body font-semibold text-error"
      }
    >
      <Clock
        aria-hidden="true"
        className={compact ? "size-3.5 shrink-0" : "size-5 shrink-0"}
      />
      {remaining === 0 ? (
        <span className="font-semibold">
          {opening ? "Opening time reached" : "Deadline reached"}
        </span>
      ) : (
        <span>
          {opening ? "Opens in" : compact ? "Closes in" : "Time remaining:"}{" "}
          <time
            dateTime={deadline}
            role="timer"
            aria-live="off"
            className="font-semibold tabular-nums"
          >
            {remaining === null
              ? "--"
              : compact
                ? formatCompactCountdown(remaining)
                : formatCountdown(remaining)}
          </time>
        </span>
      )}
    </p>
  );
}
