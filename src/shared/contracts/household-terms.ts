import { z } from "zod";
import { singleLineText } from "@/shared/validation/primitives";

/*
 * RWA-configured wording for one household (for example "Flat", "Apartment"
 * or "Villa") and for its identifier ("Flat Number" or "Flat ID"). This is
 * display wording only: stored household identifiers keep their own
 * validation and normalization contract.
 */
export const IDENTIFIER_KINDS = ["NUMBER", "ID"] as const;
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

export const IDENTIFIER_KIND_LABELS: Record<IdentifierKind, string> = {
  NUMBER: "Number",
  ID: "ID",
};

export const HOUSEHOLD_LABEL_MAX_LENGTH = 40;
export const DEFAULT_HOUSEHOLD_LABEL = "Household";
export const DEFAULT_IDENTIFIER_KIND: IdentifierKind = "NUMBER";
export const HOUSEHOLD_LABEL_SUGGESTIONS = [
  "Household",
  "Flat",
  "Apartment",
  "Villa",
  "House",
  "Unit",
] as const;

export const householdLabelSchema = singleLineText(HOUSEHOLD_LABEL_MAX_LENGTH);
export const identifierKindSchema = z.enum(IDENTIFIER_KINDS);

export interface HouseholdTerms {
  /** Configured label as typed, for headings and labels: "Flat". */
  Household: string;
  /** Plural for headings and labels: "Flats". */
  Households: string;
  /** Mid-sentence singular: "flat" (acronyms keep their case). */
  household: string;
  /** Mid-sentence plural: "flats". */
  households: string;
  identifierKind: IdentifierKind;
  /** Identifier wording: "Flat Number" or "Flat ID". */
  identifierLabel: string;
  /** Plural identifier wording: "Flat Numbers" or "Flat IDs". */
  identifierLabelPlural: string;
}

export function pluralizeLabel(label: string): string {
  if (label.trim() === "") {
    return "";
  }
  const match = /^(.*\s)?([a-z]+)([^a-z]*)$/iu.exec(label);
  if (!match) {
    return `${label}s`;
  }

  const [, matchedPrefix, word, suffix] = match;
  if (!word || suffix === undefined) {
    return `${label}s`;
  }

  const prefix = matchedPrefix ?? "";
  const lower = word.toLowerCase();
  const plural = /[^aeiou]y$/u.test(lower)
    ? `${word.slice(0, -1)}ies`
    : /(s|x|z|ch|sh)$/u.test(lower)
      ? `${word}es`
      : `${word}s`;
  return `${prefix}${plural}${suffix}`;
}

/** Lowercases ordinary capitalised words ("Row House" -> "row house") but keeps acronyms ("RWA Unit" -> "RWA unit"). */
function sentenceCase(label: string): string {
  return label.replace(/\p{Lu}\p{Ll}+/gu, (word) => word.toLowerCase());
}

function capitalise(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function buildHouseholdTerms(
  householdLabel: string = DEFAULT_HOUSEHOLD_LABEL,
  identifierKind: IdentifierKind = DEFAULT_IDENTIFIER_KIND,
): HouseholdTerms {
  const label = householdLabel.trim() || DEFAULT_HOUSEHOLD_LABEL;
  const Household = capitalise(label);
  const Households = pluralizeLabel(Household);
  const identifierLabel = `${Household} ${IDENTIFIER_KIND_LABELS[identifierKind]}`;
  return {
    Household,
    Households,
    household: sentenceCase(label),
    households: sentenceCase(pluralizeLabel(label)),
    identifierKind,
    identifierLabel,
    identifierLabelPlural: pluralizeLabel(identifierLabel),
  };
}

export const DEFAULT_HOUSEHOLD_TERMS = buildHouseholdTerms();
