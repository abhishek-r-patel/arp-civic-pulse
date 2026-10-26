import { z } from "zod";
import {
  FIELD_LIMITS,
  nameText,
  optionalEmailAddress,
  optionalMultilineText,
  optionalSingleLineText,
  singleLineText,
} from "@/shared/validation/primitives";
import {
  householdLabelSchema,
  identifierKindSchema,
} from "@/shared/contracts/household-terms";

/*
 * RWA profile contracts. The full profile is the administrator settings
 * projection. Signed-in members receive the same display values as branding,
 * and public pages only the identity projection; neither carries approvals,
 * retention or other administrator settings.
 */
export const RWA_ACCENT_PALETTES = [
  "TEAL",
  "BLUE",
  "FOREST",
  "PLUM",
  "SLATE",
] as const;
export type RwaAccentPalette = (typeof RWA_ACCENT_PALETTES)[number];

export const RWA_ACCENT_PALETTE_LABELS: Record<RwaAccentPalette, string> = {
  TEAL: "Teal (default)",
  BLUE: "Blue",
  FOREST: "Forest green",
  PLUM: "Plum",
  SLATE: "Slate",
};

export const DEFAULT_RWA_ACCENT_PALETTE: RwaAccentPalette = "TEAL";
export const WELCOME_MESSAGE_MAX_LENGTH = 300;

const rwaAliasSchema = singleLineText(80);
const rwaWebsiteSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .max(200, "Use at most 200 characters.")
      .refine(
        (value) => value === "" || /^https?:\/\/\S+$/iu.test(value),
        "Enter a website URL starting with http:// or https://.",
      ),
  );

/*
 * Optional administrator-only suggestion lists. Limits mirror the household
 * identifier and office-name bounds and the register/office collection limits
 * (rwa_settings checks in the 20261104100000 migration).
 */
export const DEFAULT_HOUSEHOLDS_MAX_ITEMS = 1_000;
export const DEFAULT_HOUSEHOLD_MAX_LENGTH = FIELD_LIMITS.householdLabel;
export const RWA_POSITIONS_MAX_ITEMS = 50;
export const RWA_POSITION_MAX_LENGTH = FIELD_LIMITS.name;
export const DEFAULT_RWA_POSITIONS = [
  "President",
  "Vice-President",
  "Secretary",
  "Joint-Secretary",
  "Treasurer",
] as const;

// Same comparison as the database's household key normalization.
export function settingsListKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ");
}

function settingsList(maxItems: number, maxLength: number, noun: string) {
  return z
    .array(singleLineText(maxLength))
    .max(maxItems, `Use at most ${maxItems} ${noun}.`)
    .refine(
      (items) => new Set(items.map(settingsListKey)).size === items.length,
      "Remove duplicate entries.",
    );
}

/** Splits comma-separated input, trimming and dropping blanks and repeats. */
export function parseSettingsList(text: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of text.split(",")) {
    const item = raw.replace(/\s+/gu, " ").trim();
    const key = settingsListKey(item);
    if (item && !seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

export function formatSettingsList(items: readonly string[]): string {
  return items.join(", ");
}

// Only fullName, alias and householdLabel are mandatory text (identifierKind
// is always one of its two choices). Every other text
// value may be "" (not provided), and consumers omit empty values. The two
// suggestion lists may be empty.
export const rwaProfileSchema = z.strictObject({
  fullName: nameText,
  alias: rwaAliasSchema,
  address: optionalMultilineText(500),
  email: optionalEmailAddress,
  phone: optionalSingleLineText(40),
  website: rwaWebsiteSchema,
  accentPalette: z.enum(RWA_ACCENT_PALETTES),
  welcomeMessage: optionalMultilineText(WELCOME_MESSAGE_MAX_LENGTH),
  householdLabel: householdLabelSchema,
  identifierKind: identifierKindSchema,
  defaultHouseholds: settingsList(
    DEFAULT_HOUSEHOLDS_MAX_ITEMS,
    DEFAULT_HOUSEHOLD_MAX_LENGTH,
    "entries",
  ),
  rwaPositions: settingsList(
    RWA_POSITIONS_MAX_ITEMS,
    RWA_POSITION_MAX_LENGTH,
    "positions",
  ),
});

export const updateRwaProfileSchema = rwaProfileSchema;
// Members never receive the administrator-only suggestion lists.
export const rwaBrandingSchema = rwaProfileSchema.omit({
  defaultHouseholds: true,
  rwaPositions: true,
});
export const publicRwaIdentitySchema = rwaProfileSchema.pick({
  fullName: true,
  alias: true,
  address: true,
  accentPalette: true,
  householdLabel: true,
});

export type RwaProfile = z.output<typeof rwaProfileSchema>;
export type RwaBranding = z.output<typeof rwaBrandingSchema>;
export type PublicRwaIdentity = z.output<typeof publicRwaIdentitySchema>;

/** Plain-text `tel:` target; keeps digits and a leading plus only. */
export function telephoneHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/gu, "").replace(/(?!^)\+/gu, "");
  return /\d{3}/u.test(digits) ? `tel:${digits}` : null;
}
