// URL behavior for the audit table's filters and page-size control.
import { describe, expect, it } from "vitest";
import { auditTableClearFiltersHref } from "@/components/admin/audit-table-controls";

describe("audit table controls", () => {
  it("clears filters and paging while preserving page size", () => {
    const href = auditTableClearFiltersHref({
      limit: "50",
      action: "VOTE_ACTIVATED",
      targetType: "VOTE",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-10T00:00:00.000Z",
      who: "Asha",
      details: "timezone",
    });
    const params = new URL(href, "https://example.test").searchParams;
    expect(Object.fromEntries(params)).toEqual({ limit: "50" });
  });
});
