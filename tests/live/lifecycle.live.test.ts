import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { RegisterDeps } from "@/server/register/shared";
import {
  createDraft,
  getVote,
  listSelectableHouseholds,
  previewDraft,
  updateDraft,
} from "@/server/votes/drafts";
import {
  activateVote,
  cancelVote,
  completeVoteEarly,
} from "@/server/votes/lifecycle";
import { adminClient, hasLive, hasSql, withSql } from "./support/live";
import { apiError, signIn, type SignedIn } from "./support/session";

/*
 * Activation, early completion, cancellation and scheduled completion against
 * real Supabase Auth, PostgREST and pg_cron on a DISPOSABLE project. Fixture
 * policy approvals are recorded here only so activation can be exercised; they
 * are not real approvals and must never be copied to a real deployment.
 */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!hasLive || !hasSql)("live: vote lifecycle", () => {
  let admin: SupabaseClient;
  let adminDeps: RegisterDeps;
  let residentDeps: RegisterDeps;
  let householdId: string;

  const asDeps = (user: SignedIn, isAdmin: boolean): RegisterDeps => ({
    client: user.client,
    admin,
    actor: { id: user.id, representativeName: user.name, isAdmin },
  });

  beforeAll(async () => {
    admin = adminClient();
    const adminUser = await signIn(admin);
    const resident = await signIn(admin, { isAdmin: false, household: true });
    adminDeps = asDeps(adminUser, true);
    residentDeps = asDeps(resident, false);

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
    const mine = households.find(
      (h) => h.identifier === `L-${residentDeps.actor.id.slice(0, 8)}`,
    );
    householdId = mine?.id ?? "";
    expect(householdId).not.toBe("");
  });

  async function readyDraft(closesInMs = 3_600_000) {
    const draft = await createDraft(adminDeps, "OPEN");
    return updateDraft(adminDeps, draft.id, {
      expectedRevision: 1,
      title: "Live lifecycle vote",
      closesAt: new Date(Date.now() + closesInMs).toISOString(),
      options: [
        { label: "Yes", position: 1 },
        { label: "No", position: 2 },
      ],
      eligibleHouseholdIds: [householdId],
    });
  }

  const dbRow = (id: string) =>
    withSql(async (sql) => {
      const result = await sql.query<{
        status: string;
        completion_mode: string | null;
        completed_at: string | null;
        closes_at: string;
      }>(
        "select status, completion_mode, completed_at, closes_at from public.votes where id = $1",
        [id],
      );
      return result.rows[0];
    });

  it("previews as ready, activates the exact revision, and freezes everything", async () => {
    const draft = await readyDraft();
    const preview = await previewDraft(
      adminDeps,
      draft.id,
      draft.draftRevision,
    );
    expect(preview.blockers).toEqual([]);
    expect(preview.readyToActivate).toBe(true);

    const active = await activateVote(adminDeps, draft.id, draft.draftRevision);
    expect(active).toMatchObject({
      status: "ACTIVE",
      draftRevision: draft.draftRevision,
      rwaName: expect.any(String),
      timezone: "Asia/Kolkata",
    });

    const edit = await apiError(
      updateDraft(adminDeps, draft.id, {
        expectedRevision: draft.draftRevision,
        title: "Too late",
      }),
    );
    expect(edit.code).toBe("VOTE_FROZEN");

    const again = await apiError(
      activateVote(adminDeps, draft.id, draft.draftRevision),
    );
    expect(again.code).toBe("LIFECYCLE_CONFLICT");
    expect(again.context).toEqual({ reason: "ACTIVE" });
  });

  it("refuses a stale or incomplete activation and changes nothing", async () => {
    const draft = await readyDraft();
    await updateDraft(adminDeps, draft.id, {
      expectedRevision: draft.draftRevision,
      title: "Edited after the preview",
    });
    expect(
      (await apiError(activateVote(adminDeps, draft.id, draft.draftRevision)))
        .code,
    ).toBe("STALE_REVISION");

    const bare = await createDraft(adminDeps, "CLOSED");
    expect((await apiError(activateVote(adminDeps, bare.id, 1))).code).toBe(
      "ACTIVATION_BLOCKED",
    );
    expect((await getVote(adminDeps, bare.id)).status).toBe("DRAFT");
  });

  it("keeps every lifecycle action closed to a resident", async () => {
    const draft = await readyDraft();
    for (const attempt of [
      () => activateVote(residentDeps, draft.id, draft.draftRevision),
      () => completeVoteEarly(residentDeps, draft.id, "x"),
      () => cancelVote(residentDeps, draft.id, "x"),
    ]) {
      expect((await apiError(attempt())).code).toBe("FORBIDDEN");
    }
    expect((await getVote(adminDeps, draft.id)).status).toBe("DRAFT");
  });

  it("completes early and cancels with recorded reasons, then refuses repeats", async () => {
    const early = await readyDraft();
    await activateVote(adminDeps, early.id, early.draftRevision);
    const completed = await completeVoteEarly(
      adminDeps,
      early.id,
      "Everyone has voted.",
    );
    expect(completed).toMatchObject({
      status: "COMPLETED",
      completionMode: "EARLY",
      completionReason: "Everyone has voted.",
    });
    const repeat = await apiError(
      cancelVote(adminDeps, early.id, "Changed my mind"),
    );
    expect(repeat.code).toBe("LIFECYCLE_CONFLICT");
    expect(repeat.context).toEqual({ reason: "COMPLETED" });

    const cancelled = await readyDraft();
    await activateVote(adminDeps, cancelled.id, cancelled.draftRevision);
    expect(
      await cancelVote(adminDeps, cancelled.id, "Wrong candidate list"),
    ).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "Wrong candidate list",
    });

    const empty = await readyDraft();
    await activateVote(adminDeps, empty.id, empty.draftRevision);
    expect(
      (await apiError(completeVoteEarly(adminDeps, empty.id, "   "))).code,
    ).toBe("VALIDATION_FAILED");
  });

  it("completes an overdue vote at its deadline and refuses the late action", async () => {
    const draft = await readyDraft(6_000);
    await activateVote(adminDeps, draft.id, draft.draftRevision);
    await wait(6_800);

    const late = await apiError(
      completeVoteEarly(adminDeps, draft.id, "Too late"),
    );
    expect(late.code).toBe("LIFECYCLE_CONFLICT");
    expect(late.context).toEqual({ reason: "DEADLINE_PASSED" });

    const row = await dbRow(draft.id);
    expect(row).toMatchObject({
      status: "COMPLETED",
      completion_mode: "DEADLINE",
    });
    expect(new Date(row?.completed_at ?? "").getTime()).toBe(
      new Date(row?.closes_at ?? "").getTime(),
    );
  }, 30_000);

  it("finalises an overdue vote when an administrator opens it", async () => {
    const draft = await readyDraft(6_000);
    await activateVote(adminDeps, draft.id, draft.draftRevision);
    await wait(6_800);
    expect(await getVote(adminDeps, draft.id)).toMatchObject({
      status: "COMPLETED",
      completionMode: "DEADLINE",
    });
  }, 30_000);

  it("is completed by Supabase Cron on its own, at the deadline", async () => {
    // Cron runs once a minute; poll the database directly so a server-side
    // reconcile cannot stand in for it.
    const draft = await readyDraft(10_000);
    await activateVote(adminDeps, draft.id, draft.draftRevision);

    let row = await dbRow(draft.id);
    const stopAt = Date.now() + 150_000;
    while (row?.status !== "COMPLETED" && Date.now() < stopAt) {
      await wait(5_000);
      row = await dbRow(draft.id);
    }
    expect(row?.status).toBe("COMPLETED");
    expect(row?.completion_mode).toBe("DEADLINE");
    expect(new Date(row?.completed_at ?? "").getTime()).toBe(
      new Date(row?.closes_at ?? "").getTime(),
    );

    const audit = await withSql((sql) =>
      sql.query<{ actor_kind: string }>(
        "select actor_kind from public.audit_events where target_id = $1 and action = 'VOTE_COMPLETED'",
        [draft.id],
      ),
    );
    expect(audit.rows).toEqual([{ actor_kind: "SYSTEM" }]);
  }, 200_000);

  it("has a restricted, active Cron job", async () => {
    const jobs = await withSql((sql) =>
      sql.query<{ schedule: string; command: string; active: boolean }>(
        "select schedule, command, active from cron.job where jobname = 'civic-pulse-complete-due-votes'",
      ),
    );
    expect(jobs.rows).toEqual([
      {
        schedule: "* * * * *",
        command: "set role cp_scheduler; select public.complete_due_votes()",
        active: true,
      },
    ]);
  });
});
