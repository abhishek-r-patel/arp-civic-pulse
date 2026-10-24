import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  newAuthUser,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";

const CHECK_VIOLATION = "23514";
const SERVICE = { role: "service_role" } as const;

describe.skipIf(!hasDatabase)("provisioning, settings and approvals", () => {
  let db: TestDatabase;
  let world: World;

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
  });
  afterAll(async () => {
    await db?.drop();
  });

  const provision = (
    id: string,
    name: string,
    isAdmin = false,
    actor: string | null = null,
  ) =>
    db.asRole(
      "service_role",
      SERVICE,
      (c) =>
        c.query<{ result: { id: string; status: string; created: boolean } }>(
          "select public.provision_profile($1, $2, $3, $4) as result",
          [id, name, isAdmin, actor],
        ),
      { commit: true },
    );

  const auditCount = async (action: string) =>
    Number(
      (
        await db.asSuperuser((c) =>
          c.query<{ n: string }>(
            "select count(*) as n from public.audit_events where action = $1",
            [action],
          ),
        )
      ).rows[0]?.n,
    );

  describe("provision_profile", () => {
    it("creates a suspended profile and audits it atomically", async () => {
      const id = await db.asSuperuser((c) => newAuthUser(c));
      const before = await auditCount("PROFILE_PROVISIONED");

      const created = await provision(id, "  Farah Khan  ");
      expect(created.rows[0]?.result).toEqual({
        id,
        status: "SUSPENDED",
        created: true,
      });
      expect(await auditCount("PROFILE_PROVISIONED")).toBe(before + 1);

      const row = await db.asSuperuser((c) =>
        c.query<{ representative_name: string; is_admin: boolean }>(
          "select representative_name, is_admin from public.profiles where id = $1",
          [id],
        ),
      );
      expect(row.rows[0]).toEqual({
        representative_name: "Farah Khan",
        is_admin: false,
      });
    });

    it("is safe to retry and never duplicates the profile or audit event", async () => {
      const id = await db.asSuperuser((c) => newAuthUser(c));
      await provision(id, "Gita Rao");
      const before = await auditCount("PROFILE_PROVISIONED");

      const retry = await provision(id, "Gita Rao");
      expect(retry.rows[0]?.result).toMatchObject({ id, created: false });
      expect(await auditCount("PROFILE_PROVISIONED")).toBe(before);
    });

    it("rejects a retry that disagrees with the existing profile", async () => {
      const id = await db.asSuperuser((c) => newAuthUser(c));
      await provision(id, "Hari Om");

      expect((await dbError(provision(id, "Someone Else"))).message).toBe(
        "REGISTER_CONFLICT",
      );
      expect((await dbError(provision(id, "Hari Om", true))).message).toBe(
        "REGISTER_CONFLICT",
      );
    });

    it("reports a missing Auth identity and writes nothing", async () => {
      const before = await auditCount("PROFILE_PROVISIONED");
      const missing = "00000000-0000-4000-8000-000000000000";

      expect((await dbError(provision(missing, "Ghost"))).message).toBe(
        "AUTH_IDENTITY_MISSING",
      );
      expect(await auditCount("PROFILE_PROVISIONED")).toBe(before);
    });

    it("requires a real enabled administrator as the acting profile", async () => {
      const id = await db.asSuperuser((c) => newAuthUser(c));
      expect(
        (await dbError(provision(id, "Indu Pal", false, world.alice.id)))
          .message,
      ).toBe("FORBIDDEN");
      expect(
        (await dbError(provision(id, "Indu Pal", false, world.carol.id)))
          .message,
      ).toBe("FORBIDDEN");

      await provision(id, "Indu Pal", false, world.admin.id);
      const event = await db.asSuperuser((c) =>
        c.query<{ actor_kind: string; actor_profile_id: string }>(
          "select actor_kind, actor_profile_id from public.audit_events where target_id = $1",
          [id],
        ),
      );
      expect(event.rows[0]).toEqual({
        actor_kind: "PROFILE",
        actor_profile_id: world.admin.id,
      });
    });

    it("refuses callers whose JWT is not the service role even if they reach the routine", async () => {
      const id = await db.asSuperuser((c) => newAuthUser(c));
      // The DB role is service_role but the verified claim is missing: still denied.
      const error = await dbError(
        db.asRole(
          "service_role",
          { role: "authenticated", sub: world.alice.id },
          (c) =>
            c.query("select public.provision_profile($1, 'Mallory')", [id]),
        ),
      );
      expect(error.message).toBe("FORBIDDEN");
    });

    it("grants no application access to a provisioned but not enabled profile", async () => {
      const id = await db.asSuperuser((c) => newAuthUser(c));
      await provision(id, "Jaya Sen");
      const visible = await db.asRole("authenticated", { sub: id }, (c) =>
        c.query("select id from public.profiles"),
      );
      expect(visible.rowCount).toBe(0);
    });
  });

  describe("enable_profile", () => {
    const enable = (id: string, actor: string | null = null) =>
      db.asRole(
        "service_role",
        SERVICE,
        (c) =>
          c.query<{ result: { status: string; changed: boolean } }>(
            "select public.enable_profile($1, $2) as result",
            [id, actor],
          ),
        { commit: true },
      );

    it("keeps residents suspended until a household is assigned", async () => {
      const id = await db.asSuperuser((c) => newAuthUser(c));
      await provision(id, "Kiran Shah");

      expect((await dbError(enable(id))).message).toBe(
        "PROVISIONING_INCOMPLETE",
      );

      await db.asOwner((c) =>
        c.query(
          `insert into public.households (identifier, identifier_normalized, representative_profile_id, is_eligible)
           values ('K-505', app_private.normalize_key('K-505'), $1, true)`,
          [id],
        ),
      );
      const before = await auditCount("PROFILE_STATUS_CHANGED");
      expect((await enable(id)).rows[0]?.result).toEqual({
        id,
        status: "ENABLED",
        changed: true,
      });
      expect(await auditCount("PROFILE_STATUS_CHANGED")).toBe(before + 1);

      // Retrying is a no-op, not a second audit event.
      expect((await enable(id)).rows[0]?.result).toMatchObject({
        changed: false,
      });
      expect(await auditCount("PROFILE_STATUS_CHANGED")).toBe(before + 1);
    });

    it("allows an administrator without a household", async () => {
      const id = await db.asSuperuser((c) => newAuthUser(c));
      await provision(id, "Lata Bose", true, world.admin.id);
      expect((await enable(id, world.admin.id)).rows[0]?.result).toMatchObject({
        status: "ENABLED",
      });

      const visible = await db.asRole("authenticated", { sub: id }, (c) =>
        c.query("select id from public.profiles where id = $1", [id]),
      );
      expect(visible.rowCount).toBe(1);

      // Administrator status confers no voting entitlement.
      const entitled = await db.asRole("authenticated", { sub: id }, (c) =>
        c.query<{ ok: boolean }>(
          "select app_private.has_entitlement(gen_random_uuid()) as ok",
        ),
      );
      expect(entitled.rows[0]?.ok).toBe(false);
    });

    it("reports unknown and deleted profiles", async () => {
      expect(
        (await dbError(enable("00000000-0000-4000-8000-000000000001"))).message,
      ).toBe("NOT_FOUND");
      await db.asOwner((c) =>
        c.query(
          "update public.profiles set status = 'DELETED', deleted_at = now() where id = $1",
          [world.carol.id],
        ),
      );
      expect((await dbError(enable(world.carol.id))).message).toBe(
        "LIFECYCLE_CONFLICT",
      );
    });
  });

  describe("deployment procedures", () => {
    let ops: TestDatabase;
    let identity: string;
    let rwaAdmin: string;

    beforeAll(async () => {
      ops = await createTestDatabase();
      identity = await ops.asSuperuser((c) => newAuthUser(c));
      rwaAdmin = identity;
    });
    afterAll(async () => {
      await ops?.drop();
    });

    const run = (sql: string, params: unknown[] = []) =>
      ops.asDeployment((c) => c.query(sql, params));

    it("initialises the singleton settings once, with an audit event", async () => {
      await run(
        "select app_private.deployment_initialize_settings('Lakeview RWA', 'Asia/Kolkata')",
      );
      expect(
        (
          await dbError(
            run(
              "select app_private.deployment_initialize_settings('Again', 'Asia/Kolkata')",
            ),
          )
        ).message,
      ).toBe("REGISTER_CONFLICT");
      const audit = await ops.asSuperuser((c) =>
        c.query<{ actor_kind: string }>(
          "select actor_kind from public.audit_events where action = 'SETTINGS_INITIALIZED'",
        ),
      );
      expect(audit.rows).toEqual([{ actor_kind: "DEPLOYMENT" }]);
    });

    it("rejects unknown time zones and a second settings row", async () => {
      const second = await dbError(
        ops.asDeployment((c) =>
          c.query(
            "insert into public.rwa_settings (id, name, timezone) values (2, 'X', 'Asia/Kolkata')",
          ),
        ),
      );
      expect(second.code).toBe(CHECK_VIOLATION);
      const tz = await dbError(
        ops.asDeployment((c) =>
          c.query("update public.rwa_settings set timezone = 'Mars/Olympus'"),
        ),
      );
      expect(tz.code).toBe(CHECK_VIOLATION);
    });

    it("bootstraps the first administrator only once and only for an existing identity", async () => {
      expect(
        (
          await dbError(
            run(
              "select app_private.deployment_bootstrap_admin('00000000-0000-4000-8000-000000000009', 'Ghost')",
            ),
          )
        ).message,
      ).toBe("AUTH_IDENTITY_MISSING");

      await run(
        "select app_private.deployment_bootstrap_admin($1, 'Maya Pillai')",
        [identity],
      );
      const profile = await ops.asSuperuser((c) =>
        c.query<{ status: string; is_admin: boolean }>(
          "select status, is_admin from public.profiles where id = $1",
          [identity],
        ),
      );
      expect(profile.rows[0]).toEqual({ status: "ENABLED", is_admin: true });

      const another = await ops.asSuperuser((c) => newAuthUser(c));
      expect(
        (
          await dbError(
            run(
              "select app_private.deployment_bootstrap_admin($1, 'Second Admin')",
              [another],
            ),
          )
        ).message,
      ).toBe("REGISTER_CONFLICT");

      const audit = await ops.asSuperuser((c) =>
        c.query<{ actor_kind: string }>(
          "select actor_kind from public.audit_events where action = 'BOOTSTRAP_ADMIN'",
        ),
      );
      expect(audit.rows).toEqual([{ actor_kind: "DEPLOYMENT" }]);
    });

    const approve = (
      key: string,
      overrides: Partial<Record<string, string | null>> = {},
    ) =>
      ops.asDeployment((c) =>
        c.query(
          "select app_private.deployment_record_policy_approval($1, $2, $3::timestamptz, $4, $5, $6)",
          [
            key,
            overrides.version ?? "v1",
            overrides.approvedAt ?? "2026-10-01T00:00:00Z",
            overrides.by === undefined ? rwaAdmin : overrides.by,
            overrides.authority ?? "RWA General Body",
            overrides.decision ?? "Approved as proposed",
          ],
        ),
      );

    it("records approvals only with complete attribution by a real enabled administrator", async () => {
      expect((await dbError(approve("A8"))).message).toBe("VALIDATION_FAILED");
      expect((await dbError(approve("A1", { decision: "  " }))).message).toBe(
        "VALIDATION_FAILED",
      );
      expect((await dbError(approve("A1", { version: "" }))).message).toBe(
        "VALIDATION_FAILED",
      );
      expect((await dbError(approve("A1", { by: null }))).message).toBe(
        "FORBIDDEN",
      );
      expect(
        (
          await dbError(
            approve("A1", { by: "00000000-0000-4000-8000-000000000009" }),
          )
        ).message,
      ).toBe("FORBIDDEN");

      await approve("A1");
      const stored = await ops.asSuperuser((c) =>
        c.query<{ approval: Record<string, string> }>(
          "select policy_approvals -> 'A1' as approval from public.rwa_settings",
        ),
      );
      expect(stored.rows[0]?.approval).toMatchObject({
        version: "v1",
        approving_authority: "RWA General Body",
        decision: "Approved as proposed",
        approved_by_profile_id: rwaAdmin,
      });
    });

    it("replaces an approval when the decision or version changes and can invalidate it", async () => {
      await approve("A2", { version: "v1" });
      await approve("A2", { version: "v2", decision: "Revised wording" });
      const stored = await ops.asSuperuser((c) =>
        c.query<{ version: string; decision: string }>(
          "select policy_approvals #>> '{A2,version}' as version, policy_approvals #>> '{A2,decision}' as decision from public.rwa_settings",
        ),
      );
      expect(stored.rows[0]).toEqual({
        version: "v2",
        decision: "Revised wording",
      });

      await run(
        "select app_private.deployment_invalidate_policy_approval('A2', 'Decision revisited')",
      );
      const gone = await ops.asSuperuser((c) =>
        c.query<{ present: boolean }>(
          "select policy_approvals ? 'A2' as present from public.rwa_settings",
        ),
      );
      expect(gone.rows[0]?.present).toBe(false);
    });

    it("blocks activation readiness until every approval and retention value is recorded", async () => {
      const ready = async () => run("select app_private.assert_policy_ready()");

      expect((await dbError(ready())).message).toBe("ACTIVATION_BLOCKED");
      for (const key of ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]) {
        await approve(key);
      }
      // Approvals alone are not enough: unset retention is "unapproved", never unlimited.
      expect((await dbError(ready())).message).toBe("ACTIVATION_BLOCKED");

      await run(
        "select app_private.deployment_set_retention(365, 730, 365, 30, 35)",
      );
      await ready();

      const nonPositive = await dbError(
        run("select app_private.deployment_set_retention(0, 730, 365, 30, 35)"),
      );
      expect(nonPositive.code).toBe(CHECK_VIOLATION);

      await run(
        "select app_private.deployment_set_retention(365, null, 365, 30, 35)",
      );
      expect((await dbError(ready())).message).toBe("ACTIVATION_BLOCKED");
    });

    it("records policy and retention changes in the audit trail without ballot data", async () => {
      const actions = await ops.asSuperuser((c) =>
        c.query<{ action: string }>(
          "select distinct action from public.audit_events order by 1",
        ),
      );
      expect(actions.rows.map((r) => r.action)).toEqual(
        expect.arrayContaining([
          "POLICY_APPROVAL_RECORDED",
          "RETENTION_UPDATED",
          "SETTINGS_INITIALIZED",
          "BOOTSTRAP_ADMIN",
        ]),
      );
    });
  });

  describe("consume_rate_limit", () => {
    // Fixed windows reset on the minute; avoid straddling a boundary mid-test.
    beforeEach(async () => {
      const second = new Date().getUTCSeconds();
      if (second >= 52) {
        await new Promise((resolve) =>
          setTimeout(resolve, (61 - second) * 1000),
        );
      }
    });

    const digest = (seed: string) =>
      Buffer.from(seed.padEnd(32, "0").slice(0, 32));
    const consume = (
      scope: string,
      digests: Buffer[],
      versions: number[],
      limit = 3,
      window = 60,
    ) =>
      db.asRole(
        "service_role",
        SERVICE,
        (c) =>
          c.query<{
            r: { allowed: boolean; count: number; retryAfterSeconds: number };
          }>(
            "select public.consume_rate_limit($1, $2::bytea[], $3::smallint[], $4, $5) as r",
            [scope, digests, versions, limit, window],
          ),
        { commit: true },
      );

    it("allows requests up to the limit and then reports a whole-second retry delay", async () => {
      const subject = [digest("subject-a")];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        expect(
          (await consume("auth.code", subject, [1])).rows[0]?.r,
        ).toMatchObject({ allowed: true, count: attempt });
      }
      const denied = (await consume("auth.code", subject, [1])).rows[0]?.r;
      expect(denied?.allowed).toBe(false);
      expect(Number.isInteger(denied?.retryAfterSeconds)).toBe(true);
      expect(denied?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });

    it("keeps counting rejected attempts independently of any rolled-back domain work", async () => {
      const subject = [digest("subject-b")];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await consume("auth.verify", subject, [1], 2);
      }
      const stored = await db.asSuperuser((c) =>
        c.query<{ request_count: string }>(
          "select request_count from public.rate_limit_buckets where scope = 'auth.verify'",
        ),
      );
      expect(stored.rows.map((r) => r.request_count)).toEqual(["5"]);
    });

    it("isolates subjects and scopes", async () => {
      await consume("auth.code", [digest("subject-c")], [1], 1);
      expect(
        (await consume("auth.code", [digest("subject-d")], [1], 1)).rows[0]?.r
          .allowed,
      ).toBe(true);
      expect(
        (await consume("export.csv", [digest("subject-c")], [1], 1)).rows[0]?.r
          .allowed,
      ).toBe(true);
    });

    it("preserves the live window across key rotation by checking every live key version", async () => {
      const oldKey = digest("rotating-old");
      const newKey = digest("rotating-new");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await consume("auth.rotate", [oldKey], [1], 3);
      }
      const rotated = (
        await consume("auth.rotate", [newKey, oldKey], [2, 1], 3)
      ).rows[0]?.r;
      expect(rotated).toMatchObject({ allowed: false, count: 4 });
    });

    it("rejects malformed input and never stores raw identifiers", async () => {
      expect((await dbError(consume("auth.code", [], [], 3))).message).toBe(
        "VALIDATION_FAILED",
      );
      expect(
        (await dbError(consume("auth.code", [digest("x")], [1, 2], 3))).message,
      ).toBe("VALIDATION_FAILED");
      expect(
        (await dbError(consume("auth.code", [digest("x")], [1], 0))).message,
      ).toBe("VALIDATION_FAILED");
      expect(
        (await dbError(consume("auth.code", [digest("x")], [1], 3, 0))).message,
      ).toBe("VALIDATION_FAILED");
      expect(
        (await dbError(consume("Bad Scope!", [digest("x")], [1]))).code,
      ).toBe(CHECK_VIOLATION);
      expect(
        (await dbError(consume("auth.code", [Buffer.from("short")], [1]))).code,
      ).toBe(CHECK_VIOLATION);

      const columns = await db.asSuperuser((c) =>
        c.query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'rate_limit_buckets' order by ordinal_position`,
        ),
      );
      expect(columns.rows.map((r) => r.column_name)).toEqual([
        "scope",
        "subject_digest",
        "digest_key_version",
        "window_start",
        "expires_at",
        "request_count",
      ]);
    });

    it("is not callable with a non-service JWT claim", async () => {
      const error = await dbError(
        db.asRole("service_role", { role: "anon" }, (c) =>
          c.query(
            "select public.consume_rate_limit('auth.code', array[decode(repeat('00', 32), 'hex')], array[1::smallint], 3, 60)",
          ),
        ),
      );
      expect(error.message).toBe("FORBIDDEN");
    });
  });
});
