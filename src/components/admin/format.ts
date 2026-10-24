// Shared presentation helpers for the administrator register screens.

// Flash messages are looked up by key, so arbitrary text can never be reflected from a URL.
export const FLASH_NOTICES: Readonly<Record<string, string>> = {
  "account-created":
    "Account created. It stays suspended until you assign a household (for residents) and enable it.",
  "account-updated": "Account updated.",
  "household-created": "Household added.",
  "household-updated": "Household updated.",
};

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
