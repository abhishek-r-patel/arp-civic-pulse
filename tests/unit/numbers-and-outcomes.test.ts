import { describe, expect, it } from "vitest";
import { officeOutcome, openOutcome } from "@/shared/contracts/results";
import {
  formatCount,
  parseCount,
  percentage as percentageOf,
} from "@/shared/validation/numbers";

// Test inputs are written as numbers or decimal strings for readability.
const percentage = (numerator: number | string, denominator: number | string) =>
  percentageOf(BigInt(numerator), BigInt(denominator));

describe("percentage", () => {
  it("returns null for a zero denominator, never NaN or infinity", () => {
    expect(percentage(0, 0)).toBeNull();
    expect(percentage("0", "0")).toBeNull();
  });

  it("formats exactly two decimal places", () => {
    expect(percentage(0, 7)).toBe("0.00");
    expect(percentage(1, 1)).toBe("100.00");
    expect(percentage(1, 2)).toBe("50.00");
    expect(percentage(1, 3)).toBe("33.33");
    expect(percentage(2, 3)).toBe("66.67");
  });

  it("rounds half up at the third decimal", () => {
    expect(percentage(1, 8)).toBe("12.50");
    expect(percentage(1, 16)).toBe("6.25");
    // 1/32 = 3.125% rounds up, not to even.
    expect(percentage(1, 32)).toBe("3.13");
    // 1/200000 = 0.0005% is below half a hundredth.
    expect(percentage(1, 200_000)).toBe("0.00");
    // 1/20000 = 0.005% is exactly half a hundredth and rounds up.
    expect(percentage(1, 20_000)).toBe("0.01");
  });

  it("stays exact beyond double precision", () => {
    expect(percentage("9007199254740993", "9007199254740993")).toBe("100.00");
    expect(percentage("4503599627370497", "9007199254740993")).toBe("50.00");
  });

  it("rejects a numerator above the denominator", () => {
    expect(() => percentage(3, 2)).toThrow(RangeError);
  });
});

describe("counts", () => {
  it("round-trips decimal strings and bigints", () => {
    expect(parseCount("9223372036854775807")).toBe(9223372036854775807n);
    expect(formatCount(42n)).toBe("42");
  });

  it.each(["", "-1", "01", "1.5", "1e3", " 1", "abc"])(
    "rejects %j",
    (value) => {
      expect(() => parseCount(value)).toThrow(RangeError);
    },
  );

  it("rejects negative bigints", () => {
    expect(() => parseCount(-1n)).toThrow(RangeError);
  });
});

describe("openOutcome", () => {
  it("reports NO_VOTES without leaders for zero responses", () => {
    expect(
      openOutcome([
        { id: "a", count: "0" },
        { id: "b", count: 0n },
      ]),
    ).toEqual({
      outcome: "NO_VOTES",
      leaderOptionIds: [],
    });
  });

  it("reports a unique leader", () => {
    expect(
      openOutcome([
        { id: "a", count: "3" },
        { id: "b", count: "2" },
      ]),
    ).toEqual({
      outcome: "LEADER",
      leaderOptionIds: ["a"],
    });
  });

  it("labels equal highest positive counts a tie without picking a winner", () => {
    expect(
      openOutcome([
        { id: "a", count: "2" },
        { id: "b", count: "2" },
        { id: "c", count: "1" },
      ]),
    ).toEqual({ outcome: "TIE", leaderOptionIds: ["a", "b"] });
  });

  it("handles a later higher count replacing earlier leaders", () => {
    expect(
      openOutcome([
        { id: "a", count: "1" },
        { id: "b", count: "1" },
        { id: "c", count: "5" },
      ]),
    ).toEqual({ outcome: "LEADER", leaderOptionIds: ["c"] });
  });
});

describe("officeOutcome", () => {
  it("has no winner when no candidate has a positive count", () => {
    expect(officeOutcome([{ id: "a", count: "0" }])).toEqual({
      outcome: "NO_WINNER",
      leaderCandidateIds: [],
    });
  });

  it("reports leaders and ties", () => {
    expect(
      officeOutcome([
        { id: "a", count: "4" },
        { id: "b", count: "1" },
      ]),
    ).toEqual({
      outcome: "LEADER",
      leaderCandidateIds: ["a"],
    });
    expect(
      officeOutcome([
        { id: "a", count: "4" },
        { id: "b", count: "4" },
      ]),
    ).toEqual({
      outcome: "TIE",
      leaderCandidateIds: ["a", "b"],
    });
  });
});
