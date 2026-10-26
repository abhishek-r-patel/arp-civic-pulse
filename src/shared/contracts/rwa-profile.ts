import { z } from "zod";
import {
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

// Only fullName, alias and householdLabel are mandatory text (identifierKind
// is always one of its two choices). Every other text
// value may be "" (not provided), and consumers omit empty values.
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
});

export const updateRwaProfileSchema = rwaProfileSchema;
export const rwaBrandingSchema = rwaProfileSchema;
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
