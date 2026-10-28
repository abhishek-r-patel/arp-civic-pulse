// Real-PostgreSQL authorization, exact filtered totals and cursor-anchor equivalence.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  newAuthUser,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";
import { votingApi } from "./support/votes";

interface Window {
  totalCount: string;
  currentPage: number;
  totalPages: number;
  position: Record<string, string> | null;
}

describe.skipIf(!hasDatabase)("numbered pagination", () => {
  let db: TestDatabase;
  let world: World;
  let api: ReturnType<typeof votingApi>;
  let observer: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
    api = votingApi(db, world);
    await api.setupPolicy();
    observer = await db.asSuperuser((c) => newAuthUser(c));
    await db.asOwner((c) =>
      c.query(
        "insert into public.profiles(id, representative_name, status, is_readonly) values ($1, 'Observer', 'ENABLED', true)",
        [observer],
      ),
    );
  });
  afterAll(async () => {
    await db?.drop();
  });
  const window = (
    sub: string | null,
    dataset: string,
    page = 1,
    limit = 2,
    filters = {},
    voteId: string | null = null,
  ) =>
    api.call<Window>(sub, "public.get_list_page($1, $2, $3, $4::jsonb, $5)", [
      dataset,
      page,
      limit,
      JSON.stringify(filters),
      voteId,
    ]);

  it("counts assigned/unassigned residents with the same filters and order as the directory", async () => {
    const first = await window(world.admin.id, "residents");
    expect(first).toEqual({
      totalCount: "6",
      currentPage: 1,
      totalPages: 3,
      position: null,
    });
    const second = await window(world.admin.id, "residents", 2);
    expect(second.position).toEqual({ id: world.bob.id });
    expect(
      await window(observer, "residents", 1, 25, { hasHousehold: false }),
    ).toMatchObject({ totalCount: "2" });
    expect(
      await window(world.admin.id, "residents", 1, 25, {
        identifier: " a-101 ",
      }),
    ).toMatchObject({ totalCount: "1" });
    expect(
      await window(world.admin.id, "residents", 1, 25, {
        isAdmin: false,
        isReadonly: false,
        status: "ENABLED",
        isEligible: true,
      }),
    ).toMatchObject({ totalCount: "3" });
  });

  it("handles empty sets, exact boundaries and pages beyond the new final page", async () => {
    expect(await window(world.admin.id, "residents", 999, 2)).toMatchObject({
      currentPage: 3,
      totalPages: 3,
    });
    expect(
      await window(world.admin.id, "residents", 999, 25, {
        identifier: "MISSING",
      }),
    ).toEqual({
      totalCount: "0",
      currentPage: 1,
      totalPages: 1,
      position: null,
    });
    expect(await window(world.admin.id, "residents", 2, 3)).toMatchObject({
      currentPage: 2,
      totalPages: 2,
      totalCount: "6",
    });
  });

  it("keeps administrator and member vote totals separate, with equivalent keyset anchors", async () => {
    const first = await api.activeVote("PUBLIC", { people: [world.alice] });
    await api.activeVote("PRIVATE", { people: [world.bob] });
    await api.call(world.admin.id, "public.create_draft('PUBLIC')");
    const all = await window(observer, "admin-votes", 1, 1);
    expect(all.totalCount).toBe("3");
    const adminSecond = await window(world.admin.id, "admin-votes", 2, 1);
    const ordered = await api.rows<{ id: string }>(
      "select id from public.votes order by updated_at desc, id desc",
    );
    expect(adminSecond.position?.id).toBe(ordered[0]?.id);
    expect(await window(world.alice.id, "member-votes", 1, 1)).toMatchObject({
      totalCount: "1",
    });
    expect(await window(world.admin.id, "member-votes", 1, 1)).toMatchObject({
      totalCount: "0",
    });
    await api.activeVote("PUBLIC", {
      people: [world.alice],
      closesInMs: 7_200_000,
    });
    const second = await window(world.alice.id, "member-votes", 2, 1, {
      votingType: "PUBLIC",
    });
    expect(second.totalCount).toBe("2");
    expect(second.position?.id).toBe(first.id);
    const resumed = await api.call<{ rows: { id: string }[] }>(
      world.alice.id,
      "public.list_member_votes(null, 'PUBLIC', 1, $1, $2, $3)",
      [
        Number(second.position?.rank),
        second.position?.key,
        second.position?.id,
      ],
    );
    expect(resumed.rows).toHaveLength(1);
    expect(resumed.rows[0]?.id).not.toBe(first.id);
  });

  it("counts filtered participation without revealing choices and deduplicates multi-select named responses", async () => {
    const vote = await api.activeVote("PUBLIC", {
      openSelectionMode: "MULTIPLE",
      openSelectionLimit: null,
    });
    await api.cast(world.alice.id, vote.id, {
      confirmed: true,
      optionIds: vote.options.map((o) => o.id),
    });
    await api.cast(world.bob.id, vote.id, {
      confirmed: true,
      optionIds: [vote.options[0]?.id],
    });
    expect(
      await window(
        observer,
        "participation",
        1,
        1,
        { submitted: true },
        vote.id,
      ),
    ).toMatchObject({ totalCount: "2", totalPages: 2 });
    expect(
      await window(
        observer,
        "participation",
        1,
        1,
        { submitted: false },
        vote.id,
      ),
    ).toMatchObject({ totalCount: "1" });
    const rejected = await dbError(
      window(world.alice.id, "responses", 1, 1, {}, vote.id),
    );
    expect(rejected.message).toBe("RESULTS_UNAVAILABLE");
    await api.call(
      world.admin.id,
      "public.complete_vote_early($1, true, 'Fixture finish')",
      [vote.id],
    );
    const responsePage = await window(
      world.alice.id,
      "responses",
      2,
      1,
      {},
      vote.id,
    );
    expect(responsePage).toMatchObject({
      totalCount: "2",
      currentPage: 2,
      totalPages: 2,
    });
    expect(responsePage.position?.id).toBe(world.alice.householdId);
    const results = await api.call<{
      namedResponses: { householdIdentifier: string }[];
    }>(world.alice.id, "public.get_vote_results($1, 1, $2, $3)", [
      vote.id,
      responsePage.position?.key,
      responsePage.position?.id,
    ]);
    expect(
      results.namedResponses.map((row) => row.householdIdentifier),
    ).toEqual(["B-202"]);
    expect(
      (await dbError(window(world.carol.id, "responses", 1, 1, {}, vote.id)))
        .message,
    ).toBe("FORBIDDEN");
  });

  it("counts audit filters and resumes in exactly the existing audit order", async () => {
    const meta = await window(observer, "audit", 2, 1, {
      action: "VOTE_ACTIVATED",
    });
    const rows = await api.rows<{ id: string }>(
      "select id::text from public.audit_events where action='VOTE_ACTIVATED' order by id desc",
    );
    expect(meta.totalCount).toBe(String(rows.length));
    expect(meta.position?.id).toBe(rows[0]?.id);
    const resumed = await api.call<{ rows: { id: string }[] }>(
      observer,
      "public.list_audit_events(1, $1, 'VOTE_ACTIVATED')",
      [meta.position?.id],
    );
    expect(resumed.rows[0]?.id).toBe(rows[1]?.id);
    expect(
      await window(observer, "audit", 1, 25, { from: "2200-01-01T00:00:00Z" }),
    ).toMatchObject({ totalCount: "0" });
  });

  it("denies anonymous, suspended, ordinary-member management and unauthorized parent reads", async () => {
    expect((await dbError(window(null, "residents"))).code).toBe("42501");
    for (const dataset of [
      "residents",
      "admin-votes",
      "participation",
      "audit",
    ]) {
      expect((await dbError(window(world.alice.id, dataset))).message).toBe(
        "FORBIDDEN",
      );
    }
    const privateVote = await api.activeVote("PRIVATE", {
      people: [world.bob],
    });
    expect(
      (
        await dbError(
          window(world.alice.id, "responses", 1, 1, {}, privateVote.id),
        )
      ).message,
    ).toBe("NOT_FOUND");
    expect(
      (
        await dbError(
          window(world.bob.id, "responses", 1, 1, {}, privateVote.id),
        )
      ).message,
    ).toBe("RESULTS_UNAVAILABLE");
  });

  it.each([
    [0, 25],
    [1_000_001, 25],
    [1, 0],
    [1, 101],
  ])("rejects out-of-range page %i / limit %i", async (page, limit) => {
    expect(
      (await dbError(window(world.admin.id, "residents", page, limit))).message,
    ).toBe("VALIDATION_FAILED");
  });
  it("rejects unsupported filters and incorrectly typed filter values", async () => {
    for (const filters of [
      { unknown: "ignored" },
      { isAdmin: "true" },
      { status: null },
    ]) {
      expect(
        (await dbError(window(world.admin.id, "residents", 1, 25, filters)))
          .message,
      ).toBe("VALIDATION_FAILED");
    }
  });
});
