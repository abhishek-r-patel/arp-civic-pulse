import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

/*
 * Real-PostgreSQL test harness. Connection details come from the environment
 * (INTEGRATION_DATABASE_URL: a superuser URL for a DISPOSABLE local server);
 * nothing is hardcoded and the tests never touch another database. Each test
 * file gets its own freshly migrated database, dropped afterwards.
 *
 * Requests are executed the way PostgREST does: a transaction that switches to
 * the API role and sets the verified JWT claims for that request.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SUPPORT = join(ROOT, "tests", "integration", "support");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

export const adminUrl = process.env.INTEGRATION_DATABASE_URL;
export const hasDatabase = Boolean(adminUrl);

export type ApiRole = "anon" | "authenticated" | "service_role";
export interface Claims {
  sub?: string;
  role?: string;
}

function connectionString(user: string, database: string): string {
  if (!adminUrl) {
    throw new Error("INTEGRATION_DATABASE_URL is not set.");
  }
  const url = new URL(adminUrl);
  url.username = user;
  url.password = "";
  url.pathname = `/${database}`;
  return url.toString();
}

async function withClient<T>(
  user: string,
  database: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: connectionString(user, database),
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function inTransaction<T>(
  client: Client,
  fn: () => Promise<T>,
  commit: boolean,
): Promise<T> {
  await client.query("begin");
  try {
    const result = await fn();
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export interface TestDatabase {
  readonly name: string;
  /** Superuser connection (fixtures, catalog inspection). Committed. */
  asSuperuser<T>(fn: (client: Client) => Promise<T>): Promise<T>;
  /** The migration role (what the deployment tooling uses). Committed. */
  asDeployment<T>(fn: (client: Client) => Promise<T>): Promise<T>;
  /** The restricted owner of application objects; triggers still apply. Committed. */
  asOwner<T>(fn: (client: Client) => Promise<T>): Promise<T>;
  /** One API request. Rolled back unless `commit` is true. */
  asRole<T>(
    role: ApiRole,
    claims: Claims | null,
    fn: (client: Client) => Promise<T>,
    options?: { commit?: boolean },
  ): Promise<T>;
  drop(): Promise<void>;
}

// Cluster-level roles (postgres, cp_owner) are created on first use, so database
// creation is serialised across parallel test files with an advisory lock.
const CREATION_LOCK = 727_001;

async function provisionDatabase(
  name: string,
  throughMigration?: string,
): Promise<void> {
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const cutoff =
    throughMigration === undefined
      ? files.length - 1
      : files.findIndex((file) => file.startsWith(`${throughMigration}_`));
  if (cutoff < 0) {
    throw new Error(`Migration baseline ${throughMigration} was not found.`);
  }

  await withClient("supabase_admin", "postgres", async (lockClient) => {
    await lockClient.query("select pg_advisory_lock($1)", [CREATION_LOCK]);
    try {
      await lockClient.query(readFileSync(join(SUPPORT, "roles.sql"), "utf8"));
      await lockClient.query(`create database ${name} owner postgres`);
      await withClient("supabase_admin", name, (client) =>
        client.query(readFileSync(join(SUPPORT, "supabase-stub.sql"), "utf8")),
      );

      await withClient("postgres", name, async (client) => {
        for (const file of files.slice(0, cutoff + 1)) {
          const sql = readFileSync(join(MIGRATIONS, file), "utf8");
          await inTransaction(client, () => client.query(sql), true);
        }
      });
    } finally {
      await lockClient.query("select pg_advisory_unlock($1)", [CREATION_LOCK]);
    }
  });
}

export async function createTestDatabase(options?: {
  throughMigration?: string;
}): Promise<TestDatabase> {
  const name = `cp_it_${randomBytes(4).toString("hex")}`;
  await provisionDatabase(name, options?.throughMigration);
  return {
    name,
    asSuperuser: (fn) => withClient("supabase_admin", name, fn),
    asDeployment: (fn) => withClient("postgres", name, fn),
    asOwner: (fn) =>
      withClient("supabase_admin", name, (client) =>
        inTransaction(
          client,
          async () => {
            await client.query("set local role cp_owner");
            return fn(client);
          },
          true,
        ),
      ),
    asRole: (role, claims, fn, options = {}) =>
      withClient("supabase_admin", name, (client) =>
        inTransaction(
          client,
          async () => {
            await client.query(`set local role ${role}`);
            const payload = JSON.stringify({ role, ...claims });
            await client.query(
              "select set_config('request.jwt.claims', $1, true)",
              [payload],
            );
            return fn(client);
          },
          options.commit === true,
        ),
      ),
    drop: () =>
      withClient("supabase_admin", "postgres", async (client) => {
        await client.query(`drop database if exists ${name} with (force)`);
      }),
  };
}

export interface CapturedError {
  message: string;
  code: string | undefined;
  detail: string | undefined;
}

// Resolves with the database error, or fails the test if the call succeeds.
export async function dbError(
  action: Promise<unknown>,
): Promise<CapturedError> {
  try {
    await action;
  } catch (error) {
    const failure = error as {
      message?: string;
      code?: string;
      detail?: string;
    };
    return {
      message: failure.message ?? "",
      code: failure.code,
      detail: failure.detail,
    };
  }
  throw new Error("Expected the database to reject the operation.");
}

export async function newAuthUser(
  client: Client,
  email?: string,
): Promise<string> {
  const id = (
    await client.query<{ id: string }>("select gen_random_uuid() as id")
  ).rows[0]?.id;
  if (!id) {
    throw new Error("Could not generate an identifier.");
  }
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    id,
    email ?? `${id}@example.test`,
  ]);
  return id;
}
