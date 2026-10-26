import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { exportResults } from "@/server/exports/results-export";
import type { RegisterDeps } from "@/server/register/shared";
import {
  createDraft,
  listSelectableHouseholds,
  updateDraft,
} from "@/server/votes/drafts";
import { activateVote, completeVoteEarly } from "@/server/votes/lifecycle";
import {
  getCompleteResults,
  getMemberVote,
  getResults,
  listMemberVotes,
} from "@/server/votes/member";
import {
  getParticipationReport,
  listAuditEvents,
} from "@/server/votes/monitoring";
import { submitBallot } from "@/server/votes/submission";
import {
  auditQuerySchema,
  participationQuerySchema,
} from "@/shared/contracts/admin-votes";
import type { AdminVoteDetail } from "@/shared/contracts/drafts";
import { memberVoteListQuerySchema } from "@/shared/contracts/member-votes";
import type { OpenResults, ClosedResults } from "@/shared/contracts/results";
import { adminClient, hasLive, hasSql, withSql } from "./support/live";
import { apiError, signIn, type SignedIn } from "./support/session";

/*
 * Member discovery, completed results, monitoring, audit and CSV export
 * against real Supabase Auth, PostgREST and RLS. Fixture policy approvals are
 * recorded only so votes can be activated on this DISPOSABLE project.
 */
describe.skipIf(!hasLive || !hasSql)("live: results and monitoring", () => {
  let admin: SupabaseClient;
  let adminDeps: RegisterDeps;
  let alice: SignedIn;
  let bob: SignedIn;
  let aliceDeps: RegisterDeps;
  let bobDeps: RegisterDeps;
  let outsiderDeps: RegisterDeps;
  let households: string[];

  const asDeps = (user: SignedIn, isAdmin: boolean): RegisterDeps => ({
    client: user.client,
    admin,
    actor: { id: user.id, representativeName: user.name, isAdmin },
  });
  const listQuery = (extra: Record<string, unknown> = {}) =>
    memberVoteListQuerySchema.parse(extra);

  beforeAll(async () => {
    admin = adminClient();
    const adminUser = await signIn(admin);
    alice = await signIn(admin, { isAdmin: false, household: true });
    bob = await signIn(admin, { isAdmin: false, household: true });
    const outsider = await signIn(admin, { isAdmin: false, household: true });
    adminDeps = asDeps(adminUser, true);
    aliceDeps = asDeps(alice, false);
    bobDeps = asDeps(bob, false);
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

    const all = await listSelectableHouseholds(adminDeps);
    households = [alice, bob].map(
      (user) =>
        all.find((h) => h.identifier === `L-${user.id.slice(0, 8)}`)?.id ?? "",
    );
    expect(households).not.toContain("");
  });

  async function activeOpen(): Promise<AdminVoteDetail> {
    const draft = await createDraft(adminDeps, "PUBLIC");
    const ready = await updateDraft(adminDeps, draft.id, {
      expectedRevision: 1,
      title: "Live results vote",
      closesAt: new Date(Date.now() + 3_600_000).toISOString(),
      options: [
        { label: "Yes", position: 1 },
        { label: "No", position: 2 },
      ],
      eligibleHouseholdIds: households,
    });
    return activateVote(adminDeps, ready.id, ready.draftRevision);
  }

  async function activeClosed(): Promise<AdminVoteDetail> {
    const draft = await createDraft(adminDeps, "PRIVATE");
    const ready = await updateDraft(adminDeps, draft.id, {
      expectedRevision: 1,
      title: "Live results election",
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
      ],
      eligibleHouseholdIds: households,
    });
    return activateVote(adminDeps, ready.id, ready.draftRevision);
  }

  it("shows live PUBLIC aggregates without identities and keeps exports gated", async () => {
    const vote = await activeOpen();
    await submitBallot(aliceDeps, vote.id, {
      confirmed: true,
      optionId: vote.options[0]?.id ?? "",
    });
    for (const deps of [aliceDeps, bobDeps, adminDeps]) {
      const { data } = await getResults(deps, vote.id, { limit: 25 });
      expect(data.vote.status).toBe("ACTIVE");
      expect(data.submittedCount).toBe("1");
      if (data.votingType !== "PUBLIC") {
        throw new Error("Active results must be a PUBLIC poll.");
      }
      expect(data.namedResponses).toEqual([]);
    }
    const exportError = await apiError(
      exportResults(aliceDeps, vote.id, "csv", "req"),
    );
    expect(exportError.code).toBe("RESULTS_UNAVAILABLE");
  });

  it("shows active PRIVATE turnout only and keeps exports gated", async () => {
    const vote = await activeClosed();
    await submitBallot(aliceDeps, vote.id, {
      confirmed: true,
      selections: vote.offices.map((office) => ({
        officeId: office.id,
        candidateId: office.candidates[0]?.id ?? null,
      })),
    });
    for (const deps of [aliceDeps, bobDeps, adminDeps]) {
      const { data } = await getResults(deps, vote.id, { limit: 25 });
      expect(data.vote.status).toBe("ACTIVE");
      expect(data.votingType).toBe("PRIVATE");
      expect(data.eligibleCount).toBe("2");
      expect(data.submittedCount).toBe("1");
      if (data.votingType !== "PRIVATE") {
        throw new Error("Active PRIVATE turnout must not contain PUBLIC data.");
      }
      expect(data.offices).toEqual([]);
      expect(JSON.stringify(data)).not.toMatch(/L-|Asha|Ravi|candidate/iu);
    }
    const exportError = await apiError(
      exportResults(aliceDeps, vote.id, "csv", "req"),
    );
    expect(exportError.code).toBe("RESULTS_UNAVAILABLE");
  });

  it("shows a member only their own entitlement and submission state", async () => {
    const vote = await activeOpen();
    await submitBallot(aliceDeps, vote.id, {
      confirmed: true,
      optionId: vote.options[0]?.id ?? "",
    });

    const mine = await listMemberVotes(aliceDeps, listQuery());
    expect(mine.data.find((v) => v.id === vote.id)?.submitted).toBe(true);
    const bobs = await listMemberVotes(bobDeps, listQuery());
    expect(bobs.data.find((v) => v.id === vote.id)?.submitted).toBe(false);
    const outsiders = await listMemberVotes(outsiderDeps, listQuery());
    expect(outsiders.data.find((v) => v.id === vote.id)).toBeUndefined();

    const detail = await getMemberVote(aliceDeps, vote.id);
    expect(detail).toMatchObject({
      submitted: true,
      canSubmit: true,
      privacyNotice: "PUBLIC",
    });
    expect((await apiError(getMemberVote(outsiderDeps, vote.id))).code).toBe(
      "NOT_FOUND",
    );
  });

  it("publishes exact PUBLIC results, named responses and a faithful CSV after completion", async () => {
    const vote = await activeOpen();
    await submitBallot(aliceDeps, vote.id, {
      confirmed: true,
      optionId: vote.options[0]?.id ?? "",
    });
    await submitBallot(bobDeps, vote.id, {
      confirmed: true,
      optionId: vote.options[0]?.id ?? "",
    });
    await completeVoteEarly(adminDeps, vote.id, "Live test completion");

    const { data } = await getResults(aliceDeps, vote.id, { limit: 1 });
    const open = data as OpenResults;
    expect(open.eligibleCount).toBe("2");
    expect(open.submittedCount).toBe("2");
    expect(open.turnout.percent).toBe("100.00");
    expect(open.options.map((o) => [o.label, o.count])).toEqual([
      ["Yes", "2"],
      ["No", "0"],
    ]);
    expect(open.outcome).toBe("LEADER");
    // The page is bounded, but the totals are not.
    expect(open.namedResponses).toHaveLength(1);

    const everything = (await getCompleteResults(
      adminDeps,
      vote.id,
    )) as OpenResults;
    expect(everything.namedResponses).toHaveLength(2);

    const response = await exportResults(aliceDeps, vote.id, "csv", "req-1");
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="civic-pulse-results-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.csv"$/u,
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const csv = await response.text();
    expect(csv.match(/NAMED_RESPONSE/gu)).toHaveLength(2);
    expect(csv).not.toContain("@");

    const pdf = await exportResults(aliceDeps, vote.id, "pdf", "req-pdf");
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toMatch(
      /^attachment; filename="civic-pulse-results-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.pdf"$/u,
    );
    expect(pdf.headers.get("cache-control")).toContain("no-store");
    expect(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");

    const unavailable = await apiError(
      exportResults(aliceDeps, vote.id, "docx", "req-2"),
    );
    expect(unavailable.code).toBe("EXPORT_FORMAT_UNAVAILABLE");
    // An unavailable format never reveals a vote the caller cannot see.
    expect(
      (await apiError(exportResults(outsiderDeps, vote.id, "docx", "r"))).code,
    ).toBe("NOT_FOUND");
    expect(
      (await apiError(exportResults(outsiderDeps, vote.id, "pdf", "r"))).code,
    ).toBe("NOT_FOUND");
    expect(
      (await apiError(getResults(outsiderDeps, vote.id, { limit: 25 }))).code,
    ).toBe("NOT_FOUND");
  });

  it("publishes PRIVATE totals with NOTA counts and no identities", async () => {
    const vote = await activeClosed();
    const chair = vote.offices[0];
    await submitBallot(aliceDeps, vote.id, {
      confirmed: true,
      selections: [
        {
          officeId: chair?.id ?? "",
          candidateId: chair?.candidates[0]?.id ?? null,
        },
      ],
    });
    await submitBallot(bobDeps, vote.id, {
      confirmed: true,
      selections: [{ officeId: chair?.id ?? "", candidateId: null }],
    });
    await completeVoteEarly(adminDeps, vote.id, "Live test completion");

    const { data, page } = await getResults(bobDeps, vote.id, { limit: 25 });
    const closed = data as ClosedResults;
    expect(page).toBeNull();
    expect(closed.offices[0]?.candidates.map((c) => c.count)).toEqual([
      "1",
      "0",
    ]);
    expect(closed.offices[0]?.nota).toEqual({
      count: "1",
      percent: "50.00",
    });
    expect(closed.offices[0]?.outcome).toBe("LEADER");
    expect(JSON.stringify(closed)).not.toMatch(/representativeName|L-/u);

    const csv = await (
      await exportResults(adminDeps, vote.id, "csv", "req-3")
    ).text();
    expect(csv).not.toContain("NAMED_RESPONSE");
    expect(csv).toContain("NOTA");
  });

  it("lets only administrators see participation and the audit history", async () => {
    const vote = await activeClosed();
    await submitBallot(aliceDeps, vote.id, {
      confirmed: true,
      selections: vote.offices.map((office) => ({
        officeId: office.id,
        candidateId: office.candidates[0]?.id ?? null,
      })),
    });

    const report = await getParticipationReport(
      adminDeps,
      vote.id,
      participationQuerySchema.parse({}),
    );
    expect(report.data).toMatchObject({
      eligibleCount: "2",
      submittedCount: "1",
    });
    expect(report.data.rows.filter((r) => r.submitted)).toHaveLength(1);
    expect(JSON.stringify(report)).not.toMatch(/optionId|@/u);
    expect(
      (
        await apiError(
          getParticipationReport(
            aliceDeps,
            vote.id,
            participationQuerySchema.parse({}),
          ),
        )
      ).code,
    ).toBe("FORBIDDEN");

    const audit = await listAuditEvents(
      adminDeps,
      auditQuerySchema.parse({ action: "VOTE_ACTIVATED", limit: "5" }),
    );
    expect(audit.data.length).toBeGreaterThan(0);
    expect(audit.data.every((e) => e.action === "VOTE_ACTIVATED")).toBe(true);
    expect(
      (await apiError(listAuditEvents(aliceDeps, auditQuerySchema.parse({}))))
        .code,
    ).toBe("FORBIDDEN");
  });
});
