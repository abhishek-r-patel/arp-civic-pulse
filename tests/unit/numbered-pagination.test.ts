// Numbered UI metadata validation and navigation links preserve filters without leaking cursor state.
import { createClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pagination } from "@/components/ui/pagination";
import { numberedPage, readPageNumber } from "@/server/http/numbered-page";
import { decodeCursor } from "@/server/http/cursor";
import { callRoutine, type RegisterDeps } from "@/server/register/shared";
import { z } from "zod";

vi.mock("@/server/register/shared", () => ({ callRoutine: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
const client = createClient(
  "https://synthetic.supabase.co",
  "synthetic-public-key",
);
const deps: RegisterDeps = {
  client,
  admin: client,
  actor: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    representativeName: "Example",
    isAdmin: true,
  },
};
const binding = {
  endpoint: "/admin/residents",
  filters: { isAdmin: false, status: undefined },
};
const meta = {
  totalCount: "143",
  currentPage: 2,
  totalPages: 6,
  position: { id: deps.actor.id },
};
beforeEach(() => vi.mocked(callRoutine).mockReset());

describe("numbered page metadata", () => {
  it("uses the authorized RPC and binds its anchor to the existing list filters", async () => {
    vi.mocked(callRoutine).mockResolvedValue(meta);
    const result = await numberedPage(deps, "residents", 2, 25, binding);
    expect(callRoutine).toHaveBeenCalledWith(client, "get_list_page", {
      p_dataset: "residents",
      p_page: 2,
      p_limit: 25,
      p_filters: { isAdmin: false },
      p_vote_id: null,
    });
    expect(result.numbered).toEqual({
      totalCount: "143",
      currentPage: 2,
      totalPages: 6,
    });
    expect(
      decodeCursor(result.cursor ?? "", binding, z.object({ id: z.string() })),
    ).toEqual(meta.position);
  });
  it.each([
    { ...meta, totalCount: "9007199254740993" },
    { ...meta, totalCount: null },
    { ...meta, totalPages: 1 },
    { ...meta, currentPage: 1 },
    { ...meta, position: null },
  ])(
    "rejects unavailable or inconsistent counts rather than inventing totals",
    async (response) => {
      vi.mocked(callRoutine).mockResolvedValue(response);
      await expect(
        numberedPage(deps, "residents", 2, 25, binding),
      ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    },
  );
  it("represents an empty list as page 1 of 1 and clamps removed final pages", async () => {
    vi.mocked(callRoutine).mockResolvedValue({
      totalCount: "0",
      currentPage: 1,
      totalPages: 1,
      position: null,
    });
    expect(
      (await numberedPage(deps, "residents", 999, 25, binding)).cursor,
    ).toBeUndefined();
  });
  it("validates page input explicitly", () => {
    expect(readPageNumber(undefined)).toBe(1);
    expect(readPageNumber("1000000")).toBe(1_000_000);
    for (const value of ["0", "-1", "1.5", "1000001", "", "abc"]) {
      expect(() => readPageNumber(value)).toThrow();
    }
  });
});

describe("full pagination controls", () => {
  const render = (currentPage = 2, totalCount = "143", totalPages = 6) =>
    renderToStaticMarkup(
      createElement(Pagination, {
        basePath: "/admin/residents",
        params: {
          isAdmin: "all",
          status: "ENABLED",
          cursor: "old",
          page: "99",
          notice: "created",
        },
        page: {
          limit: 25,
          hasMore: true,
          nextCursor: null,
          numbered: { currentPage, totalCount, totalPages },
        },
      }),
    );
  it("shows filtered totals, all four controls and a page-size selector", () => {
    const html = render();
    expect(html).toContain("Page 2 of 6 · 143 results");
    expect(html).not.toContain("Showing");
    for (const name of ["First", "Previous", "Next", "Last"])
      expect(html).toContain(`aria-label="${name} page"`);
    expect(html).toContain('name="limit"');
    expect(html).not.toContain("Apply page size");
    expect(html).not.toContain("Changes apply immediately.");
    expect(html).not.toContain("(optional)");
    expect(html).not.toMatch(/>(First|Previous|Next|Last)</u);
    expect(html).toContain('title="Next page"');
    expect(html).toContain(
      "isAdmin=all&amp;status=ENABLED&amp;limit=25&amp;page=6",
    );
    expect(html).not.toContain("cursor=");
    expect(html).not.toContain('name="cursor"');
    expect(html).not.toContain("notice");
    expect(html).not.toContain('name="page"');
  });
  it("disables the appropriate ends and keeps page-size controls for empty/single pages", () => {
    expect(render(1)).toMatch(
      /aria-disabled="true" aria-label="Previous page"/u,
    );
    expect(render(6)).toContain("Page 6 of 6 · 143 results");
    expect(render(6)).toMatch(/aria-disabled="true" aria-label="Next page"/u);
    const empty = render(1, "0", 1);
    expect(empty).toContain("Page 1 of 1 · 0 results");
    expect(empty).toContain("Page 1 of 1");
    expect(empty).toContain("Per page");
  });
});
