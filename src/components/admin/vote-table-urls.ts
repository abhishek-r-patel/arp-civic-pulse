// Pure Manage Votes URL helpers, shared by the server page and client table controls.
export type VoteFilterField =
  | "titleContains"
  | "status"
  | "votingType"
  | "deadlineFrom"
  | "deadlineTo"
  | "changedFrom"
  | "changedTo";

export const VOTE_FILTER_FIELDS: readonly VoteFilterField[] = [
  "titleContains",
  "votingType",
  "status",
  "deadlineFrom",
  "deadlineTo",
  "changedFrom",
  "changedTo",
];

type VoteTableParams = Readonly<Record<string, string | undefined>>;

const clearFilterParams = Object.fromEntries(
  VOTE_FILTER_FIELDS.map((field) => [field, ""]),
);

export function voteTableHref(
  params: VoteTableParams,
  changes: Readonly<Record<string, string>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && !["page", "cursor", "notice"].includes(key)) {
      search.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value) search.set(key, value);
    else search.delete(key);
  }
  return `/admin/votes?${search}`;
}

/** Clears every column filter while keeping sort, direction and page size. */
export function voteTableClearFiltersHref(params: VoteTableParams): string {
  return voteTableHref(params, clearFilterParams);
}
