import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";

/*
 * Shared guards for ops commands that write to one named Supabase project
 * (`demo-reset`, `provision`). Every credential must point at the confirmed
 * project reference, so a pasted URL or key for another RWA is refused before
 * any write. Error messages name variables only, never their values.
 */

export interface ProjectTarget {
  projectRef: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  databaseUrl: string;
}

const REF = /^[a-z0-9]{20}$/u;

/** Reads `<prefix>PROJECT_REF`, `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `DATABASE_URL`. */
export function projectTarget(
  env: Readonly<Record<string, string | undefined>>,
  prefix: string,
  confirm: string | undefined,
  confirmHint: string,
): ProjectTarget {
  const need = (name: string) => {
    const value = env[`${prefix}${name}`];
    if (!value) throw new Error(`${prefix}${name} is not set.`);
    return value;
  };
  const projectRef = need("PROJECT_REF");
  const supabaseUrl = need("SUPABASE_URL");
  const serviceRoleKey = need("SERVICE_ROLE_KEY");
  const databaseUrl = need("DATABASE_URL");
  if (!REF.test(projectRef)) {
    throw new Error(
      `${prefix}PROJECT_REF is not a Supabase project reference.`,
    );
  }
  if (confirm !== projectRef) {
    throw new Error(`Pass --confirm <${prefix}PROJECT_REF> ${confirmHint}.`);
  }
  let apiHost: string;
  let database: URL;
  try {
    apiHost = new URL(supabaseUrl).hostname;
    database = new URL(databaseUrl);
  } catch {
    throw new Error(
      `${prefix}SUPABASE_URL or ${prefix}DATABASE_URL is not a URL.`,
    );
  }
  if (apiHost !== `${projectRef}.supabase.co`) {
    throw new Error(
      `${prefix}SUPABASE_URL is not the ${prefix}PROJECT_REF project.`,
    );
  }
  // Direct (db.<ref>.supabase.co) or pooler (user postgres.<ref>) connections.
  const user = decodeURIComponent(database.username);
  if (
    database.hostname !== `db.${projectRef}.supabase.co` &&
    user !== `postgres.${projectRef}`
  ) {
    throw new Error(
      `${prefix}DATABASE_URL is not the ${prefix}PROJECT_REF project.`,
    );
  }
  return { projectRef, supabaseUrl, serviceRoleKey, databaseUrl };
}

export type Db = Pick<Client, "query">;

/** provision_profile/enable_profile check the service_role JWT claim. */
export async function asServiceRole(db: Db, sql: string, params: unknown[]) {
  await db.query("begin");
  try {
    await db.query("set local role service_role");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    await db.query(sql, params);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

/** Finds an Auth identity by (case-insensitive) email without printing it. */
export async function findAuthUserId(
  admin: SupabaseClient,
  email: string,
): Promise<string | undefined> {
  const wanted = email.trim().toLowerCase();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error("Could not list Auth users.");
    const match = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (match) return match.id;
    if (data.users.length < 200) return undefined;
  }
}
