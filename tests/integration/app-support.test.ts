/* Real PostgreSQL verification of RWA-controlled, read-only App Support Access. */
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

interface ToggleResult {
  enabled: boolean;
  changed: boolean;
  revokedProfileIds: string[];
}

describe.skipIf(!hasDatabase)("app support access", () => {
  let db: TestDatabase;
  let world: World;
  let supportId: string;
  let draftId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
    await votingApi(db, world).setupPolicy();
    draftId = await db.asOwner((client) =>
      insertDraft(client, world.admin.id, "PUBLIC"),
    );
    supportId = await db.asSuperuser((client) =>
      newAuthUser(client, "support@example.test"),
    );
  });
  afterAll(async () => {
    await db?.drop();
  });

  const as = (sub: string, sql: string, args: unknown[] = []) =>
    db.asRole("authenticated", { sub }, (client) => client.query(sql, args), {
      commit: true,
    });
  const toggle = async (
    id: string | null,
    enabled: boolean,
    actor: string | null = world.admin.id,
  ): Promise<ToggleResult> =>
    (
      await db.asRole(
        "service_role",
        { role: "service_role" },
        (client) =>
          client.query<{ result: ToggleResult }>(
            "select public.set_app_support_access($1,$2,$3) as result",
            [id, enabled, actor],
          ),
        { commit: true },
      )
    ).rows[0]?.result as ToggleResult;
  const profile = (id: string) =>
    db.asOwner(
      async (client) =>
        (
          await client.query(
            "select status,is_admin,is_readonly,is_app_support from public.profiles where id=$1",
            [id],
          )
        ).rows[0],
    );

  it("creates an enabled, household-free rwa-readonly support profile and audits it", async () => {
    expect(await toggle(supportId, true)).toEqual({
      enabled: true,
      changed: true,
      revokedProfileIds: [],
    });
    expect(await profile(supportId)).toEqual({
      status: "ENABLED",
      is_admin: false,
      is_readonly: true,
      is_app_support: true,
    });
    expect(await toggle(supportId, true)).toMatchObject({ changed: false });
    const audit = await db.asOwner(
      async (client) =>
        (
          await client.query(
            "select actor_profile_id,details from public.audit_events where action='APP_SUPPORT_ACCESS_ENABLED' and target_id=$1",
            [supportId],
          )
        ).rows,
    );
    expect(audit).toEqual([
      { actor_profile_id: world.admin.id, details: { created: true } },
    ]);
  });

  it("grants committee reads but no management writes or ballots", async () => {
    expect(
      (
        await as(
          supportId,
          "select app_private.is_enabled_admin() as admin, app_private.is_enabled_committee() as committee",
        )
      ).rows[0],
    ).toEqual({ admin: false, committee: true });
    expect(
      (await as(supportId, "select public.get_admin_vote($1)", [draftId]))
        .rowCount,
    ).toBe(1);
    expect(
      (await as(supportId, "select * from public.households")).rowCount,
    ).toBe(4);
    expect(
      (
        await dbError(
          as(supportId, "select public.update_profile($1,$2::jsonb)", [
            world.bob.id,
            JSON.stringify({ status: "SUSPENDED" }),
          ]),
        )
      ).message,
    ).toBe("FORBIDDEN");
    const vote = await votingApi(db, world).activeVote("PUBLIC");
    expect(
      (
        await dbError(
          votingApi(db, world).cast(supportId, vote.id, {
            confirmed: true,
            optionId: vote.options[0]?.id,
          }),
        )
      ).message,
    ).toBe("NOT_FOUND");
  });

  it("refuses ordinary account routines and any household assignment", async () => {
    for (const changes of [
      { isAdmin: true },
      { isReadonly: false },
      { status: "DELETED" },
      { representativeName: "Renamed" },
    ]) {
      const failure = await dbError(
        as(world.admin.id, "select public.update_profile($1,$2::jsonb)", [
          supportId,
          JSON.stringify(changes),
        ]),
      );
      expect(failure.message).toBe("LIFECYCLE_CONFLICT");
      expect(failure.detail).toBe("APP_SUPPORT_MANAGED");
    }
    const household = await dbError(
      db.asOwner((client) =>
        client.query(
          "insert into public.households(identifier,identifier_normalized,representative_profile_id,is_eligible) values('S-1',app_private.normalize_key('S-1'),$1,true)",
          [supportId],
        ),
      ),
    );
    expect(household.message).toBe("REGISTER_CONFLICT");
    expect(household.detail).toBe("APP_SUPPORT_ACCOUNT");
    const promoted = await dbError(
      db.asOwner((client) =>
        client.query(
          "update public.profiles set is_app_support=true where id=$1",
          [world.bob.id],
        ),
      ),
    );
    expect(promoted.detail).toBe("APP_SUPPORT_MANAGED");
  });

  it("disables immediately and reports every support profile to keep banned", async () => {
    expect(await toggle(null, false)).toEqual({
      enabled: false,
      changed: true,
      revokedProfileIds: [supportId],
    });
    expect(await profile(supportId)).toMatchObject({ status: "SUSPENDED" });
    expect(
      (await as(supportId, "select * from public.profiles")).rowCount,
    ).toBe(0);
    expect(
      (
        await dbError(
          as(supportId, "select public.get_admin_vote($1)", [draftId]),
        )
      ).message,
    ).toBe("FORBIDDEN");
    expect(await toggle(null, false)).toMatchObject({ changed: false });
    const enable = await dbError(
      db.asRole(
        "service_role",
        { role: "service_role" },
        (client) =>
          client.query("select public.enable_profile($1,$2)", [
            supportId,
            world.admin.id,
          ]),
        { commit: true },
      ),
    );
    expect(enable.detail).toBe("APP_SUPPORT_MANAGED");
    expect(await toggle(supportId, true)).toMatchObject({ changed: true });
    expect(await profile(supportId)).toMatchObject({ status: "ENABLED" });
  });

  it("suspends a previous support identity when the configured email changes", async () => {
    const nextId = await db.asSuperuser((client) =>
      newAuthUser(client, "support-next@example.test"),
    );
    expect(await toggle(nextId, true)).toEqual({
      enabled: true,
      changed: true,
      revokedProfileIds: [supportId],
    });
    expect(await profile(supportId)).toMatchObject({ status: "SUSPENDED" });
    expect(await profile(nextId)).toMatchObject({ status: "ENABLED" });
  });

  it("requires an enabled administrator actor, the service role and a support-only identity", async () => {
    expect((await dbError(toggle(supportId, true, null))).message).toBe(
      "VALIDATION_FAILED",
    );
    expect(
      (await dbError(toggle(supportId, true, world.alice.id))).message,
    ).toBe("FORBIDDEN");
    const inUse = await dbError(toggle(world.bob.id, true));
    expect(inUse.message).toBe("REGISTER_CONFLICT");
    expect(inUse.detail).toBe("APP_SUPPORT_EMAIL_IN_USE");
    expect(
      (
        await dbError(
          as(
            world.admin.id,
            "select public.set_app_support_access($1,true,$2)",
            [supportId, world.admin.id],
          ),
        )
      ).code,
    ).toBe("42501");
  });
});
