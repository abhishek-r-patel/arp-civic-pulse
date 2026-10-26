import { describe, expect, it } from "vitest";
import {
  buildHouseholdTerms,
  DEFAULT_HOUSEHOLD_TERMS,
  householdLabelSchema,
  identifierKindSchema,
  pluralizeLabel,
} from "@/shared/contracts/household-terms";

describe("household terms", () => {
  it.each([
    ["Flat Number", "Flat Numbers"],
    ["Apartment Number", "Apartment Numbers"],
    ["Villa ID", "Villa IDs"],
    ["Address", "Addresses"],
    ["Property", "Properties"],
  ])("pluralizes %s as %s", (label, expected) => {
    expect(pluralizeLabel(label)).toBe(expected);
  });

  it("returns no plural for an empty draft value", () => {
    expect(pluralizeLabel("")).toBe("");
  });

  it("defaults to Household and Household Number", () => {
    expect(DEFAULT_HOUSEHOLD_TERMS).toEqual({
      Household: "Household",
      Households: "Households",
      household: "household",
      households: "households",
      identifierKind: "NUMBER",
      identifierLabel: "Household Number",
      identifierLabelPlural: "Household Numbers",
    });
  });

  it("builds heading, sentence and identifier wording from the two settings", () => {
    expect(buildHouseholdTerms("Villa", "ID")).toMatchObject({
      Household: "Villa",
      Households: "Villas",
      household: "villa",
      households: "villas",
      identifierLabel: "Villa ID",
      identifierLabelPlural: "Villa IDs",
    });
    expect(buildHouseholdTerms("Row House", "NUMBER")).toMatchObject({
      households: "row houses",
      identifierLabel: "Row House Number",
    });
    // Acronyms keep their case mid-sentence; a lowercase label is capitalised in headings.
    expect(buildHouseholdTerms("RWA Unit").household).toBe("RWA unit");
    expect(buildHouseholdTerms("flat").Household).toBe("Flat");
    expect(buildHouseholdTerms("  ").Household).toBe("Household");
  });

  it("validates the household label as short single-line plain text", () => {
    expect(householdLabelSchema.parse("  Flat  ")).toBe("Flat");
    expect(householdLabelSchema.safeParse(" ").success).toBe(false);
    expect(householdLabelSchema.safeParse("Flat\nNumber").success).toBe(false);
    expect(householdLabelSchema.safeParse("<b>Flat</b>").success).toBe(false);
    expect(householdLabelSchema.safeParse("x".repeat(41)).success).toBe(false);
  });

  it("accepts only Number or ID as the identifier kind", () => {
    expect(identifierKindSchema.safeParse("NUMBER").success).toBe(true);
    expect(identifierKindSchema.safeParse("ID").success).toBe(true);
    expect(identifierKindSchema.safeParse("CODE").success).toBe(false);
  });
});
