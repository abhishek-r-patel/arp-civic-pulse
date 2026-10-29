// Directory substring searches use Settings suggestions without restricting typed text.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResidentIdentifierFilter } from "@/components/admin/resident-identifier-filter";

const render = (options: string[], defaultValue = "", hideLabel = false) =>
  renderToStaticMarkup(
    createElement(ResidentIdentifierFilter, {
      label: "Villa ID",
      options,
      defaultValue,
      hideLabel,
    }),
  );

describe("resident identifier filter", () => {
  it.each([{ options: [] }, { options: ["V-01"] }])(
    "can hide the repeated label without removing its accessible association ($options)",
    ({ options }) => {
      const html = render(options, "", true);
      expect(html).toContain(
        '<label for="identifier" class="sr-only">Villa ID</label>',
      );
      expect(html).toContain('id="identifier"');
    },
  );
  it("uses the Settings label and configured picker values", () => {
    const html = render(["V-01", "V-02"]);
    expect(html).toContain("Villa ID");
    expect(html).not.toContain("Exact Villa ID");
    expect(html).toContain('role="combobox"');
    expect(html).toContain("V-01");
    expect(html).toContain("V-02");
    expect(html).not.toContain("(optional)");
    expect(html).not.toContain("Information about");
  });

  it("allows manual entry when Settings has no values", () => {
    const html = render([], "V-99");
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain('name="identifier"');
    expect(html).toContain('value="V-99"');
    expect(html).not.toContain("Information about");
  });

  it("preserves bookmarked values removed from Settings", () => {
    const html = render(["V-01"], "V-99");
    expect(html).toContain('name="identifier" value="V-99"');
    expect(html).toContain("V-99");
    expect(html).toContain('value="V-99"');
  });

  it("keeps a blank filter unselected to include all identifiers", () => {
    expect(render(["V-01"])).toContain('name="identifier" value=""');
  });
  it("accepts partial text instead of requiring a Settings suggestion", () => {
    const html = render(["V-01", "V-02"], "v-0");
    expect(html).toContain('name="identifier" value="v-0"');
    expect(html).toContain("V-01");
    expect(html).toContain("V-02");
  });
});
