// Manage Votes URL helpers must stay pure so the server page can build empty-state links.
import { describe, expect, it } from "vitest";
import {
  voteTableClearFiltersHref,
  voteTableHref,
} from "@/components/admin/vote-table-urls";

describe("vote table URLs", () => {
  it("applies changes while dropping paging and notices", () => {
    const href = voteTableHref(
      { page: "3", cursor: "old", notice: "saved", status: "ACTIVE" },
      { sort: "deadline", direction: "asc", status: "" },
    );
    expect(
      Object.fromEntries(new URL(href, "https://example.test").searchParams),
    ).toEqual({ sort: "deadline", direction: "asc" });
  });

  it("clears every filter while preserving sort, direction and page size", () => {
    const href = voteTableClearFiltersHref({
      page: "2",
      limit: "50",
      sort: "updated",
      direction: "desc",
      titleContains: "Paint",
      votingType: "PUBLIC",
      status: "ACTIVE",
      deadlineFrom: "2026-10-01T00:00:00Z",
      deadlineTo: "2026-10-31T00:00:00Z",
      changedFrom: "2026-10-01T00:00:00Z",
      changedTo: "2026-10-31T00:00:00Z",
    });
    expect(
      Object.fromEntries(new URL(href, "https://example.test").searchParams),
    ).toEqual({ limit: "50", sort: "updated", direction: "desc" });
  });
});
