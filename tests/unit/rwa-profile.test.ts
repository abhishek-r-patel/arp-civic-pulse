import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RWA_POSITIONS,
  formatSettingsList,
  parseSettingsList,
  publicRwaIdentitySchema,
  RWA_ACCENT_PALETTES,
  rwaBrandingSchema,
  rwaProfileSchema,
  telephoneHref,
  updateRwaProfileSchema,
} from "@/shared/contracts/rwa-profile";

const profile = {
  fullName: "Residents Welfare Association",
  alias: "RWA",
  address: "RWA Address",
  email: "rwa@email.com",
  phone: "+91 123 456 7890",
  website: "",
  accentPalette: "TEAL",
  welcomeMessage: "",
  householdLabel: "Household",
  identifierKind: "NUMBER",
  defaultHouseholds: [],
  rwaPositions: [...DEFAULT_RWA_POSITIONS],
};
const branding = rwaBrandingSchema.parse(
  Object.fromEntries(
    Object.entries(profile).filter(
      ([key]) => key !== "defaultHouseholds" && key !== "rwaPositions",
    ),
  ),
);

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("RWA accent palettes", () => {
  const css = readFileSync("src/styles/globals.css", "utf8");
  const token = (name: string) =>
    new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "iu").exec(css)?.[1] ?? "";

  it.each(RWA_ACCENT_PALETTES)(
    "%s defines an accent with AA contrast on surface and background",
    (palette) => {
      const block = new RegExp(
        `\\[data-palette="${palette}"\\]\\s*\\{([^}]*)\\}`,
        "u",
      ).exec(css)?.[1];
      expect(block, `${palette} block`).toBeDefined();
      const accent =
        /--color-accent:\s*(#[0-9a-f]{6})/iu.exec(block ?? "")?.[1] ?? "";
      expect(accent).not.toBe("");
      expect(block).toContain("--color-accent-strong");
      expect(contrast(accent, token("surface"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, token("background"))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("keeps the root default aligned with the TEAL preset", () => {
    const teal =
      /\[data-palette="TEAL"\]\s*\{[^}]*--color-accent:\s*(#[0-9a-f]{6})/iu.exec(
        css,
      )?.[1];
    expect(token("accent")).toBe(teal);
  });
});

describe("RWA profile contract", () => {
  it("accepts the configured defaults and normalizes email", () => {
    expect(rwaProfileSchema.parse(profile)).toEqual(profile);
    expect(
      rwaProfileSchema.parse({ ...profile, email: " ADMIN@RWA.COM " }).email,
    ).toBe("admin@rwa.com");
  });

  it("allows blank address, email and phone but requires the core fields", () => {
    expect(
      updateRwaProfileSchema.parse({
        ...profile,
        address: "  ",
        email: " ",
        phone: "",
      }),
    ).toMatchObject({ address: "", email: "", phone: "" });
    for (const key of ["fullName", "alias", "householdLabel"] as const) {
      expect(
        updateRwaProfileSchema.safeParse({ ...profile, [key]: "" }).success,
      ).toBe(false);
    }
  });

  it("accepts only Number or ID as the identifier kind", () => {
    expect(
      updateRwaProfileSchema.safeParse({ ...profile, identifierKind: "ID" })
        .success,
    ).toBe(true);
    for (const identifierKind of ["", "CODE", undefined]) {
      expect(
        updateRwaProfileSchema.safeParse({ ...profile, identifierKind })
          .success,
      ).toBe(false);
    }
  });

  it("accepts an optional HTTP(S) website and rejects other URL schemes", () => {
    expect(
      updateRwaProfileSchema.safeParse({
        ...profile,
        website: "https://example.org",
      }).success,
    ).toBe(true);
    for (const website of [
      "javascript:alert(1)",
      "not a URL",
      "ftp://example.org",
    ]) {
      expect(
        updateRwaProfileSchema.safeParse({ ...profile, website }).success,
      ).toBe(false);
    }
  });

  it("limits the accent palette and keeps the welcome message plain and short", () => {
    expect(
      updateRwaProfileSchema.safeParse({ ...profile, accentPalette: "NEON" })
        .success,
    ).toBe(false);
    expect(
      updateRwaProfileSchema.parse({
        ...profile,
        welcomeMessage: "  Welcome!\r\nSecond line  ",
      }).welcomeMessage,
    ).toBe("Welcome!\nSecond line");
    for (const welcomeMessage of ["<b>Hi</b>", "x".repeat(301)]) {
      expect(
        updateRwaProfileSchema.safeParse({ ...profile, welcomeMessage })
          .success,
      ).toBe(false);
    }
  });

  it("rejects malformed or extra settings fields", () => {
    expect(
      updateRwaProfileSchema.safeParse({
        ...profile,
        email: "not-an-email",
      }).success,
    ).toBe(false);
    expect(
      updateRwaProfileSchema.safeParse({
        ...profile,
        private: "unexpected",
      }).success,
    ).toBe(false);
  });

  it("splits comma-separated lists, dropping blanks and repeats", () => {
    expect(parseSettingsList(" H-101, h-101 ,,H-102,  H  103 ")).toEqual([
      "H-101",
      "H-102",
      "H 103",
    ]);
    expect(parseSettingsList("  ")).toEqual([]);
    expect(formatSettingsList(["President", "Treasurer"])).toBe(
      "President, Treasurer",
    );
  });

  it("validates the default household and position lists", () => {
    expect(
      updateRwaProfileSchema.parse({
        ...profile,
        defaultHouseholds: [" H-101 ", "H-102"],
        rwaPositions: [],
      }),
    ).toMatchObject({
      defaultHouseholds: ["H-101", "H-102"],
      rwaPositions: [],
    });
    for (const change of [
      { defaultHouseholds: ["H-101", "h-101"] },
      { defaultHouseholds: [""] },
      { defaultHouseholds: ["x".repeat(101)] },
      { defaultHouseholds: Array.from({ length: 1001 }, (_, i) => `H-${i}`) },
      { rwaPositions: ["President", " PRESIDENT"] },
      { rwaPositions: ["<b>Chair</b>"] },
      { rwaPositions: Array.from({ length: 51 }, (_, i) => `Office ${i}`) },
      { rwaPositions: "President" },
    ]) {
      expect(
        updateRwaProfileSchema.safeParse({ ...profile, ...change }).success,
      ).toBe(false);
    }
  });

  it("gives members every display value but not the admin lists, and the public only identity", () => {
    expect(rwaBrandingSchema.safeParse(branding).success).toBe(true);
    expect(rwaBrandingSchema.safeParse(profile).success).toBe(false);
    const identity = {
      fullName: profile.fullName,
      alias: profile.alias,
      address: profile.address,
      accentPalette: "TEAL",
      householdLabel: profile.householdLabel,
    };
    expect(publicRwaIdentitySchema.safeParse(identity).success).toBe(true);
    expect(
      publicRwaIdentitySchema.safeParse({ ...identity, email: profile.email })
        .success,
    ).toBe(false);
  });

  it("builds a safe telephone link or none", () => {
    expect(telephoneHref("+91 123 456 7890")).toBe("tel:+911234567890");
    expect(telephoneHref("(022) 2345-6789")).toBe("tel:02223456789");
    expect(telephoneHref("call the office")).toBeNull();
  });
});
