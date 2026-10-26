import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";
import { votingApi, type Detail } from "./support/votes";

const PERMISSION_DENIED = "42501";

interface Report {
  skipped: string[];
  votesDeleted: number;
  voteFailures: number;
  auditDeleted: number;
  rateBucketsDeleted: number;
  profilesDeleted: number;
  profileFailures: number;
}

describe.skipIf(!hasDatabase)("retention maintenance", () => {
  let db: TestDatabase;
  let world: World;
  let api: ReturnType<typeof votingApi>;

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
    api = votingApi(db, world);
    await api.setupPolicy();
  });
  afterAll(async () => {
    await db?.drop();
  });

  const alice = () => world.alice.id;
  const bob = () => world.bob.id;
  const admin = () => world.admin.id;

  const maintain = () =>
    db.asSuperuser(async (c) => {
      await c.query("begin");
      try {
        await c.query("set local role cp_scheduler");
        const result = await c.query<{ r: Report }>(
          "select public.run_maintenance() as r",
        );
        await c.query("commit");
        return result.rows[0]?.r as Report;
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
    });

  const setRetention = (
    vote: number | null,
    audit: number | null,
    profile: number | null,
    rate: number | null,
  ) =>
    db.asSuperuser((c) =>
      c.query(
        `update public.rwa_settings
            set vote_retention_days = $1, audit_retention_days = $2,
                inactive_profile_retention_days = $3, rate_limit_retention_days = $4
          where id = 1`,
        [vote, audit, profile, rate],
      ),
    );

  // Moves a vote's whole timeline into the past, coherently, without going through the guards.
  const age = (voteId: string, days: number) =>
    db.asSuperuser(async (c) => {
      await c.query("begin");
      await c.query("set local session_replication_role = replica");
      await c.query(
        `update public.votes
            set created_at = created_at - make_interval(days => $2),
                activated_at = activated_at - make_interval(days => $2),
                closes_at = closes_at - make_interval(days => $2),
                completed_at = completed_at - make_interval(days => $2),
                cancelled_at = cancelled_at - make_interval(days => $2)
          where id = $1`,
        [voteId, days],
      );
      await c.query("commit");
    });

  const exists = async (table: string, voteId: string) =>
    Number(
      (
        await api.rows<{ n: string }>(
          `select count(*)::text n from public.${table} where vote_id = $1`,
          [voteId],
        )
      )[0]?.n,
    );
  const voteExists = async (voteId: string) =>
    (await api.rows("select 1 from public.votes where id = $1", [voteId]))
      .length === 1;

  const finish = (id: string) =>
    api.call(admin(), "public.complete_vote_early($1, true, 'Done')", [id]);
  const choose = (vote: Detail, i: number) => ({
    confirmed: true,
    optionId: vote.options[i]?.id,
  });
  const closedPick = (vote: Detail) => ({
    confirmed: true,
    selections: vote.offices.map((o) => ({
      officeId: o.id,
      candidateId: o.candidates[0]?.id ?? null,
    })),
  });

  it("is reachable only through the scheduling role", async () => {
    for (const [role, claims] of [
      ["anon", null],
      ["authenticated", { sub: admin() }],
      ["service_role", { role: "service_role" }],
    ] as const) {
      const error = await dbError(
        db.asRole(role, claims, (c) =>
          c.query("select public.run_maintenance()"),
        ),
      );
      expect(error.code, role).toBe(PERMISSION_DENIED);
    }
    // And it takes no arguments, so there is nothing to override.
    const args = await api.rows<{ n: number }>(
      "select pronargs::int n from pg_proc where proname = 'run_maintenance'",
    );
    expect(args[0]?.n).toBe(0);
  });

  it("deletes nothing while the policy is unset, and reports which tasks were skipped", async () => {
    const vote = await api.activeVote("PUBLIC");
    await api.cast(alice(), vote.id, choose(vote, 0));
    await finish(vote.id);
    await age(vote.id, 400);

    await setRetention(null, null, null, null);
    const report = await maintain();
    expect(report.skipped.sort()).toEqual([
      "AUDIT",
      "PROFILES",
      "RATE_LIMITS",
      "VOTES",
    ]);
    expect(report.votesDeleted).toBe(0);
    expect(await voteExists(vote.id)).toBe(true);
    await setRetention(365, 365, 365, 30);
    // Restore so later tests see the fixture policy.
    expect(await voteExists(vote.id)).toBe(true);
    // Clean this one up now, deliberately, to prove the happy path and its evidence.
    const done = await maintain();
    expect(done.votesDeleted).toBe(1);
    expect(await voteExists(vote.id)).toBe(false);
  });

  it("deletes an expired PUBLIC vote coherently, with minimal evidence", async () => {
    const vote = await api.activeVote("PUBLIC");
    await api.cast(alice(), vote.id, choose(vote, 0));
    await api.cast(bob(), vote.id, choose(vote, 1));
    await finish(vote.id);
    await age(vote.id, 400);

    const report = await maintain();
    expect(report.votesDeleted).toBe(1);
    for (const table of [
      "participation",
      "open_responses",
      "electorate",
      "poll_options",
    ]) {
      expect(await exists(table, vote.id), table).toBe(0);
    }
    expect(await voteExists(vote.id)).toBe(false);

    const evidence = await api.rows<{
      target_id: string;
      details: Record<string, unknown>;
    }>(
      "select target_id, details from public.audit_events where action = 'RETENTION_DELETED' and target_id = $1",
      [vote.id],
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.details).toEqual({
      kind: "VOTE",
      votingType: "PUBLIC",
      status: "COMPLETED",
    });
    // Households and the register itself are untouched.
    expect(
      (await api.rows("select 1 from public.households")).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("deletes an expired PRIVATE vote and a cancelled one, including counters and ballot configuration", async () => {
    const closed = await api.activeVote("PRIVATE");
    await api.cast(alice(), closed.id, closedPick(closed));
    await finish(closed.id);
    const cancelled = await api.activeVote("PUBLIC");
    await api.call(
      admin(),
      "public.cancel_vote($1, true, 'Wrong electorate')",
      [cancelled.id],
    );
    await age(closed.id, 400);
    await age(cancelled.id, 400);

    const report = await maintain();
    expect(report.votesDeleted).toBe(2);
    for (const id of [closed.id, cancelled.id]) {
      expect(await voteExists(id)).toBe(false);
    }
    expect(await exists("closed_tallies", closed.id)).toBe(0);
    const orphans = await api.rows(
      "select 1 from public.offices where vote_id = $1",
      [closed.id],
    );
    expect(orphans).toHaveLength(0);
  });

  it("never touches an active vote, a draft, or a terminal vote still inside retention", async () => {
    const active = await api.activeVote("PUBLIC");
    await api.cast(alice(), active.id, choose(active, 0));
    const draft = await api.call<Detail>(
      admin(),
      "public.create_draft('PUBLIC')",
    );
    const recent = await api.activeVote("PUBLIC");
    await finish(recent.id);
    // An ACTIVE vote cannot be aged coherently into the terminal states, so age only the others.
    await age(recent.id, 300);

    const report = await maintain();
    expect(report.votesDeleted).toBe(0);
    for (const id of [active.id, draft.id, recent.id]) {
      expect(await voteExists(id), id).toBe(true);
    }
    expect(await exists("participation", active.id)).toBe(1);
  });

  it("refuses direct deletion of vote data, with or without the flag, unless the vote has expired", async () => {
    const vote = await api.activeVote("PUBLIC");
    await api.cast(alice(), vote.id, choose(vote, 0));
    await finish(vote.id);

    const attempt = (sql: string, flag: boolean) =>
      dbError(
        db.asOwner(async (c) => {
          if (flag) {
            await c.query("select set_config('cp.retention', 'on', true)");
          }
          await c.query(sql, [vote.id]);
        }),
      );
    for (const flag of [false, true]) {
      for (const sql of [
        "delete from public.participation where vote_id = $1",
        "delete from public.open_responses where vote_id = $1",
        "delete from public.electorate where vote_id = $1",
        "delete from public.poll_options where vote_id = $1",
        "delete from public.votes where id = $1",
      ]) {
        const error = await attempt(sql, flag);
        expect(
          ["IMMUTABLE_RECORD", "VOTE_FROZEN"],
          `${sql} flag=${flag}`,
        ).toContain(error.message);
      }
    }
    expect(await exists("participation", vote.id)).toBe(1);
  });

  it("expires audit events independently, keeps the rest, and leaves a count-only trace", async () => {
    const before = await api.rows<{ n: string }>(
      "select count(*)::text n from public.audit_events",
    );
    await db.asSuperuser(async (c) => {
      await c.query("begin");
      await c.query("set local session_replication_role = replica");
      await c.query(
        "update public.audit_events set occurred_at = occurred_at - interval '500 days' where id in (select id from public.audit_events order by id limit 3)",
      );
      await c.query("commit");
    });

    const report = await maintain();
    expect(report.auditDeleted).toBe(3);
    const after = await api.rows<{ n: string }>(
      "select count(*)::text n from public.audit_events",
    );
    // Three gone, one trace added.
    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n) - 3 + 1);
    const trace = await api.rows<{ details: Record<string, unknown> }>(
      "select details from public.audit_events where target_id = 'audit_events' and action = 'RETENTION_DELETED' order by id desc limit 1",
    );
    expect(trace[0]?.details).toEqual({ kind: "AUDIT", count: 3 });

    // Rows that are not expired can never be removed, even by the owner with the flag.
    const error = await dbError(
      db.asOwner(async (c) => {
        await c.query("select set_config('cp.audit_retention', 'on', true)");
        await c.query(
          "delete from public.audit_events where occurred_at > now() - interval '1 day'",
        );
      }),
    );
    expect(error.message).toBe("IMMUTABLE_RECORD");
    expect(
      (
        await dbError(
          db.asOwner((c) =>
            c.query("update public.audit_events set reason = 'x'"),
          ),
        )
      ).message,
    ).toBe("IMMUTABLE_RECORD");
  });

  it("expires rate buckets without resetting a live abuse window", async () => {
    await db.asSuperuser(async (c) => {
      for (const [scope, windowStart, expires] of [
        [
          "t.expired",
          "now() - interval '90 days'",
          "now() - interval '89 days'",
        ],
        [
          "t.live",
          "now() - interval '1 minute'",
          "now() + interval '14 minutes'",
        ],
        ["t.recent", "now() - interval '2 days'", "now() - interval '1 day'"],
      ] as const) {
        await c.query(
          `insert into public.rate_limit_buckets (scope, subject_digest, digest_key_version, window_start, expires_at, request_count)
           values ($1, decode(repeat('ab', 32), 'hex'), 1, ${windowStart}, ${expires}, 7)`,
          [scope],
        );
      }
    });
    const report = await maintain();
    expect(report.rateBucketsDeleted).toBe(1);
    const left = await api.rows<{ scope: string; request_count: string }>(
      "select scope, request_count::text from public.rate_limit_buckets where scope like 't.%' order by scope",
    );
    // The live window keeps its count; a recently expired bucket stays inside the retention period.
    expect(left.map((r) => [r.scope, r.request_count])).toEqual([
      ["t.live", "7"],
      ["t.recent", "7"],
    ]);
  });

  it("removes a deleted profile only when nothing refers to it any more", async () => {
    const people = await db.asSuperuser(async (c) => {
      const out: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const id = (
          await c.query<{ id: string }>("select gen_random_uuid() id")
        ).rows[0]?.id as string;
        await c.query("insert into auth.users (id, email) values ($1, $2)", [
          id,
          `${id}@example.test`,
        ]);
        out.push(id);
      }
      return out;
    });
    const [free, referenced] = people as [string, string];
    await db.asOwner(async (c) => {
      for (const id of people) {
        await c.query(
          "insert into public.profiles (id, representative_name, status) values ($1, 'Former resident', 'SUSPENDED')",
          [id],
        );
      }
      await c.query(
        "update public.profiles set status = 'DELETED', deleted_at = now() - interval '500 days' where id = any($1)",
        [people],
      );
    });
    // One was also an actor in the audit history, which must be preserved.
    await db.asOwner((c) =>
      c.query(
        "select app_private.append_audit('PROFILE', $1::uuid, 'PROFILE_UPDATED', 'PROFILE', $1::text, null, '{}'::jsonb)",
        [referenced],
      ),
    );

    const report = await maintain();
    expect(report.profilesDeleted).toBeGreaterThanOrEqual(1);
    const left = await api.rows<{ id: string }>(
      "select id from public.profiles where id = any($1)",
      [people],
    );
    expect(left.map((r) => r.id)).toEqual([referenced]);
    // The Auth identity is left for supported Auth administration; the profile is what we remove.
    expect(
      (await api.rows("select 1 from auth.users where id = $1", [free])).length,
    ).toBe(1);
  });

  it("is idempotent, and one failing vote does not undo the others", async () => {
    const a = await api.activeVote("PUBLIC");
    const b = await api.activeVote("PUBLIC");
    await finish(a.id);
    await finish(b.id);
    await age(a.id, 400);
    await age(b.id, 400);
    // Make one vote impossible to delete (a stray reference the routine does not know about).
    await db.asSuperuser(async (c) => {
      await c.query(
        "create table public.zz_blocker (vote_id uuid references public.votes (id) on delete restrict)",
      );
      await c.query("insert into public.zz_blocker values ($1)", [a.id]);
    });

    const first = await maintain();
    expect(first.votesDeleted).toBe(1);
    expect(first.voteFailures).toBe(1);
    expect(await voteExists(a.id)).toBe(true);
    // A failed vote keeps ALL of its data: the failed attempt rolled back as one unit.
    expect(await exists("electorate", a.id)).toBeGreaterThan(0);
    expect(await voteExists(b.id)).toBe(false);

    const again = await maintain();
    expect(again.votesDeleted).toBe(0);
    await db.asSuperuser((c) => c.query("drop table public.zz_blocker"));
    const last = await maintain();
    expect(last.votesDeleted).toBe(1);
    expect(await voteExists(a.id)).toBe(false);
  });

  it("reports operational counts without identities or choices", async () => {
    const status = await db.asRole(
      "service_role",
      { role: "service_role" },
      (c) =>
        c.query<{ r: Record<string, unknown> }>(
          "select public.operational_status() as r",
        ),
    );
    const r = status.rows[0]?.r ?? {};
    expect(r).toMatchObject({
      settingsPresent: true,
      policyReady: true,
      invariantFailures: 0,
      overdueActiveVotes: 0,
    });
    expect(Object.keys(r).sort()).toEqual([
      "activeVotes",
      "expiredAuditPending",
      "expiredRateBucketsPending",
      "expiredVotesPending",
      "invariantFailures",
      "overdueActiveVotes",
      "policyReady",
      "settingsPresent",
    ]);
    for (const [role, claims] of [
      ["anon", null],
      ["authenticated", { sub: admin() }],
    ] as const) {
      expect(
        (
          await dbError(
            db.asRole(role, claims, (c) =>
              c.query("select public.operational_status()"),
            ),
          )
        ).code,
      ).toBe(PERMISSION_DENIED);
    }
    const ping = await db.asRole(
      "service_role",
      { role: "service_role" },
      (c) => c.query<{ r: boolean }>("select public.health_ping() as r"),
    );
    expect(ping.rows[0]?.r).toBe(true);
  });
});
