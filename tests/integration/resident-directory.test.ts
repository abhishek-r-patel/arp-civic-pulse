// Real-PostgreSQL checks for the security-invoker Residents directory view.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";

describe.skipIf(!hasDatabase)("resident_directory", () => {
  let db: TestDatabase;
  let world: World;

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("is a security-invoker view, so the caller's own RLS applies", async () => {
    const options = await db.asSuperuser((c) =>
      c.query<{ reloptions: string[] | null }>(
        "select reloptions from pg_class where oid = 'public.resident_directory'::regclass",
      ),
    );
    expect(options.rows[0]?.reloptions).toContain("security_invoker=true");
  });

  it("lists everyone for an administrator, households by identifier first and unassigned people last", async () => {
    const rows = await db.asRole(
      "authenticated",
      { sub: world.admin.id },
      (c) =>
        c.query<{ id: string; household_identifier: string | null }>(
          "select id, household_identifier from public.resident_directory order by sort_key, id",
        ),
    );
    const total = await db.asSuperuser((c) =>
      c.query<{ n: string }>("select count(*) as n from public.profiles"),
    );
    expect(rows.rowCount).toBe(Number(total.rows[0]?.n));
    const identifiers = rows.rows.map((row) => row.household_identifier);
    const firstUnassigned = identifiers.indexOf(null);
    expect(firstUnassigned).toBeGreaterThan(0);
    expect(identifiers.slice(firstUnassigned).every((id) => id === null)).toBe(
      true,
    );
    expect(rows.rows.map((row) => row.id)).toContain(world.admin.id);
  });

  it("shows a member only their own row, without household details", async () => {
    const rows = await db.asRole(
      "authenticated",
      { sub: world.alice.id },
      (c) =>
        c.query<{ id: string; household_id: string | null }>(
          "select id, household_id from public.resident_directory",
        ),
    );
    expect(rows.rows).toEqual([{ id: world.alice.id, household_id: null }]);
  });

  it("denies anonymous callers", async () => {
    const error = await dbError(
      db.asRole("anon", null, (c) =>
        c.query("select 1 from public.resident_directory"),
      ),
    );
    expect(error.code).toBe("42501");
  });
});
