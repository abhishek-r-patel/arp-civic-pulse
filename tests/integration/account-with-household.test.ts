// Real-PostgreSQL checks for creating an administrator-managed account together with its household.
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

describe.skipIf(!hasDatabase)("provision_profile_with_household", () => {
  let db: TestDatabase;
  let world: World;

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
  });
  afterAll(async () => {
    await db?.drop();
  });

  const create = (
    id: string,
    identifier: string,
    actor: string | null,
    eligible = false,
  ) =>
    db.asRole(
      "service_role",
      SERVICE,
      (c) =>
        c.query(
          "select public.provision_profile_with_household($1, 'Neha Joshi', false, false, $2, $3, $4) as result",
          [id, identifier, eligible, actor],
        ),
      { commit: true },
    );

  it("creates a suspended profile and its household atomically with both audit events", async () => {
    const id = await db.asSuperuser((c) => newAuthUser(c));
    await create(id, "NH-101", world.admin.id, true);
    const row = await db.asSuperuser((c) =>
      c.query(
        `select p.status, h.identifier, h.is_eligible
           from public.profiles p join public.households h on h.representative_profile_id = p.id
          where p.id = $1`,
        [id],
      ),
    );
    expect(row.rows[0]).toEqual({
      status: "SUSPENDED",
      identifier: "NH-101",
      is_eligible: true,
    });
    const audit = await db.asSuperuser((c) =>
      c.query<{ action: string }>(
        `select action from public.audit_events
          where actor_profile_id = $1 and action in ('PROFILE_PROVISIONED', 'HOUSEHOLD_CREATED')
            and occurred_at > now() - interval '1 minute'`,
        [world.admin.id],
      ),
    );
    expect(audit.rows.map((r) => r.action).sort()).toEqual([
      "HOUSEHOLD_CREATED",
      "PROFILE_PROVISIONED",
    ]);
  });

  it("writes nothing when the household is already taken", async () => {
    const first = await db.asSuperuser((c) => newAuthUser(c));
    await create(first, "NH-202", world.admin.id);
    const second = await db.asSuperuser((c) => newAuthUser(c));
    const error = await dbError(create(second, " nh-202 ", world.admin.id));
    expect(error.message).toBe("REGISTER_CONFLICT");
    expect(error.detail).toBe("DUPLICATE_IDENTIFIER");
    const profile = await db.asSuperuser((c) =>
      c.query("select 1 from public.profiles where id = $1", [second]),
    );
    expect(profile.rowCount).toBe(0);
  });

  it("reports an identity that already has a profile as a duplicate email", async () => {
    const error = await dbError(
      create(world.alice.id, "NH-303", world.admin.id),
    );
    expect(error.detail).toBe("DUPLICATE_EMAIL");
  });

  it("requires a current enabled administrator as the actor", async () => {
    const id = await db.asSuperuser((c) => newAuthUser(c));
    for (const actor of [null, world.alice.id]) {
      const error = await dbError(create(id, "NH-404", actor));
      expect(error.message).toBe("FORBIDDEN");
    }
  });
});
