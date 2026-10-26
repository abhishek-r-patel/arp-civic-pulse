"use client";
// Client access to the RWA's household wording, provided once by the app shell.
import { createContext, useContext, type ReactNode } from "react";
import {
  DEFAULT_HOUSEHOLD_TERMS,
  type HouseholdTerms,
} from "@/shared/contracts/household-terms";

const HouseholdTermsContext = createContext<HouseholdTerms>(
  DEFAULT_HOUSEHOLD_TERMS,
);

export function HouseholdTermsProvider({
  terms,
  children,
}: Readonly<{ terms: HouseholdTerms; children: ReactNode }>) {
  return (
    <HouseholdTermsContext.Provider value={terms}>
      {children}
    </HouseholdTermsContext.Provider>
  );
}

/** Configured household wording; defaults to "Household"/"Household Number". */
export function useHouseholdTerms(): HouseholdTerms {
  return useContext(HouseholdTermsContext);
}
