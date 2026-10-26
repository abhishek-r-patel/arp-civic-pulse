import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { RegisterDeps } from "@/server/register/shared";
import {
  createDraft,
  getRwaDisplay,
  getVote,
  listSelectableHouseholds,
  listVotes,
  previewDraft,
  updateDraft,
} from "@/server/votes/drafts";
import { voteListQuerySchema } from "@/shared/contracts/admin-votes";
import { adminClient, hasLive, hasSql, withSql } from "./support/live";
import { apiError, signIn, type SignedIn } from "./support/session";

/*
 * Draft management against real Supabase Auth and PostgREST with real signed-in
 * sessions: the services, the guarded routines and RLS together. Drafts
 * created here stay in the disposable project; reset it when done.
 */
describe.skipIf(!hasLive || !hasSql)("live: vote drafts", () => {
  let admin: SupabaseClient;
  let adminDeps: RegisterDeps;
  let residentDeps: RegisterDeps;
  let resident: SignedIn;

  const asDeps = (user: SignedIn, isAdmin: boolean): RegisterDeps => ({
    client: user.client,
    admin,
    actor: { id: user.id, representativeName: user.name, isAdmin },
  });

  beforeAll(async () => {
    admin = adminClient();
    await withSql(async (sql) => {
      const existing = await sql.query("select 1 from public.rwa_settings");
      if (existing.rowCount === 0) {
        await sql.query(
          "select app_private.deployment_initialize_settings('Live RWA', 'Asia/Kolkata')",
        );
      }
    });
    adminDeps = asDeps(await signIn(admin), true);
    resident = await signIn(admin, { isAdmin: false, household: true });
    residentDeps = asDeps(resident, false);
  });

  const list = (query: Record<string, string> = {}, deps = adminDeps) =>
    listVotes(deps, voteListQuerySchema.parse(query));

  it("creates a revision-1 draft that the administrator can read and list", async () => {
    const draft = await createDraft(adminDeps, "PUBLIC");
    expect(draft).toMatchObject({
      votingType: "PUBLIC",
      status: "DRAFT",
      draftRevision: 1,
      title: "",
      closesAt: null,
      options: [],
      offices: [],
      eligibleHouseholdIds: [],
    });
    expect(draft.timezone).toBeTruthy();

    expect(await getVote(adminDeps, draft.id)).toEqual(draft);
    const page = await list({ status: "DRAFT", votingType: "PUBLIC" });
    expect(page.data.some((row) => row.id === draft.id)).toBe(true);
    expect(page.data.every((row) => row.votingType === "PUBLIC")).toBe(true);
  });

  it("round-trips a full PUBLIC draft through the guarded routine", async () => {
    const draft = await createDraft(adminDeps, "PUBLIC");
    const households = await listSelectableHouseholds(adminDeps);
    const mine = households.find((h) => h.id !== undefined && h.isEligible);
    expect(mine).toBeDefined();

    const saved = await updateDraft(adminDeps, draft.id, {
      expectedRevision: 1,
      title: "Repaint the clubhouse?",
      instructions: "Read the quote first.",
      closesAt: "2099-06-01T12:00:00+05:30",
      options: [
        { label: "Yes", position: 1 },
        { label: "No", position: 2 },
      ],
      eligibleHouseholdIds: [mine?.id ?? ""],
    });
    expect(saved).toMatchObject({
      draftRevision: 2,
      title: "Repaint the clubhouse?",
      closesAt: "2099-06-01T06:30:00.000Z",
    });
    expect(saved.options.map((o) => o.label)).toEqual(["Yes", "No"]);
    expect(saved.eligibleHouseholdIds).toEqual([mine?.id]);
  });

  it("refuses a stale revision and leaves the draft untouched", async () => {
    const draft = await createDraft(adminDeps, "PRIVATE");
    await updateDraft(adminDeps, draft.id, {
      expectedRevision: 1,
      title: "First save",
    });
    const error = await apiError(
      updateDraft(adminDeps, draft.id, {
        expectedRevision: 1,
        title: "From a stale page",
      }),
    );
    expect(error.code).toBe("STALE_REVISION");
    expect(await getVote(adminDeps, draft.id)).toMatchObject({
      title: "First save",
      draftRevision: 2,
    });
  });

  it("previews an incomplete draft with safe blockers and never changes the revision", async () => {
    const draft = await createDraft(adminDeps, "PRIVATE");
    const preview = await previewDraft(adminDeps, draft.id, 1);
    expect(preview.readyToActivate).toBe(false);
    expect(preview.blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining([
        "TITLE_REQUIRED",
        "DEADLINE_REQUIRED",
        "ELECTORATE_EMPTY",
        "OFFICES_REQUIRED",
      ]),
    );
    expect(preview.vote.draftRevision).toBe(1);
    expect((await getVote(adminDeps, draft.id)).draftRevision).toBe(1);

    const error = await apiError(previewDraft(adminDeps, draft.id, 9));
    expect(error.code).toBe("STALE_REVISION");
  });

  it("keeps drafts invisible to residents and every routine closed to them", async () => {
    const draft = await createDraft(adminDeps, "PUBLIC");

    for (const attempt of [
      () => createDraft(residentDeps, "PUBLIC"),
      () => getVote(residentDeps, draft.id),
      () => previewDraft(residentDeps, draft.id, 1),
      () =>
        updateDraft(residentDeps, draft.id, {
          expectedRevision: 1,
          title: "Hijacked",
        }),
    ]) {
      expect((await apiError(attempt())).code).toBe("FORBIDDEN");
    }

    // RLS hides drafts from a resident's list; the draft is untouched.
    const seen = await list({}, residentDeps);
    expect(seen.data.some((row) => row.id === draft.id)).toBe(false);
    expect((await getVote(adminDeps, draft.id)).title).toBe("");
  });

  it("lets a resident read the RWA name and time zone", async () => {
    expect(await getRwaDisplay(residentDeps)).toEqual({
      name: expect.any(String),
      timezone: expect.any(String),
    });
    const { data, error } = await resident.client
      .from("rwa_settings")
      .select("policy_approvals");
    expect(data ?? []).toEqual([]);
    expect(error).not.toBeNull();
  });

  it("pages through the list without repeats", async () => {
    await Promise.all([
      createDraft(adminDeps, "PUBLIC"),
      createDraft(adminDeps, "PUBLIC"),
      createDraft(adminDeps, "PUBLIC"),
    ]);
    const first = await list({ limit: "2" });
    expect(first.data).toHaveLength(2);
    expect(first.page.hasMore).toBe(true);
    const second = await list({
      limit: "2",
      cursor: first.page.nextCursor ?? "",
    });
    const ids = new Set(first.data.map((row) => row.id));
    expect(second.data.length).toBeGreaterThan(0);
    expect(second.data.every((row) => !ids.has(row.id))).toBe(true);
  });

  it("rejects a cursor from different filters", async () => {
    const first = await list({ limit: "1", votingType: "PUBLIC" });
    expect(first.page.nextCursor).toBeTruthy();
    const error = await apiError(
      list({
        limit: "1",
        votingType: "PRIVATE",
        cursor: first.page.nextCursor ?? "",
      }),
    );
    expect(error.code).toBe("VALIDATION_FAILED");
  });
});
