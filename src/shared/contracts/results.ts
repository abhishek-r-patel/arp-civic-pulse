import { z } from "zod";
import { instant } from "@/shared/contracts/drafts";
import { VOTING_TYPES } from "@/shared/contracts/voting";
import { parseCount, percentage } from "@/shared/validation/numbers";

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

/*
 * The completed-result projection (docs/API.md section 5.1). The database
 * returns exact counts from ONE completion-gated snapshot; this is the only
 * place percentages and outcomes are derived, so the screen, the API and the
 * CSV export cannot disagree.
 */
export const RESULTS_DISCLAIMER =
  "This record is not a signature, a legal certification, or an authorization to spend funds.";

const count = z.string().regex(/^(0|[1-9]\d*)$/u);

export const rawResultsSchema = z.object({
  vote: z.object({
    id: z.uuid(),
    votingType: z.enum(VOTING_TYPES),
    status: z.literal("COMPLETED"),
    title: z.string(),
    instructions: z.string().nullable(),
    closesAt: instant,
    timezone: z.string(),
    rwaName: z.string(),
    policyVersions: z.record(z.string(), z.string()),
    activatedAt: instant,
    completedAt: instant,
    completionMode: z.enum(["DEADLINE", "EARLY"]),
    completionReason: z.string().nullable(),
  }),
  eligibleCount: count,
  submittedCount: count,
  options: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      position: z.number().int(),
      count,
    }),
  ),
  offices: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      position: z.number().int(),
      abstentionCount: count,
      candidates: z.array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          position: z.number().int(),
          count,
        }),
      ),
    }),
  ),
  namedResponses: z
    .array(
      z.object({
        representativeName: z.string(),
        householdIdentifier: z.string(),
        optionId: z.uuid(),
        optionLabel: z.string(),
        cursor: z.object({ key: z.string(), householdId: z.uuid() }),
      }),
    )
    .nullable(),
  namedPage: z.object({ hasMore: z.boolean() }).nullable(),
});
export type RawResults = z.output<typeof rawResultsSchema>;

export interface NamedResponse {
  representativeName: string;
  householdIdentifier: string;
  optionId: string;
  optionLabel: string;
}

export interface Turnout {
  numerator: string;
  denominator: string;
  percent: string | null;
}

export type ResultsVote = RawResults["vote"];

interface ResultsBase {
  vote: ResultsVote;
  disclaimer: string;
  eligibleCount: string;
  submittedCount: string;
  turnout: Turnout;
}

export interface OpenResults extends ResultsBase {
  votingType: "OPEN";
  options: {
    id: string;
    label: string;
    count: string;
    percent: string | null;
  }[];
  outcome: OpenOutcome;
  leaderOptionIds: string[];
  namedResponses: NamedResponse[];
}

export interface ClosedResults extends ResultsBase {
  votingType: "CLOSED";
  offices: {
    id: string;
    name: string;
    candidates: {
      id: string;
      name: string;
      count: string;
      percent: string | null;
    }[];
    abstention: { count: string; percent: string | null };
    outcome: OfficeOutcome;
    leaderCandidateIds: string[];
  }[];
}

export type VoteResults = OpenResults | ClosedResults;

export function projectResults(raw: RawResults): VoteResults {
  const submitted = raw.submittedCount;
  const base: ResultsBase = {
    vote: raw.vote,
    disclaimer: RESULTS_DISCLAIMER,
    eligibleCount: raw.eligibleCount,
    submittedCount: submitted,
    turnout: {
      numerator: submitted,
      denominator: raw.eligibleCount,
      percent: percentage(submitted, raw.eligibleCount),
    },
  };

  if (raw.vote.votingType === "OPEN") {
    const options = raw.options.map((option) => ({
      id: option.id,
      label: option.label,
      count: option.count,
      percent: percentage(option.count, submitted),
    }));
    return {
      ...base,
      votingType: "OPEN",
      options,
      ...openOutcome(options),
      namedResponses: (raw.namedResponses ?? []).map((named) => ({
        representativeName: named.representativeName,
        householdIdentifier: named.householdIdentifier,
        optionId: named.optionId,
        optionLabel: named.optionLabel,
      })),
    };
  }

  return {
    ...base,
    votingType: "CLOSED",
    offices: raw.offices.map((office) => ({
      id: office.id,
      name: office.name,
      candidates: office.candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        count: candidate.count,
        percent: percentage(candidate.count, submitted),
      })),
      abstention: {
        count: office.abstentionCount,
        percent: percentage(office.abstentionCount, submitted),
      },
      ...officeOutcome(office.candidates),
    })),
  };
}
