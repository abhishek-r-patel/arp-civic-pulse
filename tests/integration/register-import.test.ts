/* Real-PostgreSQL import authorization, conflict, concurrency and suspended-access checks. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  newAuthUser,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";

describe.skipIf(!hasDatabase)("register import routines", () => {
  let db: TestDatabase;
  let world: World;
  let freshId: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
    freshId = await db.asSuperuser((client) =>
      newAuthUser(client, "import@example.test"),
    );
    await db.asOwner((client) =>
      client.query(
        "insert into public.profiles(id, representative_name) values ($1, 'Import Resident')",
        [freshId],
      ),
    );
  });
  afterAll(async () => {
    await db?.drop();
  });
  const call = (name: string, args: unknown[], sub = world.admin.id) =>
    db
      .asRole(
        "authenticated",
        { sub },
        (client) =>
          client.query<{ result: { state: string; accountId?: string } }>(
            `select public.${name}($1,$2,$3,$4) as result`,
            args,
          ),
        { commit: true },
      )
      .then((result) => {
        const row = result.rows[0];
        if (!row)
          throw new Error("The import routine did not return a result.");
        return row.result;
      });

  it("denies residents and anonymous callers", async () => {
    expect(
      (
        await dbError(
          call(
            "check_register_import",
            ["X-1", "Import Resident", freshId, true],
            world.alice.id,
          ),
        )
      ).message,
    ).toBe("FORBIDDEN");
    expect(
      (
        await dbError(
          db.asRole("anon", null, (client) =>
            client.query(
              "select public.check_register_import('X-1','Import Resident',null,true)",
            ),
          ),
        )
      ).code,
    ).toBe("42501");
  });
  it("skips exact matches and rejects changed name, representative or eligibility", async () => {
    const exact = ["a-101", "Alice Rao", world.alice.id, true];
    expect(await call("check_register_import", exact)).toMatchObject({
      state: "EXISTING",
      accountId: world.alice.id,
    });
    expect(await call("import_register_household", exact)).toMatchObject({
      state: "EXISTING",
    });
    expect(
      await call("check_register_import", [
        "A-101",
        "Changed Name",
        world.alice.id,
        true,
      ]),
    ).toMatchObject({ state: "CONFLICT" });
    expect(
      await call("check_register_import", [
        "A-101",
        "Alice Rao",
        freshId,
        true,
      ]),
    ).toMatchObject({ state: "CONFLICT" });
    expect(
      await call("check_register_import", [
        "A-101",
        "Alice Rao",
        world.alice.id,
        false,
      ]),
    ).toMatchObject({ state: "CONFLICT" });
  });
  it("serializes concurrent duplicate import and keeps the account suspended", async () => {
    const args = ["Imported-1", "Import Resident", freshId, true];
    expect(await call("check_register_import", args)).toMatchObject({
      state: "READY",
    });
    const result = await Promise.all([
      call("import_register_household", args),
      call("import_register_household", args),
    ]);
    expect(result.map((row) => row.state).sort()).toEqual([
      "EXISTING",
      "IMPORTED",
    ]);
    await db.asSuperuser(async (client) => {
      expect(
        (
          await client.query(
            "select status, is_admin from public.profiles where id=$1",
            [freshId],
          )
        ).rows,
      ).toEqual([{ status: "SUSPENDED", is_admin: false }]);
      expect(
        (
          await client.query(
            "select * from public.households where representative_profile_id=$1",
            [freshId],
          )
        ).rows,
      ).toHaveLength(1);
    });
  });
  it("does not assign a second property or reuse an admin identity", async () => {
    expect(
      await call("check_register_import", [
        "Imported-2",
        "Import Resident",
        freshId,
        true,
      ]),
    ).toMatchObject({ state: "CONFLICT" });
    expect(
      await call("check_register_import", [
        "Admin-1",
        "Asha Admin",
        world.admin.id,
        true,
      ]),
    ).toMatchObject({ state: "CONFLICT" });
  });
});
