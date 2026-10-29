// Compact directory statuses retain names and leave other status badges unchanged.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AccountStatusBadge,
  RegistrationSourceBadge,
  RoleBadge,
} from "@/components/ui/badges";

describe("account status badges", () => {
  it.each([
    [{ isAdmin: false }, "Voter", "success"],
    [{ isAdmin: false, isReadonly: true }, "RWA ReadOnly", "warning"],
    [{ isAdmin: true }, "RWA Admin", "error"],
    [
      { isAdmin: false, isReadonly: true, isAppSupport: true },
      "App Support (ReadOnly)",
      "warning",
    ],
  ] as const)(
    "colours role %j without removing its label",
    (props, label, tone) => {
      const html = renderToStaticMarkup(createElement(RoleBadge, props));
      expect(html).toContain(label);
      expect(html).toContain(`border-${tone}/40`);
      expect(html).toContain(`text-${tone}`);
      expect(html).toContain("<svg");
    },
  );
  it.each([
    [true, "Self-registered"],
    [false, "Admin-registered"],
  ] as const)(
    "names registration source %s for hover, keyboard and touch",
    (selfRegistered, label) => {
      const html = renderToStaticMarkup(
        createElement(RegistrationSourceBadge, { selfRegistered }),
      );
      expect(html).toContain(`title="${label}"`);
      expect(html).toContain(`<span class="sr-only">${label}</span>`);
      expect(html).toContain(selfRegistered ? "lucide-user" : "lucide-shield");
      expect(html).toContain("<summary");
      expect(html).toContain("<details");
    },
  );
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
