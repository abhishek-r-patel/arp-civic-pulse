// Manage Votes toolbar semantics and all-viewport sort/filter controls.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  VoteTableToolbar,
  type VoteTableState,
} from "@/components/admin/vote-table-controls";
import {
  OPTIONAL_VOTE_COLUMNS,
  visibleVoteColumnKeys,
} from "@/components/admin/vote-table-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("vote table controls", () => {
  it("keeps Vote, Status, and Turnout visible by default on compact screens", () => {
    expect(visibleVoteColumnKeys(true, new Set())).toEqual([
      "title",
      "status",
      "turnout",
    ]);
  });

  it.each(OPTIONAL_VOTE_COLUMNS)(
    "shows the selected $label column on compact screens",
    ({ key }) => {
      const visible = visibleVoteColumnKeys(true, new Set([key]));

      expect(visible).toContain(key);
      for (const column of OPTIONAL_VOTE_COLUMNS) {
        if (column.key !== key) expect(visible).not.toContain(column.key);
      }
    },
  );

  it("shows all columns on desktop regardless of compact-screen preferences", () => {
    expect(visibleVoteColumnKeys(false, new Set())).toEqual([
      "title",
      "type",
      "status",
      "deadline",
      "updated",
      "turnout",
    ]);
  });

  it("uses the shared sort/filter and clear-filter icons at every viewport", () => {
    const html = renderToStaticMarkup(
      createElement(VoteTableToolbar, {
        state: {
          params: {},
          sort: "updated",
          direction: "desc",
        } satisfies VoteTableState,
      }),
    );

    expect(html).toContain('aria-label="Sort &amp; Filter"');
    expect(html).toContain('aria-label="Clear filters"');
    expect(html).toContain('title="Clear filters"');
    expect(html).toContain("lucide-arrow-up");
    expect(html).toContain("lucide-arrow-down");
    expect(html).toContain("lucide-circle");
    expect(html).toContain("lucide-x");
    expect(html).toContain('name="sort"');
    expect(html).toContain('name="direction"');
    expect(html).not.toContain('aria-label="Filter Votes"');
    expect(html).not.toContain(">Clear filters</a>");
  });

  it("marks applied filters without treating sort settings as filters", () => {
    const renderToolbar = (params: VoteTableState["params"]) =>
      renderToStaticMarkup(
        createElement(VoteTableToolbar, {
          state: {
            params,
            sort: "updated",
            direction: "desc",
          },
        }),
      );

    expect(renderToolbar({ sort: "updated", direction: "desc" })).not.toContain(
      "Filter applied",
    );
    expect(renderToolbar({ status: "ACTIVE" })).toContain("Filter applied");
  });
});
