import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { DEMO_MARKER } from "./demo.ts";
import { operationalDatabaseClient } from "./database.ts";
import {
  findAuthUserId,
  projectTarget,
  type Db,
  type ProjectTarget,
} from "./supabase-project.ts";

/*
 * `npm run ops -- provision` (docs/OPERATIONS.md, "Provision a customer RWA").
 * Prepares one FRESH, dedicated Supabase project for a customer association:
 * migrations, settings, Auth/email configuration, the first administrator and
 * the tenant-directory entry. Every step checks before it writes, so a failed
 * run can simply be repeated. It never copies data from another project, never
 * erases anything and refuses the demo project or a project/host the current
 * directory already gives to a different tenant. Output contains no keys,
 * database URLs, codes or email addresses.
 */

export interface ProvisionRequest {
  tenantId: string;
  host: string;
  rwaName: string;
  timezone: string;
  adminEmail: string;
  adminName: string;
  publishableKey: string;
}

export type StepStatus = "done" | "already" | "manual" | "blocked";

export interface StepResult {
  step: string;
  status: StepStatus;
  detail: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HOST =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function serviceRoleKeyRef(tenantId: string): string {
  return `TENANT_${tenantId.replaceAll("-", "").toUpperCase()}_SUPABASE_SERVICE_ROLE_KEY`;
}

interface DirectoryLike {
  host?: unknown;
  kind?: unknown;
  tenantId?: unknown;
  projectUrl?: unknown;
}

/** Validates the request and refuses anything that could reach another tenant. */
export function provisionPlan(
  env: Readonly<Record<string, string | undefined>>,
  options: Readonly<Record<string, string | undefined>>,
): { target: ProjectTarget; request: ProvisionRequest } {
  const target = projectTarget(
    env,
    "PROVISION_",
    options.confirm,
    "to provision that customer project",
  );
  const tenantId = options["tenant-id"]?.toLowerCase() ?? "";
  if (!UUID.test(tenantId)) {
    throw new Error(
      "Pass --tenant-id <new UUID>. Reuse the same value on every retry for this RWA.",
    );
  }
  const host = options.host?.toLowerCase() ?? "";
  if (!HOST.test(host)) throw new Error("Pass --host <customer hostname>.");
  const rwaName = options["rwa-name"]?.trim() ?? "";
  if (rwaName.length < 2 || rwaName.length > 200) {
    throw new Error("Pass --rwa-name <association name> (2-200 characters).");
  }
  const adminName = options["admin-name"]?.trim() ?? "";
  if (adminName.length < 2 || adminName.length > 200) {
    throw new Error("Pass --admin-name <first administrator's name>.");
  }
  const timezone = options.timezone ?? "Asia/Kolkata";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new Error("--timezone is not a valid IANA time zone.");
  }
  const adminEmail = env.PROVISION_ADMIN_EMAIL?.trim() ?? "";
  if (!EMAIL.test(adminEmail)) {
    throw new Error("PROVISION_ADMIN_EMAIL is not set to an email address.");
  }
  const publishableKey = env.PROVISION_PUBLISHABLE_KEY ?? "";
  if (!publishableKey) throw new Error("PROVISION_PUBLISHABLE_KEY is not set.");
  if (
    publishableKey === target.serviceRoleKey ||
    publishableKey.startsWith("sb_secret_")
  ) {
    throw new Error(
      "PROVISION_PUBLISHABLE_KEY must be the public (publishable/anon) key, not a secret key.",
    );
  }

  if (env.DEMO_PROJECT_REF && env.DEMO_PROJECT_REF === target.projectRef) {
    throw new Error("The demo project can never be provisioned as a customer.");
  }
  const projectUrl = `https://${target.projectRef}.supabase.co`;
  for (const entry of directoryEntries(env.TENANT_DIRECTORY_JSON)) {
    const sameTenant = entry.tenantId === tenantId;
    if (entry.projectUrl === projectUrl && entry.kind === "demo") {
      throw new Error("The directory lists this project as the demo.");
    }
    if (entry.projectUrl === projectUrl && !sameTenant) {
      throw new Error("The directory gives this project to another tenant.");
    }
    if (entry.host === host && !sameTenant) {
      throw new Error("The directory gives this host to another tenant.");
    }
    if (sameTenant && entry.projectUrl !== projectUrl) {
      throw new Error(
        "The directory already maps this tenant ID to a different project.",
      );
    }
  }
  return {
    target,
    request: {
      tenantId,
      host,
      rwaName,
      timezone,
      adminEmail,
      adminName,
      publishableKey,
    },
  };
}

function directoryEntries(serialized: string | undefined): DirectoryLike[] {
  if (!serialized) return [];
  try {
    const parsed = JSON.parse(serialized) as { entries?: unknown };
    return Array.isArray(parsed.entries)
      ? (parsed.entries as DirectoryLike[]).map((entry) => ({
          ...entry,
          host: typeof entry.host === "string" ? entry.host.toLowerCase() : "",
          tenantId:
            typeof entry.tenantId === "string"
              ? entry.tenantId.toLowerCase()
              : undefined,
        }))
      : [];
  } catch {
    throw new Error("TENANT_DIRECTORY_JSON is set but is not valid JSON.");
  }
}

export function migrationStatus(local: string[], remote: string[]) {
  const remoteSet = new Set(remote);
  const localSet = new Set(local);
  const pending = local.filter((v) => !remoteSet.has(v)).sort();
  const unknownRemote = remote.filter((v) => !localSet.has(v)).sort();
  return {
    pending,
    unknownRemote,
    complete: pending.length === 0 && unknownRemote.length === 0,
  };
}

export async function localMigrationVersions(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .map((name) => /^(\d{14})_.+\.sql$/u.exec(name)?.[1])
    .filter((v): v is string => v !== undefined)
    .sort();
}

const SIGN_IN_SUBJECT = "Your Civic Pulse sign-in code";

/** Hosted Auth settings the app requires (docs/DEPLOYMENT.md section 5). */
export function authConfigPatch(host: string) {
  const origin = `https://${host}`;
  return {
    site_url: origin,
    uri_allow_list: origin,
    disable_signup: true,
    external_email_enabled: true,
    mailer_otp_length: 6,
  };
}

/*
 * Sent separately: Supabase refuses email template changes (400) on projects
 * that still use its default email sender, so this waits for custom SMTP.
 */
export function authTemplatePatch(template: string) {
  return {
    mailer_subjects_magic_link: SIGN_IN_SUBJECT,
    mailer_templates_magic_link_content: template,
  };
}

/** Plain-language problems; SMTP and the template are reported separately because SMTP only the operator holds. */
export function authConfigProblems(
  config: Readonly<Record<string, unknown>>,
  host: string,
): { fixable: string[]; template: boolean; smtp: boolean } {
  const origin = `https://${host}`;
  const fixable: string[] = [];
  if (config.disable_signup !== true) fixable.push("public sign-up is on");
  if (config.site_url !== origin) fixable.push("Site URL is not the RWA host");
  const allow = String(config.uri_allow_list ?? "");
  if (allow.includes("*") || !allow.split(",").includes(origin)) {
    fixable.push("redirect URLs are not exactly the RWA host");
  }
  if (Number(config.mailer_otp_length) !== 6) {
    fixable.push("sign-in codes are not six digits");
  }
  if (config.external_email_enabled !== true) {
    fixable.push("email sign-in is turned off");
  }
  const template = String(
    config.mailer_templates_magic_link_content ?? "",
  ).includes("{{ .Token }}");
  const smtp =
    typeof config.smtp_host === "string" && config.smtp_host.trim() !== "";
  return { fixable, template, smtp };
}

export function directoryEntry(
  request: ProvisionRequest,
  projectRef: string,
  state: "provisioning" | "active",
) {
  return {
    host: request.host,
    kind: "customer" as const,
    tenantId: request.tenantId,
    state,
    projectUrl: `https://${projectRef}.supabase.co`,
    publishableKey: request.publishableKey,
    serviceRoleKeyRef: serviceRoleKeyRef(request.tenantId),
  };
}

const MANAGEMENT_API = "https://api.supabase.com/v1/projects";

async function managementAuth(
  projectRef: string,
  token: string,
  patch?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${MANAGEMENT_API}/${projectRef}/config/auth`, {
    method: patch ? "PATCH" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: patch ? JSON.stringify(patch) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // Supabase's own explanation (never contains credentials) makes 400s actionable.
    const reason = await response
      .json()
      .then((body: { message?: unknown }) =>
        typeof body.message === "string" ? `: ${body.message}` : "",
      )
      .catch(() => "");
    throw new Error(
      `Supabase Management API returned ${response.status} for the Auth settings${reason} (check SUPABASE_ACCESS_TOKEN and project access).`,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

async function remoteMigrations(db: Db): Promise<string[] | null> {
  const exists = await db.query<{ t: string | null }>(
    "select to_regclass('supabase_migrations.schema_migrations')::text as t",
  );
  if (!exists.rows[0]?.t) return null;
  const rows = await db.query<{ version: string }>(
    "select version from supabase_migrations.schema_migrations",
  );
  return rows.rows.map((r) => r.version);
}

function pushMigrations(databaseUrl: string): boolean {
  // The CLI only accepts the URL as an argument (docs/DEPLOYMENT.md section 4).
  // Run npm's npx script directly with Node so the URL (with its password) is
  // never concatenated into a Windows shell command line.
  const npmCli = process.env.npm_execpath;
  const npxCli = npmCli ? path.join(path.dirname(npmCli), "npx-cli.js") : "";
  const args = ["supabase", "db", "push", "--db-url", databaseUrl, "--yes"];
  let command = "npx";
  if (npxCli && existsSync(npxCli)) {
    command = process.execPath;
    args.unshift(npxCli);
  } else if (process.platform === "win32") {
    throw new Error(
      "Run provisioning through `npm run ops` so migrations can be applied without a shell.",
    );
  }
  const result = spawnSync(command, args, {
    stdio: "ignore",
    timeout: 600_000,
  });
  return result.status === 0;
}

export interface ProvisionOptions {
  applyMigrations: boolean;
  activate: boolean;
  accessToken?: string;
  repoRoot: string;
}

/** Runs every step that is safe to run; stops before steps whose prerequisites are missing. */
export async function provisionCustomer(
  target: ProjectTarget,
  request: ProvisionRequest,
  options: ProvisionOptions,
) {
  const steps: StepResult[] = [];
  const add = (step: string, status: StepStatus, detail: string) =>
    steps.push({ step, status, detail });
  const handover: string[] = [];
  const db = operationalDatabaseClient(target.databaseUrl);
  await db.connect();
  try {
    // Refuse the demo even when its credentials were mislabelled as PROVISION_*.
    const marker = await db.query<{ t: string | null }>(
      "select to_regclass('public.rwa_settings')::text as t",
    );
    if (marker.rows[0]?.t) {
      const demo = await db.query<{ authority: string | null }>(
        "select policy_approvals -> 'A1' ->> 'approving_authority' as authority from public.rwa_settings",
      );
      if (demo.rows[0]?.authority === DEMO_MARKER) {
        throw new Error(
          "This project holds the demo; it can never become a customer.",
        );
      }
    }

    const local = await localMigrationVersions(
      path.join(options.repoRoot, "supabase", "migrations"),
    );
    let remote = await remoteMigrations(db);
    if (remote === null && marker.rows[0]?.t) {
      throw new Error(
        "App tables exist without migration history; this is not a fresh project.",
      );
    }
    let status = migrationStatus(local, remote ?? []);
    if (status.unknownRemote.length > 0) {
      throw new Error(
        `The project has ${status.unknownRemote.length} migration(s) this release does not know; stop and review.`,
      );
    }
    if (status.pending.length > 0 && options.applyMigrations) {
      if (!pushMigrations(target.databaseUrl)) {
        throw new Error(
          "supabase db push failed; fix the cause and run again (applied migrations are kept).",
        );
      }
      remote = await remoteMigrations(db);
      status = migrationStatus(local, remote ?? []);
      if (!status.complete) {
        throw new Error("Migrations are still incomplete after db push.");
      }
      add("migrations", "done", `${local.length} migrations applied`);
    } else if (status.pending.length > 0) {
      add(
        "migrations",
        "blocked",
        `${status.pending.length} of ${local.length} migrations pending; review them, then re-run with --apply-migrations`,
      );
    } else {
      add("migrations", "already", `all ${local.length} migrations present`);
    }

    if (status.complete) {
      const settings = await db.query<{ full_name: string }>(
        "select full_name from public.rwa_settings where id = 1",
      );
      const current = settings.rows[0];
      if (!current) {
        await db.query(
          "select app_private.deployment_initialize_settings($1, $2)",
          [request.rwaName, request.timezone],
        );
        add("settings", "done", "settings initialized");
      } else if (current.full_name === request.rwaName) {
        add("settings", "already", "settings present for this RWA");
      } else {
        add(
          "settings",
          "blocked",
          "settings belong to a different association name; stop and check the project",
        );
      }

      const admin = createClient(target.supabaseUrl, target.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      let userId = await findAuthUserId(admin, request.adminEmail);
      let created = false;
      if (!userId) {
        const { data, error } = await admin.auth.admin.createUser({
          email: request.adminEmail,
          email_confirm: true,
        });
        // A concurrent or earlier partial run may have created it meanwhile.
        userId =
          data.user?.id ?? (await findAuthUserId(admin, request.adminEmail));
        if (!userId) {
          throw new Error(
            `Could not create the administrator's Auth identity${error ? ` (${error.code ?? error.status ?? "error"})` : ""}.`,
          );
        }
        created = true;
      }
      const admins = await db.query<{ id: string }>(
        "select id from public.profiles where status = 'ENABLED' and is_admin",
      );
      if (admins.rows.some((r) => r.id === userId)) {
        add("first-admin", "already", "the administrator is enabled");
      } else if (admins.rows.length > 0) {
        add(
          "first-admin",
          "blocked",
          "a different administrator is already enabled; this project was already handed over",
        );
      } else {
        const existing = await db.query(
          "select 1 from public.profiles where id = $1",
          [userId],
        );
        if (existing.rowCount) {
          add(
            "first-admin",
            "blocked",
            "the administrator's profile exists but is not an enabled administrator; resolve it in the database",
          );
        } else {
          await db.query(
            "select app_private.deployment_bootstrap_admin($1, $2)",
            [userId, request.adminName],
          );
          add(
            "first-admin",
            "done",
            created
              ? "Auth identity created and administrator enabled"
              : "administrator enabled for the existing Auth identity",
          );
        }
      }

      const policy = await db.query<{ approvals: number; retention: boolean }>(
        `select (select count(*) from jsonb_object_keys(policy_approvals))::int as approvals,
                (vote_retention_days is not null and audit_retention_days is not null
                 and inactive_profile_retention_days is not null
                 and rate_limit_retention_days is not null
                 and backup_retention_days is not null) as retention
           from public.rwa_settings where id = 1`,
      );
      const p = policy.rows[0];
      if (!p || p.approvals < 7 || !p.retention) {
        handover.push(
          `Record the RWA's real policy approvals (${p?.approvals ?? 0}/7 recorded) and retention periods before its first vote (supabase/README.md).`,
        );
      }
    }

    const template = await readFile(
      path.join(options.repoRoot, "supabase", "templates", "magic_link.html"),
      "utf8",
    );
    if (options.accessToken) {
      let config = await managementAuth(target.projectRef, options.accessToken);
      let problems = authConfigProblems(config, request.host);
      let changed = false;
      if (problems.fixable.length > 0) {
        config = await managementAuth(
          target.projectRef,
          options.accessToken,
          authConfigPatch(request.host),
        );
        problems = authConfigProblems(config, request.host);
        changed = true;
      }
      if (!problems.template && problems.smtp) {
        config = await managementAuth(
          target.projectRef,
          options.accessToken,
          authTemplatePatch(template),
        );
        problems = authConfigProblems(config, request.host);
        changed = true;
      }
      if (problems.fixable.length > 0) {
        add("auth", "blocked", `still wrong: ${problems.fixable.join("; ")}`);
      } else if (!problems.smtp) {
        add(
          "auth",
          "blocked",
          "Auth settings are correct but custom SMTP is not configured; add it in the Supabase dashboard (docs/LOCAL_SETUP.md section 8), then re-run to set the six-digit code email",
        );
      } else if (!problems.template) {
        add(
          "auth",
          "blocked",
          "the sign-in email still does not contain the code",
        );
      } else {
        add(
          "auth",
          changed ? "done" : "already",
          "Auth settings, sign-in email and custom SMTP verified",
        );
      }
    } else {
      add(
        "auth",
        "manual",
        "SUPABASE_ACCESS_TOKEN not set: apply docs/DEPLOYMENT.md section 5 by hand (sign-up off, Site URL and redirect = the RWA host, six-digit code template, custom SMTP) and re-run with a token to verify",
      );
    }
  } finally {
    await db.end();
  }

  const required = ["migrations", "settings", "first-admin", "auth"];
  const blockers = required
    .map((name) => steps.find((s) => s.step === name))
    .map((s, i) =>
      !s
        ? `${required[i]}: not reached`
        : s.status === "done" || s.status === "already"
          ? undefined
          : `${s.step}: ${s.detail}`,
    )
    .filter((b): b is string => b !== undefined);
  const active = options.activate && blockers.length === 0;
  handover.push(
    `Set the Vercel secret ${serviceRoleKeyRef(request.tenantId)} (sensitive) to this project's service-role key.`,
    "Add the host to the Vercel project's domains and the entry below to TENANT_DIRECTORY_JSON, then redeploy.",
    "Ask the administrator to sign in with an emailed code and confirm the RWA profile.",
  );
  return {
    ready: blockers.length === 0,
    activationRequested: options.activate,
    steps,
    blockers,
    handover,
    directoryEntry: directoryEntry(
      request,
      target.projectRef,
      active ? "active" : "provisioning",
    ),
  };
}
