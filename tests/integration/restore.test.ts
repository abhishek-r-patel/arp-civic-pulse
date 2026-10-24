import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createBackup,
  exportRecoveryRecord,
  readCounts,
  reconcileRestore,
  restoreBackup,
  verifyBackup,
} from "../../scripts/ops/backup.ts";
import {
  decryptFile,
  generateKeyHex,
  parseKey,
} from "../../scripts/ops/crypto.ts";
import {
  adminUrl,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";
import { votingApi, type Detail } from "./support/votes";

/*
 * Restore rehearsal: a real pg_dump of a populated database, encrypted, verified,
 * restored into a SEPARATE freshly migrated database, and reconciled against the
 * counts and per-vote digests taken at the same snapshot. Needs PG_BIN_DIR (the
 * PostgreSQL client tools); skipped otherwise.
 */
const pgBin = process.env.PG_BIN_DIR;
const enabled = hasDatabase && Boolean(pgBin);

function urlFor(db: TestDatabase): string {
  const url = new URL(adminUrl as string);
  url.pathname = `/${db.name}`;
  return url.toString();
}

describe.skipIf(!enabled)("encrypted backup and restore rehearsal", () => {
  const key = parseKey(generateKeyHex());
  let source: TestDatabase;
  const targets: TestDatabase[] = [];
  let world: World;
  let api: ReturnType<typeof votingApi>;
  let out: string;
  let completedOpen: Detail;
  let completedClosed: Detail;
  let active: Detail;

  const finish = (id: string) =>
    api.call(
      world.admin.id,
      "public.complete_vote_early($1, true, 'Rehearsal')",
      [id],
    );

  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), "cp-rehearsal-"));
    source = await createTestDatabase();
    world = await seedWorld(source);
    api = votingApi(source, world);
    await api.setupPolicy();

    completedOpen = await api.activeVote("OPEN");
    await api.cast(world.alice.id, completedOpen.id, {
      confirmed: true,
      optionId: completedOpen.options[0]?.id,
    });
    await api.cast(world.bob.id, completedOpen.id, {
      confirmed: true,
      optionId: completedOpen.options[1]?.id,
    });
    await finish(completedOpen.id);

    completedClosed = await api.activeVote("CLOSED");
    await api.cast(world.alice.id, completedClosed.id, {
      confirmed: true,
      selections: completedClosed.offices.map((o) => ({
        officeId: o.id,
        candidateId: o.candidates[0]?.id ?? null,
      })),
    });
    await api.cast(world.dave.id, completedClosed.id, {
      confirmed: true,
      selections: completedClosed.offices.map((o) => ({
        officeId: o.id,
        candidateId: null,
      })),
    });
    await finish(completedClosed.id);

    active = await api.activeVote("OPEN");
    await api.cast(world.bob.id, active.id, {
      confirmed: true,
      optionId: active.options[0]?.id,
    });
    await api.call<Detail>(world.admin.id, "public.create_draft('OPEN')");
  });

  afterAll(async () => {
    await source?.drop();
    for (const target of targets) {
      await target.drop();
    }
    await rm(out, { recursive: true, force: true });
  });

  const freshTarget = async () => {
    const target = await createTestDatabase();
    targets.push(target);
    return target;
  };

  const results = (db: TestDatabase, voteId: string) =>
    db
      .asRole("authenticated", { sub: world.alice.id }, (c) =>
        c.query<{ r: unknown }>(
          "select public.get_vote_results($1, null) as r",
          [voteId],
        ),
      )
      .then((r) => r.rows[0]?.r);

  it("creates an encrypted set whose dumps actually cover the data, and refuses to run without an approved expiry", async () => {
    const { manifestPath, manifest } = await createBackup({
      databaseUrl: urlFor(source),
      outDir: out,
      key,
      ...(pgBin && { pgBin }),
    });
    expect(manifest.retentionDays).toBe(90);
    expect(
      new Date(manifest.expiresAt).getTime() -
        new Date(manifest.createdAt).getTime(),
    ).toBe(90 * 86_400_000);
    expect(manifest.files.map((f) => f.role).sort()).toEqual([
      "app",
      "auth",
      "counts",
    ]);

    // Nothing readable is stored: no names, identifiers or e-mail addresses in any file.
    for (const file of manifest.files) {
      const bytes = await readFile(join(out, file.name));
      for (const needle of [
        "Alice Rao",
        "A-101",
        "example.test",
        "CREATE TABLE",
        "PGDMP",
      ]) {
        expect(
          bytes.includes(Buffer.from(needle)),
          `${file.name} contains ${needle}`,
        ).toBe(false);
      }
    }

    const check = await verifyBackup({
      manifestPath,
      key,
      ...(pgBin && { pgBin }),
    });
    expect(check).toMatchObject({ ok: true, problems: [] });
    expect(check.tables).toEqual(
      expect.arrayContaining([
        "votes",
        "participation",
        "open_responses",
        "closed_tallies",
        "audit_events",
        "profiles",
        "rwa_settings",
      ]),
    );

    // The counts were taken at the dump's snapshot.
    const counts = await readCounts(manifestPath, key);
    expect(counts.tables.participation).toBe(5);
    expect(counts.auth?.users).toBeGreaterThanOrEqual(5);
    expect(Object.keys(counts.voteDigests)).toHaveLength(3);

    // No expiry approved, no backup: and nothing is left behind.
    await source.asSuperuser((c) =>
      c.query(
        "update public.rwa_settings set backup_retention_days = null where id = 1",
      ),
    );
    await expect(
      createBackup({
        databaseUrl: urlFor(source),
        outDir: out,
        key,
        now: new Date("2030-01-01T00:00:00Z"),
        ...(pgBin && { pgBin }),
      }),
    ).rejects.toThrow(/not approved/u);
    await source.asSuperuser((c) =>
      c.query(
        "update public.rwa_settings set backup_retention_days = 90 where id = 1",
      ),
    );
  });

  it("detects a damaged, wrong-key or incomplete backup before anyone relies on it", async () => {
    const { manifestPath, manifest } = await createBackup({
      databaseUrl: urlFor(source),
      outDir: out,
      key,
      now: new Date(Date.now() + 1_000),
      ...(pgBin && { pgBin }),
    });
    const app = join(
      out,
      manifest.files.find((f) => f.role === "app")?.name as string,
    );
    const original = await readFile(app);
    const damaged = Buffer.from(original);
    damaged[Math.floor(damaged.length / 2)] =
      (damaged[Math.floor(damaged.length / 2)] ?? 0) ^ 0xff;
    await writeFile(app, damaged);
    expect(
      (await verifyBackup({ manifestPath, key, ...(pgBin && { pgBin }) })).ok,
    ).toBe(false);
    await writeFile(app, original);

    await expect(
      verifyBackup({
        manifestPath,
        key: parseKey(generateKeyHex()),
        ...(pgBin && { pgBin }),
      }),
    ).rejects.toThrow(/wrong key/u);
  });

  it("restores into an isolated database and reproduces every record, count, digest and result", async () => {
    const { manifestPath } = await createBackup({
      databaseUrl: urlFor(source),
      outDir: out,
      key,
      now: new Date(Date.now() + 2_000),
      ...(pgBin && { pgBin }),
    });
    const target = await freshTarget();
    const outcome = await restoreBackup({
      manifestPath,
      key,
      targetUrl: urlFor(target),
      ...(pgBin && { pgBin }),
    });

    expect(outcome.problems).toEqual([]);
    expect(outcome.consistent).toBe(true);
    // A vote was still active when the backup was taken: completeness cannot be proven by the backup alone.
    expect(outcome.warnings.join(" ")).toMatch(/active at backup time/u);
    expect(outcome.resumeAllowed).toBe(false);

    // Exact agreement of the published results, read through the real routine as a real member.
    for (const vote of [completedOpen, completedClosed]) {
      expect(await results(target, vote.id)).toEqual(
        await results(source, vote.id),
      );
    }
    // Policies, grants and guards came back with the migrations: a restored database is still locked down.
    const denied = await target
      .asRole("authenticated", { sub: world.alice.id }, (c) =>
        c.query("select * from public.open_responses"),
      )
      .then(
        () => "allowed",
        (e: { code?: string }) => e.code,
      );
    expect(denied).toBe("42501");
    // Identity sequence continues past the restored audit history rather than colliding with it.
    await target.asOwner((c) =>
      c.query(
        "select app_private.append_audit('SYSTEM', null, 'SETTINGS_INITIALIZED', 'SETTINGS', 'again', null, '{}'::jsonb)",
      ),
    );
  });

  it("never authorizes resumption from a consistent but possibly incomplete restore", async () => {
    await finish(active.id);
    const { manifestPath } = await createBackup({
      databaseUrl: urlFor(source),
      outDir: out,
      key,
      now: new Date(Date.now() + 3_000),
      ...(pgBin && { pgBin }),
    });
    const target = await freshTarget();

    const unconfirmed = await restoreBackup({
      manifestPath,
      key,
      targetUrl: urlFor(target),
      ...(pgBin && { pgBin }),
    });
    expect(unconfirmed.consistent).toBe(true);
    expect(unconfirmed.warnings).toEqual([]);
    // Consistent and nothing active, yet resumption still needs an explicit completeness confirmation.
    expect(unconfirmed.resumeAllowed).toBe(false);

    const counts = await readCounts(manifestPath, key);
    const confirmed = await reconcileRestore({
      targetUrl: urlFor(target),
      counts,
      completenessConfirmed: true,
    });
    expect(confirmed.resumeAllowed).toBe(true);

    // A restore that lost one acknowledged ballot is caught, whatever the operator says.
    await target.asSuperuser(async (c) => {
      await c.query("begin");
      await c.query("set local session_replication_role = replica");
      await c.query(
        "delete from public.open_responses where vote_id = $1 and household_id = $2",
        [completedOpen.id, world.alice.householdId],
      );
      await c.query(
        "delete from public.participation where vote_id = $1 and household_id = $2",
        [completedOpen.id, world.alice.householdId],
      );
      await c.query("commit");
    });
    const lost = await reconcileRestore({
      targetUrl: urlFor(target),
      counts,
      completenessConfirmed: true,
    });
    expect(lost.consistent).toBe(false);
    expect(lost.resumeAllowed).toBe(false);
    expect(lost.problems.join(" ")).toMatch(/participation: expected/u);
    expect(lost.problems.join(" ")).toMatch(/does not reproduce/u);
  });

  it("flags a vote whose deadline elapsed while the service was down", async () => {
    // An active vote with a short deadline, backed up while open, restored after it passed.
    const short = await api.activeVote("OPEN", { closesInMs: 4_000 });
    const { manifestPath } = await createBackup({
      databaseUrl: urlFor(source),
      outDir: out,
      key,
      now: new Date(Date.now() + 4_000),
      ...(pgBin && { pgBin }),
    });
    await new Promise((resolve) => setTimeout(resolve, 4_500));
    const target = await freshTarget();
    const outcome = await restoreBackup({
      manifestPath,
      key,
      targetUrl: urlFor(target),
      completenessConfirmed: true,
      ...(pgBin && { pgBin }),
    });
    expect(outcome.consistent).toBe(true);
    expect(outcome.warnings.join(" ")).toMatch(/past their deadline/u);
    expect(outcome.resumeAllowed).toBe(false);
    void short;
  });

  it("exports an encrypted recovery record of administrative actions since a restore point", async () => {
    const since = new Date();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await api.call(world.admin.id, "public.update_profile($1, $2::jsonb)", [
      world.dave.id,
      JSON.stringify({ status: "SUSPENDED" }),
    ]);

    const file = join(out, "recovery.enc");
    const count = await exportRecoveryRecord({
      databaseUrl: urlFor(source),
      since,
      destination: file,
      key,
    });
    expect(count).toBeGreaterThanOrEqual(1);

    const plain = join(out, "recovery.json");
    await decryptFile(file, plain, key);
    const record = JSON.parse(await readFile(plain, "utf8")) as {
      events: { action: string; details: Record<string, unknown> }[];
    };
    expect(record.events.map((e) => e.action)).toContain(
      "PROFILE_STATUS_CHANGED",
    );
    // Administrative facts only: never a ballot, a choice or a secret.
    expect(JSON.stringify(record)).not.toMatch(/optionId|candidateId|otp/iu);
  });
});
