import { mkdir } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { operationalDatabaseClient } from "./database.ts";
import {
  createBackup,
  exportRecoveryRecord,
  findOrphanAuthUsers,
  latestBackupAgeHours,
  pruneBackups,
  readCounts,
  restoreBackup,
  verifyBackup,
} from "./backup.ts";
import { generateKeyHex, parseKey } from "./crypto.ts";

/*
 * Operations commands (docs/OPERATIONS.md). Run from the project root:
 *   node --env-file-if-exists=.env.local scripts/ops/cli.ts <command> [options]
 * Nothing here prints secrets, ballots or personal data. Exit status is
 * non-zero whenever a check fails, so a scheduler or monitor can alert on it.
 */
function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

const args = process.argv.slice(3);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

async function main(): Promise<number> {
  const command = process.argv[2];

  switch (command) {
    case "generate-key": {
      // Print once; store it in the approved secret manager, never beside the backups.
      console.log(generateKeyHex());
      return 0;
    }

    case "backup": {
      const outDir = need("BACKUP_DIR");
      await mkdir(outDir, { recursive: true });
      const key = parseKey(process.env.BACKUP_ENCRYPTION_KEY);
      const { manifestPath, manifest } = await createBackup({
        databaseUrl: need("BACKUP_DATABASE_URL"),
        outDir,
        key,
      });
      const check = await verifyBackup({ manifestPath, key });
      const removed = await pruneBackups(outDir);
      console.log(
        JSON.stringify({
          manifest: manifestPath,
          createdAt: manifest.createdAt,
          expiresAt: manifest.expiresAt,
          verified: check.ok,
          problems: check.problems,
          expiredRemoved: removed.length,
        }),
      );
      return check.ok ? 0 : 1;
    }

    case "verify": {
      const manifest = option("manifest");
      if (!manifest) {
        throw new Error("Pass --manifest <path>.");
      }
      const result = await verifyBackup({
        manifestPath: manifest,
        key: parseKey(process.env.BACKUP_ENCRYPTION_KEY),
      });
      console.log(
        JSON.stringify({
          ok: result.ok,
          problems: result.problems,
          tables: result.tables.length,
        }),
      );
      return result.ok ? 0 : 1;
    }

    case "restore": {
      // The target is an ISOLATED project/database that already has the reviewed migrations applied.
      const manifest = option("manifest");
      if (!manifest) {
        throw new Error("Pass --manifest <path>.");
      }
      const result = await restoreBackup({
        manifestPath: manifest,
        key: parseKey(process.env.BACKUP_ENCRYPTION_KEY),
        targetUrl: need("RESTORE_DATABASE_URL"),
        completenessConfirmed: flag("completeness-confirmed"),
      });
      console.log(JSON.stringify(result, null, 2));
      return result.consistent ? 0 : 1;
    }

    case "prune": {
      const removed = await pruneBackups(need("BACKUP_DIR"));
      console.log(JSON.stringify({ removed: removed.length }));
      return 0;
    }

    case "recovery-record": {
      // Administrative actions since a restore point, encrypted, for replay after a restore.
      const since = option("since");
      const out = option("out");
      if (!since || !out) {
        throw new Error("Pass --since <ISO time> and --out <file>.");
      }
      const count = await exportRecoveryRecord({
        databaseUrl: need("BACKUP_DATABASE_URL"),
        since: new Date(since),
        destination: out,
        key: parseKey(process.env.BACKUP_ENCRYPTION_KEY),
      });
      console.log(JSON.stringify({ events: count }));
      return 0;
    }

    case "status": {
      // Counts only. Alerts (non-zero exit): a late scheduler, a failing invariant, or a stale backup.
      const supabase = createClient(
        need("NEXT_PUBLIC_SUPABASE_URL"),
        need("SUPABASE_SERVICE_ROLE_KEY"),
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
      const { data, error } = await supabase.rpc("operational_status");
      if (error || !data) {
        console.log(
          JSON.stringify({ ok: false, reason: "status unavailable" }),
        );
        return 1;
      }
      const status = data as Record<string, number | boolean>;
      const alerts: string[] = [];
      if (Number(status.overdueActiveVotes) > 0) alerts.push("CRON_LATE");
      if (Number(status.invariantFailures) > 0)
        alerts.push("INVARIANT_FAILURE");
      if (status.policyReady !== true) alerts.push("POLICY_INCOMPLETE");
      const maxAge = Number(
        option("max-backup-age-hours") ?? process.env.BACKUP_MAX_AGE_HOURS ?? 0,
      );
      let backupAge: number | null = null;
      if (maxAge > 0 && process.env.BACKUP_DIR) {
        backupAge = await latestBackupAgeHours(process.env.BACKUP_DIR);
        if (backupAge === null || backupAge > maxAge)
          alerts.push("BACKUP_STALE");
      }
      console.log(
        JSON.stringify({
          ok: alerts.length === 0,
          alerts,
          status,
          backupAgeHours: backupAge,
        }),
      );
      return alerts.length === 0 ? 0 : 1;
    }

    case "auth-orphans": {
      // Removes Auth identities left behind after a profile was deleted by retention.
      // Dry run unless --apply; identities younger than 24h are never touched (provisioning may be mid-flight).
      const supabase = createClient(
        need("NEXT_PUBLIC_SUPABASE_URL"),
        need("SUPABASE_SERVICE_ROLE_KEY"),
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
      const db = operationalDatabaseClient(need("BACKUP_DATABASE_URL"));
      await db.connect();
      let profileIds: Set<string>;
      try {
        profileIds = new Set(
          (
            await db.query<{ id: string }>("select id from public.profiles")
          ).rows.map((r) => r.id),
        );
      } finally {
        await db.end();
      }
      const users: { id: string; created_at: string }[] = [];
      for (let page = 1; ; page += 1) {
        const { data, error } = await supabase.auth.admin.listUsers({
          page,
          perPage: 200,
        });
        if (error) throw new Error("Could not list Auth identities.");
        users.push(
          ...data.users.map((u) => ({ id: u.id, created_at: u.created_at })),
        );
        if (data.users.length < 200) break;
      }
      const orphans = findOrphanAuthUsers(users, profileIds, new Date());
      const failed: string[] = [];
      if (flag("apply")) {
        for (const id of orphans) {
          const { error } = await supabase.auth.admin.deleteUser(id);
          if (error) failed.push(id);
        }
      }
      console.log(
        JSON.stringify({
          orphans: orphans.length,
          applied: flag("apply"),
          failed: failed.length,
        }),
      );
      return failed.length === 0 ? 0 : 1;
    }

    case "counts": {
      const manifest = option("manifest");
      if (!manifest) throw new Error("Pass --manifest <path>.");
      const counts = await readCounts(
        manifest,
        parseKey(process.env.BACKUP_ENCRYPTION_KEY),
      );
      console.log(
        JSON.stringify({
          tables: counts.tables,
          auth: counts.auth,
          votes: Object.keys(counts.voteDigests).length,
        }),
      );
      return 0;
    }

    default:
      console.error(
        "Commands: generate-key | backup | verify --manifest | restore --manifest | prune | recovery-record --since --out | status | auth-orphans [--apply] | counts --manifest",
      );
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Unexpected failure.",
    );
    process.exitCode = 1;
  });
