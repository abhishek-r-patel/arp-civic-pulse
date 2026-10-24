/*
 * Wall-clock times in the RWA's IANA time zone. The API only accepts instants
 * with an explicit UTC offset, so the browser converts what a person typed in
 * the RWA's zone. A local time that happens twice (clocks going back) or never
 * (clocks going forward) is refused rather than guessed.
 */
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-IN", { timeZone, ...options });
}

function wallClock(instantMs: number, timeZone: string): WallClock {
  const parts = formatter(timeZone, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

function wallClockAsUtcMs(clock: WallClock): number {
  return Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
}

// Milliseconds the zone is ahead of UTC at that instant.
function offsetMs(instantMs: number, timeZone: string): number {
  const whole = Math.floor(instantMs / 1000) * 1000;
  return wallClockAsUtcMs(wallClock(whole, timeZone)) - whole;
}

export type LocalConversion =
  | { ok: true; instant: string }
  | { ok: false; reason: "INVALID" | "NONEXISTENT" | "AMBIGUOUS" };

/** Converts `YYYY-MM-DDTHH:mm` typed in `timeZone` to a UTC ISO instant. */
export function zonedLocalToInstant(
  local: string,
  timeZone: string,
): LocalConversion {
  const match = LOCAL_INPUT.exec(local);
  if (!match) {
    return { ok: false, reason: "INVALID" };
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  const roundTrip = new Date(wanted);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute
  ) {
    return { ok: false, reason: "INVALID" };
  }

  // Candidate offsets around the wanted time cover any single transition.
  const day24 = 24 * 60 * 60 * 1000;
  const offsets = new Set([
    offsetMs(wanted - day24, timeZone),
    offsetMs(wanted + day24, timeZone),
  ]);
  const matches = new Set<number>();
  for (const offset of offsets) {
    const candidate = wanted - offset;
    if (wallClockAsUtcMs(wallClock(candidate, timeZone)) === wanted) {
      matches.add(candidate);
    }
  }

  if (matches.size === 0) {
    return { ok: false, reason: "NONEXISTENT" };
  }
  if (matches.size > 1) {
    return { ok: false, reason: "AMBIGUOUS" };
  }
  const [only] = [...matches] as [number];
  return { ok: true, instant: new Date(only).toISOString() };
}

/** The value for a datetime-local input showing `instant` in `timeZone`. */
export function instantToLocalInput(
  instant: string | null,
  timeZone: string,
): string {
  if (!instant) {
    return "";
  }
  const clock = wallClock(new Date(instant).getTime(), timeZone);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${String(clock.year).padStart(4, "0")}-${two(clock.month)}-${two(clock.day)}T${two(clock.hour)}:${two(clock.minute)}`;
}

/**
 * "Sat 2 Nov, 6:00 PM IST". The year appears only when it is not the current
 * year in that zone, so a deadline next year is never ambiguous.
 */
export function formatInZone(
  instant: string,
  timeZone: string,
  now: Date = new Date(),
): string {
  const date = new Date(instant);
  const parts = formatter(timeZone, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const sameYear =
    wallClock(now.getTime(), timeZone).year === Number(read("year"));
  const calendar = `${read("weekday")} ${read("day")} ${read("month")}${sameYear ? "" : ` ${read("year")}`}`;
  const time = `${read("hour")}:${read("minute")} ${read("dayPeriod").toUpperCase()}`;
  return `${calendar}, ${time} ${read("timeZoneName")}`;
}
