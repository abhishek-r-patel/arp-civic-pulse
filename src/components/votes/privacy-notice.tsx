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
    PUBLIC: `While voting is open, RWA members see only total counts. You can change your vote until voting closes. After that, RWA members can see your name, ${terms.identifierLabel.toLowerCase()} and final vote in results and downloads.`,
    PRIVATE: "Only totals are shown, never who chose what.",
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
      <Notice tone="warning" heading="Your vote is not private">
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
  return <PrivateNotice tone="warning" />;
}

/** One-line PRIVATE notice: bold lead-in followed by the summary sentence. */
export function PrivateNotice({
  tone,
}: Readonly<{ tone: "info" | "warning" }>) {
  return (
    <Notice tone={tone}>
      <p>
        <strong className="font-semibold">Your vote is private</strong>.{" "}
        {PRIVACY_COPY.PRIVATE}
      </p>
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
