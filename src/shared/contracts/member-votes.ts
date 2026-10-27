// Resident-safe vote summaries, ballots, participation and audit projections.
import { z } from "zod";
import {
  instant,
  officeProjection,
  optionProjection,
} from "@/shared/contracts/drafts";
import { listQuerySchema, queryBoolean } from "@/shared/contracts/pagination";
import { VOTING_TYPES } from "@/shared/contracts/voting";

/*
 * Member vote projections (docs/API.md section 4.2). A member sees only their
 * own frozen entitlements and their OWN submission state: never drafts, the
 * electorate, other households' participation, counters or selections. The
 * routines in supabase/migrations build these and the schemas below validate
 * them on the way out.
 */
const MEMBER_STATUSES = [
  "SCHEDULED",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
] as const;

export const memberVoteListQuerySchema = listQuerySchema({
  status: z.enum(MEMBER_STATUSES).optional(),
  votingType: z.enum(VOTING_TYPES).optional(),
});

export const memberVoteSummarySchema = z.object({
  id: z.uuid(),
  votingType: z.enum(VOTING_TYPES),
  status: z.enum(MEMBER_STATUSES),
  title: z.string(),
  closesAt: instant,
  opensAt: instant.nullable().optional(),
  scheduledAt: instant.nullable().optional(),
  timezone: z.string(),
  activatedAt: instant,
  completedAt: instant.nullable(),
  cancelledAt: instant.nullable(),
  submitted: z.boolean(),
});
export type MemberVoteSummary = z.output<typeof memberVoteSummarySchema>;

export interface MemberVoteOverview {
  active: number;
  scheduled: number;
  responded: number;
}

export interface VoteCardTurnout {
  eligibleCount: string;
  submittedCount: string;
  percent: string | null;
}

/** The list routine also returns a position for the cursor, which never leaves the server. */
export const memberVoteRowSchema = memberVoteSummarySchema.extend({
  cursor: z.object({
    rank: z.number().int(),
    key: z.string().regex(/^-?\d{1,20}$/u),
    id: z.uuid(),
  }),
});

export const memberVoteListSchema = z.object({
  rows: z.array(memberVoteRowSchema),
  hasMore: z.boolean(),
});

export const policyVersionsSchema = z.record(z.string(), z.string());

export const memberVoteDetailSchema = z
  .object({
    id: z.uuid(),
    votingType: z.enum(VOTING_TYPES),
    openSelectionMode: z.enum(["SINGLE", "MULTIPLE"]),
    openSelectionLimit: z.number().int().min(1).max(100).nullable(),
    status: z.enum(MEMBER_STATUSES),
    title: z.string(),
    instructions: z.string().nullable(),
    closesAt: instant,
    opensAt: instant.nullable().optional(),
    scheduledAt: instant.nullable().optional(),
    timezone: z.string(),
    rwaName: z.string(),
    policyVersions: policyVersionsSchema,
    activatedAt: instant,
    completedAt: instant.nullable(),
    completionMode: z.enum(["DEADLINE", "EARLY"]).nullable(),
    completionReason: z.string().nullable(),
    cancelledAt: instant.nullable(),
    cancellationReason: z.string().nullable(),
    offices: z.array(officeProjection),
    options: z.array(optionProjection),
    /** False for an administrator who is not in this vote's frozen electorate. */
    entitled: z.boolean(),
    submitted: z.boolean().nullable(),
    /** PUBLIC voters can replace their response until closure; PRIVATE ballots remain one-shot. */
    canSubmit: z.boolean(),
    exportFormats: z.array(z.enum(["csv", "pdf"])),
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
export type MemberVoteDetail = z.output<typeof memberVoteDetailSchema>;

/** The response adds the notice type so a client never infers privacy copy from other fields. */
export type MemberVoteDetailResponse = MemberVoteDetail & {
  privacyNotice: "PUBLIC" | "PRIVATE";
};

export const participationMonitorQuerySchema = listQuerySchema({
  submitted: queryBoolean.optional(),
});

export const participationMonitorSchema = z.object({
  voteId: z.uuid(),
  status: z.enum(MEMBER_STATUSES),
  eligibleCount: z.string(),
  submittedCount: z.string(),
  rows: z.array(
    z.object({
      representativeName: z.string(),
      householdIdentifier: z.string(),
      submitted: z.boolean(),
      cursor: z.object({ key: z.string(), householdId: z.uuid() }),
    }),
  ),
  hasMore: z.boolean(),
});

export const auditListSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string().regex(/^\d{1,19}$/u),
      actorKind: z.enum(["PROFILE", "SYSTEM", "DEPLOYMENT"]),
      actorProfileId: z.uuid().nullable(),
      actorName: z.string().nullable(),
      action: z.string(),
      targetType: z.string(),
      targetId: z.string(),
      occurredAt: instant,
      reason: z.string().nullable(),
      details: z.record(z.string(), z.unknown()),
    }),
  ),
  hasMore: z.boolean(),
});
export type AuditEvent = z.output<typeof auditListSchema>["rows"][number];
