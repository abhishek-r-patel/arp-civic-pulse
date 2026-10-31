// Shared helpers for the opt-in tenant-host HTTP specs; restricted to the two approved disposable projects.
import { createClient } from "@supabase/supabase-js";
import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import {
  createCsrfContext,
  csrfCookieName,
  csrfTokenFor,
} from "../../../src/server/http/csrf";

export const remote = process.env.TENANT_HTTP_REMOTE === "1";

export interface TenantHttpProject {
  label: "A" | "B";
  url: string;
  publishableKey: string;
  serviceRoleKey: string;
  ref: string;
  host: string;
  tenantId: string;
  databaseUrl?: string;
}

const APPROVED_REFS = { A: "nycbbzgsilnxrgkwlwno", B: "hnqajjjemqepxuoqbsqx" };

/*
 * Project B became the demo, so an operator may name another disposable
 * project explicitly (for example a temporary S07 provisioning project).
 */
function approvedRef(label: "A" | "B"): string {
  const override = process.env[`TENANT_HTTP_PROJECT_${label}_REF`];
  if (override && !/^[a-z0-9]{20}$/u.test(override)) {
    throw new Error(`TENANT_HTTP_PROJECT_${label}_REF is not a project ref.`);
  }
  return override || APPROVED_REFS[label];
}

export function requiredSetting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing tenant HTTP test setting: ${name}.`);
  return value;
}

/** Reads both tenant settings and refuses anything but the disposable projects. */
export function tenantHttpProjects(): [TenantHttpProject, TenantHttpProject] {
  const project = (label: "A" | "B"): TenantHttpProject => {
    const settings: TenantHttpProject = {
      label,
      url: requiredSetting(`TENANT_HTTP_PROJECT_${label}_URL`),
      publishableKey: requiredSetting(
        `TENANT_HTTP_PROJECT_${label}_PUBLISHABLE_KEY`,
      ),
      serviceRoleKey: requiredSetting(
        `TENANT_HTTP_PROJECT_${label}_SERVICE_ROLE_KEY`,
      ),
      ref: approvedRef(label),
      host: requiredSetting(`TENANT_HTTP_HOST_${label}`),
      tenantId: requiredSetting(`TENANT_HTTP_TENANT_${label}_ID`),
      databaseUrl: process.env[`TENANT_HTTP_PROJECT_${label}_DATABASE_URL`],
    };
    if (new URL(settings.url).hostname !== `${settings.ref}.supabase.co`) {
      throw new Error(
        "Tenant HTTP tests are restricted to the approved disposable projects.",
      );
    }
    if (settings.databaseUrl) {
      const parsed = new URL(settings.databaseUrl);
      if (
        !parsed.hostname.includes(settings.ref) &&
        !decodeURIComponent(parsed.username).endsWith(`.${settings.ref}`)
      ) {
        throw new Error(
          "Tenant HTTP database URL does not match its approved project.",
        );
      }
    }
    return settings;
  };
  return [project("A"), project("B")];
}

// Remote hosts are reached by URL (TLS needs the real name); local runs keep
// one server and select the tenant with a Host override.
export function endpoint(host: string, path: string): string {
  return remote ? `https://${host}${path}` : path;
}

export function hostHeader(host: string): Record<string, string> {
  return remote ? {} : { host };
}

export function serviceClient(project: TenantHttpProject) {
  return createClient(project.url, project.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function provisionAdmin(
  project: TenantHttpProject,
  email: string,
  name: string,
): Promise<{ id: string; email: string; code: string }> {
  const admin = serviceClient(project);
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  const id = created.data.user?.id;
  if (created.error || !id) {
    throw new Error("Could not provision the tenant HTTP test identity.");
  }
  const provisioned = await admin.rpc("provision_profile", {
    p_auth_user_id: id,
    p_representative_name: name,
    p_is_admin: true,
    p_actor_profile_id: null,
  });
  if (provisioned.error) {
    throw new Error("Could not create the tenant HTTP test profile.");
  }
  const enabled = await admin.rpc("enable_profile", {
    p_profile_id: id,
    p_actor_profile_id: null,
  });
  if (enabled.error) {
    throw new Error("Could not enable the tenant HTTP test profile.");
  }
  const generated = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const code = generated.data?.properties?.email_otp;
  if (generated.error || !code) {
    throw new Error("Could not generate the tenant HTTP test code.");
  }
  return { id, email, code };
}

export async function verifyThroughHttp(
  request: APIRequestContext,
  project: { host: string },
  account: { id: string; email: string; code: string },
): Promise<{ cookies: string[] }> {
  const context = createCsrfContext();
  const response = await request.post(
    endpoint(project.host, "/api/auth/verify"),
    {
      data: { email: account.email, code: account.code },
      headers: mutationHeaders(
        project.host,
        `https://${project.host}`,
        [],
        context,
      ),
    },
  );
  if (response.status() !== 200) {
    const body = (await response.json()) as {
      error?: {
        code?: unknown;
        fieldErrors?: Array<{ field?: unknown; code?: unknown }>;
      };
    };
    const code =
      typeof body.error?.code === "string" ? body.error.code : "unknown";
    const fields = (body.error?.fieldErrors ?? [])
      .map((field) => `${String(field.field)}:${String(field.code)}`)
      .join(",");
    throw new Error(
      `Tenant-host OTP verification failed: HTTP ${response.status()} (${code}${fields ? `; ${fields}` : ""}; code-format=${account.code.length}/${/^\d{6}$/u.test(account.code)}).`,
    );
  }
  const result = (await response.json()) as {
    data?: { account?: { id?: string } };
  };
  expect(result.data?.account?.id).toBe(account.id);
  return { cookies: responseCookies(response) };
}

export function mutationHeaders(
  host: string,
  origin: string,
  cookies: string[],
  context: string,
): Record<string, string> {
  const csrf = csrfCookieName(remote);
  return {
    ...hostHeader(host),
    origin,
    cookie: [
      ...cookies.filter((cookie) => cookieName(cookie) !== csrf),
      `${csrf}=${context}`,
    ].join("; "),
    "x-csrf-token": csrfTokenFor(context),
  };
}

export function responseCookies(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter(({ name }) => name.toLowerCase() === "set-cookie")
    .map(({ value }) => {
      const pair = value.split(";", 1)[0];
      if (!pair) throw new Error("Malformed Set-Cookie response.");
      return pair.trim();
    });
}

export function cookieName(cookie: string): string {
  const separator = cookie.indexOf("=");
  return separator === -1 ? cookie : cookie.slice(0, separator);
}

export function cookieValue(cookies: string[], name: string): string {
  const cookie = cookies.find((value) => cookieName(value) === name);
  if (!cookie) throw new Error(`Missing expected cookie: ${name}.`);
  return decodeURIComponent(cookie.slice(name.length + 1));
}

export function updatedCookies(
  previous: string[],
  response: APIResponse,
): string[] {
  const jar = new Map(previous.map((cookie) => [cookieName(cookie), cookie]));
  for (const { value } of response
    .headersArray()
    .filter(({ name }) => name.toLowerCase() === "set-cookie")) {
    const [pair, ...attributes] = value.split(";");
    if (!pair) throw new Error("Malformed Set-Cookie response.");
    const cookie = pair.trim();
    const name = cookieName(cookie);
    if (attributes.some((attribute) => /^\s*max-age=0\s*$/iu.test(attribute))) {
      jar.delete(name);
    } else {
      jar.set(name, cookie);
    }
  }
  return [...jar.values()];
}
