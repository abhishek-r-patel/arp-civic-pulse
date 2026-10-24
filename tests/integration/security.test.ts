import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  newAuthUser,
  type TestDatabase,
} from "./support/database";
import { fixtureOpenVote, seedWorld, type World } from "./support/fixtures";

const APP_TABLES = [
  "rwa_settings",
  "profiles",
  "households",
  "votes",
  "offices",
  "candidates",
  "poll_options",
  "electorate",
  "participation",
  "open_responses",
  "closed_tallies",
  "audit_events",
  "rate_limit_buckets",
];
const PRIVATE_TABLES = [
  "rwa_settings",
  "open_responses",
  "closed_tallies",
  "rate_limit_buckets",
];
const API_ROLES = ["anon", "authenticated", "service_role"];
const PERMISSION_DENIED = "42501";

describe.skipIf(!hasDatabase)("database security posture", () => {
  let db: TestDatabase;
  let world: World;

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
  });
  afterAll(async () => {
    await db?.drop();
  });

  describe("catalog", () => {
    it("enables RLS on every application table", async () => {
      const result = await db.asSuperuser((c) =>
        c.query<{ relname: string }>(
          `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
        ),
      );
      expect(result.rows).toEqual([]);
      const count = await db.asSuperuser((c) =>
        c.query<{ n: string }>(
          `select count(*) as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'`,
        ),
      );
      expect(Number(count.rows[0]?.n)).toBe(APP_TABLES.length);
    });

    it("owns every application object with the restricted non-login role", async () => {
      const result = await db.asSuperuser((c) =>
        c.query<{ name: string; owner: string }>(
          `select c.relname as name, pg_get_userbyid(c.relowner) as owner
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'S', 'i')
           union all
           select p.proname, pg_get_userbyid(p.proowner)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'app_private')`,
        ),
      );
      expect(result.rows.length).toBeGreaterThan(40);
      expect(result.rows.filter((row) => row.owner !== "cp_owner")).toEqual([]);

      const role = await db.asSuperuser((c) =>
        c.query<{
          rolcanlogin: boolean;
          rolsuper: boolean;
          rolbypassrls: boolean;
          rolcreaterole: boolean;
        }>(
          "select rolcanlogin, rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = 'cp_owner'",
        ),
      );
      expect(role.rows[0]).toEqual({
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
      });
    });

    it("pins a trusted search_path on every routine", async () => {
      const result = await db.asSuperuser((c) =>
        c.query<{ proname: string }>(
          `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'app_private')
              and not exists (
                select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as setting
                 where setting = 'search_path=""')`,
        ),
      );
      expect(result.rows).toEqual([]);
    });

    it("grants no write or truncate privileges to any API role", async () => {
      const result = await db.asSuperuser((c) =>
        c.query<{ role: string; table: string; privilege: string }>(
          `select r.role, t.table_name as table, p.privilege
             from unnest($1::text[]) as r(role)
             cross join unnest($2::text[]) as t(table_name)
             cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(privilege)
            where has_table_privilege(r.role, 'public.' || t.table_name, p.privilege)`,
          [API_ROLES, APP_TABLES],
        ),
      );
      expect(result.rows).toEqual([]);
    });

    it("grants no read privileges on private tables and none at all to anon", async () => {
      const privateReads = await db.asSuperuser((c) =>
        c.query(
          `select r.role, t.table_name from unnest($1::text[]) as r(role)
             cross join unnest($2::text[]) as t(table_name)
            where has_table_privilege(r.role, 'public.' || t.table_name, 'SELECT')`,
          [API_ROLES, PRIVATE_TABLES],
        ),
      );
      expect(privateReads.rows).toEqual([]);

      const anonReads = await db.asSuperuser((c) =>
        c.query(
          `select t.table_name from unnest($1::text[]) as t(table_name)
            where has_table_privilege('anon', 'public.' || t.table_name, 'SELECT')`,
          [APP_TABLES],
        ),
      );
      expect(anonReads.rows).toEqual([]);
    });

    it("limits routine execution to the documented callers", async () => {
      const executable = (role: string) =>
        db.asSuperuser((c) =>
          c.query<{ schema: string; name: string }>(
            `select n.nspname as schema, p.proname as name
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'app_private')
                and has_function_privilege($1, p.oid, 'EXECUTE')
              order by 1, 2`,
            [role],
          ),
        );

      expect((await executable("anon")).rows).toEqual([]);
      expect(
        (await executable("service_role")).rows.map((r) => r.name),
      ).toEqual(["consume_rate_limit", "enable_profile", "provision_profile"]);
      expect(
        (await executable("authenticated")).rows.map((r) => r.name),
      ).toEqual([
        "can_view_office",
        "can_view_vote",
        "current_uid",
        "has_entitlement",
        "is_enabled_admin",
        "is_enabled_member",
        "owns_participation",
      ]);
    });

    it("does not publish application tables to Realtime or logical replication", async () => {
      const result = await db.asSuperuser((c) =>
        c.query(
          "select 1 from pg_publication_tables where schemaname = 'public'",
        ),
      );
      expect(result.rows).toEqual([]);
    });
  });

  describe("direct API access", () => {
    it("denies anonymous reads of every application table", async () => {
      for (const table of APP_TABLES) {
        const error = await dbError(
          db.asRole("anon", null, (c) =>
            c.query(`select 1 from public.${table} limit 1`),
          ),
        );
        expect(error.code, table).toBe(PERMISSION_DENIED);
      }
    });

    it("denies anonymous and member calls to server-only routines", async () => {
      for (const role of ["anon", "authenticated"] as const) {
        const claims = role === "anon" ? null : { sub: world.alice.id };
        expect(
          (
            await dbError(
              db.asRole(role, claims, (c) =>
                c.query(
                  "select public.provision_profile($1, 'Mallory', true)",
                  [world.alice.id],
                ),
              ),
            )
          ).code,
        ).toBe(PERMISSION_DENIED);
        expect(
          (
            await dbError(
              db.asRole(role, claims, (c) =>
                c.query(
                  "select public.consume_rate_limit('x', array[decode(repeat('00', 32), 'hex')], array[1::smallint], 10, 60)",
                ),
              ),
            )
          ).code,
        ).toBe(PERMISSION_DENIED);
      }
    });

    it("denies direct writes by members and administrators", async () => {
      const statements = [
        "insert into public.votes (voting_type, created_by_profile_id) values ('OPEN', gen_random_uuid())",
        "update public.profiles set is_admin = true",
        "update public.votes set title = 'x'",
        "delete from public.households",
        "insert into public.audit_events (actor_kind, action, target_type, target_id) values ('SYSTEM', 'DRAFT_CREATED', 'VOTE', '1')",
        "update public.audit_events set reason = 'x'",
        "delete from public.participation",
      ];
      for (const actor of [world.alice.id, world.admin.id]) {
        for (const sql of statements) {
          const error = await dbError(
            db.asRole("authenticated", { sub: actor }, (c) => c.query(sql)),
          );
          expect(error.code, sql).toBe(PERMISSION_DENIED);
        }
      }
    });

    it("never lets even an administrator read choices, counters, settings or buckets", async () => {
      for (const table of PRIVATE_TABLES) {
        const error = await dbError(
          db.asRole("authenticated", { sub: world.admin.id }, (c) =>
            c.query(`select * from public.${table}`),
          ),
        );
        expect(error.code, table).toBe(PERMISSION_DENIED);
      }
    });

    it("hides the vote creator column from direct reads", async () => {
      const error = await dbError(
        db.asRole("authenticated", { sub: world.admin.id }, (c) =>
          c.query("select created_by_profile_id from public.votes"),
        ),
      );
      expect(error.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("row visibility", () => {
    it("shows members only their own enabled profile", async () => {
      const rows = await db.asRole(
        "authenticated",
        { sub: world.alice.id },
        (c) => c.query<{ id: string }>("select id from public.profiles"),
      );
      expect(rows.rows.map((r) => r.id)).toEqual([world.alice.id]);
    });

    it("shows administrators every profile and household", async () => {
      const profiles = await db.asRole(
        "authenticated",
        { sub: world.admin.id },
        (c) => c.query("select id from public.profiles"),
      );
      const households = await db.asRole(
        "authenticated",
        { sub: world.admin.id },
        (c) => c.query("select id from public.households"),
      );
      expect(profiles.rowCount).toBe(5);
      expect(households.rowCount).toBe(4);
    });

    it("hides households from members", async () => {
      const result = await db.asRole(
        "authenticated",
        { sub: world.alice.id },
        (c) => c.query("select id from public.households"),
      );
      expect(result.rowCount).toBe(0);
    });

    it("returns nothing to a suspended profile that still holds a valid JWT", async () => {
      for (const table of [
        "profiles",
        "households",
        "votes",
        "electorate",
        "participation",
      ]) {
        const result = await db.asRole(
          "authenticated",
          { sub: world.carol.id },
          (c) => c.query(`select 1 from public.${table}`),
        );
        expect(result.rowCount, table).toBe(0);
      }
    });

    it("returns nothing for a valid JWT whose identity has no profile", async () => {
      const stranger = await db.asSuperuser((c) => newAuthUser(c));
      const result = await db.asRole("authenticated", { sub: stranger }, (c) =>
        c.query("select 1 from public.profiles"),
      );
      expect(result.rowCount).toBe(0);
    });

    it("shows members only votes whose frozen electorate names them, never drafts", async () => {
      const shared = await fixtureOpenVote(db, world, [world.alice, world.bob]);
      const daveOnly = await fixtureOpenVote(db, world, [world.dave]);
      const draftId = await db.asOwner(async (c) => {
        const row = await c.query<{ id: string }>(
          "insert into public.votes (voting_type, created_by_profile_id) values ('OPEN', $1) returning id",
          [world.admin.id],
        );
        return row.rows[0]?.id ?? "";
      });

      const visible = async (sub: string) =>
        (
          await db.asRole("authenticated", { sub }, (c) =>
            c.query<{ id: string }>("select id from public.votes"),
          )
        ).rows.map((r) => r.id);

      expect(await visible(world.alice.id)).toEqual([shared.id]);
      expect(await visible(world.dave.id)).toEqual([daveOnly.id]);
      const adminSees = await visible(world.admin.id);
      expect(adminSees).toEqual(
        expect.arrayContaining([shared.id, daveOnly.id, draftId]),
      );

      // Ballot configuration follows the same parent-vote visibility.
      const options = await db.asRole(
        "authenticated",
        { sub: world.alice.id },
        (c) =>
          c.query<{ vote_id: string }>(
            "select vote_id from public.poll_options",
          ),
      );
      expect(new Set(options.rows.map((r) => r.vote_id))).toEqual(
        new Set([shared.id]),
      );
    });

    it("revokes access immediately on suspension even with an existing session", async () => {
      const vote = await fixtureOpenVote(db, world, [world.dave]);
      const before = await db.asRole(
        "authenticated",
        { sub: world.dave.id },
        (c) => c.query("select id from public.votes where id = $1", [vote.id]),
      );
      expect(before.rowCount).toBe(1);

      await db.asOwner((c) =>
        c.query(
          "update public.profiles set status = 'SUSPENDED' where id = $1",
          [world.dave.id],
        ),
      );
      const after = await db.asRole(
        "authenticated",
        { sub: world.dave.id },
        (c) => c.query("select id from public.votes where id = $1", [vote.id]),
      );
      expect(after.rowCount).toBe(0);

      await db.asOwner((c) =>
        c.query("update public.profiles set status = 'ENABLED' where id = $1", [
          world.dave.id,
        ]),
      );
    });

    it("keeps historical entitlement with the frozen representative after reassignment", async () => {
      const vote = await fixtureOpenVote(db, world, [world.bob]);
      const eve = await db.asSuperuser((c) => newAuthUser(c));
      await db.asOwner(async (c) => {
        await c.query(
          "insert into public.profiles (id, representative_name, status) values ($1, 'Eve Menon', 'ENABLED')",
          [eve],
        );
        await c.query(
          "update public.households set representative_profile_id = $1 where id = $2",
          [eve, world.bob.householdId],
        );
      });

      const seenBy = async (sub: string) =>
        (
          await db.asRole("authenticated", { sub }, (c) =>
            c.query("select id from public.votes where id = $1", [vote.id]),
          )
        ).rowCount;
      expect(await seenBy(world.bob.id)).toBe(1);
      expect(await seenBy(eve)).toBe(0);

      await db.asOwner(async (c) => {
        await c.query(
          "update public.households set representative_profile_id = $1 where id = $2",
          [world.bob.id, world.bob.householdId],
        );
      });
    });

    it("limits audit history to administrators", async () => {
      await db.asDeployment((c) =>
        c.query(
          "select app_private.deployment_initialize_settings('Test RWA', 'Asia/Kolkata')",
        ),
      );
      const member = await db.asRole(
        "authenticated",
        { sub: world.alice.id },
        (c) => c.query("select id from public.audit_events"),
      );
      const admin = await db.asRole(
        "authenticated",
        { sub: world.admin.id },
        (c) => c.query("select id from public.audit_events"),
      );
      expect(member.rowCount).toBe(0);
      expect(admin.rowCount).toBeGreaterThan(0);
    });
  });
});
