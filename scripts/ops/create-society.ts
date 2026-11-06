import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { PROJECTS, fetchProjectKeys, withValues } from "./test-target.ts";
import { provisionCustomer, provisionPlan } from "./provision.ts";
import type { ProjectTarget } from "./supabase-project.ts";
import {
  assertCanAddCustomer,
  checkLiveHosts,
  ensureProjectDomain,
  readVercelProfile,
  redeployProduction,
  saveDirectory,
  upsertSensitiveEnv,
  vercelClient,
  withCustomerEntry,
} from "./vercel-directory.ts";

/*
 * Creates and prepares one dedicated RWA project in the free-tier slot left
 * open by testdb:pause. Project and connection secrets are written only to
 * the ignored `.env.<alias>.local`; the demo and testdb profiles are untouched.
 * The RWA host is attached to the shared Vercel project before any Supabase
 * project is created; after provisioning, the tenant's service key and a
 * `provisioning` directory entry are pushed and production is redeployed.
 * Usage:
 *   npm run society:create -- <alias> --confirm-create <civic-pulse-alias> \
 *     --rwa-name <name> (--subdomain <label> | --host <host>) \
 *     --admin-name <name> --admin-email <email>
 * `--subdomain maplewood` expands to maplewood.arp-civic-pulse.vercel.app;
 * `--host` takes a full custom hostname instead.
 */

export const SOCIETY_REGION = "ap-south-1";
export const SOCIETY_BASE_DOMAIN = "arp-civic-pulse.vercel.app";
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
// Labels already used by the platform's own deployments.
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "site",
  "demo",
  "staging",
  "beta",
  "tenant-a",
  "tenant-b",
]);
const PROJECT_PREFIX = "civic-pulse-";
const ALIAS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REF = /^[a-z0-9]{20}$/u;
const HEALTHY = "ACTIVE_HEALTHY";

export interface SocietyOptions {
  alias: string;
  projectName: string;
  confirmCreate: string;
  rwaName: string;
  host: string;
  adminName: string;
  adminEmail: string;
  tenantId?: string;
  timezone: string;
}

interface HostedProject {
  id: string;
  ref?: string;
  name: string;
  status: string;
  region: string;
  organization_slug?: string;
}

function option(args: readonly string[], name: string) {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
}

export function parseSocietyOptions(args: readonly string[]): SocietyOptions {
  const [alias, ...rest] = args;
  if (!alias || alias.length > 50 || !ALIAS.test(alias)) {
    throw new Error(
      "Pass a lowercase society alias using letters, numbers and single hyphens (for example premier-inspira-maplewood).",
    );
  }
  const allowed = new Set([
    "--confirm-create",
    "--rwa-name",
    "--host",
    "--subdomain",
    "--admin-name",
    "--admin-email",
    "--tenant-id",
    "--timezone",
  ]);
  const seen = new Set<string>();
  for (let index = 0; index < rest.length; index += 1) {
    const name = rest[index];
    if (!name?.startsWith("--") || !allowed.has(name)) {
      throw new Error(`Unknown society:create argument ${name ?? ""}.`);
    }
    if (seen.has(name)) throw new Error(`${name} may be provided only once.`);
    seen.add(name);
    if (index + 1 >= rest.length || rest[index + 1]?.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    index += 1;
  }
  const projectName = `${PROJECT_PREFIX}${alias}`;
  const confirmCreate = option(rest, "confirm-create") ?? "";
  if (confirmCreate !== projectName) {
    throw new Error(
      `Pass --confirm-create ${projectName} to confirm this hosted project creation.`,
    );
  }
  const rwaName = option(rest, "rwa-name")?.trim() ?? "";
  const adminName = option(rest, "admin-name")?.trim() ?? "";
  const adminEmail = option(rest, "admin-email")?.trim() ?? "";
  const tenantId = option(rest, "tenant-id")?.trim().toLowerCase();
  const timezone = option(rest, "timezone")?.trim() || "Asia/Kolkata";
  if (rwaName.length < 2)
    throw new Error("Pass --rwa-name <association name>.");
  const host = societyHost(
    option(rest, "host")?.trim().toLowerCase(),
    option(rest, "subdomain")?.trim().toLowerCase(),
  );
  if (adminName.length < 2)
    throw new Error("Pass --admin-name <administrator name>.");
  if (!adminEmail) throw new Error("Pass --admin-email <administrator email>.");
  if (tenantId && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/u.test(tenantId)) {
    throw new Error("--tenant-id must be a UUID.");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new Error("--timezone is not a valid IANA time zone.");
  }
  return {
    alias,
    projectName,
    confirmCreate,
    rwaName,
    host,
    adminName,
    adminEmail,
    tenantId,
    timezone,
  };
}

export function societyHost(host?: string, subdomain?: string) {
  if (host && subdomain) {
    throw new Error("Pass either --subdomain or --host, not both.");
  }
  if (subdomain !== undefined) {
    if (!SUBDOMAIN.test(subdomain)) {
      throw new Error(
        "--subdomain must be a single DNS label such as maplewood (no dots or https://).",
      );
    }
    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      throw new Error(`--subdomain ${subdomain} is reserved by the platform.`);
    }
    return `${subdomain}.${SOCIETY_BASE_DOMAIN}`;
  }
  if (!host) {
    throw new Error(
      `Pass --subdomain <label> (for <label>.${SOCIETY_BASE_DOMAIN}) or --host <full hostname>.`,
    );
  }
  return host;
}

export function societyProfileFile(alias: string) {
  if (!ALIAS.test(alias)) throw new Error("Society alias is invalid.");
  return `.env.${alias}.local`;
}

export function databaseUrlFor(
  ref: string,
  password: string,
  region = SOCIETY_REGION,
) {
  if (!REF.test(ref)) throw new Error("Supabase project reference is invalid.");
  if (!password) throw new Error("Database password is required.");
  if (region !== SOCIETY_REGION) {
    throw new Error(`Only the verified ${SOCIETY_REGION} region is supported.`);
  }
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:5432/postgres`;
}

export function projectCreateBody(
  organizationSlug: string,
  name: string,
  password: string,
) {
  if (!organizationSlug)
    throw new Error("Supabase organization slug is missing.");
  if (!password) throw new Error("Database password is required.");
  return {
    organization_slug: organizationSlug,
    db_pass: password,
    name,
    plan: "free",
    region_selection: { type: "specific", code: SOCIETY_REGION },
  };
}

export function assertFreeSlot(
  projects: readonly HostedProject[],
  existingRef?: string,
) {
  const demo = projects.find((project) => project.id === PROJECTS.demo);
  const testdb = projects.find((project) => project.id === PROJECTS.testdb);
  if (demo?.status !== HEALTHY) {
    throw new Error(
      "The demo project must be ACTIVE_HEALTHY before creating a society project.",
    );
  }
  if (testdb?.status !== "INACTIVE") {
    throw new Error(
      "The testdb project must be INACTIVE before creating a society project.",
    );
  }
  const unexpected = projects.filter(
    (project) =>
      project.status !== "INACTIVE" &&
      project.id !== PROJECTS.demo &&
      project.id !== existingRef,
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Another project is active (${unexpected.map((project) => project.name).join(", ")}); pause it before creating this society project.`,
    );
  }
}

function verifyProjectProfile(
  env: Readonly<Record<string, string | undefined>>,
  alias: string,
  projectName: string,
) {
  if (
    env.SOCIETY_NAME_ALIAS !== alias ||
    env.SOCIETY_PROJECT_NAME !== projectName ||
    env.SOCIETY_REGION !== SOCIETY_REGION ||
    !env.SUPABASE_PROJECT_REF ||
    !REF.test(env.SUPABASE_PROJECT_REF)
  ) {
    throw new Error(
      "The saved society profile does not match this alias/project; refusing to overwrite it.",
    );
  }
  const ref = env.SUPABASE_PROJECT_REF;
  const url = `https://${ref}.supabase.co`;
  const databaseUrl = env.LIVE_DATABASE_URL ?? "";
  const parsedDatabaseUrl = URL.canParse(databaseUrl)
    ? new URL(databaseUrl)
    : undefined;
  if (
    env.NEXT_PUBLIC_SUPABASE_URL !== url ||
    env.PROVISION_SUPABASE_URL !== url ||
    env.PROVISION_PROJECT_REF !== ref ||
    env.PROVISION_DATABASE_URL !== databaseUrl ||
    !env.SOCIETY_HOST ||
    !env.SOCIETY_RWA_NAME ||
    !env.SOCIETY_ADMIN_NAME ||
    !env.SOCIETY_ADMIN_EMAIL ||
    !env.SOCIETY_TIMEZONE ||
    !env.SUPABASE_DB_PASSWORD ||
    !parsedDatabaseUrl ||
    parsedDatabaseUrl.hostname !==
      `aws-0-${SOCIETY_REGION}.pooler.supabase.com` ||
    parsedDatabaseUrl.port !== "5432" ||
    parsedDatabaseUrl.pathname !== "/postgres" ||
    decodeURIComponent(parsedDatabaseUrl.username) !== `postgres.${ref}` ||
    decodeURIComponent(parsedDatabaseUrl.password) !==
      env.SUPABASE_DB_PASSWORD ||
    !env.SOCIETY_TENANT_ID ||
    !env.RATE_LIMIT_HMAC_KEY
  ) {
    throw new Error(
      "The saved society profile is incomplete; fix it manually before retrying.",
    );
  }
  return { ref, url, password: env.SUPABASE_DB_PASSWORD };
}

function initialProfile(
  options: SocietyOptions,
  tenantId: string,
  ref: string,
  password: string,
) {
  const url = `https://${ref}.supabase.co`;
  const databaseUrl = databaseUrlFor(ref, password);
  return withValues("", {
    SOCIETY_NAME_ALIAS: options.alias,
    SOCIETY_PROJECT_NAME: options.projectName,
    SOCIETY_REGION: SOCIETY_REGION,
    SOCIETY_TENANT_ID: tenantId,
    SOCIETY_HOST: options.host,
    SOCIETY_RWA_NAME: options.rwaName,
    SOCIETY_ADMIN_NAME: options.adminName,
    SOCIETY_ADMIN_EMAIL: options.adminEmail,
    SOCIETY_TIMEZONE: options.timezone,
    APP_ORIGIN: `https://${options.host}`,
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    SUPABASE_PROJECT_REF: ref,
    SUPABASE_DB_PASSWORD: password,
    LIVE_DATABASE_URL: databaseUrl,
    RATE_LIMIT_HMAC_KEY: randomBytes(32).toString("hex"),
    PROVISION_PROJECT_REF: ref,
    PROVISION_SUPABASE_URL: url,
    PROVISION_SERVICE_ROLE_KEY: "",
    PROVISION_DATABASE_URL: databaseUrl,
    PROVISION_PUBLISHABLE_KEY: "",
    PROVISION_ADMIN_EMAIL: options.adminEmail,
  });
}

async function api<T>(
  pathName: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`https://api.supabase.com/v1${pathName}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `Supabase Management API returned HTTP ${response.status} for ${init?.method ?? "GET"} ${pathName}.`,
    );
  }
  return (await response.json()) as T;
}

async function waitUntilHealthy(ref: string, token: string) {
  const deadline = Date.now() + 15 * 60_000;
  let previous = "";
  while (Date.now() <= deadline) {
    const project = await api<HostedProject>(`/projects/${ref}`, token);
    if (project.status !== previous) {
      console.log(`  ${ref}: ${project.status}`);
      previous = project.status;
    }
    if (project.status === HEALTHY) return project;
    if (
      project.status === "INACTIVE" ||
      project.status.endsWith("_FAILED") ||
      project.status === "DELETED"
    ) {
      throw new Error(
        `Project creation reached ${project.status}; check Supabase.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(
    `Project ${ref} is not healthy yet; rerun the same command to continue.`,
  );
}

async function restoreExistingProject(ref: string, token: string) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/restore`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Supabase could not resume the saved society project (HTTP ${response.status}).`,
    );
  }
}

function runSupabaseCli(args: string[], token: string, password?: string) {
  const npmCli = process.env.npm_execpath;
  const npxCli = npmCli ? path.join(path.dirname(npmCli), "npx-cli.js") : "";
  if (!npxCli || !existsSync(npxCli)) {
    throw new Error(
      "Run this command through npm so the Supabase CLI is available.",
    );
  }
  return spawnSync(process.execPath, [npxCli, "supabase", ...args], {
    stdio: args[0] === "link" ? "inherit" : "ignore",
    timeout: 180_000,
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: token,
      ...(password ? { SUPABASE_DB_PASSWORD: password } : {}),
    },
  });
}

function ensureCliAvailable(token: string) {
  const result = runSupabaseCli(["projects", "list"], token);
  if (result.error || result.status !== 0) {
    throw new Error(
      "The Supabase CLI cannot reach the Management API. No new project was created; fix CLI access and retry.",
    );
  }
}

function linkWithCli(ref: string, token: string, password: string) {
  const result = runSupabaseCli(
    ["link", "--project-ref", ref, "--yes"],
    token,
    password,
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      "The project and ignored env profile are saved, but `supabase link` failed. Fix CLI access and rerun the same command; it will reuse the created project.",
    );
  }
}

function provisionForSociety(
  env: Readonly<Record<string, string | undefined>>,
  options: SocietyOptions,
  tenantId: string,
  target: ProjectTarget,
  token: string,
) {
  const provisionEnv = {
    ...env,
    PROVISION_PROJECT_REF: target.projectRef,
    PROVISION_SUPABASE_URL: target.supabaseUrl,
    PROVISION_SERVICE_ROLE_KEY: target.serviceRoleKey,
    PROVISION_DATABASE_URL: target.databaseUrl,
    PROVISION_PUBLISHABLE_KEY: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    PROVISION_ADMIN_EMAIL: options.adminEmail,
  };
  const { target: checked, request } = provisionPlan(provisionEnv, {
    confirm: target.projectRef,
    "tenant-id": tenantId,
    host: options.host,
    "rwa-name": options.rwaName,
    "admin-name": options.adminName,
    timezone: options.timezone,
  });
  return provisionCustomer(checked, request, {
    applyMigrations: true,
    activate: false,
    accessToken: token,
    repoRoot: process.cwd(),
  });
}

async function main(args: string[]): Promise<number> {
  const options = parseSocietyOptions(args);
  const localText = existsSync(".env.local")
    ? readFileSync(".env.local", "utf8")
    : "";
  const local = parseEnv(localText);
  const token =
    process.env.SUPABASE_ACCESS_TOKEN || local.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SUPABASE_ACCESS_TOKEN is not set (.env.local or shell).");
  }
  ensureCliAvailable(token);
  const vercelProfile = readVercelProfile();
  const vercel = await vercelClient(vercelProfile.teamId);

  const profilePath = societyProfileFile(options.alias);
  const hasProfile = existsSync(profilePath);
  const profileText = hasProfile ? readFileSync(profilePath, "utf8") : "";
  const profileEnv = parseEnv(profileText);
  const savedTenantId = profileEnv.SOCIETY_TENANT_ID;
  const tenantId = options.tenantId ?? savedTenantId ?? randomUUID();
  if (savedTenantId && savedTenantId !== tenantId) {
    throw new Error(
      "The saved profile has a different tenant ID; reuse it with --tenant-id.",
    );
  }
  assertCanAddCustomer(
    vercelProfile.directory,
    options.host,
    tenantId,
    profileEnv.SUPABASE_PROJECT_REF
      ? `https://${profileEnv.SUPABASE_PROJECT_REF}.supabase.co`
      : undefined,
  );
  const directoryJson = JSON.stringify(vercelProfile.directory);

  // A retry validates against the saved project, which the directory may already list.
  const validationRef =
    profileEnv.SUPABASE_PROJECT_REF && REF.test(profileEnv.SUPABASE_PROJECT_REF)
      ? profileEnv.SUPABASE_PROJECT_REF
      : "aaaaaaaaaaaaaaaaaaaa";
  provisionPlan(
    {
      ...local,
      TENANT_DIRECTORY_JSON: directoryJson,
      PROVISION_PROJECT_REF: validationRef,
      PROVISION_SUPABASE_URL: `https://${validationRef}.supabase.co`,
      PROVISION_SERVICE_ROLE_KEY: "validation-only",
      PROVISION_DATABASE_URL: `postgresql://postgres.${validationRef}:validation@aws-0-${SOCIETY_REGION}.pooler.supabase.com:5432/postgres`,
      PROVISION_PUBLISHABLE_KEY: "sb_publishable_validation",
      PROVISION_ADMIN_EMAIL: options.adminEmail,
    },
    {
      confirm: validationRef,
      "tenant-id": tenantId,
      host: options.host,
      "rwa-name": options.rwaName,
      "admin-name": options.adminName,
      timezone: options.timezone,
    },
  );

  const projects = await api<HostedProject[]>("/projects", token);
  assertFreeSlot(
    projects,
    hasProfile ? profileEnv.SUPABASE_PROJECT_REF : undefined,
  );
  const domain = await ensureProjectDomain(vercel, options.host);
  console.log(
    domain === "added"
      ? `Attached ${options.host} to the Vercel project.`
      : `${options.host} is already attached to the Vercel project.`,
  );

  let ref: string;
  let password: string;
  if (hasProfile) {
    const saved = verifyProjectProfile(
      profileEnv,
      options.alias,
      options.projectName,
    );
    ref = saved.ref;
    password = saved.password;
    for (const [key, supplied, stored] of [
      ["host", options.host, profileEnv.SOCIETY_HOST],
      ["RWA name", options.rwaName, profileEnv.SOCIETY_RWA_NAME],
      ["administrator name", options.adminName, profileEnv.SOCIETY_ADMIN_NAME],
      [
        "administrator email",
        options.adminEmail,
        profileEnv.SOCIETY_ADMIN_EMAIL,
      ],
      ["timezone", options.timezone, profileEnv.SOCIETY_TIMEZONE],
    ]) {
      if (stored && supplied !== stored) {
        throw new Error(
          `The supplied ${key} differs from the saved profile; refusing to reuse it.`,
        );
      }
    }
    const existing = projects.find((project) => project.id === ref);
    if (
      !existing ||
      existing.name !== options.projectName ||
      existing.region !== SOCIETY_REGION
    ) {
      throw new Error(
        "The saved profile project is missing or does not match the requested project.",
      );
    }
  } else {
    if (projects.some((project) => project.name === options.projectName)) {
      throw new Error(
        `A project named ${options.projectName} already exists without its ignored profile; inspect it in Supabase before continuing.`,
      );
    }
    const demo = await api<HostedProject>(`/projects/${PROJECTS.demo}`, token);
    if (!demo.organization_slug) {
      throw new Error(
        "Supabase did not return the demo project's organization slug; refusing to create a project.",
      );
    }
    const passwordCandidate = randomBytes(32).toString("base64url");
    const created = await api<HostedProject>("/projects", token, {
      method: "POST",
      body: JSON.stringify(
        projectCreateBody(
          demo.organization_slug,
          options.projectName,
          passwordCandidate,
        ),
      ),
    });
    ref = created.id ?? created.ref ?? "";
    if (!REF.test(ref)) {
      throw new Error(
        "Supabase accepted project creation but returned no valid project ref; find the project in Supabase before retrying.",
      );
    }
    password = passwordCandidate;
    writeFileSync(
      profilePath,
      initialProfile(options, tenantId, ref, password),
      { mode: 0o600 },
    );
    console.log(
      `Created ${options.projectName}; saved its credentials in ${profilePath}.`,
    );
  }

  if (
    hasProfile &&
    projects.find((project) => project.id === ref)?.status === "INACTIVE"
  ) {
    console.log(`Resuming saved project ${ref}...`);
    await restoreExistingProject(ref, token);
  }
  const project = await waitUntilHealthy(ref, token);
  if (
    project.name !== options.projectName ||
    project.region !== SOCIETY_REGION
  ) {
    throw new Error(
      "Supabase project metadata does not match the saved name/region; refusing to provision.",
    );
  }

  const existingEnv = parseEnv(readFileSync(profilePath, "utf8"));
  const keys = await fetchProjectKeys(
    ref,
    token,
    existingEnv.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_preferred",
  );
  const databaseUrl = databaseUrlFor(ref, password);
  const profileValues = {
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: keys.publishable,
    SUPABASE_SERVICE_ROLE_KEY: keys.serviceRole,
    SUPABASE_PROJECT_REF: ref,
    LIVE_DATABASE_URL: databaseUrl,
    PROVISION_PROJECT_REF: ref,
    PROVISION_SUPABASE_URL: `https://${ref}.supabase.co`,
    PROVISION_SERVICE_ROLE_KEY: keys.serviceRole,
    PROVISION_DATABASE_URL: databaseUrl,
    PROVISION_PUBLISHABLE_KEY: keys.publishable,
  };
  const refreshedProfile = withValues(
    readFileSync(profilePath, "utf8"),
    profileValues,
  );
  writeFileSync(profilePath, refreshedProfile, { mode: 0o600 });

  const env = {
    ...parseEnv(refreshedProfile),
    DEMO_PROJECT_REF: PROJECTS.demo,
    TENANT_DIRECTORY_JSON: directoryJson,
  };
  const target: ProjectTarget = {
    projectRef: ref,
    supabaseUrl: `https://${ref}.supabase.co`,
    serviceRoleKey: keys.serviceRole,
    databaseUrl,
  };
  linkWithCli(ref, token, password);
  const report = await provisionForSociety(
    env,
    options,
    tenantId,
    target,
    token,
  );
  console.log(JSON.stringify(report, null, 2));

  // The service key goes first so the directory never names a missing variable.
  const directory = withCustomerEntry(
    readVercelProfile().directory,
    report.directoryEntry,
  );
  await upsertSensitiveEnv(
    vercel,
    report.directoryEntry.serviceRoleKeyRef,
    keys.serviceRole,
  );
  saveDirectory(directory);
  await upsertSensitiveEnv(
    vercel,
    "TENANT_DIRECTORY_JSON",
    JSON.stringify(directory),
  );
  console.log(
    "Pushed the tenant service key and directory to Vercel; redeploying production...",
  );
  const deployment = await redeployProduction(vercel);
  await checkLiveHosts(directory, options.host, deployment.previous);
  console.log(
    `Production now serves ${deployment.next}; ${options.host} is routed to this tenant (state ${directory.entries.find((entry) => entry.host === options.host)?.state}; a provisioning tenant answers 503 until activated).`,
  );

  if (!report.ready) {
    console.warn(
      "Provisioning has follow-up blockers; the tenant remains in provisioning state and is not activated.",
    );
  } else {
    console.log(
      "Provisioning steps completed. The tenant remains in provisioning state; follow the handover and approval gates before activation.",
    );
  }
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
