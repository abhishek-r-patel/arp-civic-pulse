import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

/*
 * Moves local app, live and browser tests between the synthetic demo and the
 * testdb Supabase project (civic-pulse-testdb) (docs/OPERATIONS.md, "Switching the
 * test target"). Free-tier accounts get two active projects: demo always keeps
 * one, so testdb must be paused before another project uses the second slot.
 *   npm run test:target              show both projects and the current target
 *   npm run testdb:pause            point tests at demo, then pause testdb
 *   npm run testdb:resume           resume testdb, then point tests at it
 *   npm run test:target -- demo|testdb   switch only, no pause/resume
 * Only the synthetic demo and the testdb project are accepted; a
 * real RWA project is refused. Credentials move between ignored env files and
 * are never printed.
 */

export const PROJECTS = {
  demo: "arxkuxlbynjbqcjuugde",
  testdb: "nycbbzgsilnxrgkwlwno",
} as const;
export type Target = keyof typeof PROJECTS;

export const PROFILE_FILES: Record<Target, string> = {
  demo: ".env.demo-test.local",
  testdb: ".env.testdb.local",
};

const PAIRED_KEYS = [
  "TENANT_TEST_SUPABASE_URL",
  "TENANT_TEST_SUPABASE_PUBLISHABLE_KEY",
  "TENANT_TEST_SUPABASE_SERVICE_ROLE_KEY",
  "TENANT_TEST_DATABASE_URL",
];
export const TARGET_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_PASSWORD",
  "LIVE_DATABASE_URL",
  ...PAIRED_KEYS,
];

const HEALTHY = "ACTIVE_HEALTHY";
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u;
type Raw = Record<string, string>;
interface ProjectApiKey {
  api_key: string;
  name: string;
  type: string;
}

function isProjectApiKey(value: unknown): value is ProjectApiKey {
  return (
    typeof value === "object" &&
    value !== null &&
    "api_key" in value &&
    typeof value.api_key === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "type" in value &&
    typeof value.type === "string"
  );
}

export interface ProjectKeys {
  publishable: string;
  serviceRole: string;
}

/** Right-hand sides of the switchable keys, quoting preserved. */
export function rawValues(text: string): Raw {
  const values: Raw = {};
  for (const line of text.split(/\r?\n/u)) {
    const [, key = "", value = ""] = LINE.exec(line) ?? [];
    if (TARGET_KEYS.includes(key)) values[key] = value;
  }
  return values;
}

const decode = (raw: string | undefined) =>
  raw === undefined ? "" : (parseEnv(`V=${raw}`).V ?? "").trim();

/** Replaces every `KEY=` line in place, keeping comments; appends new keys. */
export function withValues(text: string, values: Raw): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const missing = new Set(Object.keys(values));
  const lines = text.split(/\r?\n/u).map((line) => {
    const [, key = ""] = LINE.exec(line) ?? [];
    if (!(key in values)) return line;
    missing.delete(key);
    return `${key}=${values[key]}`;
  });
  if (missing.size > 0) {
    while (lines.at(-1) === "") lines.pop();
    for (const key of missing) lines.push(`${key}=${values[key]}`);
    lines.push("");
  }
  return lines.join(eol);
}

const hostOf = (url: string) =>
  URL.canParse(url) ? new URL(url).hostname : "";

// Direct (db.<ref>.supabase.co) or pooler (user postgres.<ref>) connections.
function databaseIs(url: string, ref: string) {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return (
    parsed.hostname === `db.${ref}.supabase.co` ||
    decodeURIComponent(parsed.username) === `postgres.${ref}`
  );
}

/** Errors name files and variables only, never values. */
export function profileErrors(target: Target, raw: Raw): string[] {
  const file = PROFILE_FILES[target];
  const ref = PROJECTS[target];
  const value = (key: string) => decode(raw[key]);
  const errors: string[] = [];
  if (value("SUPABASE_PROJECT_REF") !== ref) {
    errors.push(`${file} SUPABASE_PROJECT_REF is not ${ref}.`);
  }
  if (hostOf(value("NEXT_PUBLIC_SUPABASE_URL")) !== `${ref}.supabase.co`) {
    errors.push(`${file} NEXT_PUBLIC_SUPABASE_URL is not the ${ref} project.`);
  }
  if (!databaseIs(value("LIVE_DATABASE_URL"), ref)) {
    errors.push(`${file} LIVE_DATABASE_URL is not the ${ref} project.`);
  }
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    if (!value(key)) errors.push(`${file} ${key} is not set.`);
  }
  // The paired test needs two different projects: testdb as A, demo as B.
  if (PAIRED_KEYS.some((key) => value(key))) {
    const demo = PROJECTS.demo;
    if (
      target !== "testdb" ||
      hostOf(value("TENANT_TEST_SUPABASE_URL")) !== `${demo}.supabase.co` ||
      !databaseIs(value("TENANT_TEST_DATABASE_URL"), demo)
    ) {
      errors.push(
        `${file} TENANT_TEST_* must be empty or, for testdb only, the demo project ${demo}.`,
      );
    }
  }
  return errors;
}

export function projectKeysFromResponse(
  keys: readonly ProjectApiKey[],
  existingServiceRoleKey?: string,
): ProjectKeys {
  if (keys.length === 0) {
    throw new Error(
      "Supabase returned no API keys; ensure the project is active before refreshing its credentials.",
    );
  }
  const publishable = keys.find((key) => key.type === "publishable");
  const serviceRole = existingServiceRoleKey?.startsWith("sb_secret_")
    ? keys.find((key) => key.type === "secret")
    : keys.find((key) => key.type === "legacy" && key.name === "service_role");
  if (!publishable?.api_key || !serviceRole?.api_key) {
    throw new Error(
      "Supabase API-key response is missing the publishable key or the saved service-key format.",
    );
  }
  return {
    publishable: publishable.api_key,
    serviceRole: serviceRole.api_key,
  };
}

export async function fetchProjectKeys(
  ref: string,
  token: string,
  existingServiceRoleKey?: string,
  fetcher: typeof fetch = fetch,
): Promise<ProjectKeys> {
  if (!/^[a-z0-9]{20}$/u.test(ref)) {
    throw new Error("Supabase project reference is invalid.");
  }
  const response = await fetcher(
    `https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Could not refresh API keys for ${ref} (HTTP ${response.status}). Check the Management API token permissions.`,
    );
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body) || !body.every(isProjectApiKey)) {
    throw new Error("Supabase API-key response has an unexpected format.");
  }
  return projectKeysFromResponse(body, existingServiceRoleKey);
}

function refreshedProfile(
  text: string,
  ref: string,
  keys: ProjectKeys,
  options: {
    publishableKey: string;
    serviceRoleKey: string;
    projectRefKey: string;
    urlKey: string;
  },
): string {
  const existing = rawValues(text);
  if (decode(existing[options.projectRefKey]) !== ref) {
    throw new Error(
      `${options.projectRefKey} does not match ${ref}; refusing to refresh another project's profile.`,
    );
  }
  if (hostOf(decode(existing[options.urlKey])) !== `${ref}.supabase.co`) {
    throw new Error(
      `${options.urlKey} does not match ${ref}; refusing to refresh another project's profile.`,
    );
  }
  if (!decode(existing.SUPABASE_DB_PASSWORD)) {
    throw new Error(
      `${options.projectRefKey} profile has no saved database password.`,
    );
  }
  const databaseUrl = decode(existing.LIVE_DATABASE_URL);
  const parsedDatabaseUrl = URL.canParse(databaseUrl)
    ? new URL(databaseUrl)
    : undefined;
  if (
    !databaseIs(databaseUrl, ref) ||
    !parsedDatabaseUrl?.password ||
    decodeURIComponent(parsedDatabaseUrl.password) !==
      decode(existing.SUPABASE_DB_PASSWORD)
  ) {
    throw new Error(
      `${options.projectRefKey} profile LIVE_DATABASE_URL does not match ${ref} or its saved database password; refusing to write credentials.`,
    );
  }
  return withValues(text, {
    [options.urlKey]: `https://${ref}.supabase.co`,
    [options.publishableKey]: keys.publishable,
    [options.serviceRoleKey]: keys.serviceRole,
    [options.projectRefKey]: ref,
  });
}

export function refreshTestProfile(
  text: string,
  ref: string,
  keys: ProjectKeys,
): string {
  return refreshedProfile(text, ref, keys, {
    publishableKey: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    serviceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
    projectRefKey: "SUPABASE_PROJECT_REF",
    urlKey: "NEXT_PUBLIC_SUPABASE_URL",
  });
}

export function refreshDemoOpsProfile(text: string, keys: ProjectKeys): string {
  const values = parseEnv(text);
  if (values.DEMO_PROJECT_REF !== PROJECTS.demo) {
    throw new Error(
      ".env.demo.local DEMO_PROJECT_REF is not the approved demo project.",
    );
  }
  if (
    hostOf(values.DEMO_SUPABASE_URL ?? "") !== `${PROJECTS.demo}.supabase.co`
  ) {
    throw new Error(
      ".env.demo.local DEMO_SUPABASE_URL is not the approved demo project.",
    );
  }
  if (!databaseIs(values.DEMO_DATABASE_URL ?? "", PROJECTS.demo)) {
    throw new Error(
      ".env.demo.local DEMO_DATABASE_URL is not the approved demo project.",
    );
  }
  return withValues(text, {
    DEMO_SUPABASE_URL: `https://${PROJECTS.demo}.supabase.co`,
    DEMO_SERVICE_ROLE_KEY: keys.serviceRole,
  });
}

export function refreshPairedDemoKeys(
  testdbText: string,
  demoText: string,
  keys: ProjectKeys,
): { testdbText: string; demoText: string } {
  const testdb = rawValues(testdbText);
  const demo = parseEnv(demoText);
  if (
    hostOf(decode(testdb.TENANT_TEST_SUPABASE_URL)) !==
      `${PROJECTS.demo}.supabase.co` ||
    !databaseIs(decode(testdb.TENANT_TEST_DATABASE_URL), PROJECTS.demo) ||
    !databaseIs(demo.DEMO_DATABASE_URL ?? "", PROJECTS.demo)
  ) {
    throw new Error(
      "The testdb profile's paired-test settings or .env.demo.local database URL do not match the approved demo project.",
    );
  }
  return {
    testdbText: withValues(testdbText, {
      TENANT_TEST_SUPABASE_URL: `https://${PROJECTS.demo}.supabase.co`,
      TENANT_TEST_SUPABASE_PUBLISHABLE_KEY: keys.publishable,
      TENANT_TEST_SUPABASE_SERVICE_ROLE_KEY: keys.serviceRole,
    }),
    demoText: refreshDemoOpsProfile(demoText, keys),
  };
}

export function currentTarget(localText: string): Target | undefined {
  const ref = decode(rawValues(localText).SUPABASE_PROJECT_REF);
  return (Object.keys(PROJECTS) as Target[]).find(
    (target) => PROJECTS[target] === ref,
  );
}

export interface SwitchPlan {
  from: Target;
  writes: { file: string; text: string }[];
  warnings: string[];
}

export function planSwitch(
  target: Target,
  files: Readonly<Record<string, string | undefined>>,
  statuses: Readonly<Record<Target, string>>,
): SwitchPlan {
  const local = files[".env.local"];
  if (local === undefined) throw new Error(".env.local does not exist.");
  const from = currentTarget(local);
  if (!from) {
    throw new Error(
      ".env.local SUPABASE_PROJECT_REF is neither the demo nor the testdb project; refusing to overwrite it.",
    );
  }
  if (statuses[target] !== HEALTHY) {
    throw new Error(
      `Supabase reports ${target} (${PROJECTS[target]}) as ${statuses[target]}; resume it in the dashboard and wait for ${HEALTHY} first.`,
    );
  }

  // Save the outgoing target first so switching back restores it. An empty
  // paired setting means it was disabled, not that the archive should lose it.
  const outgoing = rawValues(local);
  if (from === "testdb") {
    for (const key of PAIRED_KEYS) {
      if (!decode(outgoing[key])) delete outgoing[key];
    }
  }
  const outgoingFile = PROFILE_FILES[from];
  const savedText = withValues(
    files[outgoingFile] ??
      "# Saved by `npm run test:target`. Ignored by Git; never commit.\n",
    outgoing,
  );
  const writes = [{ file: outgoingFile, text: savedText }];

  const profileText =
    target === from ? savedText : files[PROFILE_FILES[target]];
  if (profileText === undefined) {
    throw new Error(
      `${PROFILE_FILES[target]} does not exist; it is created when you switch away from ${target}.`,
    );
  }
  const incoming: Raw = Object.fromEntries(TARGET_KEYS.map((key) => [key, ""]));
  Object.assign(incoming, rawValues(profileText));
  const errors = profileErrors(target, incoming);
  if (errors.length > 0) throw new Error(errors.join("\n"));

  const warnings: string[] = [];
  const paired = PAIRED_KEYS.some((key) => decode(incoming[key]));
  if (paired && statuses.demo !== HEALTHY) {
    for (const key of PAIRED_KEYS) incoming[key] = "";
    warnings.push(
      `Demo is ${statuses.demo}; the paired cross-project live test stays disabled.`,
    );
  }
  writes.push({ file: ".env.local", text: withValues(local, incoming) });

  const demoLocal = files[".env.demo.local"];
  if (demoLocal === undefined) {
    warnings.push(".env.demo.local does not exist; demo:reset is unavailable.");
  } else {
    writes.push({
      file: ".env.demo.local",
      text: withValues(demoLocal, {
        DEMO_SHARED_TEST_PROJECT: target === "demo" ? "true" : "false",
      }),
    });
  }
  return { from, writes, warnings };
}

async function projectStatus(ref: string, token: string): Promise<string> {
  try {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${ref}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) return `UNKNOWN (HTTP ${response.status})`;
    const body = (await response.json()) as { status?: string };
    return body.status ?? "UNKNOWN";
  } catch {
    return "UNKNOWN (network error)";
  }
}

const transient = (status: string) =>
  status.startsWith("UNKNOWN") ||
  ["COMING_UP", "RESTORING", "RESTARTING", "PAUSING", "GOING_DOWN"].includes(
    status,
  );

/** Next `testdb:pause` step for testdb's current status. */
export function pauseStep(status: string): "pause" | "wait" | "done" {
  if (status === "INACTIVE") return "done";
  if (status === HEALTHY || status === "ACTIVE_UNHEALTHY") return "pause";
  if (transient(status)) return "wait";
  throw new Error(
    `The testdb project is ${status}; check it in the Supabase dashboard.`,
  );
}

/** Next `testdb:resume` step for testdb's current status. */
export function resumeStep(status: string): "restore" | "wait" | "done" {
  if (status === HEALTHY) return "done";
  if (status === "INACTIVE") return "restore";
  if (transient(status) || status === "ACTIVE_UNHEALTHY") return "wait";
  throw new Error(
    `The testdb project is ${status}; check it in the Supabase dashboard.`,
  );
}

async function projectAction(
  ref: string,
  action: "pause" | "restore",
  token: string,
): Promise<void> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/${action}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.ok) return;
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
  };
  throw new Error(
    `Supabase refused to ${action} ${ref} (HTTP ${response.status}${body.message ? `: ${body.message}` : ""}).` +
      (action === "restore"
        ? " The free tier allows two active projects; pause the other non-demo project first."
        : ""),
  );
}

async function waitForStatus(
  ref: string,
  token: string,
  wanted: string,
  timeoutMs = 15 * 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    const status = await projectStatus(ref, token);
    if (status !== last) console.log(`  ${ref}: ${status}`);
    // A restore can report ACTIVE_HEALTHY once and then RESTORING again, so
    // the wanted status must hold on two consecutive polls.
    if (status === wanted && last === wanted) return;
    last = status;
    // Right after the request the old INACTIVE/ACTIVE status may still show.
    const waiting = ["INACTIVE", HEALTHY, "ACTIVE_UNHEALTHY"];
    if (!transient(status) && !waiting.includes(status)) {
      throw new Error(`${ref} reached ${status}; check the dashboard.`);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${ref} is still ${status}; rerun the same command to keep waiting.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

function readFiles() {
  const names = [
    ".env.local",
    ".env.demo.local",
    ...Object.values(PROFILE_FILES),
  ];
  return Object.fromEntries(
    names.map((name) => [
      name,
      existsSync(name) ? readFileSync(name, "utf8") : undefined,
    ]),
  );
}

async function readStatuses(token: string) {
  const statuses = {} as Record<Target, string>;
  for (const target of Object.keys(PROJECTS) as Target[]) {
    statuses[target] = await projectStatus(PROJECTS[target], token);
  }
  return statuses;
}

async function refreshTestdbCredentials(
  token: string,
  statuses: Record<Target, string>,
) {
  const files = readFiles();
  const testdbText = files[PROFILE_FILES.testdb];
  if (testdbText === undefined) {
    throw new Error(
      `${PROFILE_FILES.testdb} is missing; refusing to resume into an incomplete profile.`,
    );
  }
  const localText = files[".env.local"];
  const current = localText ? currentTarget(localText) : undefined;
  if (!localText || !current) {
    throw new Error(
      ".env.local must point at demo or testdb before refreshing credentials; refusing to overwrite another project's settings.",
    );
  }
  const testdbRaw = rawValues(testdbText);
  const testdbKeys = await fetchProjectKeys(
    PROJECTS.testdb,
    token,
    decode(testdbRaw.SUPABASE_SERVICE_ROLE_KEY),
  );
  let refreshedTestdb = refreshTestProfile(
    testdbText,
    PROJECTS.testdb,
    testdbKeys,
  );
  let refreshedLocal =
    current === "testdb"
      ? refreshTestProfile(localText, PROJECTS.testdb, testdbKeys)
      : localText;
  let refreshedDemo: string | undefined;
  let refreshedDemoTest: string | undefined;

  if (statuses.demo === HEALTHY) {
    const demoText = files[".env.demo.local"];
    if (demoText === undefined) {
      throw new Error(
        ".env.demo.local is missing; cannot refresh demo operations credentials.",
      );
    }
    const demoEnv = parseEnv(demoText);
    const demoKeys = await fetchProjectKeys(
      PROJECTS.demo,
      token,
      demoEnv.DEMO_SERVICE_ROLE_KEY,
    );
    refreshedDemo = refreshDemoOpsProfile(demoText, demoKeys);
    if (current === "demo") {
      refreshedLocal = refreshTestProfile(
        refreshedLocal,
        PROJECTS.demo,
        demoKeys,
      );
    }
    const demoTestText = files[PROFILE_FILES.demo];
    if (demoTestText !== undefined) {
      refreshedDemoTest = refreshTestProfile(
        demoTestText,
        PROJECTS.demo,
        demoKeys,
      );
    }
    if (PAIRED_KEYS.some((key) => decode(rawValues(refreshedTestdb)[key]))) {
      const paired = refreshPairedDemoKeys(refreshedTestdb, demoText, demoKeys);
      refreshedTestdb = paired.testdbText;
      refreshedDemo = paired.demoText;
      if (current === "testdb") {
        refreshedLocal = withValues(refreshedLocal, {
          TENANT_TEST_SUPABASE_URL: `https://${PROJECTS.demo}.supabase.co`,
          TENANT_TEST_SUPABASE_PUBLISHABLE_KEY: demoKeys.publishable,
          TENANT_TEST_SUPABASE_SERVICE_ROLE_KEY: demoKeys.serviceRole,
        });
      }
    }
  }

  writeFileSync(PROFILE_FILES.testdb, refreshedTestdb);
  if (refreshedDemo !== undefined)
    writeFileSync(".env.demo.local", refreshedDemo);
  if (refreshedDemoTest !== undefined)
    writeFileSync(PROFILE_FILES.demo, refreshedDemoTest);
  if (refreshedLocal !== localText) writeFileSync(".env.local", refreshedLocal);
}

function applySwitch(target: Target, statuses: Record<Target, string>) {
  const plan = planSwitch(target, readFiles(), statuses);
  for (const write of plan.writes) writeFileSync(write.file, write.text);
  for (const warning of plan.warnings) console.warn(`Warning: ${warning}`);
  console.log(
    `\nTest target: ${plan.from} -> ${target}. Saved ${PROFILE_FILES[plan.from]}; updated ${plan.writes
      .slice(1)
      .map((write) => write.file)
      .join(", ")}.`,
  );
}

function nextSteps(target: Target) {
  console.log("Next steps:");
  console.log(`  npx supabase link --project-ref ${PROJECTS[target]}`);
  console.log("  Restart any running `npm run dev` server.");
  console.log(
    target === "testdb"
      ? "  Check migrations before live tests (docs/OPERATIONS.md, migration-status)."
      : "  Run `npm run demo:reset` after browser or manual tests.",
  );
}

const COMMANDS = ["status", "demo", "testdb", "pause-testdb", "resume-testdb"];

async function main(): Promise<number> {
  const command = process.argv[2] ?? "status";
  if (!COMMANDS.includes(command)) {
    console.error(
      `Usage: node scripts/ops/test-target.ts [${COMMANDS.join(" | ")}]`,
    );
    return 2;
  }
  const local = readFiles()[".env.local"];
  const token =
    process.env.SUPABASE_ACCESS_TOKEN ||
    (local ? parseEnv(local).SUPABASE_ACCESS_TOKEN : undefined);
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is not set (.env.local or shell).");
    return 1;
  }
  const statuses = await readStatuses(token);
  const current = local ? currentTarget(local) : undefined;
  for (const target of Object.keys(PROJECTS) as Target[]) {
    const mark = target === current ? "  <- current test target" : "";
    console.log(
      `${target.padEnd(8)} ${PROJECTS[target]}  ${statuses[target]}${mark}`,
    );
  }
  if (!current) console.log(".env.local points at neither project.");
  const testdb = PROJECTS.testdb;

  switch (command) {
    case "status":
      return 0;
    case "demo":
    case "testdb":
      applySwitch(command, statuses);
      nextSteps(command);
      return 0;
    case "pause-testdb": {
      // Repoint tests first so nothing local keeps using a pausing database.
      applySwitch("demo", statuses);
      const step = pauseStep(statuses.testdb);
      if (step === "pause") {
        console.log(`\nPausing testdb ${testdb}...`);
        await projectAction(testdb, "pause", token);
      }
      if (step !== "done") await waitForStatus(testdb, token, "INACTIVE");
      console.log(`The testdb project ${testdb} is paused (INACTIVE).`);
      nextSteps("demo");
      return 0;
    }
    case "resume-testdb": {
      if (!current) {
        throw new Error(
          ".env.local must point at demo or testdb before resuming; refusing to overwrite another project's settings.",
        );
      }
      const step = resumeStep(statuses.testdb);
      if (step === "restore") {
        console.log(`\nResuming testdb ${testdb} (usually a few minutes)...`);
        await projectAction(testdb, "restore", token);
      }
      await waitForStatus(testdb, token, HEALTHY);
      const readyStatuses = await readStatuses(token);
      if (readyStatuses.testdb !== HEALTHY) {
        throw new Error(
          `The testdb project is ${readyStatuses.testdb}; refusing to refresh credentials or switch the test target.`,
        );
      }
      await refreshTestdbCredentials(token, readyStatuses);
      applySwitch("testdb", await readStatuses(token));
      nextSteps("testdb");
      return 0;
    }
  }
  return 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
