/*
 * Display-only countdown arithmetic. The database remains authoritative for
 * whether a ballot is accepted at the deadline.
 */
export function secondsUntilDeadline(deadline: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  const remaining = Math.max(0, Math.floor(seconds));
  const days = Math.floor(remaining / 86_400);
  const hours = Math.floor((remaining % 86_400) / 3_600);
  const minutes = Math.floor((remaining % 3_600) / 60);
  const remainingSeconds = remaining % 60;
  const twoDigits = (value: number) => String(value).padStart(2, "0");

  return `${days > 0 ? `${days}d ` : ""}${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(remainingSeconds)}`;
}
