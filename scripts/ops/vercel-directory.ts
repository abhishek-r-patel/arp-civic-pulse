import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { withValues } from "./test-target.ts";

/*
 * Keeps the shared multi-tenant Vercel project (`arp-civic-pulse`) in step
 * with new society projects. Vercel stores TENANT_DIRECTORY_JSON as a
 * write-only sensitive variable, so the authoritative copy lives in the ignored
 * `.env.vercel.local`; every change is made there first and then pushed whole.
 * The repository is public, so the directory (client hosts, Supabase project
 * URLs, tenant IDs) is deliberately not committed.
 * Usage:
 *   npm run vercel:directory               # redacted summary of the local copy
 *   npm run vercel:directory -- init       # one-time rebuild of the live entries
 */

export const VERCEL_PROFILE = ".env.vercel.local";
export const VERCEL_PROJECT = {
  id: "prj_q5xGBRUH5542l8SLvJDU9spFBld1",
  name: "arp-civic-pulse",
  productionHost: "arp-civic-pulse.vercel.app",
} as const;
export const MAX_CUSTOMERS = 10;

const DNS_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST = new RegExp(`^(?=.{1,253}$)(?:${DNS_LABEL}\\.)+${DNS_LABEL}$`, "u");
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STATES = new Set(["provisioning", "active", "unavailable"]);

export type DirectoryState = "provisioning" | "active" | "unavailable";
export interface MainEntry {
  host: string;
  kind: "main";
  state: DirectoryState;
}
export interface RwaEntry {
  host: string;
  kind: "demo" | "customer";
  tenantId: string;
  state: DirectoryState;
  projectUrl: string;
  publishableKey: string;
  serviceRoleKeyRef: string;
}
export type DirectoryEntry = MainEntry | RwaEntry;
export interface Directory {
  version: 1;
  entries: DirectoryEntry[];
}

export function serviceKeyRef(tenantId: string) {
  return `TENANT_${tenantId.replaceAll("-", "").toUpperCase()}_SUPABASE_SERVICE_ROLE_KEY`;
}

function exactKeys(value: object, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    [...keys].sort().every((key, i) => key === actual[i])
  );
}

/**
 * Mirrors the app's strict parser (src/server/config/tenant-directory.ts), but
 * rejects the whole directory on any defect: the app would silently drop a bad
 * or duplicated host, which here would mean taking a live RWA offline.
 */
export function validateDirectory(value: unknown): Directory {
  if (
    typeof value !== "object" ||
    value === null ||
    !exactKeys(value, ["version", "entries"]) ||
    (value as Directory).version !== 1 ||
    !Array.isArray((value as Directory).entries) ||
    (value as Directory).entries.length === 0
  ) {
    throw new Error("Tenant directory must be { version: 1, entries: [...] }.");
  }
  const entries = (value as Directory).entries;
  const seen = new Map<string, string>();
  const unique = (field: string, key: string, host: string) => {
    const id = `${field}:${key}`;
    if (seen.has(id)) {
      throw new Error(
        `Tenant directory repeats ${field} for ${seen.get(id)} and ${host}.`,
      );
    }
    seen.set(id, host);
  };
  const counts = { main: 0, demo: 0, customer: 0 };
  for (const entry of entries as unknown[]) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Tenant directory entries must be objects.");
    }
    const e = entry as Omit<Partial<RwaEntry>, "kind"> & { kind?: string };
    const host = typeof e.host === "string" ? e.host : "";
    if (!HOST.test(host) || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) {
      throw new Error(`Tenant directory host "${host}" is not a hostname.`);
    }
    if (!e.state || !STATES.has(e.state)) {
      throw new Error(`Tenant directory state for ${host} is invalid.`);
    }
    unique("host", host, host);
    if (e.kind === "main") {
      if (!exactKeys(e, ["host", "kind", "state"])) {
        throw new Error(`Main entry ${host} has unexpected fields.`);
      }
      counts.main += 1;
      continue;
    }
    if (e.kind !== "demo" && e.kind !== "customer") {
      throw new Error(`Tenant directory kind for ${host} is invalid.`);
    }
    if (
      !exactKeys(e, [
        "host",
        "kind",
        "tenantId",
        "state",
        "projectUrl",
        "publishableKey",
        "serviceRoleKeyRef",
      ]) ||
      !e.tenantId ||
      !UUID.test(e.tenantId) ||
      e.serviceRoleKeyRef !== serviceKeyRef(e.tenantId) ||
      !e.projectUrl ||
      !/^https:\/\/[a-z0-9-]+\.supabase\.co$/u.test(e.projectUrl) ||
      !e.publishableKey ||
      e.publishableKey.startsWith("sb_secret_")
    ) {
      throw new Error(`Tenant directory entry for ${host} is incomplete.`);
    }
    unique("tenantId", e.tenantId, host);
    unique("projectUrl", e.projectUrl, host);
    counts[e.kind] += 1;
  }
  if (counts.main > 1 || counts.demo > 1) {
    throw new Error("Tenant directory allows one main and one demo host.");
  }
  if (counts.customer > MAX_CUSTOMERS) {
    throw new Error(
      `Tenant directory allows at most ${MAX_CUSTOMERS} customer RWAs.`,
    );
  }
  return value as Directory;
}

export function parseDirectory(serialized: string | undefined): Directory {
  if (!serialized) {
    throw new Error(
      `${VERCEL_PROFILE} has no TENANT_DIRECTORY_JSON; run npm run vercel:directory -- init first.`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("TENANT_DIRECTORY_JSON is not valid JSON.");
  }
  return validateDirectory(value);
}

/** Refuses any entry whose host, tenant or project already belongs to another RWA. */
export function assertCanAddCustomer(
  directory: Directory,
  host: string,
  tenantId: string,
  projectUrl?: string,
) {
  for (const entry of directory.entries) {
    const sameTenant = entry.kind !== "main" && entry.tenantId === tenantId;
    if (sameTenant && entry.kind !== "customer") {
      throw new Error(`Tenant ${tenantId} is the ${entry.kind} tenant.`);
    }
    if (sameTenant && entry.host !== host) {
      throw new Error(
        `Tenant ${tenantId} is already mapped to ${entry.host}; refusing to move it.`,
      );
    }
    if (!sameTenant && entry.host === host) {
      throw new Error(`The directory already gives ${host} to another entry.`);
    }
    if (
      projectUrl &&
      entry.kind !== "main" &&
      entry.projectUrl === projectUrl &&
      !sameTenant
    ) {
      throw new Error(`The directory gives ${projectUrl} to another tenant.`);
    }
    if (sameTenant && projectUrl && entry.projectUrl !== projectUrl) {
      throw new Error(
        `Tenant ${tenantId} is already mapped to a different Supabase project.`,
      );
    }
  }
}

/** Adds or refreshes one customer; an already-active entry is never downgraded. */
export function withCustomerEntry(
  directory: Directory,
  entry: RwaEntry,
): Directory {
  if (entry.kind !== "customer") {
    throw new Error("Only customer entries can be added by society:create.");
  }
  assertCanAddCustomer(directory, entry.host, entry.tenantId, entry.projectUrl);
  const existing = directory.entries.find(
    (candidate) =>
      candidate.kind === "customer" && candidate.tenantId === entry.tenantId,
  );
  const next: RwaEntry = {
    ...entry,
    state: existing?.state === "active" ? "active" : entry.state,
  };
  return validateDirectory({
    version: 1,
    entries: existing
      ? directory.entries.map((candidate) =>
          candidate === existing ? next : candidate,
        )
      : [...directory.entries, next],
  });
}

/** Removes one customer; refuses main/demo entries and a host bound to another tenant. */
export function withoutCustomerEntry(
  directory: Directory,
  host: string,
  tenantId: string,
  projectUrl: string,
): Directory {
  const byHost = directory.entries.find((entry) => entry.host === host);
  const byTenant = directory.entries.find(
    (entry) => entry.kind !== "main" && entry.tenantId === tenantId,
  );
  const target = byHost ?? byTenant;
  if (!target) return directory;
  if (
    target.kind !== "customer" ||
    target.host !== host ||
    target.tenantId !== tenantId ||
    target.projectUrl !== projectUrl
  ) {
    throw new Error(
      `The directory entry for ${target.host} does not match this society (host, tenant and project must all match); refusing to remove it.`,
    );
  }
  return validateDirectory({
    version: 1,
    entries: directory.entries.filter((entry) => entry !== target),
  });
}

const DEMO_TENANT = "22222222-2222-4222-8222-222222222222";
const TENANT_A = "11111111-1111-4111-8111-111111111111";

/**
 * Rebuilds the entries live on 6 November 2026 (see docs/DEPLOYMENT.md): the
 * product site, the synthetic demo and the synthetic tenant-a on the testdb
 * project. Only public keys are needed; service keys stay in Vercel.
 */
export function bootstrapDirectory(keys: {
  demoPublishableKey: string;
  tenantAPublishableKey: string;
}): Directory {
  return validateDirectory({
    version: 1,
    entries: [
      { host: VERCEL_PROJECT.productionHost, kind: "main", state: "active" },
      {
        host: `demo.${VERCEL_PROJECT.productionHost}`,
        kind: "demo",
        tenantId: DEMO_TENANT,
        state: "active",
        projectUrl: "https://hnqajjjemqepxuoqbsqx.supabase.co",
        publishableKey: keys.demoPublishableKey,
        serviceRoleKeyRef: serviceKeyRef(DEMO_TENANT),
      },
      {
        host: `tenant-a.${VERCEL_PROJECT.productionHost}`,
        kind: "customer",
        tenantId: TENANT_A,
        state: "active",
        projectUrl: "https://nycbbzgsilnxrgkwlwno.supabase.co",
        publishableKey: keys.tenantAPublishableKey,
        serviceRoleKeyRef: serviceKeyRef(TENANT_A),
      },
    ],
  });
}

export function describeDirectory(directory: Directory) {
  return directory.entries.map((entry) =>
    entry.kind === "main"
      ? `${entry.kind.padEnd(8)} ${entry.state.padEnd(12)} ${entry.host}`
      : `${entry.kind.padEnd(8)} ${entry.state.padEnd(12)} ${entry.host} -> ${entry.projectUrl} (tenant ${entry.tenantId}, key ${entry.publishableKey.slice(0, 16)}…)`,
  );
}

/**
 * Reads a file, or returns undefined when it does not exist. Opening it directly
 * (rather than checking existence first) avoids a check-then-use race.
 */
export function readTextIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Creates a new owner-only file, failing instead of overwriting one that appeared meanwhile. */
export function createPrivateFile(file: string, text: string, what: string) {
  try {
    writeFileSync(file, text, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${file} already exists; ${what}`);
    }
    throw error;
  }
}

export function readVercelProfile() {
  const text = readTextIfExists(VERCEL_PROFILE);
  if (text === undefined) {
    throw new Error(
      `${VERCEL_PROFILE} is missing; run npm run vercel:directory -- init first.`,
    );
  }
  const env = parseEnv(text);
  if (env.VERCEL_PROJECT_ID !== VERCEL_PROJECT.id) {
    throw new Error(
      `${VERCEL_PROFILE} is not for Vercel project ${VERCEL_PROJECT.name}.`,
    );
  }
  if (!env.VERCEL_TEAM_ID?.startsWith("team_")) {
    throw new Error(`${VERCEL_PROFILE} has no VERCEL_TEAM_ID.`);
  }
  return {
    text,
    teamId: env.VERCEL_TEAM_ID,
    directory: parseDirectory(env.TENANT_DIRECTORY_JSON),
  };
}

export function saveDirectory(directory: Directory) {
  const { text } = readVercelProfile();
  writeFileSync(
    VERCEL_PROFILE,
    withValues(text, {
      TENANT_DIRECTORY_JSON: quotedDirectory(directory),
    }),
    { mode: 0o600 },
  );
}

/** Single-quoted so parseEnv keeps `#` and double quotes literally. */
export function quotedDirectory(directory: Directory) {
  const json = JSON.stringify(validateDirectory(directory));
  if (json.includes("'")) {
    throw new Error("Tenant directory values must not contain single quotes.");
  }
  return `'${json}'`;
}

function cliAuthFiles() {
  const home = os.homedir();
  return [
    process.env.APPDATA &&
      path.join(process.env.APPDATA, "com.vercel.cli", "Data", "auth.json"),
    path.join(
      home,
      "Library",
      "Application Support",
      "com.vercel.cli",
      "auth.json",
    ),
    path.join(home, ".local", "share", "com.vercel.cli", "auth.json"),
  ].filter((file): file is string => Boolean(file));
}

function cliToken() {
  for (const file of cliAuthFiles()) {
    const text = readTextIfExists(file);
    if (text === undefined) continue;
    try {
      const token = (JSON.parse(text) as { token?: string }).token;
      if (token) return token;
    } catch {
      // Unreadable auth file: fall through to the next location.
    }
  }
  return undefined;
}

/** Lets the Vercel CLI refresh its short-lived login token (needs system CAs here). */
function refreshCliLogin() {
  const npmCli = process.env.npm_execpath;
  const npxCli = npmCli ? path.join(path.dirname(npmCli), "npx-cli.js") : "";
  if (!npxCli || !existsSync(npxCli)) return false;
  const result = spawnSync(
    process.execPath,
    [npxCli, "--yes", "vercel@latest", "whoami"],
    {
      stdio: "ignore",
      timeout: 180_000,
      env: {
        ...process.env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, "--use-system-ca"]
          .filter(Boolean)
          .join(" "),
      },
    },
  );
  return !result.error && result.status === 0;
}

export interface VercelClient {
  teamId: string;
  request<T>(
    method: string,
    pathName: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }>;
}

export async function vercelClient(teamId: string): Promise<VercelClient> {
  let token = process.env.VERCEL_TOKEN || cliToken();
  const send = async (method: string, pathName: string, body?: unknown) => {
    if (!token) throw new Error("No Vercel token.");
    const separator = pathName.includes("?") ? "&" : "?";
    const response = await fetch(
      `https://api.vercel.com${pathName}${separator}teamId=${teamId}`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      },
    );
    const text = await response.text();
    return {
      status: response.status,
      data: (text ? JSON.parse(text) : {}) as unknown,
    };
  };
  const probe = token
    ? await send("GET", `/v9/projects/${VERCEL_PROJECT.id}`)
    : undefined;
  if (!probe || probe.status === 401 || probe.status === 403) {
    if (!process.env.VERCEL_TOKEN && refreshCliLogin()) token = cliToken();
    const retry = token
      ? await send("GET", `/v9/projects/${VERCEL_PROJECT.id}`)
      : undefined;
    if (!retry || retry.status !== 200) {
      throw new Error(
        "Vercel API access failed. Set VERCEL_TOKEN or run `$env:NODE_OPTIONS='--use-system-ca'; npx vercel login`, then retry.",
      );
    }
  } else if (probe.status !== 200) {
    throw new Error(
      `Vercel API returned HTTP ${probe.status} for project ${VERCEL_PROJECT.name}.`,
    );
  }
  return {
    teamId,
    request: async <T>(method: string, pathName: string, body?: unknown) =>
      (await send(method, pathName, body)) as { status: number; data: T },
  };
}

function apiError(action: string, status: number, data: unknown) {
  const error = (data as { error?: { code?: string; message?: string } })
    ?.error;
  return new Error(
    `Vercel ${action} failed (HTTP ${status}${error?.code ? `, ${error.code}` : ""}${error?.message ? `: ${error.message}` : ""}).`,
  );
}

/** Attaches the host to the shared project; idempotent and fails if another project owns it. */
export async function ensureProjectDomain(client: VercelClient, host: string) {
  const domainPath = `/v9/projects/${VERCEL_PROJECT.id}/domains/${host}`;
  const existing = await client.request<{ verified?: boolean }>(
    "GET",
    domainPath,
  );
  if (existing.status === 200) {
    if (!existing.data.verified) {
      throw new Error(
        `${host} is on the Vercel project but not verified; finish verification in Vercel.`,
      );
    }
    return "already";
  }
  if (existing.status !== 404) {
    throw apiError(`lookup of ${host}`, existing.status, existing.data);
  }
  const added = await client.request<{ verified?: boolean }>(
    "POST",
    `/v10/projects/${VERCEL_PROJECT.id}/domains`,
    { name: host },
  );
  if (added.status !== 200) {
    throw apiError(`adding ${host}`, added.status, added.data);
  }
  if (!added.data.verified) {
    throw new Error(
      `${host} was added to Vercel but needs verification (DNS) before use.`,
    );
  }
  return "added";
}

export async function upsertSensitiveEnv(
  client: VercelClient,
  key: string,
  value: string,
) {
  if (!value) throw new Error(`Refusing to set an empty ${key}.`);
  const result = await client.request(
    "POST",
    `/v10/projects/${VERCEL_PROJECT.id}/env?upsert=true`,
    { key, value, type: "sensitive", target: ["production"] },
  );
  if (result.status !== 200 && result.status !== 201) {
    throw apiError(`setting ${key}`, result.status, result.data);
  }
}

/** Deletes a Production variable by name; idempotent. */
export async function deleteProjectEnv(client: VercelClient, key: string) {
  const list = await client.request<{ envs?: { id: string; key: string }[] }>(
    "GET",
    `/v10/projects/${VERCEL_PROJECT.id}/env`,
  );
  if (list.status !== 200) {
    throw apiError("listing variables", list.status, list.data);
  }
  const matches = (list.data.envs ?? []).filter((env) => env.key === key);
  for (const env of matches) {
    const removed = await client.request(
      "DELETE",
      `/v9/projects/${VERCEL_PROJECT.id}/env/${env.id}`,
    );
    if (removed.status !== 200 && removed.status !== 404) {
      throw apiError(`deleting ${key}`, removed.status, removed.data);
    }
  }
  return matches.length > 0 ? "deleted" : "absent";
}

/** Detaches a host from the shared project; idempotent. */
export async function removeProjectDomain(client: VercelClient, host: string) {
  const domainPath = `/v9/projects/${VERCEL_PROJECT.id}/domains/${host}`;
  const existing = await client.request("GET", domainPath);
  if (existing.status === 404) return "absent";
  if (existing.status !== 200) {
    throw apiError(`lookup of ${host}`, existing.status, existing.data);
  }
  const removed = await client.request("DELETE", domainPath);
  if (removed.status !== 200 && removed.status !== 404) {
    throw apiError(`removing ${host}`, removed.status, removed.data);
  }
  return "removed";
}

interface Deployment {
  id: string;
  projectId?: string;
  readyState?: string;
  target?: string | null;
  url?: string;
}

/**
 * Rebuilds the deployment currently serving production with the latest
 * variables. It never uploads this working tree, matching the operator's
 * manual "redeploy without local changes" practice for this Git-less project.
 */
export async function redeployProduction(client: VercelClient) {
  const current = await client.request<Deployment>(
    "GET",
    `/v13/deployments/${VERCEL_PROJECT.productionHost}`,
  );
  if (
    current.status !== 200 ||
    current.data.projectId !== VERCEL_PROJECT.id ||
    current.data.target !== "production"
  ) {
    throw apiError(
      "lookup of the current production deployment",
      current.status,
      current.data,
    );
  }
  const created = await client.request<Deployment>(
    "POST",
    "/v13/deployments?forceNew=1",
    {
      name: VERCEL_PROJECT.name,
      project: VERCEL_PROJECT.id,
      deploymentId: current.data.id,
      target: "production",
    },
  );
  if (created.status !== 200) {
    throw apiError("redeploy", created.status, created.data);
  }
  console.log(
    `  Redeploying ${current.data.id} as ${created.data.id} (production)...`,
  );
  const deadline = Date.now() + 20 * 60_000;
  let previous = "";
  let failures = 0;
  while (Date.now() <= deadline) {
    let status: { status: number; data: Deployment };
    try {
      status = await client.request<Deployment>(
        "GET",
        `/v13/deployments/${created.data.id}`,
      );
      failures = 0;
    } catch (error) {
      // A slow status poll must not abandon a build that is still progressing.
      failures += 1;
      if (failures >= 6) {
        throw new Error(
          `Lost contact with Vercel while ${created.data.id} was building (${error instanceof Error ? error.message : String(error)}); check it in Vercel before retrying.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      continue;
    }
    const state = status.data.readyState ?? `HTTP ${status.status}`;
    if (state !== previous) {
      console.log(`  ${created.data.id}: ${state}`);
      previous = state;
    }
    if (state === "READY") {
      return { previous: current.data.id, next: created.data.id };
    }
    if (state === "ERROR" || state === "CANCELED") {
      throw new Error(
        `Vercel redeploy ${created.data.id} ended in ${state}; production still serves ${current.data.id}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(
    `Vercel redeploy ${created.data.id} is still building; check it in Vercel.`,
  );
}

export interface HostResponse {
  status: number;
  vercelError: string | null;
  retryAfter: string | null;
  bodyLength: number;
}

async function probeHost(url: string): Promise<HostResponse> {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    return {
      status: response.status,
      vercelError: response.headers.get("x-vercel-error"),
      retryAfter: response.headers.get("retry-after"),
      bodyLength: body.length,
    };
  } catch {
    return { status: 0, vercelError: null, retryAfter: null, bodyLength: 0 };
  }
}

function describeResponse(response: HostResponse) {
  if (response.status === 0) return "no response";
  const extras = [
    response.vercelError && `x-vercel-error ${response.vercelError}`,
    response.retryAfter && "maintenance Retry-After",
  ].filter(Boolean);
  return extras.length > 0
    ? `${response.status} (${extras.join(", ")})`
    : `${response.status}`;
}

/**
 * What the new society host must return from `/sign-in` once production has
 * the updated directory. An active tenant serves the page. A tenant that is
 * still `provisioning` (or `unavailable`) is deliberately refused by
 * src/proxy.ts with an empty 503 (TENANT_NOT_ACTIVE); an unlisted host would
 * get an empty 404 instead. Vercel platform failures (`x-vercel-error`),
 * maintenance mode (`Retry-After` page) and any other status are failures.
 */
export function newHostResponseOk(
  state: DirectoryState,
  response: HostResponse,
) {
  if (response.vercelError) return false;
  if (state === "active") return response.status === 200;
  return (
    response.status === 503 &&
    response.retryAfter === null &&
    response.bodyLength === 0
  );
}

/**
 * After a society is removed and production redeployed, its host (still
 * attached at that point) must get the app's own empty 404 for an unlisted
 * host, not a Vercel platform error.
 */
export function removedHostResponseOk(response: HostResponse) {
  return (
    response.status === 404 &&
    !response.vercelError &&
    response.retryAfter === null &&
    response.bodyLength === 0
  );
}

/**
 * After a redeploy, the main site and demo must still serve, and the changed
 * host must be answered by the app with the response its directory state
 * implies (or the unlisted-host 404 once removed). On failure the previous
 * deployment ID is reported for an instant rollback in Vercel.
 */
export async function checkLiveHosts(
  directory: Directory,
  changedHost: string,
  previousDeployment: string,
  removed = false,
) {
  const changedEntry = directory.entries.find(
    (entry) => entry.host === changedHost,
  );
  if (removed ? changedEntry : !changedEntry) {
    throw new Error(
      removed
        ? `${changedHost} is still in the pushed tenant directory.`
        : `${changedHost} is not in the pushed tenant directory.`,
    );
  }
  const served = (response: HostResponse) =>
    response.status === 200 && !response.vercelError;
  const checks: { url: string; ok: (response: HostResponse) => boolean }[] = [];
  for (const entry of directory.entries) {
    if (entry.state !== "active" || entry.host === changedHost) continue;
    if (entry.kind === "main") {
      checks.push({ url: `https://${entry.host}/`, ok: served });
    } else if (entry.kind === "demo") {
      checks.push({ url: `https://${entry.host}/sign-in`, ok: served });
    }
  }
  checks.push({
    url: `https://${changedHost}/sign-in`,
    ok: (response) =>
      changedEntry
        ? newHostResponseOk(changedEntry.state, response)
        : removedHostResponseOk(response),
  });
  const failures: string[] = [];
  for (const check of checks) {
    let response = await probeHost(check.url);
    for (let attempt = 1; attempt < 6 && !check.ok(response); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      response = await probeHost(check.url);
    }
    console.log(`  ${check.url} -> ${describeResponse(response)}`);
    if (!check.ok(response)) {
      failures.push(`${check.url} (${describeResponse(response)})`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Post-deploy checks failed: ${failures.join(", ")}. Roll back by promoting ${previousDeployment} in Vercel (Instant Rollback) if the main site or demo is affected.`,
    );
  }
}

function initProfile() {
  const alreadyExists =
    "it is the source of truth and will not be overwritten.";
  if (readTextIfExists(VERCEL_PROFILE) !== undefined) {
    throw new Error(`${VERCEL_PROFILE} already exists; ${alreadyExists}`);
  }
  const read = (file: string) => parseEnv(readTextIfExists(file) ?? "");
  const demo = read(".env.demo-test.local");
  const testdb = read(".env.testdb.local");
  const local = read(".env.local");
  const demoKey =
    demo.NEXT_PUBLIC_SUPABASE_URL === "https://hnqajjjemqepxuoqbsqx.supabase.co"
      ? demo.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      : local.NEXT_PUBLIC_SUPABASE_URL ===
          "https://hnqajjjemqepxuoqbsqx.supabase.co"
        ? local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        : undefined;
  const tenantAKey =
    testdb.NEXT_PUBLIC_SUPABASE_URL ===
    "https://nycbbzgsilnxrgkwlwno.supabase.co"
      ? testdb.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      : undefined;
  if (!demoKey || !tenantAKey) {
    throw new Error(
      "Saved demo/testdb publishable keys were not found in the local profiles.",
    );
  }
  const linkedText = readTextIfExists(path.join(".vercel", "project.json"));
  const linked = linkedText
    ? (JSON.parse(linkedText) as { orgId?: string })
    : {};
  const teamId = process.env.VERCEL_TEAM_ID || linked.orgId;
  if (!teamId?.startsWith("team_")) {
    throw new Error(
      "Set VERCEL_TEAM_ID (team_…) for the arp-civic-pulse team.",
    );
  }
  const directory = bootstrapDirectory({
    demoPublishableKey: demoKey,
    tenantAPublishableKey: tenantAKey,
  });
  createPrivateFile(
    VERCEL_PROFILE,
    withValues("", {
      VERCEL_TEAM_ID: teamId,
      VERCEL_PROJECT_ID: VERCEL_PROJECT.id,
      TENANT_DIRECTORY_JSON: quotedDirectory(directory),
    }),
    alreadyExists,
  );
  return directory;
}

async function main(args: string[]) {
  const [command = "show"] = args;
  if (args.length > 1 || (command !== "show" && command !== "init")) {
    throw new Error("Usage: npm run vercel:directory -- [show|init]");
  }
  const directory =
    command === "init" ? initProfile() : readVercelProfile().directory;
  if (command === "init") console.log(`Wrote ${VERCEL_PROFILE}.`);
  for (const line of describeDirectory(directory)) console.log(line);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
