// Real PostgreSQL inspection, aggregate privacy and read-only transaction checks.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  readConfigurationSnapshot,
  configurationReport,
} from "../../scripts/ops/configuration.ts";
import {
  createTestDatabase,
  adminUrl,
  dbError,
  hasDatabase,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";
import { votingApi, type Detail } from "./support/votes";

describe.skipIf(!hasDatabase)("operator configuration inspection", () => {
  let db: TestDatabase;
  let world: World;
  let api: ReturnType<typeof votingApi>;
  const inspect = () => db.asDeployment(readConfigurationSnapshot);

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
    api = votingApi(db, world);
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("reports an uninitialized association and exact role/eligibility counts", async () => {
    const result = await inspect();
    expect(result.settings).toBeNull();
    expect(result.accounts).toMatchObject({
      total: 5,
      enabled: 4,
      suspended: 1,
      enabledAdmins: 1,
      enabledResidents: 3,
      enabledWithoutHousehold: 0,
      households: 4,
      eligibleHouseholds: 4,
      readyHouseholds: 3,
    });
    expect(result.votes.byStatus).toEqual({});
    expect(result.operations.settingsPresent).toBe(false);
  });

  it("uses the current profile fields and detects approvals missing despite complete retention", async () => {
    await api.setupPolicy();
    await db.asDeployment((c) =>
      c.query(
        "select app_private.deployment_invalidate_policy_approval('A7', 'Synthetic missing approval test')",
      ),
    );
    const result = await inspect();
    expect(result.settings).toMatchObject({
      fullName: "Lakeview RWA",
      timezone: "Asia/Kolkata",
      identifierKind: "NUMBER",
      missingApprovals: ["A7"],
      missingRetention: [],
      retentionDays: {
        vote: 365,
        audit: 365,
        inactiveProfile: 365,
        rateLimit: 30,
        backup: 90,
      },
      listsValid: true,
    });
    expect(result.operations.policyReady).toBe(true);
    expect(configurationReport(result, {}).checks).toContainEqual(
      expect.objectContaining({ code: "POLICY_APPROVALS", status: "fail" }),
    );
    await db.asDeployment((c) =>
      c.query(
        "select app_private.deployment_record_policy_approval('A7', 'v-A7', now(), $1, 'Fixture committee', 'APPROVED')",
        [world.admin.id],
      ),
    );
  });

  it("reuses preview blockers and never emits resident names, identifiers, choices or vote IDs", async () => {
    const draft = await api.call<Detail>(
      world.admin.id,
      "public.create_draft('PUBLIC')",
    );
    const election = await api.activeVote("PRIVATE");
    await api.cast(world.alice.id, election.id, {
      confirmed: true,
      selections: election.offices.map((o) => ({
        officeId: o.id,
        candidateId: o.candidates[0]?.id,
      })),
    });
    const result = await inspect();
    expect(result.votes).toMatchObject({
      drafts: 1,
      readyDrafts: 0,
      byStatus: { DRAFT: 1, ACTIVE: 1 },
      byType: { PUBLIC: 1, PRIVATE: 1 },
      draftBlockers: {
        TITLE_REQUIRED: 1,
        DEADLINE_REQUIRED: 1,
        ELECTORATE_EMPTY: 1,
        OPTIONS_REQUIRED: 1,
      },
    });
    expect(result.operations.invariantFailures).toBe(0);
    const json = JSON.stringify(result);
    for (const value of [
      "Alice Rao",
      "A-101",
      "candidateId",
      "accepted_count",
      "closed_tallies",
      draft.id,
      election.id,
      world.alice.id,
    ]) {
      expect(json).not.toContain(value);
    }

    await api.call(world.admin.id, "public.update_draft($1, 1, $2::jsonb)", [
      draft.id,
      JSON.stringify({
        title: "Synthetic ready draft",
        closesAt: new Date(Date.now() + 3_600_000).toISOString(),
        options: [
          { label: "Yes", position: 1 },
          { label: "No", position: 2 },
        ],
        eligibleHouseholdIds: [world.alice.householdId],
      }),
    ]);
    expect((await inspect()).votes.readyDrafts).toBe(1);
  });

  it("runs the actual Node CLI without an app session and returns JSON with the correct exit status", async () => {
    if (!adminUrl) throw new Error("Disposable database URL is required.");
    const target = new URL(adminUrl);
    target.username = "postgres";
    target.pathname = `/${db.name}`;
    const run = (origin: string, databaseUrl = target.toString()) =>
      new Promise<{
        code: string | number;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        execFile(
          process.execPath,
          [
            "--conditions=react-server",
            fileURLToPath(new URL("../../scripts/ops/cli.ts", import.meta.url)),
            "config-check",
          ],
          {
            timeout: 15_000,
            env: {
              ...process.env,
              CONFIG_DATABASE_URL: databaseUrl,
              APP_ORIGIN: origin,
              NEXT_PUBLIC_SUPABASE_URL: "https://project.example.test",
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-placeholder",
              SUPABASE_SERVICE_ROLE_KEY: "server-only-placeholder",
              RATE_LIMIT_HMAC_KEY: "x".repeat(32),
              RESEND_API_KEY: "",
              CONTACT_EMAIL_FROM: "",
              CONTACT_EMAIL_TO: "",
            },
          },
          (error, stdout, stderr) =>
            resolve({ code: error?.code ?? 0, stdout, stderr }),
        );
      });
    const success = await run("https://vote.example.test");
    expect(success.code, success.stderr).toBe(0);
    expect(JSON.parse(success.stdout)).toMatchObject({
      formatVersion: 1,
      ok: true,
      productionReady: false,
    });
    const failure = await run("http://invalid.example.test");
    expect(failure.code).toBe(1);
    expect(JSON.parse(failure.stdout)).toMatchObject({ ok: false });
    expect(failure.stdout).not.toContain("http://invalid.example.test");
    const unavailable = await run(
      "https://vote.example.test",
      "postgres://operator:do-not-print@database.example.test/app?sslmode=disable",
    );
    expect(unavailable.code).toBe(1);
    expect(unavailable.stdout).toBe("");
    expect(JSON.parse(unavailable.stderr)).toMatchObject({
      ok: false,
      status: "unavailable",
    });
    expect(unavailable.stderr).not.toContain("do-not-print");
  });

  it("reports delayed scheduled openings without opening the vote", async () => {
    const draft = (
      await api.rows<{ id: string }>(
        "select id from public.votes where status = 'DRAFT'",
      )
    )[0];
    if (!draft) throw new Error("Expected the ready synthetic draft.");
    await api.call(world.admin.id, "public.schedule_vote($1, 2, true, $2)", [
      draft.id,
      new Date(Date.now() + 600_000).toISOString(),
    ]);
    for (const minutes of [4, 6]) {
      await db.asSuperuser(async (c) => {
        await c.query("begin");
        await c.query("set local session_replication_role = replica");
        await c.query(
          `update public.votes
           set created_at = created_at - interval '1 day',
               updated_at = updated_at - interval '1 day',
               scheduled_at = scheduled_at - interval '1 day',
               activated_at = now() - make_interval(mins => $2),
               opens_at = now() - make_interval(mins => $2)
           where id = $1`,
          [draft.id, minutes],
        );
        await c.query("commit");
      });
      expect((await inspect()).votes.overdueScheduledVotes).toBe(
        minutes > 5 ? 1 : 0,
      );
    }
    expect(
      (
        await api.rows<{ status: string }>(
          "select status from public.votes where id = $1",
          [draft.id],
        )
      )[0]?.status,
    ).toBe("SCHEDULED");
  });

  it("uses a read-only transaction, rolls back claims/settings, and does not reconcile overdue votes", async () => {
    await db.asSuperuser(async (c) => {
      await c.query("begin");
      await c.query("set local session_replication_role = replica");
      await c.query(
        `update public.votes
         set created_at = created_at - interval '1 day',
             updated_at = updated_at - interval '1 day',
             activated_at = activated_at - interval '1 day',
             closes_at = now() - interval '4 minutes'
         where status = 'ACTIVE'`,
      );
      await c.query("commit");
      expect(
        (await readConfigurationSnapshot(c)).operations.overdueActiveVotes,
      ).toBe(0);
      await c.query("begin");
      await c.query("set local session_replication_role = replica");
      await c.query(
        `update public.votes
         set created_at = created_at - interval '1 day',
             updated_at = updated_at - interval '1 day',
             activated_at = activated_at - interval '1 day',
             closes_at = now() - interval '10 minutes'
         where status = 'ACTIVE'`,
      );
      await c.query("commit");
      const before = (
        await c.query("select count(*) n from public.audit_events")
      ).rows;
      const queries = vi.spyOn(c, "query");
      const result = await readConfigurationSnapshot(c);
      expect(queries).toHaveBeenNthCalledWith(
        1,
        "begin isolation level repeatable read read only",
      );
      queries.mockRestore();
      expect(result.operations.overdueActiveVotes).toBe(1);
      expect(
        (
          await c.query(
            "select status from public.votes where status = 'ACTIVE'",
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (await c.query("select count(*) n from public.audit_events")).rows,
      ).toEqual(before);
      expect(
        (await c.query("show transaction_read_only")).rows[0]
          ?.transaction_read_only,
      ).toBe("off");
      expect(
        (
          await c.query(
            "select current_setting('request.jwt.claims', true) claims",
          )
        ).rows[0]?.claims ?? "",
      ).toBe("");
    });
  });

  it("fails rather than silently reporting zero for a restricted account", async () => {
    const error = await dbError(
      db.asSuperuser(async (c) => {
        await c.query("set role authenticated");
        return readConfigurationSnapshot(c);
      }),
    );
    expect(error.code).toBe("42501");
  });

  it("enforces read-only behavior even if a reused helper unexpectedly attempts a write", async () => {
    await api.call(world.admin.id, "public.create_draft('PUBLIC')");
    await db.asDeployment((c) =>
      c.query(`
      create or replace function app_private.draft_blockers(v public.votes)
      returns jsonb language plpgsql set search_path = '' as $$
      begin
        update public.rwa_settings set alias = alias where id = 1;
        return '[]'::jsonb;
      end
      $$
    `),
    );
    const error = await dbError(inspect());
    expect(error.code).toBe("25006");
  });
});
