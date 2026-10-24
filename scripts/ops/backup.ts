import { spawn } from "node:child_process";
import {
  mkdtemp,
  lstat,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Client } from "pg";
import { z } from "zod";
import { operationalDatabaseClient, pgEnv } from "./database.ts";
import {
  decryptFile,
  encryptBytes,
  encryptStream,
  sha256File,
} from "./crypto.ts";

/*
 * Encrypted off-site backup, verification, expiry and restore rehearsal
 * (docs/OPERATIONS.md). A backup is a set of files in a destination directory
 * that the operator syncs off-site:
 *   <stamp>.app.enc     pg_dump (custom format) of the public and app_private schemas
 *   <stamp>.auth.enc    data of Auth identities, migration history, Cron schedules
 *   <stamp>.counts.enc  row counts and per-vote digests taken at the SAME snapshot
 *   <stamp>.manifest.json  names, sizes, hashes, creation and expiry (no data)
 * Everything with data in it is AES-256-GCM encrypted; plaintext never touches
 * disk on the backup side, and the restore side deletes its temporary copies.
 */
export interface BackupOptions {
  databaseUrl: string;
  outDir: string;
  key: Buffer;
  /** Directory holding pg_dump/pg_restore; defaults to PG_BIN_DIR or the PATH. */
  pgBin?: string;
  /** Approved expiry; defaults to rwa_settings.backup_retention_days, which must be set. */
  retentionDays?: number;
  now?: Date;
}

export interface Manifest {
  formatVersion: 1;
  createdAt: string;
  expiresAt: string;
  retentionDays: number;
  serverVersion: string;
  files: {
    role: "app" | "auth" | "counts";
    name: string;
    bytes: number;
    sha256: string;
  }[];
}

export interface Counts {
  tables: Record<string, number>;
  auth: { users: number; identities: number | null } | null;
  voteDigests: Record<string, { status: string; digest: string }>;
}

function pgTool(name: string, pgBin?: string): string {
  const dir = pgBin ?? process.env.PG_BIN_DIR;
  return dir ? join(dir, name) : name;
}

function run(
  tool: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(
            new Error(`${tool} failed (${code}): ${err.trim().slice(0, 600)}`),
          ),
    );
  });
}

async function dumpToEncrypted(
  args: string[],
  env: NodeJS.ProcessEnv,
  destination: string,
  key: Buffer,
  pgBin?: string,
) {
  const child = spawn(pgTool("pg_dump", pgBin), args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
  const exited = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`pg_dump failed (${code}): ${err.trim().slice(0, 600)}`),
          ),
    );
  });
  let created = false;
  const encrypted = encryptStream(child.stdout, destination, key).then(
    (result) => {
      created = true;
      return result;
    },
  );
  try {
    const [result] = await Promise.all([encrypted, exited]);
    return result;
  } catch (error) {
    child.kill();
    await Promise.allSettled([encrypted, exited]);
    if (created) {
      await rm(destination, { force: true });
    }
    throw error;
  }
}

const quote = (name: string) => `"${name.replace(/"/gu, '""')}"`;

const DIGEST_SQL = `
  select v.id::text as id, v.status, md5(
    coalesce((select string_agg(p.household_id::text, ',' order by p.household_id)
              from public.participation p where p.vote_id = v.id), '') || '|' ||
    coalesce((select string_agg(r.household_id::text || ':' || r.option_id::text, ',' order by r.household_id)
              from public.open_responses r where r.vote_id = v.id), '') || '|' ||
    coalesce((select string_agg(coalesce(t.candidate_id::text, '-') || ':' || t.office_id::text || ':' || t.accepted_count::text,
                                ',' order by t.office_id, t.candidate_id nulls first)
              from public.closed_tallies t where t.vote_id = v.id), '') || '|' ||
    coalesce((select string_agg(e.household_id::text || ':' || coalesce(e.representative_name_snapshot, ''),
                                ',' order by e.household_id)
              from public.electorate e where e.vote_id = v.id), '')) as digest
  from public.votes v where v.status <> 'DRAFT'`;

export async function collectCounts(client: Client): Promise<Counts> {
  const tables = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  const counts: Counts = { tables: {}, auth: null, voteDigests: {} };
  for (const { table_name } of tables.rows) {
    const result = await client.query<{ n: string }>(
      `select count(*)::text n from public.${quote(table_name)}`,
    );
    counts.tables[table_name] = Number(result.rows[0]?.n);
  }
  const hasAuth = await client.query<{ ok: boolean }>(
    "select to_regclass('auth.users') is not null as ok",
  );
  if (hasAuth.rows[0]?.ok) {
    const users = await client.query<{ n: string }>(
      "select count(*)::text n from auth.users",
    );
    const hasIdentities = await client.query<{ ok: boolean }>(
      "select to_regclass('auth.identities') is not null as ok",
    );
    const identities = hasIdentities.rows[0]?.ok
      ? await client.query<{ n: string }>(
          "select count(*)::text n from auth.identities",
        )
      : null;
    counts.auth = {
      users: Number(users.rows[0]?.n),
      identities: identities ? Number(identities.rows[0]?.n) : null,
    };
  }
  for (const row of (
    await client.query<{ id: string; status: string; digest: string }>(
      DIGEST_SQL,
    )
  ).rows) {
    counts.voteDigests[row.id] = { status: row.status, digest: row.digest };
  }
  return counts;
}

const stampOf = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d+Z$/u, "Z");

export async function createBackup(
  options: BackupOptions,
): Promise<{ manifestPath: string; manifest: Manifest }> {
  const now = options.now ?? new Date();
  const stamp = `cp-backup-${stampOf(now)}`;
  const client = operationalDatabaseClient(options.databaseUrl);
  await client.connect();
  const files: Manifest["files"] = [];
  const created: string[] = [];

  try {
    // One snapshot for the dumps AND the counts, so they describe the same instant.
    await client.query("begin isolation level repeatable read read only");
    const snapshot = (
      await client.query<{ s: string }>("select pg_export_snapshot() as s")
    ).rows[0]?.s;
    if (!snapshot) {
      throw new Error("Could not export a snapshot.");
    }

    let retentionDays = options.retentionDays;
    if (retentionDays === undefined) {
      const row = await client.query<{ d: number | null }>(
        "select backup_retention_days as d from public.rwa_settings where id = 1",
      );
      retentionDays = row.rows[0]?.d ?? undefined;
    }
    if (!retentionDays || retentionDays < 1) {
      throw new Error(
        "backup_retention_days is not approved yet; refusing to create a backup with no expiry.",
      );
    }
    const serverVersion =
      (
        await client.query<{ v: string }>(
          "select current_setting('server_version') as v",
        )
      ).rows[0]?.v ?? "";
    const counts = await collectCounts(client);
    const env = pgEnv(options.databaseUrl);

    const app = join(options.outDir, `${stamp}.app.enc`);
    files.push({
      role: "app",
      name: `${stamp}.app.enc`,
      ...(await dumpToEncrypted(
        ["-Fc", `--snapshot=${snapshot}`, "-n", "public", "-n", "app_private"],
        env,
        app,
        options.key,
        options.pgBin,
      )),
    });
    created.push(app);

    // Data only: the schema comes from the reviewed migrations of the target project.
    const auth = join(options.outDir, `${stamp}.auth.enc`);
    files.push({
      role: "auth",
      name: `${stamp}.auth.enc`,
      ...(await dumpToEncrypted(
        [
          "-Fc",
          "--data-only",
          `--snapshot=${snapshot}`,
          "-t",
          "auth.users",
          "-t",
          "auth.identities",
          "-t",
          "supabase_migrations.schema_migrations",
          "-t",
          "cron.job",
        ],
        env,
        auth,
        options.key,
        options.pgBin,
      )),
    });
    created.push(auth);

    const countsFile = join(options.outDir, `${stamp}.counts.enc`);
    files.push({
      role: "counts",
      name: `${stamp}.counts.enc`,
      ...(await encryptBytes(
        Buffer.from(JSON.stringify(counts)),
        countsFile,
        options.key,
      )),
    });
    created.push(countsFile);
    await client.query("commit");

    const manifest: Manifest = {
      formatVersion: 1,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + retentionDays * 86_400_000,
      ).toISOString(),
      retentionDays,
      serverVersion,
      files,
    };
    const manifestPath = join(options.outDir, `${stamp}.manifest.json`);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    return { manifestPath, manifest };
  } catch (error) {
    // A half-written backup set is worse than none: remove what this run created.
    for (const file of created) {
      await rm(file, { force: true });
    }
    throw error;
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

const manifestSchema = z.strictObject({
  formatVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  retentionDays: z.number().int().positive().max(2_147_483_647),
  // Earlier format-v1 writers left this informational field blank.
  serverVersion: z.string().max(100),
  files: z
    .array(
      z.strictObject({
        role: z.enum(["app", "auth", "counts"]),
        name: z.string(),
        bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      }),
    )
    .length(3),
});

async function readManifest(path: string): Promise<Manifest> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > 64 * 1024) {
    throw new Error(
      "Invalid backup manifest: expected a bounded regular file.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("Invalid backup manifest JSON.");
  }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid backup manifest structure.");
  }
  const manifest = parsed.data;
  const stamp = `cp-backup-${stampOf(new Date(manifest.createdAt))}`;
  if (
    basename(path) !== `${stamp}.manifest.json` ||
    new Set(manifest.files.map((file) => file.role)).size !== 3 ||
    manifest.files.some((file) => file.name !== `${stamp}.${file.role}.enc`) ||
    new Date(manifest.expiresAt).getTime() -
      new Date(manifest.createdAt).getTime() !==
      manifest.retentionDays * 86_400_000
  ) {
    throw new Error(
      "Invalid backup manifest: filenames, roles or expiry do not match this set.",
    );
  }
  return manifest;
}

async function withDecrypted<T>(
  manifestPath: string,
  key: Buffer,
  roles: Manifest["files"][number]["role"][],
  fn: (paths: Record<string, string>, manifest: Manifest) => Promise<T>,
): Promise<T> {
  const manifest = await readManifest(manifestPath);
  const dir = await mkdtemp(join(tmpdir(), "cp-restore-"));
  try {
    const paths: Record<string, string> = {};
    for (const file of manifest.files.filter((f) => roles.includes(f.role))) {
      const source = join(manifestPath, "..", file.name);
      if (!(await lstat(source)).isFile()) {
        throw new Error("Invalid backup manifest: data must be regular files.");
      }
      const target = join(dir, `${file.role}.plain`);
      await decryptFile(source, target, key);
      paths[file.role] = target;
    }
    return await fn(paths, manifest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function readCounts(
  manifestPath: string,
  key: Buffer,
): Promise<Counts> {
  return withDecrypted(
    manifestPath,
    key,
    ["counts"],
    async (paths) =>
      JSON.parse(await readFile(paths.counts as string, "utf8")) as Counts,
  );
}

export interface VerifyResult {
  ok: boolean;
  problems: string[];
  tables: string[];
}

/** Checks integrity (hashes), decryptability and ACTUAL dump coverage, without restoring anything. */
export async function verifyBackup(options: {
  manifestPath: string;
  key: Buffer;
  pgBin?: string;
}): Promise<VerifyResult> {
  const problems: string[] = [];
  const manifest = await readManifest(options.manifestPath);
  for (const file of manifest.files) {
    const path = join(options.manifestPath, "..", file.name);
    try {
      const info = await lstat(path);
      if (!info.isFile()) {
        throw new Error("Not a regular backup file.");
      }
      if (
        info.size !== file.bytes ||
        (await sha256File(path)) !== file.sha256
      ) {
        problems.push(
          `${file.name} does not match the manifest (size or hash).`,
        );
      }
    } catch {
      problems.push(`${file.name} is missing.`);
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems, tables: [] };
  }

  const counts = await readCounts(options.manifestPath, options.key);
  const listing = async (role: "app" | "auth") =>
    withDecrypted(options.manifestPath, options.key, [role], (paths) =>
      run(
        pgTool("pg_restore", options.pgBin),
        ["--list", paths[role] as string],
        process.env,
      ),
    );

  const app = await listing("app");
  const tables = [...app.matchAll(/TABLE DATA public (\S+)/gu)].map(
    (m) => m[1] as string,
  );
  for (const name of Object.keys(counts.tables)) {
    if (!tables.includes(name)) {
      problems.push(`The dump has no data section for public.${name}.`);
    }
  }
  if (
    !/FUNCTION public run_maintenance/u.test(app) ||
    !/FUNCTION public cast_vote/u.test(app)
  ) {
    problems.push("The dump does not contain the application routines.");
  }
  const auth = await listing("auth");
  if (
    counts.auth &&
    (!/TABLE DATA auth users/u.test(auth) ||
      (counts.auth.identities !== null &&
        !/TABLE DATA auth identities/u.test(auth)))
  ) {
    problems.push("The dump has no Auth identity data.");
  }
  return { ok: problems.length === 0, problems, tables };
}

export interface Reconciliation {
  consistent: boolean;
  problems: string[];
  warnings: string[];
  /** Never true on a consistent restore alone: completeness must be confirmed separately. */
  resumeAllowed: boolean;
}

export async function reconcileRestore(options: {
  targetUrl: string;
  counts: Counts;
  completenessConfirmed?: boolean;
}): Promise<Reconciliation> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const client = operationalDatabaseClient(options.targetUrl);
  await client.connect();
  try {
    const restored = await collectCounts(client);

    for (const [table, expected] of Object.entries(options.counts.tables)) {
      if (restored.tables[table] !== expected) {
        problems.push(
          `public.${table}: expected ${expected} rows, found ${restored.tables[table] ?? "none"}.`,
        );
      }
    }
    if (options.counts.auth) {
      if (restored.auth?.users !== options.counts.auth.users) {
        problems.push(
          `auth.users: expected ${options.counts.auth.users}, found ${restored.auth?.users ?? "none"}.`,
        );
      }
      if (restored.auth?.identities !== options.counts.auth.identities) {
        problems.push(
          `auth.identities: expected ${options.counts.auth.identities}, found ${restored.auth?.identities ?? "none"}.`,
        );
      }
    }
    for (const [id, expected] of Object.entries(options.counts.voteDigests)) {
      const found = restored.voteDigests[id];
      if (
        !found ||
        found.digest !== expected.digest ||
        found.status !== expected.status
      ) {
        problems.push(
          `Vote ${id} does not reproduce its recorded participation, choices, counters or electorate.`,
        );
      }
    }

    // Every started vote must satisfy the same invariants that guard completion and publication.
    for (const id of Object.keys(restored.voteDigests)) {
      try {
        await client.query("select app_private.verify_vote_invariants($1)", [
          id,
        ]);
      } catch {
        problems.push(`Vote ${id} fails its invariants after restore.`);
      }
    }

    // Auth/profile mapping: an application profile without an Auth identity can never sign in.
    const unmapped = await client.query<{ n: string }>(
      "select count(*)::text n from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id)",
    );
    if (Number(unmapped.rows[0]?.n) > 0) {
      problems.push(`${unmapped.rows[0]?.n} profile(s) have no Auth identity.`);
    }

    // Policies, grants and routines must have come back, not just rows.
    const rls = await client.query<{ n: string }>(
      `select count(*)::text n from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    if (Number(rls.rows[0]?.n) > 0) {
      problems.push(
        "Some application tables do not have row-level security enabled.",
      );
    }
    const anonRoutines = await client.query<{ n: string }>(
      `select count(*)::text n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public','app_private') and has_function_privilege('anon', p.oid, 'EXECUTE')`,
    );
    if (Number(anonRoutines.rows[0]?.n) > 0) {
      problems.push("Anonymous callers can execute application routines.");
    }

    // Time kept passing while the service was down.
    const elapsed = await client.query<{ n: string }>(
      "select count(*)::text n from public.votes where status = 'ACTIVE' and closes_at <= clock_timestamp()",
    );
    if (Number(elapsed.rows[0]?.n) > 0) {
      warnings.push(
        `${elapsed.rows[0]?.n} active vote(s) are already past their deadline. They complete at the deadline with the data restored here; ballots acknowledged after the backup are NOT in it.`,
      );
    }
    const active = await client.query<{ n: string }>(
      "select count(*)::text n from public.votes where status = 'ACTIVE'",
    );
    if (Number(active.rows[0]?.n) > 0) {
      warnings.push(
        "Votes were active at backup time: acknowledged ballots after the backup instant cannot be proven present.",
      );
    }
  } finally {
    await client.end();
  }

  const consistent = problems.length === 0;
  return {
    consistent,
    problems,
    warnings,
    resumeAllowed:
      consistent &&
      warnings.length === 0 &&
      options.completenessConfirmed === true,
  };
}

/** Restores into a target that already has the reviewed migrations applied (empty application tables). */
export async function restoreBackup(options: {
  manifestPath: string;
  key: Buffer;
  targetUrl: string;
  pgBin?: string;
  completenessConfirmed?: boolean;
}): Promise<Reconciliation> {
  // Replica mode lets data load without firing the guard triggers; they do not apply to a restore.
  const env = pgEnv(options.targetUrl, {
    PGOPTIONS: "-c session_replication_role=replica",
  });
  await withDecrypted(
    options.manifestPath,
    options.key,
    ["auth", "app"],
    async (paths) => {
      for (const role of ["auth", "app"] as const) {
        await run(
          pgTool("pg_restore", options.pgBin),
          [
            "--data-only",
            "--single-transaction",
            "--exit-on-error",
            "--no-owner",
            "-d",
            env.PGDATABASE as string,
            paths[role] as string,
          ],
          env,
        );
      }
    },
  );
  return reconcileRestore({
    targetUrl: options.targetUrl,
    counts: await readCounts(options.manifestPath, options.key),
    ...(options.completenessConfirmed !== undefined && {
      completenessConfirmed: options.completenessConfirmed,
    }),
  });
}

/** Deletes backup sets past their approved expiry, always keeping the newest one. */
export async function pruneBackups(
  dir: string,
  now = new Date(),
): Promise<string[]> {
  const manifests = (await readdir(dir))
    .filter((n) => n.endsWith(".manifest.json"))
    .sort();
  const removed: string[] = [];
  for (const name of manifests.slice(0, -1)) {
    const manifest = await readManifest(join(dir, name));
    if (new Date(manifest.expiresAt).getTime() <= now.getTime()) {
      for (const file of manifest.files) {
        await rm(join(dir, file.name), { force: true });
      }
      await rm(join(dir, name), { force: true });
      removed.push(name);
    }
  }
  return removed;
}

export async function latestBackupAgeHours(
  dir: string,
  now = new Date(),
): Promise<number | null> {
  const manifests = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => n.endsWith(".manifest.json"))
    .sort();
  const last = manifests.at(-1);
  if (!last) {
    return null;
  }
  const manifest = await readManifest(join(dir, last));
  return (now.getTime() - new Date(manifest.createdAt).getTime()) / 3_600_000;
}

/** Auth identities that no application profile refers to, old enough that provisioning cannot be mid-flight. */
export function findOrphanAuthUsers(
  authUsers: readonly { id: string; created_at: string }[],
  profileIds: ReadonlySet<string>,
  now: Date,
  minAgeHours = 24,
): string[] {
  return authUsers
    .filter(
      (user) =>
        !profileIds.has(user.id) &&
        now.getTime() - new Date(user.created_at).getTime() >=
          minAgeHours * 3_600_000,
    )
    .map((user) => user.id);
}

/** Encrypted, privacy-minimized record of administrative actions since a restore point (no ballots, no secrets). */
export async function exportRecoveryRecord(options: {
  databaseUrl: string;
  since: Date;
  destination: string;
  key: Buffer;
}): Promise<number> {
  const client = operationalDatabaseClient(options.databaseUrl);
  await client.connect();
  try {
    const rows = await client.query(
      `select id::text, actor_kind, actor_profile_id, action, target_type, target_id, occurred_at, reason, details
         from public.audit_events where occurred_at >= $1 order by id`,
      [options.since.toISOString()],
    );
    await encryptBytes(
      Buffer.from(JSON.stringify({ since: options.since, events: rows.rows })),
      options.destination,
      options.key,
    );
    return rows.rowCount ?? 0;
  } finally {
    await client.end();
  }
}
