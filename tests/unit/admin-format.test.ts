// Viewer-local administrative timestamps preserve instants and server UTC defaults.
import { describe, expect, it } from "vitest";
import { formatInstant, formatLocalInstant } from "@/components/admin/format";

describe("administrative timestamp formatting", () => {
  const instant = "2026-10-28T23:30:00Z";
  it("uses the supplied viewer zone without a suffix", () => {
    expect(formatLocalInstant(instant, "Asia/Kolkata")).toBe(
      "29 Oct 2026, 05:00",
    );
    expect(formatLocalInstant(instant, "America/New_York")).toBe(
      "28 Oct 2026, 19:30",
    );
  });
  it("respects daylight saving offsets", () => {
    expect(formatLocalInstant("2026-01-28T23:30:00Z", "America/New_York")).toBe(
      "28 Jan 2026, 18:30",
    );
  });
  it("retains explicit UTC for existing server consumers", () => {
    expect(formatInstant(instant)).toBe("28 Oct 2026, 23:30 UTC");
  });
});
