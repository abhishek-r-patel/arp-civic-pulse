// Shared page-header structure keeps titles, actions, and descriptions aligned.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/ui/layout";

describe("page header", () => {
  it("places right-aligned actions beside the title and description below them", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Manage Votes",
        description: "A full-width description.",
        actions: createElement("button", null, "New Vote"),
      }),
    );

    expect(html).toMatch(
      /<div class="flex min-w-0 flex-wrap items-start justify-between gap-3 sm:items-center"><h1[^>]*>Manage Votes<\/h1><div class="ml-auto flex max-w-full min-w-0 flex-wrap justify-end gap-3"><button>New Vote<\/button><\/div><\/div><p class="w-full text-body text-muted">A full-width description\.<\/p>/,
    );
  });
});
