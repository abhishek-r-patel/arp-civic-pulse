// Exact voting vocabulary and separation of type/status labels.
import { describe, expect, it } from "vitest";
import {
  VOTE_STATUSES,
  VOTE_STATUS_LABELS,
  VOTING_TYPES,
  VOTING_TYPE_LABELS,
} from "@/shared/contracts/voting";

describe("voting vocabulary", () => {
  it("keeps the exact API enum values", () => {
    expect(VOTING_TYPES).toEqual(["PUBLIC", "PRIVATE"]);
    expect(VOTE_STATUSES).toEqual([
      "DRAFT",
      "SCHEDULED",
      "ACTIVE",
      "COMPLETED",
      "CANCELLED",
    ]);
  });

  it("never shares a label between voting types and lifecycle statuses", () => {
    const typeLabels = new Set(Object.values(VOTING_TYPE_LABELS));

    for (const label of Object.values(VOTE_STATUS_LABELS)) {
      expect(typeLabels.has(label)).toBe(false);
    }
  });
});
