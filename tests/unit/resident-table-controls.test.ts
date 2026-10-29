// URL state and shared table-header semantics for the directory's global controls.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { residentTableQuerySchema } from "@/shared/contracts/admin-votes";
import { DataTable } from "@/components/ui/data-table";
import { SelectField } from "@/components/ui/field";
import { residentTableHref } from "@/components/admin/resident-table-controls";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("resident table controls", () => {
  it("hides repeated select labels while preserving accessible names", () => {
    const html = renderToStaticMarkup(
      createElement(
        SelectField,
        {
          id: "status",
          label: "Status",
          hideLabel: true,
          showOptional: false,
        },
        createElement("option", { value: "ENABLED" }, "Enabled"),
      ),
    );
    expect(html).toContain(
      '<label for="status" class="sr-only">Status</label>',
    );
    expect(html).toContain('aria-label="Status"');
    expect(html).toContain('role="combobox"');
  });
  it("preserves filters and page size while resetting paging and notices", () => {
    const href = residentTableHref(
      {
        page: "4",
        cursor: "old",
        notice: "saved",
        limit: "50",
        representative: "Alice & Bob",
        isAdmin: "all",
        identifier: "A-101",
      },
      { sort: "representative", direction: "desc", identifier: "" },
    );
    const params = new URL(href, "https://example.test").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      limit: "50",
      representative: "Alice & Bob",
      isAdmin: "all",
      sort: "representative",
      direction: "desc",
    });
  });
  it("keeps cursor-list defaults separate and validates table-only state", () => {
    expect(residentTableQuerySchema.parse({})).toMatchObject({
      sort: "household",
      direction: "asc",
      limit: 25,
    });
    expect(residentTableQuerySchema.parse({ sort: "source" }).sort).toBe(
      "source",
    );
    for (const bad of [
      { sort: "email" },
      { direction: "sideways" },
      { representative: "x".repeat(201) },
      {
        changedFrom: "2030-01-02T00:00:00Z",
        changedTo: "2030-01-01T23:00:00Z",
      },
      { changedFrom: "2030-01-01T10:00" },
    ])
      expect(residentTableQuerySchema.safeParse(bad).success).toBe(false);
    expect(
      residentTableQuerySchema.safeParse({
        changedFrom: "2030-01-01T10:00:00+05:30",
        changedTo: "2030-01-01T05:00:00Z",
      }).success,
    ).toBe(true);
  });
  it("supports sortable headers without changing mobile labels or ordinary tables", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable<{ id: string }>, {
        caption: "Directory",
        rows: [{ id: "one" }],
        rowKey: (row) => row.id,
        columns: [
          {
            key: "id",
            header: "Representative",
            headerContent: "Sort Name",
            sortDirection: "ascending",
            cell: (row) => row.id,
          },
        ],
      }),
    );
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('aria-label="Representative"');
    expect(html).toContain("Sort Name");
    expect(html).toContain("Representative");
  });
});
