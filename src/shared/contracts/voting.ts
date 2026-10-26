export const VOTING_TYPES = ["PUBLIC", "PRIVATE"] as const;
export type VotingType = (typeof VOTING_TYPES)[number];

export const VOTE_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
] as const;
export type VoteStatus = (typeof VOTE_STATUSES)[number];

// Voting type and lifecycle status are separate concepts and never share a label.
export const VOTING_TYPE_LABELS: Record<VotingType, string> = {
  PUBLIC: "PUBLIC voting",
  PRIVATE: "PRIVATE voting",
};

export const VOTE_STATUS_LABELS: Record<VoteStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
