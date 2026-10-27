// Administrative draft and frozen vote projections returned by guarded routines.
import { z } from "zod";
import { VOTE_STATUSES, VOTING_TYPES } from "@/shared/contracts/voting";

/*
 * Administrative vote projections (docs/API.md section 4.4). The routines in
 * supabase/migrations build these; the schemas below re-validate them on the
 * way out so a malformed routine result becomes a safe server error instead of
 * reaching a client. No tallies, counters or per-household data appear here.
 */
export const instant = z
  .string()
  .transform((value) => new Date(value).toISOString());

const candidateProjection = z.object({
  id: z.uuid(),
  name: z.string(),
  position: z.number().int(),
});

export const officeProjection = z.object({
  id: z.uuid(),
  name: z.string(),
  position: z.number().int(),
  candidates: z.array(candidateProjection),
});

export const optionProjection = z.object({
  id: z.uuid(),
  label: z.string(),
  position: z.number().int(),
});

export const adminVoteDetailSchema = z
  .object({
    id: z.uuid(),
    votingType: z.enum(VOTING_TYPES),
    openSelectionMode: z.enum(["SINGLE", "MULTIPLE"]),
    openSelectionLimit: z.number().int().min(1).max(100).nullable(),
    status: z.enum(VOTE_STATUSES),
    title: z.string(),
    instructions: z.string().nullable(),
    closesAt: instant.nullable(),
    opensAt: instant.nullable().optional(),
    scheduledAt: instant.nullable().optional(),
    draftRevision: z.number().int().min(1),
    createdAt: instant,
    updatedAt: instant,
    activatedAt: instant.nullable(),
    completedAt: instant.nullable(),
    completionMode: z.enum(["DEADLINE", "EARLY"]).nullable(),
    completionReason: z.string().nullable(),
    cancelledAt: instant.nullable(),
    cancellationReason: z.string().nullable(),
    rwaName: z.string().nullable(),
    timezone: z.string().nullable(),
    offices: z.array(officeProjection),
    options: z.array(optionProjection),
    eligibleHouseholdIds: z.array(z.uuid()),
  })
  .superRefine((vote, context) => {
    const validModeLimit =
      vote.openSelectionMode === "SINGLE"
        ? vote.openSelectionLimit === 1
        : vote.openSelectionLimit === null || vote.openSelectionLimit >= 2;
    if (
      !validModeLimit ||
      (vote.votingType === "PRIVATE" &&
        (vote.openSelectionMode !== "SINGLE" || vote.openSelectionLimit !== 1))
    ) {
      context.addIssue({
        code: "custom",
        path: ["openSelectionLimit"],
        message: "The selection limit must match the PUBLIC voting mode.",
      });
    }
  });
export type AdminVoteDetail = z.output<typeof adminVoteDetailSchema>;

export const BLOCKER_SECTIONS = [
  "type",
  "details",
  "ballot",
  "electorate",
  "deadline",
  "settings",
] as const;
export type BlockerSection = (typeof BLOCKER_SECTIONS)[number];

export const draftPreviewSchema = z.object({
  revision: z.number().int().min(1),
  readyToActivate: z.boolean(),
  blockers: z.array(
    z.object({
      code: z.string(),
      section: z.enum(BLOCKER_SECTIONS),
      message: z.string(),
    }),
  ),
  electorate: z.object({
    selected: z.number().int().min(0),
    eligibleWithEnabledRepresentative: z.number().int().min(0),
  }),
  vote: adminVoteDetailSchema,
});
export type DraftPreview = z.output<typeof draftPreviewSchema>;

export const rwaDisplaySchema = z.object({
  name: z.string().nullable(),
  timezone: z.string().nullable(),
});
export type RwaDisplay = z.output<typeof rwaDisplaySchema>;

export interface AdminVoteSummary {
  id: string;
  votingType: (typeof VOTING_TYPES)[number];
  status: (typeof VOTE_STATUSES)[number];
  title: string;
  closesAt: string | null;
  opensAt?: string | null;
  draftRevision: number;
  updatedAt: string;
  timezone: string | null;
}

/** A household the administrator may select for a draft. */
export interface SelectableHousehold {
  id: string;
  identifier: string;
  isEligible: boolean;
  representativeName: string;
  representativeEnabled: boolean;
}
