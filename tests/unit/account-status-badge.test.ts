// Compact directory statuses retain names and leave other status badges unchanged.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountStatusBadge } from "@/components/ui/badges";

describe("account status badges", () => {
  it.each([
    ["ENABLED", "Enabled"],
    ["SUSPENDED", "Suspended"],
    ["DELETED", "Deleted"],
  ] as const)(
    "names the %s icon for hover and assistive technology",
    (status, label) => {
      const html = renderToStaticMarkup(
        createElement(AccountStatusBadge, { status, iconOnly: true }),
      );
      expect(html).toContain(`title="${label}"`);
      expect(html).toContain(`<span class="sr-only">${label}</span>`);
      expect(html).toContain("<summary");
      expect(html).toContain("<details");
    },
  );

  it("keeps the normal text badge elsewhere", () => {
    const html = renderToStaticMarkup(
      createElement(AccountStatusBadge, { status: "ENABLED" }),
    );
    expect(html).toContain("Enabled");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("sr-only");
  });
});
