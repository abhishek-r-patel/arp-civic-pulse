import { Notice } from "@/components/ui/notice";
import {
  DEFAULT_HOUSEHOLD_TERMS,
  type HouseholdTerms,
} from "@/shared/contracts/household-terms";
import type { VotingType } from "@/shared/contracts/voting";

/*
 * Voting privacy copy (docs/DESIGN_SYSTEM.md section 09). It lives in one
 * place so ballot, review, and results guidance cannot drift apart.
 */
export function privacyCopy(terms: HouseholdTerms = DEFAULT_HOUSEHOLD_TERMS) {
  return {
    PUBLIC: `While voting is open, eligible members, RWA Admins and RWA ReadOnly observers can see aggregate counts only. You can change your selection until voting closes. After it ends, your name, ${terms.identifierLabel.toLowerCase()} and final selections are visible in authorized results and downloads.`,
    PRIVATE:
      "Your selections are not shown to the Resident, RWA Admin or RWA ReadOnly personas through the app. Results show totals only.",
    CLOSED_LIMITS:
      "This protects choices within the app, not against privileged infrastructure access. Results from very small elections may allow people to infer choices.",
    FINAL:
      "Your PRIVATE election submission is final. You cannot change or withdraw it.",
  } as const;
}

export const PRIVACY_COPY = privacyCopy();

export function PrivacyNotice({
  type,
  terms,
  openSelectionMode = "SINGLE",
}: Readonly<{
  type: VotingType;
  terms: HouseholdTerms;
  openSelectionMode?: "SINGLE" | "MULTIPLE";
}>) {
  const copy = privacyCopy(terms);
  if (type === "PUBLIC") {
    return (
      <Notice tone="warning" heading="Your selections are not private">
        <p>{copy.PUBLIC}</p>
        {openSelectionMode === "MULTIPLE" ? (
          <p className="pt-2">
            Each {terms.household} submits one ballot with one or more selected
            options.
          </p>
        ) : null}
      </Notice>
    );
  }
  return (
    <Notice tone="warning" heading="Your selections are private">
      <p>{copy.PRIVATE}</p>
      <p className="pt-2">{copy.CLOSED_LIMITS}</p>
    </Notice>
  );
}

export function FinalSubmissionNotice() {
  const copy = PRIVACY_COPY;
  return (
    <Notice tone="info" heading="Final submission">
      <p>{copy.FINAL}</p>
    </Notice>
  );
}
