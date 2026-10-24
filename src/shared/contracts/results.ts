import { parseCount } from "@/shared/validation/numbers";

/*
 * Result outcomes (docs/API.md section 5.1). Abstention is never a candidate,
 * so it must not be passed in as an entry.
 */
export const OPEN_OUTCOMES = ["LEADER", "TIE", "NO_VOTES"] as const;
export type OpenOutcome = (typeof OPEN_OUTCOMES)[number];

export const OFFICE_OUTCOMES = ["LEADER", "TIE", "NO_WINNER"] as const;
export type OfficeOutcome = (typeof OFFICE_OUTCOMES)[number];

export interface CountedChoice {
  readonly id: string;
  readonly count: string | bigint;
}

interface Leaders {
  readonly leaderIds: string[];
  readonly hasVotes: boolean;
}

function findLeaders(choices: readonly CountedChoice[]): Leaders {
  let highest = 0n;
  let leaderIds: string[] = [];

  for (const choice of choices) {
    const count = parseCount(choice.count);
    if (count > highest) {
      highest = count;
      leaderIds = [choice.id];
    } else if (count === highest && count > 0n) {
      leaderIds.push(choice.id);
    }
  }

  return { leaderIds, hasVotes: highest > 0n };
}

export function openOutcome(options: readonly CountedChoice[]): {
  outcome: OpenOutcome;
  leaderOptionIds: string[];
} {
  const { leaderIds, hasVotes } = findLeaders(options);

  if (!hasVotes) {
    return { outcome: "NO_VOTES", leaderOptionIds: [] };
  }
  return {
    outcome: leaderIds.length === 1 ? "LEADER" : "TIE",
    leaderOptionIds: leaderIds,
  };
}

/*
 * No positive candidate count (zero submissions or all abstentions) yields
 * NO_WINNER. The "No candidate elected" wording for all-abstention offices
 * depends on approval A5 and is a presentation concern, not decided here.
 */
export function officeOutcome(candidates: readonly CountedChoice[]): {
  outcome: OfficeOutcome;
  leaderCandidateIds: string[];
} {
  const { leaderIds, hasVotes } = findLeaders(candidates);

  if (!hasVotes) {
    return { outcome: "NO_WINNER", leaderCandidateIds: [] };
  }
  return {
    outcome: leaderIds.length === 1 ? "LEADER" : "TIE",
    leaderCandidateIds: leaderIds,
  };
}
