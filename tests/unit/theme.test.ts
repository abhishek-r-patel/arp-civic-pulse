/* Contrast gates for Platinum/Obsidian tokens and every RWA accent variant. */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { RWA_ACCENT_PALETTES } from "@/shared/contracts/rwa-profile";
import { APPEARANCE_BOOTSTRAP, APPEARANCE_STORAGE_KEY } from "@/shared/theme";

const css = readFileSync("src/styles/globals.css", "utf8");
const dark = /:root\[data-theme="dark"\]\s*\{([^}]+)\}/u.exec(css)?.[1] ?? "";
const token = (source: string, name: string) => {
  const value = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "iu").exec(
    source,
  )?.[1];
  if (!value) throw new Error(`Missing ${name} token.`);
  return value;
};
function contrast(first: string, second: string) {
  function luminance(hex: string) {
    const channels = [1, 3, 5].map((index) => {
      const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return (
      (channels[0] ?? 0) * 0.2126 +
      (channels[1] ?? 0) * 0.7152 +
      (channels[2] ?? 0) * 0.0722
    );
  }
  const values = [luminance(first), luminance(second)].sort(
    (left, right) => left - right,
  );
  return ((values[1] ?? 0) + 0.05) / ((values[0] ?? 0) + 0.05);
}
describe("theme colour contrast", () => {
  it.each(["primary", "muted", "secondary", "success", "warning", "error"])(
    "keeps %s text readable in both modes",
    (name) => {
      for (const source of [css, dark]) {
        for (const background of ["background", "surface"])
          expect(
            contrast(token(source, name), token(source, background)),
          ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
  it.each(RWA_ACCENT_PALETTES)(
    "keeps %s dark links and filled-button labels readable",
    (palette) => {
      const block =
        new RegExp(
          `:root\\[data-theme="dark"\\] \\[data-palette="${palette}"\\]\\s*\\{([^}]+)\\}`,
          "u",
        ).exec(css)?.[1] ?? "";
      const accent = token(block, "accent");
      expect(contrast(accent, token(dark, "surface"))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(accent, token(dark, "background")),
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, token(dark, "on-accent"))).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );
  it("keeps essential control boundaries visible in both modes", () => {
    for (const source of [css, dark])
      expect(
        contrast(token(source, "control-border"), token(source, "surface")),
      ).toBeGreaterThanOrEqual(3);
  });
  it("keeps warning text readable on the selected-row tinted background", () => {
    expect(contrast(token(css, "warning"), "#e7e9e3")).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

describe("pre-paint appearance", () => {
  it.each([
    [null, true, "dark"],
    [null, false, "light"],
    ["system", true, "dark"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["invalid", true, "dark"],
  ])(
    "resolves %s against system=%s before rendering",
    (stored, systemDark, expected) => {
      const root = {
        style: { colorScheme: "" },
        setAttribute(name: string, value: string) {
          expect(name).toBe("data-theme");
          expect(value).toBe(expected);
        },
      };
      runInNewContext(APPEARANCE_BOOTSTRAP, {
        document: { documentElement: root },
        window: { matchMedia: () => ({ matches: systemDark }) },
        localStorage: {
          getItem(key: string) {
            expect(key).toBe(APPEARANCE_STORAGE_KEY);
            return stored;
          },
          removeItem(key: string) {
            expect(key).toBe(APPEARANCE_STORAGE_KEY);
          },
        },
      });
      expect(root.style.colorScheme).toBe(expected);
    },
  );
  it("falls back to System when browser storage is blocked", () => {
    let theme = "";
    runInNewContext(APPEARANCE_BOOTSTRAP, {
      document: {
        documentElement: {
          style: {},
          setAttribute(_name: string, value: string) {
            theme = value;
          },
        },
      },
      window: { matchMedia: () => ({ matches: true }) },
      localStorage: {
        getItem() {
          throw new Error("Blocked");
        },
      },
    });
    expect(theme).toBe("dark");
  });
});
