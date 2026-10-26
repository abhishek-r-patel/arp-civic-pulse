import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { RegisterDeps } from "@/server/register/shared";
import {
  createDraft,
  listSelectableHouseholds,
  updateDraft,
} from "@/server/votes/drafts";
import { activateVote } from "@/server/votes/lifecycle";
import { getParticipation, submitBallot } from "@/server/votes/submission";
import type { AdminVoteDetail } from "@/shared/contracts/drafts";
import {
  adminClient,
  hasLive,
  hasSql,
  publicClient,
  withSql,
} from "./support/live";
import { apiError, signIn, type SignedIn } from "./support/session";

/*
 * Member submission against real Supabase Auth, PostgREST and RLS, with real
 * signed-in sessions. Fixture policy approvals are recorded only so votes can
 * be activated on this DISPOSABLE project; they are not real approvals.
 */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!hasLive || !hasSql)("live: member submission", () => {
  let admin: SupabaseClient;
  let adminDeps: RegisterDeps;
  let member: SignedIn;
  let memberDeps: RegisterDeps;
  let outsiderDeps: RegisterDeps;
  let householdId: string;

  const asDeps = (user: SignedIn, isAdmin: boolean): RegisterDeps => ({
    client: user.client,
    admin,
    actor: { id: user.id, representativeName: user.name, isAdmin },
  });

  beforeAll(async () => {
    admin = adminClient();
    const adminUser = await signIn(admin);
    member = await signIn(admin, { isAdmin: false, household: true });
    const outsider = await signIn(admin, { isAdmin: false, household: true });
    adminDeps = asDeps(adminUser, true);
    memberDeps = asDeps(member, false);
    outsiderDeps = asDeps(outsider, false);

    await withSql(async (sql) => {
      if (
        (await sql.query("select 1 from public.rwa_settings")).rowCount === 0
      ) {
        await sql.query(
          "select app_private.deployment_initialize_settings('Live RWA', 'Asia/Kolkata')",
        );
      }
      for (const key of ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]) {
        const have = await sql.query(
          "select 1 from public.rwa_settings where policy_approvals ? $1",
          [key],
        );
        if (have.rowCount === 0) {
          await sql.query(
            "select app_private.deployment_record_policy_approval($1, 'fixture-v1', now(), $2, 'FIXTURE ONLY (disposable project)', 'APPROVED')",
            [key, adminUser.id],
          );
        }
      }
      await sql.query(
        `update public.rwa_settings
            set vote_retention_days = coalesce(vote_retention_days, 365),
                audit_retention_days = coalesce(audit_retention_days, 365),
                inactive_profile_retention_days = coalesce(inactive_profile_retention_days, 365),
                rate_limit_retention_days = coalesce(rate_limit_retention_days, 30),
                backup_retention_days = coalesce(backup_retention_days, 90)
          where id = 1`,
      );
    });

    const households = await listSelectableHouseholds(adminDeps);
    householdId =
      households.find((h) => h.identifier === `L-${member.id.slice(0, 8)}`)
        ?.id ?? "";
    expect(householdId).not.toBe("");
  });

  async function activeOpen(closesInMs = 3_600_000): Promise<AdminVoteDetail> {
    const draft = await createDraft(adminDeps, "PUBLIC");
    const ready = await updateDraft(adminDeps, draft.id, {
      expectedRevision: 1,
      title: "Live submission vote",
      closesAt: new Date(Date.now() + closesInMs).toISOString(),
      options: [
        { label: "Yes", position: 1 },
        { label: "No", position: 2 },
      ],
      eligibleHouseholdIds: [householdId],
    });
    return activateVote(adminDeps, ready.id, ready.draftRevision);
  }

  async function activeClosed(): Promise<AdminVoteDetail> {
    const draft = await createDraft(adminDeps, "PRIVATE");
    const ready = await updateDraft(adminDeps, draft.id, {
      expectedRevision: 1,
      title: "Live election",
      instructions: "One per office.",
      closesAt: new Date(Date.now() + 3_600_000).toISOString(),
      offices: [
        {
          name: "Chair",
          position: 1,
          candidates: [
            { name: "Asha", position: 1 },
            { name: "Ravi", position: 2 },
          ],
        },
        {
          name: "Treasurer",
          position: 2,
          candidates: [{ name: "Meera", position: 1 }],
        },
      ],
      eligibleHouseholdIds: [householdId],
    });
    return activateVote(adminDeps, ready.id, ready.draftRevision);
  }

  const counts = (voteId: string) =>
    withSql(async (sql) => {
      const p = await sql.query<{ n: string }>(
        "select count(*)::text n from public.participation where vote_id = $1",
        [voteId],
      );
      const t = await sql.query<{
        office_id: string;
        candidate_id: string | null;
        accepted_count: string;
      }>(
        "select office_id, candidate_id, accepted_count::text from public.closed_tallies where vote_id = $1",
        [voteId],
      );
      return { participation: Number(p.rows[0]?.n), tallies: t.rows };
    });

  it("accepts one PUBLIC ballot, acknowledges participation only, and reports it", async () => {
    const vote = await activeOpen();
    const ack = await submitBallot(memberDeps, vote.id, {
      confirmed: true,
      optionId: vote.options[0]?.id ?? "",
    });
    expect(ack).toEqual({ voteId: vote.id, submitted: true });
    expect(await getParticipation(memberDeps, vote.id)).toEqual({
      voteId: vote.id,
      status: "ACTIVE",
      submitted: true,
    });

    const replacement = await submitBallot(memberDeps, vote.id, {
      confirmed: true,
      optionId: vote.options[1]?.id ?? "",
    });
    expect(replacement).toEqual({ voteId: vote.id, submitted: true });
    expect((await counts(vote.id)).participation).toBe(1);
  });

  it("increments exactly the chosen PRIVATE counters, including NOTA", async () => {
    const vote = await activeClosed();
    const [chair, treasurer] = vote.offices;
    const ack = await submitBallot(memberDeps, vote.id, {
      confirmed: true,
      selections: [
        {
          officeId: chair?.id ?? "",
          candidateId: chair?.candidates[1]?.id ?? null,
        },
        { officeId: treasurer?.id ?? "", candidateId: null },
      ],
    });
    expect(ack).toEqual({ voteId: vote.id, submitted: true });

    const state = await counts(vote.id);
    expect(state.participation).toBe(1);
    const value = (office?: string, candidate: string | null = null) =>
      Number(
        state.tallies.find(
          (t) => t.office_id === office && t.candidate_id === candidate,
        )?.accepted_count,
      );
    expect(value(chair?.id, chair?.candidates[1]?.id)).toBe(1);
    expect(value(chair?.id, chair?.candidates[0]?.id)).toBe(0);
    expect(value(chair?.id)).toBe(0);
    expect(value(treasurer?.id)).toBe(1);
    expect(value(treasurer?.id, treasurer?.candidates[0]?.id)).toBe(0);
  });

  it("refuses everyone who is not entitled, identically, and writes nothing", async () => {
    const vote = await activeOpen();
    const body = {
      confirmed: true as const,
      optionId: vote.options[0]?.id ?? "",
    };

    // Another resident with a household that is not in this vote, an administrator
    // with no household, and a draft all look the same: not found.
    const draft = await createDraft(adminDeps, "PUBLIC");
    for (const [deps, id] of [
      [outsiderDeps, vote.id],
      [adminDeps, vote.id],
      [memberDeps, draft.id],
    ] as const) {
      expect((await apiError(submitBallot(deps, id, body))).code).toBe(
        "NOT_FOUND",
      );
      expect((await apiError(getParticipation(deps, id))).code).toBe(
        "NOT_FOUND",
      );
    }
    expect((await counts(vote.id)).participation).toBe(0);
  });

  it("rejects malformed, mixed and identity-bearing payloads at the database, even if they bypass the API schema", async () => {
    const vote = await activeOpen();
    const good = vote.options[0]?.id ?? "";
    for (const body of [
      { confirmed: true },
      { confirmed: true, optionId: good, selections: [] },
      { confirmed: true, optionId: good, householdId },
      { confirmed: true, optionId: good, profileId: member.id },
      { confirmed: false, optionId: good },
      { confirmed: true, optionId: "00000000-0000-4000-8000-000000000099" },
    ]) {
      const error = await apiError(
        submitBallot(memberDeps, vote.id, body as never),
      );
      expect(error.code, JSON.stringify(body)).toBe("VALIDATION_FAILED");
    }
    expect((await counts(vote.id)).participation).toBe(0);
  });

  it("refuses a revoked member immediately, even with a still-valid session", async () => {
    const vote = await activeOpen();
    const body = {
      confirmed: true as const,
      optionId: vote.options[0]?.id ?? "",
    };
    await withSql((sql) =>
      sql.query(
        "update public.profiles set status = 'SUSPENDED' where id = $1",
        [member.id],
      ),
    );
    try {
      expect(
        (await apiError(submitBallot(memberDeps, vote.id, body))).code,
      ).toBe("FORBIDDEN");
    } finally {
      await withSql((sql) =>
        sql.query(
          "update public.profiles set status = 'ENABLED' where id = $1",
          [member.id],
        ),
      );
    }
    expect((await counts(vote.id)).participation).toBe(0);
  });

  it("serializes concurrent PUBLIC changes without duplicating participation", async () => {
    const vote = await activeOpen();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        submitBallot(memberDeps, vote.id, {
          confirmed: true,
          optionId: vote.options[index % 2]?.id ?? "",
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect((await counts(vote.id)).participation).toBe(1);
  });

  it("recovers a committed submission whose acknowledgement was lost", async () => {
    const vote = await activeOpen();
    // The caller never reads the answer, as if the connection dropped.
    void submitBallot(memberDeps, vote.id, {
      confirmed: true,
      optionId: vote.options[0]?.id ?? "",
    }).catch(() => undefined);

    let submitted = false;
    for (let attempt = 0; attempt < 15 && !submitted; attempt += 1) {
      await wait(500);
      submitted = (await getParticipation(memberDeps, vote.id)).submitted;
    }
    expect(submitted).toBe(true);
  });

  it("refuses a late submission, completing the vote at its deadline in the same committed step", async () => {
    const vote = await activeOpen(5_000);
    await wait(5_800);
    const error = await apiError(
      submitBallot(memberDeps, vote.id, {
        confirmed: true,
        optionId: vote.options[0]?.id ?? "",
      }),
    );
    expect(error.code).toBe("VOTING_CLOSED");

    const row = await withSql(
      async (sql) =>
        (
          await sql.query<{
            status: string;
            completed_at: string;
            closes_at: string;
          }>(
            "select status, completed_at, closes_at from public.votes where id = $1",
            [vote.id],
          )
        ).rows[0],
    );
    expect(row?.status).toBe("COMPLETED");
    expect(new Date(row?.completed_at ?? "").getTime()).toBe(
      new Date(row?.closes_at ?? "").getTime(),
    );
    expect((await counts(vote.id)).participation).toBe(0);
  }, 30_000);

  it("is closed to anonymous callers at the API", async () => {
    const vote = await activeOpen();
    const { error } = await publicClient().rpc("cast_vote", {
      p_vote_id: vote.id,
      p_submission: { confirmed: true, optionId: vote.options[0]?.id },
    });
    expect(error?.code).toBe("42501");
  });

  it("meters submissions per signed-in profile", async () => {
    const vote = await activeOpen();
    const body = {
      confirmed: true as const,
      optionId: vote.options[0]?.id ?? "",
    };
    // An outsider's refusals still spend their budget, so abuse is bounded.
    let limited: { code: string; retryAfterSeconds: number | null } | null =
      null;
    for (let attempt = 0; attempt < 30 && !limited; attempt += 1) {
      const error = await apiError(submitBallot(outsiderDeps, vote.id, body));
      if (error.code === "RATE_LIMITED") {
        limited = {
          code: error.code,
          retryAfterSeconds: error.retryAfterSeconds ?? null,
        };
      }
    }
    expect(limited?.code).toBe("RATE_LIMITED");
    expect(limited?.retryAfterSeconds).toBeGreaterThan(0);
  }, 60_000);

  it("keeps durable commit on for accepted submissions", async () => {
    const setting = await withSql(
      async (sql) =>
        (
          await sql.query<{ synchronous_commit: string }>(
            "show synchronous_commit",
          )
        ).rows[0],
    );
    expect(setting?.synchronous_commit).toBe("on");
  });
});
