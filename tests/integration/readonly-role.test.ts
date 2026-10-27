/* Real PostgreSQL verification of committee reads, exclusive roles and denied management writes. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  newAuthUser,
  type TestDatabase,
} from "./support/database";
import { seedWorld, insertDraft, type World } from "./support/fixtures";
import { votingApi } from "./support/votes";

describe.skipIf(!hasDatabase)("readonly committee role", () => {
  let db: TestDatabase;
  let world: World;
  let draftId: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
    await votingApi(db, world).setupPolicy();
    draftId = await db.asOwner((client) =>
      insertDraft(client, world.admin.id, "PUBLIC"),
    );
    await change(world.alice.id, { isReadonly: true });
  });
  afterAll(async () => {
    await db?.drop();
  });
  const as = (sub: string, sql: string, args: unknown[] = []) =>
    db.asRole("authenticated", { sub }, (client) => client.query(sql, args), {
      commit: true,
    });
  const change = (
    id: string,
    changes: Record<string, unknown>,
    actor?: string,
  ) =>
    as(
      actor ?? world.admin.id,
      "select public.update_profile($1,$2::jsonb) as result",
      [id, JSON.stringify(changes)],
    );

  it("reads the complete register, drafts, settings and audit, without gaining admin capability", async () => {
    expect(
      (await as(world.alice.id, "select * from public.profiles")).rowCount,
    ).toBe(5);
    expect(
      (await as(world.alice.id, "select * from public.households")).rowCount,
    ).toBe(4);
    expect(
      (await as(world.alice.id, "select public.get_admin_vote($1)", [draftId]))
        .rowCount,
    ).toBe(1);
    expect(
      (await as(world.alice.id, "select public.get_rwa_profile()")).rowCount,
    ).toBe(1);
    expect(
      (await as(world.alice.id, "select * from public.audit_events")).rowCount,
    ).toBeGreaterThan(0);
    expect(
      (
        await as(
          world.alice.id,
          "select app_private.is_enabled_admin() as admin, app_private.is_enabled_committee() as committee",
        )
      ).rows[0],
    ).toEqual({ admin: false, committee: true });
  });
  it("denies direct mutation RPCs, table writes and self-promotion", async () => {
    for (const changes of [
      { isAdmin: true },
      { representativeName: "Changed" },
      { status: "SUSPENDED" },
    ]) {
      expect(
        (await dbError(change(world.alice.id, changes, world.alice.id)))
          .message,
      ).toBe("FORBIDDEN");
    }
    expect(
      (
        await dbError(
          as(
            world.alice.id,
            "update public.profiles set is_admin=true,is_readonly=false where id=$1",
            [world.alice.id],
          ),
        )
      ).code,
    ).toBe("42501");
    expect(
      (
        await dbError(
          as(
            world.alice.id,
            "select public.check_register_import('X','Name',null,true)",
          ),
        )
      ).message,
    ).toBe("FORBIDDEN");
  });
  it("requires household assignment before enabling a readonly account", async () => {
    const id = await db.asSuperuser((client) =>
      newAuthUser(client, "observer@example.test"),
    );
    await db.asOwner((client) =>
      client.query(
        "insert into public.profiles(id,representative_name,status,is_readonly) values($1,'Observer Example','SUSPENDED',true)",
        [id],
      ),
    );
    const enable = () =>
      db.asRole(
        "service_role",
        { role: "service_role" },
        (client) => client.query("select public.enable_profile($1,null)", [id]),
        { commit: true },
      );
    expect((await dbError(enable())).message).toBe("PROVISIONING_INCOMPLETE");
    await db.asOwner((client) =>
      client.query(
        "insert into public.households(identifier,identifier_normalized,representative_profile_id,is_eligible) values('R-901',app_private.normalize_key('R-901'),$1,false)",
        [id],
      ),
    );
    expect((await enable()).rows[0]).toMatchObject({
      enable_profile: { status: "ENABLED" },
    });
  });
  it("rejects dual roles and protects the final enabled admin", async () => {
    expect(
      (await dbError(change(world.bob.id, { isAdmin: true, isReadonly: true })))
        .message,
    ).toBe("VALIDATION_FAILED");
    expect(
      (await dbError(change(world.admin.id, { isAdmin: false }))).message,
    ).toBe("LIFECYCLE_CONFLICT");
  });
  it("requires a household when an enabled administrator switches to readonly", async () => {
    await change(world.bob.id, { isAdmin: true });
    expect(
      (await dbError(change(world.admin.id, { isReadonly: true }))).message,
    ).toBe("PROVISIONING_INCOMPLETE");
    await change(world.bob.id, { isAdmin: false });
  });
  it("preserves own PUBLIC and PRIVATE voting, result privacy and admin-equivalent completed result reads", async () => {
    const api = votingApi(db, world);
    for (const type of ["PUBLIC", "PRIVATE"] as const) {
      const vote = await api.activeVote(type);
      const body =
        type === "PUBLIC"
          ? { confirmed: true, optionId: vote.options[0]?.id }
          : {
              confirmed: true,
              selections: vote.offices.map((office) => ({
                officeId: office.id,
                candidateId: office.candidates[0]?.id,
              })),
            };
      expect(await api.cast(world.alice.id, vote.id, body)).toMatchObject({
        accepted: true,
      });
      const active = await api.call<{
        offices: unknown[];
        namedResponses: unknown;
      }>(world.alice.id, "public.get_vote_results($1)", [vote.id]);
      expect(active.namedResponses).toBeNull();
      if (type === "PRIVATE") expect(active.offices).toEqual([]);
      await api.call(
        world.admin.id,
        "public.complete_vote_early($1,true,'Synthetic test complete')",
        [vote.id],
      );
      const reader = await api.call(
        world.alice.id,
        "public.get_vote_results($1)",
        [vote.id],
      );
      expect(reader).toEqual(
        await api.call(world.admin.id, "public.get_vote_results($1)", [
          vote.id,
        ]),
      );
    }
    const other = await api.activeVote("PUBLIC", { people: [world.bob] });
    expect(
      (
        await dbError(
          api.cast(world.alice.id, other.id, {
            confirmed: true,
            optionId: other.options[0]?.id,
          }),
        )
      ).message,
    ).toBe("NOT_FOUND");
    expect(
      (
        await dbError(
          api.call(
            world.alice.id,
            "public.complete_vote_early($1,true,'Not allowed')",
            [other.id],
          ),
        )
      ).message,
    ).toBe("FORBIDDEN");
    await api.cast(world.bob.id, other.id, {
      confirmed: true,
      optionId: other.options[0]?.id,
    });
    await api.call(
      world.admin.id,
      "public.complete_vote_early($1,true,'Synthetic test complete')",
      [other.id],
    );
    const observerResults = await api.call<{ namedResponses: unknown[] }>(
      world.alice.id,
      "public.get_vote_results($1)",
      [other.id],
    );
    expect(observerResults.namedResponses).toHaveLength(1);
    expect(observerResults).toEqual(
      await api.call(world.admin.id, "public.get_vote_results($1)", [other.id]),
    );
  });

  it("switches roles atomically and invalidates readonly access using current profile state", async () => {
    await change(world.alice.id, { isAdmin: true });
    expect(
      (
        await as(
          world.alice.id,
          "select is_admin,is_readonly from public.profiles where id=$1",
          [world.alice.id],
        )
      ).rows[0],
    ).toEqual({ is_admin: true, is_readonly: false });
    await change(world.alice.id, { isReadonly: true });
    await change(world.alice.id, { isReadonly: false });
    expect(
      (await as(world.alice.id, "select * from public.households")).rowCount,
    ).toBe(0);
    expect(
      (
        await dbError(
          as(world.alice.id, "select public.get_admin_vote($1)", [draftId]),
        )
      ).message,
    ).toBe("FORBIDDEN");
    await change(world.alice.id, { isReadonly: true });
    await change(world.alice.id, { status: "SUSPENDED" });
    expect(
      (await as(world.alice.id, "select * from public.profiles")).rowCount,
    ).toBe(0);
    expect(
      (
        await dbError(
          as(world.alice.id, "select public.get_admin_vote($1)", [draftId]),
        )
      ).message,
    ).toBe("FORBIDDEN");
  });
});
