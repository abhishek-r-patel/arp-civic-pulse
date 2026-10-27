// Guarded vote activation, scheduling, deadline and terminal transitions.
import "server-only";
import { ApiError } from "@/server/http/errors";
import { log } from "@/server/observability/logger";
import {
  assertCurrentAdmin,
  callRoutine,
  type RegisterDeps,
} from "@/server/register/shared";
import {
  adminVoteDetailSchema,
  type AdminVoteDetail,
} from "@/shared/contracts/drafts";

/*
 * Activation, deadline changes and terminal transitions. Every change runs in a guarded routine
 * that re-checks the caller, locks the vote, applies the transition and its
 * audit event atomically. The database clock decides what is overdue.
 */
function parseDetail(value: unknown): AdminVoteDetail {
  const result = adminVoteDetailSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError("INTERNAL_ERROR");
  }
  return result.data;
}

interface Outcome {
  applied: boolean;
  reason?: string;
  vote: unknown;
}

// A refused action still committed the overdue completion; the caller is told why.
function appliedOrConflict(outcome: Outcome): AdminVoteDetail {
  const vote = parseDetail(outcome.vote);
  if (!outcome.applied) {
    throw new ApiError("LIFECYCLE_CONFLICT", {
      context: { reason: outcome.reason ?? "DEADLINE_PASSED" },
    });
  }
  return vote;
}

export async function activateVote(
  deps: RegisterDeps,
  id: string,
  expectedRevision: number,
): Promise<AdminVoteDetail> {
  await assertCurrentAdmin(deps);
  return parseDetail(
    await callRoutine(deps.client, "activate_vote", {
      p_vote_id: id,
      p_expected_revision: expectedRevision,
      p_confirmed: true,
    }),
  );
}

export async function completeVoteEarly(
  deps: RegisterDeps,
  id: string,
  reason: string,
): Promise<AdminVoteDetail> {
  await assertCurrentAdmin(deps);
  return appliedOrConflict(
    await callRoutine<Outcome>(deps.client, "complete_vote_early", {
      p_vote_id: id,
      p_confirmed: true,
      p_reason: reason,
    }),
  );
}

export async function scheduleVote(
  deps: RegisterDeps,
  id: string,
  expectedRevision: number,
  opensAt: string,
): Promise<AdminVoteDetail> {
  await assertCurrentAdmin(deps);
  return parseDetail(
    await callRoutine(deps.client, "schedule_vote", {
      p_vote_id: id,
      p_expected_revision: expectedRevision,
      p_confirmed: true,
      p_opens_at: opensAt,
    }),
  );
}

export async function withdrawVoteSchedule(
  deps: RegisterDeps,
  id: string,
  reason: string,
): Promise<AdminVoteDetail> {
  await assertCurrentAdmin(deps);
  return parseDetail(
    await callRoutine(deps.client, "withdraw_vote_schedule", {
      p_vote_id: id,
      p_confirmed: true,
      p_reason: reason,
    }),
  );
}

export async function cancelVote(
  deps: RegisterDeps,
  id: string,
  reason: string,
): Promise<AdminVoteDetail> {
  await assertCurrentAdmin(deps);
  return appliedOrConflict(
    await callRoutine<Outcome>(deps.client, "cancel_vote", {
      p_vote_id: id,
      p_confirmed: true,
      p_reason: reason,
    }),
  );
}

/**
 * Moves an ACTIVE vote's deadline. Refused with VALIDATION_FAILED (reason
 * DEADLINE_TOO_SOON or DEADLINE_UNCHANGED) or, when the current deadline has
 * already passed, LIFECYCLE_CONFLICT after the vote completes at it.
 */
export async function changeVoteDeadline(
  deps: RegisterDeps,
  id: string,
  closesAt: string,
  reason: string,
): Promise<AdminVoteDetail> {
  await assertCurrentAdmin(deps);
  return appliedOrConflict(
    await callRoutine<Outcome>(deps.client, "change_vote_deadline", {
      p_vote_id: id,
      p_closes_at: closesAt,
      p_confirmed: true,
      p_reason: reason,
    }),
  );
}

/**
 * Finalises one vote that is past its deadline, using the server-only
 * credential. Best effort: a failure must not stop an administrator from
 * seeing the vote, because Cron and every admission check enforce the deadline
 * independently.
 */
export async function reconcileOverdue(
  deps: RegisterDeps,
  id: string,
): Promise<boolean> {
  try {
    const result = await callRoutine<{ completed: boolean }>(
      deps.admin,
      "reconcile_vote",
      { p_vote_id: id },
    );
    return result.completed;
  } catch (error) {
    log("warn", "votes.reconcile_failed", {
      errorCode: error instanceof ApiError ? error.code : "UNKNOWN",
    });
    return false;
  }
}
