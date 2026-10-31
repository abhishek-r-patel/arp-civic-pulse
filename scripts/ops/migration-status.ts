import { migrationStatus } from "./provision.ts";

/*
 * Read-only target guard for per-RWA migration reporting.
 */
const PROJECT_REF = /^[a-z0-9]{20}$/u;

export interface MigrationDatabaseTarget {
  projectRef: string;
  databaseUrl: string;
}

export type MigrationStatusName =
  | "current"
  | "behind"
  | "unknown-remote"
  | "divergent"
  | "untracked"
  | "uninitialized";

export interface MigrationStatusReport {
  projectRef: string;
  checkedAt: string;
  status: MigrationStatusName;
  localCount: number;
  latestLocal: string | null;
  remoteCount: number;
  latestRemote: string | null;
  pending: string[];
  unknownRemote: string[];
}

export function migrationDatabaseTarget(
  projectRef: string | undefined,
  databaseUrl: string | undefined,
  confirm: string | undefined,
): MigrationDatabaseTarget {
  if (!projectRef || !PROJECT_REF.test(projectRef)) {
    throw new Error(
      "Pass --confirm <project ref> for the migration database target.",
    );
  }
  if (confirm !== projectRef) {
    throw new Error(
      "The confirmed project does not match the migration target.",
    );
  }
  if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL is not set.");

  let url: URL;
  let username: string;
  try {
    url = new URL(databaseUrl);
    username = decodeURIComponent(url.username);
  } catch {
    throw new Error("MIGRATION_DATABASE_URL is not a valid URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("MIGRATION_DATABASE_URL must use PostgreSQL.");
  }

  const direct = url.hostname === `db.${projectRef}.supabase.co`;
  const pooler =
    url.hostname.endsWith(".pooler.supabase.com") &&
    username === `postgres.${projectRef}`;
  const unexpectedDirectUser =
    direct && username !== "postgres" && username !== `postgres.${projectRef}`;
  if ((!direct && !pooler) || unexpectedDirectUser) {
    throw new Error(
      "MIGRATION_DATABASE_URL does not match the confirmed Supabase project.",
    );
  }

  return { projectRef, databaseUrl };
}

export function migrationStatusReport(
  projectRef: string,
  local: string[],
  remote: string[] | null,
  hasApplicationTables: boolean,
  checkedAt = new Date().toISOString(),
): MigrationStatusReport {
  if (new Set(local).size !== local.length) {
    throw new Error(
      "Local migration versions are duplicated; stop and review the migration set.",
    );
  }
  const latestLocal = [...local].sort().at(-1) ?? null;
  if (remote === null) {
    return {
      projectRef,
      checkedAt,
      status: hasApplicationTables ? "untracked" : "uninitialized",
      localCount: local.length,
      latestLocal,
      remoteCount: 0,
      latestRemote: null,
      pending: [...local].sort(),
      unknownRemote: [],
    };
  }

  const comparison = migrationStatus(local, remote);
  const status = comparison.complete
    ? "current"
    : comparison.pending.length > 0 && comparison.unknownRemote.length > 0
      ? "divergent"
      : comparison.pending.length > 0
        ? "behind"
        : "unknown-remote";
  return {
    projectRef,
    checkedAt,
    status,
    localCount: local.length,
    latestLocal,
    remoteCount: remote.length,
    latestRemote: [...remote].sort().at(-1) ?? null,
    pending: comparison.pending,
    unknownRemote: comparison.unknownRemote,
  };
}
