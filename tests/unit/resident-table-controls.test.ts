// URL state, toolbar semantics and shared table behavior for Residents.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { residentTableQuerySchema } from "@/shared/contracts/admin-votes";
import { DataTable } from "@/components/ui/data-table";
import { SelectField } from "@/components/ui/field";
import {
  residentTableClearFiltersHref,
  residentTableHref,
  ResidentTableToolbar,
  type ResidentTableState,
} from "@/components/admin/resident-table-controls";

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
  it("clears filters while preserving the current sort and page size", () => {
    const href = residentTableClearFiltersHref({
      page: "4",
      cursor: "old",
      notice: "saved",
      limit: "50",
      representative: "Alice",
      identifier: "A-101",
      status: "SUSPENDED",
      isAdmin: "all",
      isEligible: "false",
      changedFrom: "2026-10-01T00:00",
      changedTo: "2026-10-10T00:00",
      selfRegistered: "true",
      sort: "source",
      direction: "desc",
    });
    const params = new URL(href, "https://example.test").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      limit: "50",
      sort: "source",
      direction: "desc",
    });
  });
  it("uses accessible icon-only controls for sorting, filtering, and clearing", () => {
    const html = renderToStaticMarkup(
      createElement(ResidentTableToolbar, {
        state: {
          params: {},
          identifiers: [],
          sort: "representative",
          direction: "asc",
        },
      }),
    );
    expect(html).toContain('aria-label="Sort &amp; Filter"');
    expect(html).toContain('aria-label="Clear filters"');
    expect(html).toContain('title="Clear filters"');
    expect(html).toContain("lucide-arrow-up");
    expect(html).toContain("lucide-arrow-down");
    expect(html).toContain("lucide-circle");
    expect(html).toContain("lucide-x");
    expect(html.match(/relative block size-5/g)).toHaveLength(2);
    expect(html).not.toContain(">Clear filters</a>");
    expect(html).not.toContain(">Sort &amp; Filter</span>");
  });
  it("announces when filters are active but not for the all-roles default", () => {
    const renderToolbar = (params: ResidentTableState["params"]) =>
      renderToStaticMarkup(
        createElement(ResidentTableToolbar, {
          state: {
            params,
            identifiers: [],
            sort: "representative",
            direction: "asc",
          },
        }),
      );
    expect(renderToolbar({ isAdmin: "all" })).not.toContain("Filter applied");
    expect(renderToolbar({ status: "SUSPENDED" })).toContain("Filter applied");
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
