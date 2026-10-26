"use client";

/*
 * Shows active vote deadlines in the browser; server/database state remains
 * authoritative for accepting submissions.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { formatCountdown, secondsUntilDeadline } from "@/shared/time/countdown";

export function DeadlineCountdown({
  deadline,
}: Readonly<{ deadline: string }>) {
  const router = useRouter();
  const [remaining, setRemaining] = useState<number | null>(null);
  const refreshRequested = useRef(false);

  useEffect(() => {
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
    <p className="flex items-center gap-2 text-body font-semibold text-error">
      <Clock aria-hidden="true" className="size-5 shrink-0" />
      {remaining === 0 ? (
        <span className="font-semibold">Deadline reached</span>
      ) : (
        <span>
          Time remaining:{" "}
          <time
            dateTime={deadline}
            role="timer"
            aria-live="off"
            className="font-semibold tabular-nums"
          >
            {remaining === null ? "--:--:--" : formatCountdown(remaining)}
          </time>
        </span>
      )}
    </p>
  );
}
