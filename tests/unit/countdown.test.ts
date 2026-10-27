import { describe, expect, it } from "vitest";
import {
  formatCompactCountdown,
  formatCountdown,
  secondsUntilDeadline,
} from "@/shared/time/countdown";

describe("secondsUntilDeadline", () => {
  const deadline = "2026-10-26T12:00:00.000Z";

  it("rounds up partial seconds so a positive remaining time is visible", () => {
    expect(
      secondsUntilDeadline(deadline, Date.parse("2026-10-26T11:59:59.500Z")),
    ).toBe(1);
  });

  it("reaches zero at and after the deadline", () => {
    const atDeadline = Date.parse(deadline);
    expect(secondsUntilDeadline(deadline, atDeadline)).toBe(0);
    expect(secondsUntilDeadline(deadline, atDeadline + 1)).toBe(0);
  });
});

describe("formatCountdown", () => {
  it("formats compact concept-card deadlines without losing the deadline boundary", () => {
    expect(formatCompactCountdown(194400)).toBe("02d 06h");
    expect(formatCompactCountdown(3661)).toBe("01h 01m");
    expect(formatCompactCountdown(120)).toBe("02m");
    expect(formatCompactCountdown(1)).toBe("less than 1m");
  });
  it("formats hours, minutes and seconds with leading zeroes", () => {
    expect(formatCountdown(3_661)).toBe("01:01:01");
  });

  it("adds days for longer deadlines", () => {
    expect(formatCountdown(90_061)).toBe("1d 01:01:01");
  });

  it("never formats a negative remaining time", () => {
    expect(formatCountdown(-1)).toBe("00:00:00");
  });
});
