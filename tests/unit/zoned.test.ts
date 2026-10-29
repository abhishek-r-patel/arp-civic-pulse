import { describe, expect, it } from "vitest";
import {
  defaultDraftClosingLocal,
  formatInZone,
  instantToLocalInput,
  zonedLocalToInstant,
} from "@/shared/time/zoned";

const KOLKATA = "Asia/Kolkata";
const NEW_YORK = "America/New_York";

describe("zonedLocalToInstant", () => {
  it("converts a wall-clock time in a fixed-offset zone", () => {
    expect(zonedLocalToInstant("2026-11-02T18:00", KOLKATA)).toEqual({
      ok: true,
      instant: "2026-11-02T12:30:00.000Z",
    });
  });

  it("preserves seconds when converting a wall-clock deadline", () => {
    expect(zonedLocalToInstant("2026-11-05T23:59:59", KOLKATA)).toEqual({
      ok: true,
      instant: "2026-11-05T18:29:59.000Z",
    });
  });

  it("converts around daylight saving where the time is unambiguous", () => {
    expect(zonedLocalToInstant("2026-07-01T09:00", NEW_YORK)).toEqual({
      ok: true,
      instant: "2026-07-01T13:00:00.000Z",
    });
    expect(zonedLocalToInstant("2026-12-01T09:00", NEW_YORK)).toEqual({
      ok: true,
      instant: "2026-12-01T14:00:00.000Z",
    });
  });

  it("refuses a time that does not exist (clocks go forward)", () => {
    expect(zonedLocalToInstant("2026-03-08T02:30", NEW_YORK)).toEqual({
      ok: false,
      reason: "NONEXISTENT",
    });
  });

  it("refuses a time that happens twice (clocks go back)", () => {
    expect(zonedLocalToInstant("2026-11-01T01:30", NEW_YORK)).toEqual({
      ok: false,
      reason: "AMBIGUOUS",
    });
  });

  it("refuses malformed or impossible input", () => {
    for (const value of [
      "",
      "2026-11-02",
      "2026-11-02T18:00:60",
      "2026-11-02T18:00Z",
      "2026-02-30T10:00",
      "2026-13-01T10:00",
      "2026-11-02T24:00",
    ]) {
      expect(zonedLocalToInstant(value, KOLKATA)).toEqual({
        ok: false,
        reason: "INVALID",
      });
    }
  });
});

describe("instantToLocalInput", () => {
  it("round-trips through the zone", () => {
    const local = "2026-11-02T18:00";
    const converted = zonedLocalToInstant(local, KOLKATA);
    expect(
      converted.ok && instantToLocalInput(converted.instant, KOLKATA),
    ).toBe(local);
  });

  it("is empty when there is no deadline", () => {
    expect(instantToLocalInput(null, KOLKATA)).toBe("");
  });

  it("includes seconds when requested", () => {
    expect(instantToLocalInput("2026-11-05T18:29:59.000Z", KOLKATA, true)).toBe(
      "2026-11-05T23:59:59",
    );
  });
});

describe("defaultDraftClosingLocal", () => {
  it("uses seven local calendar days after creation at 23:59:59", () => {
    expect(defaultDraftClosingLocal("2026-10-29T15:00:00.000Z", KOLKATA)).toBe(
      "2026-11-05T23:59:59",
    );
  });

  it("uses the creation date in the RWA zone before adding calendar days", () => {
    expect(defaultDraftClosingLocal("2026-10-29T23:30:00.000Z", KOLKATA)).toBe(
      "2026-11-06T23:59:59",
    );
  });
});

describe("formatInZone", () => {
  const now = new Date("2026-10-24T00:00:00Z");

  it("labels the time zone", () => {
    expect(formatInZone("2026-11-02T12:30:00.000Z", KOLKATA, now)).toBe(
      "Mon 2 Nov, 6:00 PM IST",
    );
  });

  it("shows the year only when it is not the current year", () => {
    expect(formatInZone("2027-01-05T12:30:00.000Z", KOLKATA, now)).toBe(
      "Tue 5 Jan 2027, 6:00 PM IST",
    );
  });

  it("uses the RWA zone rather than the viewer's", () => {
    expect(formatInZone("2026-12-01T14:00:00.000Z", NEW_YORK, now)).toMatch(
      /^Tue 1 Dec, 9:00 AM (EST|GMT-5)$/u,
    );
  });
});
