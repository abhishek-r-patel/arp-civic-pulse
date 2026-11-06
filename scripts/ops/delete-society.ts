import { rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { PROJECTS, currentTarget } from "./test-target.ts";
import { runSupabaseCli, societyProfileFile } from "./create-society.ts";
import {
  VERCEL_PROJECT,
  checkLiveHosts,
  deleteProjectEnv,
  readTextIfExists,
  readVercelProfile,
  redeployProduction,
  removeProjectDomain,
  saveDirectory,
  serviceKeyRef,
  upsertSensitiveEnv,
  vercelClient,
  withoutCustomerEntry,
} from "./vercel-directory.ts";

/*
 * Offboards one society created by society:create: removes its tenant
 * directory entry (then redeploys production and checks the host is unlisted),
 * its service-key variable and its domain from the shared Vercel project,
 * deletes its Supabase project, and finally removes the ignored
 * `.env.<alias>.local`. Every step is idempotent, so an interrupted run can be
 * repeated. The demo, testdb and platform hosts can never be targeted.
 * This is technical teardown only: export/retention/offboarding terms (S11)
 * are not automated, so an `active` tenant is refused unless
 * `--offboard-active` confirms its data has been handed over.
 * Usage:
 *   npm run society:delete -- <alias> --confirm-delete <civic-pulse-alias> \
 *     [--offboard-active]
 */

const PROJECT_PREFIX = "civic-pulse-";
const ALIAS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REF = /^[a-z0-9]{20}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROTECTED_TENANTS = new Set([
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
]);

export interface DeleteOptions {
  alias: string;
  projectName: string;
  offboardActive: boolean;
}

export function parseDeleteOptions(args: readonly string[]): DeleteOptions {
  const [alias, ...rest] = args;
  if (!alias || alias.length > 50 || !ALIAS.test(alias)) {
    throw new Error(
      "Pass the society alias used with society:create (for example premier-inspira-maplewood).",
    );
  }
  const projectName = `${PROJECT_PREFIX}${alias}`;
  let confirm: string | undefined;
  let offboardActive = false;
  for (let index = 0; index < rest.length; index += 1) {
    const name = rest[index];
    if (name === "--offboard-active" && !offboardActive) {
      offboardActive = true;
    } else if (name === "--confirm-delete" && confirm === undefined) {
      confirm = rest[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unexpected society:delete argument ${name ?? ""}.`);
    }
  }
  if (confirm !== projectName) {
    throw new Error(
      `Pass --confirm-delete ${projectName} to confirm deleting this society's project and hosting.`,
    );
  }
  return { alias, projectName, offboardActive };
}

export interface SocietyIdentity {
  ref: string;
  tenantId: string;
  host: string;
  projectUrl: string;
}

/** Reads the saved profile and refuses anything that is not this society's own project. */
export function societyIdentity(
  env: Readonly<Record<string, string | undefined>>,
  options: DeleteOptions,
): SocietyIdentity {
  const ref = env.SUPABASE_PROJECT_REF ?? "";
  const tenantId = env.SOCIETY_TENANT_ID?.toLowerCase() ?? "";
  const host = env.SOCIETY_HOST?.toLowerCase() ?? "";
  if (
    env.SOCIETY_NAME_ALIAS !== options.alias ||
    env.SOCIETY_PROJECT_NAME !== options.projectName ||
    !REF.test(ref) ||
    !UUID.test(tenantId) ||
    !host
  ) {
    throw new Error(
      "The saved society profile does not identify this alias's project, tenant and host; refusing to delete.",
    );
  }
  if (ref === PROJECTS.demo || ref === PROJECTS.testdb) {
    throw new Error("The demo and testdb projects can never be deleted here.");
  }
  if (PROTECTED_TENANTS.has(tenantId)) {
    throw new Error("The demo and tenant-a tenants can never be deleted here.");
  }
  const platformHosts = [
    VERCEL_PROJECT.productionHost,
    ...["www", "site", "demo", "staging", "beta", "tenant-a", "tenant-b"].map(
      (label) => `${label}.${VERCEL_PROJECT.productionHost}`,
    ),
  ];
  if (platformHosts.includes(host)) {
    throw new Error(
      `${host} is a platform host and can never be removed here.`,
    );
  }
  return { ref, tenantId, host, projectUrl: `https://${ref}.supabase.co` };
}

interface HostedProject {
  id: string;
  name: string;
  status: string;
}

async function supabase(
  method: string,
  pathName: string,
  token: string,
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`https://api.supabase.com/v1${pathName}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { status: response.status, data };
}

async function lookupProject(ref: string, token: string) {
  const result = await supabase("GET", `/projects/${ref}`, token);
  if (result.status === 404) return undefined;
  if (result.status !== 200) {
    throw new Error(
      `Supabase Management API returned HTTP ${result.status} for project ${ref}.`,
    );
  }
  return result.data as HostedProject;
}

async function deleteProject(ref: string, token: string) {
  const result = await supabase("DELETE", `/projects/${ref}`, token);
  if (result.status !== 200 && result.status !== 404) {
    throw new Error(
      `Supabase could not delete project ${ref} (HTTP ${result.status}).`,
    );
  }
  const deadline = Date.now() + 10 * 60_000;
  let previous = "";
  while (Date.now() <= deadline) {
    const project = await lookupProject(ref, token);
    if (!project || project.status === "REMOVED") return;
    if (project.status !== previous) {
      console.log(`  ${ref}: ${project.status}`);
      previous = project.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(
    `Project ${ref} is still being deleted; rerun the same command to finish.`,
  );
}

async function main(args: string[]): Promise<number> {
  const options = parseDeleteOptions(args);
  const localText = readTextIfExists(".env.local") ?? "";
  const local = parseEnv(localText);
  const token =
    process.env.SUPABASE_ACCESS_TOKEN || local.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SUPABASE_ACCESS_TOKEN is not set (.env.local or shell).");
  }
  const profilePath = societyProfileFile(options.alias);
  const profileText = readTextIfExists(profilePath);
  if (profileText === undefined) {
    throw new Error(
      `${profilePath} is missing; without it the project cannot be identified safely. Remove leftovers manually (see docs/OPERATIONS.md).`,
    );
  }
  const society = societyIdentity(parseEnv(profileText), options);

  const project = await lookupProject(society.ref, token);
  if (project && project.name !== options.projectName) {
    throw new Error(
      `Supabase project ${society.ref} is named ${project.name}, not ${options.projectName}; refusing to delete it.`,
    );
  }

  const vercelProfile = readVercelProfile();
  const existing = vercelProfile.directory.entries.find(
    (entry) => entry.host === society.host,
  );
  const directory = withoutCustomerEntry(
    vercelProfile.directory,
    society.host,
    society.tenantId,
    society.projectUrl,
  );
  if (existing?.state === "active" && !options.offboardActive) {
    throw new Error(
      `${society.host} is active. Export and hand over its data under the agreed offboarding terms first, then rerun with --offboard-active.`,
    );
  }
  const vercel = await vercelClient(vercelProfile.teamId);

  if (existing) {
    await upsertSensitiveEnv(
      vercel,
      "TENANT_DIRECTORY_JSON",
      JSON.stringify(directory),
    );
    console.log(
      `Pushed the directory without ${society.host}; redeploying production...`,
    );
    const deployment = await redeployProduction(vercel);
    // Saved only once production no longer routes the host, so a rerun redeploys.
    saveDirectory(directory);
    await checkLiveHosts(directory, society.host, deployment.previous, true);
    console.log(
      `Production now serves ${deployment.next}; ${society.host} is unlisted.`,
    );
  } else {
    console.log(`${society.host} is not in the tenant directory.`);
  }

  const key = serviceKeyRef(society.tenantId);
  console.log(
    (await deleteProjectEnv(vercel, key)) === "deleted"
      ? `Deleted Vercel variable ${key}.`
      : `Vercel variable ${key} was already absent.`,
  );
  console.log(
    (await removeProjectDomain(vercel, society.host)) === "removed"
      ? `Detached ${society.host} from the Vercel project.`
      : `${society.host} was already detached.`,
  );

  if (project) {
    console.log(`Deleting Supabase project ${options.projectName}...`);
    await deleteProject(society.ref, token);
    console.log(`Deleted Supabase project ${society.ref}.`);
  } else {
    console.log(`Supabase project ${society.ref} was already deleted.`);
  }

  // society:create links the CLI to the new project; point it back at the test target.
  if (readTextIfExists("supabase/.temp/project-ref")?.trim() === society.ref) {
    const target = currentTarget(localText) ?? "demo";
    const relinked = runSupabaseCli(
      ["link", "--project-ref", PROJECTS[target], "--yes"],
      token,
    );
    console.log(
      !relinked.error && relinked.status === 0
        ? `Relinked the Supabase CLI to ${target} (${PROJECTS[target]}).`
        : `The Supabase CLI is still linked to the deleted project; run npx supabase@2 link --project-ref ${PROJECTS[target]}.`,
    );
  }

  rmSync(profilePath, { force: true });
  console.log(
    `Removed ${profilePath}. ${options.projectName} is fully offboarded.`,
  );
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
