// Real-PostgreSQL checks for the server-only resident self-registration routine.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  newAuthUser,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";

const SERVICE = { role: "service_role" } as const;

describe.skipIf(!hasDatabase)("self_register_resident", () => {
  let db: TestDatabase;
  let world: World;

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
  });
  afterAll(async () => {
    await db?.drop();
  });

  const register = (id: string, name: string, identifier: string) =>
    db.asRole(
      "service_role",
      SERVICE,
      (c) =>
        c.query<{
          result: { id: string; status: string; householdId: string };
        }>("select public.self_register_resident($1, $2, $3) as result", [
          id,
          name,
          identifier,
        ]),
      { commit: true },
    );

  it("creates a suspended self-registered profile with an ineligible household and one audit event", async () => {
    const id = await db.asSuperuser((c) => newAuthUser(c));
    const created = await register(id, "  Rhea Das ", " SR-101 ");
    expect(created.rows[0]?.result).toMatchObject({ id, status: "SUSPENDED" });

    const row = await db.asSuperuser((c) =>
      c.query(
        `select p.status, p.is_admin, p.is_readonly, p.self_registered, p.representative_name,
                h.identifier, h.is_eligible
           from public.profiles p join public.households h on h.representative_profile_id = p.id
          where p.id = $1`,
        [id],
      ),
    );
    expect(row.rows[0]).toEqual({
      status: "SUSPENDED",
      is_admin: false,
      is_readonly: false,
      self_registered: true,
      representative_name: "Rhea Das",
      identifier: "SR-101",
      is_eligible: false,
    });
    const audit = await db.asSuperuser((c) =>
      c.query(
        "select actor_kind, actor_profile_id from public.audit_events where action = 'PROFILE_SELF_REGISTERED' and target_id = $1",
        [id],
      ),
    );
    expect(audit.rows).toEqual([
      { actor_kind: "SYSTEM", actor_profile_id: null },
    ]);
  });

  it("rejects a repeated email (same or different household) and writes nothing", async () => {
    const id = await db.asSuperuser((c) => newAuthUser(c));
    await register(id, "Sam Iyer", "SR-201");
    for (const identifier of ["SR-201", "SR-202"]) {
      const error = await dbError(register(id, "Sam Iyer", identifier));
      expect(error.message).toBe("REGISTER_CONFLICT");
      expect(error.detail).toBe("DUPLICATE_EMAIL");
    }
    const households = await db.asSuperuser((c) =>
      c.query("select 1 from public.households where identifier = 'SR-202'"),
    );
    expect(households.rowCount).toBe(0);
  });

  it("rejects a household that is already registered, including case and spacing variants", async () => {
    const first = await db.asSuperuser((c) => newAuthUser(c));
    await register(first, "Tara Nair", "Tower B 303");
    const second = await db.asSuperuser((c) => newAuthUser(c));
    const error = await dbError(
      register(second, "Uma Shah", "  tower  b 303 "),
    );
    expect(error.message).toBe("REGISTER_CONFLICT");
    expect(error.detail).toBe("DUPLICATE_IDENTIFIER");
    const profile = await db.asSuperuser((c) =>
      c.query("select 1 from public.profiles where id = $1", [second]),
    );
    expect(profile.rowCount).toBe(0);
  });

  it("reports an existing admin-provisioned profile as a repeated email", async () => {
    const error = await dbError(
      register(world.alice.id, "Alice Example", "SR-999"),
    );
    expect(error.detail).toBe("DUPLICATE_EMAIL");
  });

  it("is reachable only with a verified service-role claim", async () => {
    const id = await db.asSuperuser((c) => newAuthUser(c));
    const error = await dbError(
      db.asRole("service_role", { role: "authenticated", sub: id }, (c) =>
        c.query("select public.self_register_resident($1, 'Mallory', 'X-1')", [
          id,
        ]),
      ),
    );
    expect(error.message).toBe("FORBIDDEN");
    for (const role of ["anon", "authenticated"] as const) {
      const denied = await dbError(
        db.asRole(role, role === "anon" ? null : { sub: id }, (c) =>
          c.query(
            "select public.self_register_resident($1, 'Mallory', 'X-1')",
            [id],
          ),
        ),
      );
      expect(denied.code).toBe("42501");
    }
  });

  describe("with configured Default Households", () => {
    const setList = (items: string[]) =>
      db.asSuperuser((c) =>
        c.query(
          "update public.rwa_settings set default_households = $1 where id = 1",
          [items],
        ),
      );

    beforeAll(async () => {
      await db.asDeployment((c) =>
        c.query(
          "select app_private.deployment_initialize_settings('Lakeview RWA', 'Asia/Kolkata')",
        ),
      );
      await setList(["Tower C 101", "Tower C 102"]);
    });

    it("returns the list only to the service role", async () => {
      const listed = await db.asRole("service_role", SERVICE, (c) =>
        c.query<{ result: string[] }>(
          "select public.get_self_registration_households() as result",
        ),
      );
      expect(listed.rows[0]?.result).toEqual(["Tower C 101", "Tower C 102"]);
      const denied = await dbError(
        db.asRole("anon", null, (c) =>
          c.query("select public.get_self_registration_households()"),
        ),
      );
      expect(denied.code).toBe("42501");
    });

    it("rejects a household outside the list and writes nothing", async () => {
      const id = await db.asSuperuser((c) => newAuthUser(c));
      const error = await dbError(register(id, "Vik Rao", "tower_c-101"));
      expect(error.message).toBe("VALIDATION_FAILED");
      expect(error.detail).toBe("UNKNOWN_HOUSEHOLD");
      const profile = await db.asSuperuser((c) =>
        c.query("select 1 from public.profiles where id = $1", [id]),
      );
      expect(profile.rowCount).toBe(0);
    });

    it("stores the configured spelling for a case or spacing variant", async () => {
      const id = await db.asSuperuser((c) => newAuthUser(c));
      await register(id, "Wani Das", "  tower c   102 ");
      const row = await db.asSuperuser((c) =>
        c.query<{ identifier: string }>(
          "select identifier from public.households where representative_profile_id = $1",
          [id],
        ),
      );
      expect(row.rows[0]?.identifier).toBe("Tower C 102");
    });

    it("still reports a repeated email before the list check", async () => {
      const error = await dbError(
        register(world.alice.id, "Alice Example", "Not Listed"),
      );
      expect(error.detail).toBe("DUPLICATE_EMAIL");
    });
  });
});
