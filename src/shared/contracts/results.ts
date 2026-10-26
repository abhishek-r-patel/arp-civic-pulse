import { z } from "zod";
import { instant } from "@/shared/contracts/drafts";
import { VOTING_TYPES } from "@/shared/contracts/voting";
import { parseCount, percentage } from "@/shared/validation/numbers";

/*
 * Result outcomes (docs/API.md section 5.1). NOTA is a recorded choice, not a
 * candidate; it does not compete for the elected-candidate outcome.
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
 * The highest positive candidate count determines the outcome independently
 * of NOTA. Zero candidate votes (including ballots that all chose NOTA) yields
 * NO_WINNER; a NOTA total cannot itself become an elected candidate.
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
 * Result projections (docs/API.md section 5.1). The database returns exact
 * counts from one authorized snapshot; this is the only place percentages and
 * outcomes are derived, so the screen, API and CSV cannot disagree. `percent`
 * is the share of submitted ballots; `eligiblePercent` is the share of the
 * whole frozen electorate, used by the bar charts on screen and in the PDF.
 */
export const RESULTS_DISCLAIMER =
  "This record is not a signature, a legal certification, or an authorization to spend funds.";

const count = z.string().regex(/^(0|[1-9]\d*)$/u);

export const rawResultsSchema = z
  .object({
    vote: z.object({
      id: z.uuid(),
      votingType: z.enum(VOTING_TYPES),
      openSelectionMode: z.enum(["SINGLE", "MULTIPLE"]),
      openSelectionLimit: z.number().int().min(1).max(100).nullable(),
      status: z.enum(["ACTIVE", "COMPLETED"]),
      title: z.string(),
      instructions: z.string().nullable(),
      closesAt: instant,
      timezone: z.string(),
      rwaName: z.string(),
      policyVersions: z.record(z.string(), z.string()),
      activatedAt: instant,
      completedAt: instant.nullable(),
      completionMode: z.enum(["DEADLINE", "EARLY"]).nullable(),
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
        notaCount: count,
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
          optionLabels: z.array(z.string()).min(1),
          cursor: z.object({ key: z.string(), householdId: z.uuid() }),
        }),
      )
      .nullable(),
    namedPage: z.object({ hasMore: z.boolean() }).nullable(),
  })
  .superRefine((result, context) => {
    const validSelection =
      result.vote.openSelectionMode === "SINGLE"
        ? result.vote.openSelectionLimit === 1
        : result.vote.openSelectionLimit === null ||
          result.vote.openSelectionLimit >= 2;
    if (
      !validSelection ||
      (result.vote.votingType === "PRIVATE" &&
        (result.vote.openSelectionMode !== "SINGLE" ||
          result.vote.openSelectionLimit !== 1))
    ) {
      context.addIssue({
        code: "custom",
        path: ["vote", "openSelectionLimit"],
        message: "The selection settings do not match the voting type.",
      });
    }
    if (result.vote.status === "ACTIVE") {
      if (
        result.vote.completedAt !== null ||
        result.vote.completionMode !== null ||
        result.vote.completionReason !== null ||
        result.namedResponses !== null ||
        result.namedPage !== null ||
        (result.vote.votingType === "PUBLIC"
          ? result.offices.length !== 0
          : result.options.length !== 0 || result.offices.length !== 0)
      ) {
        context.addIssue({
          code: "custom",
          message: "Active results must contain only permitted aggregates.",
        });
      }
      return;
    }

    if (
      result.vote.completedAt === null ||
      result.vote.completionMode === null ||
      (result.vote.votingType === "PUBLIC"
        ? result.namedResponses === null || result.namedPage === null
        : result.namedResponses !== null || result.namedPage !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed result details do not match the voting type.",
      });
    }
  });
export type RawResults = z.output<typeof rawResultsSchema>;

export interface NamedResponse {
  representativeName: string;
  householdIdentifier: string;
  optionLabels: string[];
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
  votingType: "PUBLIC";
  options: {
    id: string;
    label: string;
    count: string;
    percent: string | null;
    eligiblePercent: string | null;
  }[];
  outcome: OpenOutcome;
  leaderOptionIds: string[];
  namedResponses: NamedResponse[];
}

export interface ClosedResults extends ResultsBase {
  votingType: "PRIVATE";
  status: "COMPLETED";
  vote: Omit<ResultsVote, "status" | "votingType"> & {
    status: "COMPLETED";
    votingType: "PRIVATE";
  };
  offices: {
    id: string;
    name: string;
    candidates: {
      id: string;
      name: string;
      count: string;
      percent: string | null;
      eligiblePercent: string | null;
    }[];
    nota: {
      count: string;
      percent: string | null;
      eligiblePercent: string | null;
    };
    outcome: OfficeOutcome;
    leaderCandidateIds: string[];
  }[];
}

export interface ActiveClosedResults extends ResultsBase {
  votingType: "PRIVATE";
  status: "ACTIVE";
  vote: Omit<ResultsVote, "status" | "votingType"> & {
    status: "ACTIVE";
    votingType: "PRIVATE";
  };
  offices: [];
}

export type VoteResults = OpenResults | ClosedResults | ActiveClosedResults;

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

  if (raw.vote.votingType === "PUBLIC") {
    const options = raw.options.map((option) => ({
      id: option.id,
      label: option.label,
      count: option.count,
      percent: percentage(option.count, submitted),
      eligiblePercent: percentage(option.count, raw.eligibleCount),
    }));
    return {
      ...base,
      votingType: "PUBLIC",
      options,
      ...openOutcome(options),
      namedResponses: (raw.namedResponses ?? []).map((named) => ({
        representativeName: named.representativeName,
        householdIdentifier: named.householdIdentifier,
        optionLabels: named.optionLabels,
      })),
    };
  }

  if (raw.vote.status === "ACTIVE") {
    return {
      ...base,
      vote: {
        ...raw.vote,
        status: "ACTIVE",
        votingType: "PRIVATE",
      },
      votingType: "PRIVATE",
      status: "ACTIVE",
      offices: [],
    };
  }

  return {
    ...base,
    vote: {
      ...raw.vote,
      status: "COMPLETED",
      votingType: "PRIVATE",
    },
    votingType: "PRIVATE",
    status: "COMPLETED",
    offices: raw.offices.map((office) => ({
      id: office.id,
      name: office.name,
      candidates: office.candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        count: candidate.count,
        percent: percentage(candidate.count, submitted),
        eligiblePercent: percentage(candidate.count, raw.eligibleCount),
      })),
      nota: {
        count: office.notaCount,
        percent: percentage(office.notaCount, submitted),
        eligiblePercent: percentage(office.notaCount, raw.eligibleCount),
      },
      ...officeOutcome(office.candidates),
    })),
  };
}
