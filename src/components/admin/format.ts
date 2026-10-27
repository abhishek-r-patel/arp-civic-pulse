// Shared presentation helpers for the administrator register screens.

import {
  DEFAULT_HOUSEHOLD_TERMS,
  type HouseholdTerms,
} from "@/shared/contracts/household-terms";

// Flash messages are looked up by key, so arbitrary text can never be reflected from a URL.
export function flashNotices(
  terms: HouseholdTerms = DEFAULT_HOUSEHOLD_TERMS,
): Readonly<Record<string, string>> {
  return {
    "account-created": `Account created. It stays suspended until you assign a ${terms.household} (for residents) and enable it.`,
    "account-updated": "Account updated.",
    "household-created": `${terms.Household} added.`,
    "household-updated": `${terms.Household} updated.`,
    "draft-created":
      "Draft created. Add the details, ballot, electorate and deadline, then preview it.",
    "vote-activated":
      "Vote activated. Its type, ballot, electorate and representatives are now frozen; only the deadline can still be changed.",
    "vote-scheduled":
      "Vote scheduled. Its ballot, electorate and representatives are frozen until it opens or returns to draft.",
    "schedule-withdrawn":
      "Schedule withdrawn. Review the draft and preview it again before scheduling or activating.",
    "vote-completed": "Vote completed early.",
    "vote-cancelled": "Vote cancelled.",
    "deadline-changed":
      "Deadline changed. Residents now see the new deadline and countdown.",
  };
}

export function firstValues(
  params: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== "") {
      result[key] = first;
    }
  }
  return result;
}

// Dates are shown with an explicit time-zone label. The RWA zone is not exposed
// to this screen yet, so these are UTC.
export function formatInstant(iso: string): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(iso))} UTC`;
}
