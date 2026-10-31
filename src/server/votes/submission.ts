import "server-only";
import { z } from "zod";
import { VOTE_RATE_LIMITS, enforceRateLimit } from "@/server/auth/rate-limit";
import { requireAccount } from "@/server/authorization/account";
import { getRequestTenantContext } from "@/server/config/tenant-context";
import { createAdminClient, createUserClient } from "@/server/db/clients";
import { ApiError } from "@/server/http/errors";
import { callRoutine, type RegisterDeps } from "@/server/register/shared";
import type { Submission } from "@/shared/contracts/ballots";

/*
 * Member voting actions. Everything runs with the signed-in member's OWN
 * session: the guarded routines take identity from the verified JWT and the
 * household from the frozen electorate, never from this layer. The privileged
 * client is used for the rate limiter only, never for submission.
 */

const participationSchema = z.object({
  voteId: z.uuid(),
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]),
  submitted: z.boolean(),
});
export type Participation = z.output<typeof participationSchema>;

const acceptedSchema = z.object({
  accepted: z.boolean(),
  reason: z.string().optional(),
});

/** A verified, enabled member. Entitlement to a particular vote is the database's call. */
export async function memberDeps(): Promise<RegisterDeps> {
  const tenant = await getRequestTenantContext();
  const { account, client } = await requireAccount(
    await createUserClient(tenant),
  );
  return {
    tenant,
    client,
    admin: await createAdminClient(tenant),
    actor: account,
  };
}

export interface SubmissionAck {
  voteId: string;
  submitted: true;
}

/**
 * Submits a first ballot or replaces a PUBLIC response while active. Acknowledges
 * ONLY after the guarded routine commits and returns participation only, never
 * the selection. Deadline refusal commits overdue completion before returning.
 */
export async function submitBallot(
  deps: RegisterDeps,
  voteId: string,
  submission: Submission,
): Promise<SubmissionAck> {
  await enforceRateLimit(
    deps.admin,
    VOTE_RATE_LIMITS.submissionByProfile,
    "profile",
    deps.actor.id,
    "DEPENDENCY_UNAVAILABLE",
  );

  const result = acceptedSchema.safeParse(
    await callRoutine(deps.client, "cast_vote", {
      p_vote_id: voteId,
      p_submission: submission,
    }),
  );
  if (!result.success) {
    throw new ApiError("INTERNAL_ERROR");
  }
  if (!result.data.accepted) {
    throw new ApiError("VOTING_CLOSED");
  }
  return { voteId, submitted: true };
}

/** The member's own committed status, for recovering from an uncertain outcome. */
export async function getParticipation(
  deps: RegisterDeps,
  voteId: string,
): Promise<Participation> {
  await enforceRateLimit(
    deps.admin,
    VOTE_RATE_LIMITS.participationByProfile,
    "profile",
    deps.actor.id,
    "DEPENDENCY_UNAVAILABLE",
  );
  const result = participationSchema.safeParse(
    await callRoutine(deps.client, "get_my_participation", {
      p_vote_id: voteId,
    }),
  );
  if (!result.success) {
    throw new ApiError("INTERNAL_ERROR");
  }
  return result.data;
}
