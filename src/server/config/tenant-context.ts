// Resolves immutable per-request backend configuration from an allowlisted host.
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { getEnvironment, type Environment } from "@/server/config/environment";
import {
  parseTenantDirectory,
  type TenantDirectoryEntry,
} from "@/server/config/tenant-directory";
import { ApiError } from "@/server/http/errors";

export interface TenantContext {
  readonly tenantId: string | undefined;
  readonly kind: "single" | "main" | "demo" | "customer";
  readonly hostname: string;
  readonly canonicalOrigin: string;
  readonly state: "active";
  readonly projectUrl: string | undefined;
  readonly publishableKey: string | undefined;
  readonly serviceRoleKeyRef: string | undefined;
}

function invalidHost(): never {
  throw new ApiError("NOT_FOUND", {
    cause: { source: "tenant_config", code: "UNKNOWN_HOST" },
  });
}

function parseHost(
  value: string | null,
  allowPort: boolean,
  rejectIp = true,
): { hostname: string; authority: string } {
  if (
    !value ||
    value !== value.trim() ||
    /[,/@\\?#\s]/u.test(value) ||
    (!allowPort && value.includes(":"))
  ) {
    return invalidHost();
  }

  let parsed: URL;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    return invalidHost();
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    hostname.endsWith(".") ||
    (rejectIp &&
      (hostname.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)))
  ) {
    return invalidHost();
  }

  return { hostname, authority: parsed.host.toLowerCase() };
}

function publicKeyIsSafe(value: string): boolean {
  const publishablePrefix = "sb_publishable_";
  if (value.startsWith(publishablePrefix)) {
    return value.length > publishablePrefix.length;
  }
  if (value.startsWith("sb_secret_")) return false;

  const segments = value.split(".");
  if (segments.length !== 3 || !segments[1]) return false;
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    );
    return (
      typeof claims === "object" &&
      claims !== null &&
      "role" in claims &&
      claims.role === "anon"
    );
  } catch {
    return false;
  }
}

export function serviceRoleKeyIsValid(value: string): boolean {
  const secretPrefix = "sb_secret_";
  if (value.startsWith(secretPrefix)) {
    return value.length > secretPrefix.length;
  }
  const segments = value.split(".");
  if (segments.length !== 3 || !segments[1]) return false;
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    );
    return (
      typeof claims === "object" &&
      claims !== null &&
      "role" in claims &&
      claims.role === "service_role"
    );
  } catch {
    return false;
  }
}

function activeContext(entry: TenantDirectoryEntry): TenantContext {
  if (entry.state !== "active") {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      cause: { source: "tenant_config", code: "TENANT_NOT_ACTIVE" },
    });
  }
  if (entry.kind === "main") {
    return Object.freeze({
      tenantId: undefined,
      kind: "main",
      hostname: entry.host,
      canonicalOrigin: `https://${entry.host}`,
      state: "active",
      projectUrl: undefined,
      publishableKey: undefined,
      serviceRoleKeyRef: undefined,
    });
  }

  return Object.freeze({
    tenantId: entry.tenantId,
    kind: entry.kind,
    hostname: entry.host,
    canonicalOrigin: `https://${entry.host}`,
    state: "active",
    projectUrl: entry.projectUrl,
    publishableKey: entry.publishableKey,
    serviceRoleKeyRef: entry.serviceRoleKeyRef,
  });
}

function resolveDirectoryHost(
  hostHeader: string | null,
  serialized: string | undefined,
  source: Readonly<Record<string, string | undefined>>,
): TenantContext {
  const { hostname } = parseHost(hostHeader, false);
  const directory = parseTenantDirectory(serialized);
  if (directory.invalidHosts.includes(hostname)) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      cause: { source: "tenant_config", code: "DIRECTORY_ENTRY_INVALID" },
    });
  }
  const entry = directory.entries.find(
    (candidate) => candidate.host === hostname,
  );
  if (!entry) return invalidHost();

  const context = activeContext(entry);
  if (context.kind === "main") return context;

  const key = source[context.serviceRoleKeyRef ?? ""];
  if (
    !key ||
    !serviceRoleKeyIsValid(key) ||
    !context.projectUrl ||
    !context.publishableKey ||
    !publicKeyIsSafe(context.publishableKey)
  ) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      cause: {
        source: "tenant_config",
        code: !key
          ? "SERVICE_KEY_MISSING"
          : !serviceRoleKeyIsValid(key)
            ? "SERVICE_KEY_INVALID"
            : "PUBLIC_CONFIG_INVALID",
      },
    });
  }
  return context;
}

/*
 * Vercel Preview deployments get a new URL per deploy, so single-tenant mode
 * also accepts that deployment's own system-provided hosts, but only when Vercel
 * reports a Preview runtime. Production and directory mode stay exact-host only.
 * The deployment URL becomes the preview's canonical origin, so mutations
 * remain same-origin without treating arbitrary Host values as authority.
 */
function previewDeploymentOrigins(
  source: Readonly<Record<string, string | undefined>>,
): ReadonlyMap<string, string> {
  const origins = new Map<string, string>();
  if (source.VERCEL_ENV !== "preview") return origins;
  for (const value of [source.VERCEL_URL, source.VERCEL_BRANCH_URL]) {
    if (!value) continue;
    try {
      const { authority } = parseHost(value, false);
      origins.set(authority, `https://${authority}`);
    } catch {
      // A malformed system value simply allows nothing extra.
    }
  }
  return origins;
}

export function resolveTenantContext(
  hostHeader: string | null,
  environment: Environment,
  source: Readonly<Record<string, string | undefined>> = process.env,
): TenantContext {
  if (environment.TENANT_ROUTING_ENABLED) {
    return resolveDirectoryHost(
      hostHeader,
      environment.TENANT_DIRECTORY_JSON,
      source,
    );
  }

  const { authority, hostname } = parseHost(hostHeader, true, false);
  const configuredOrigin = new URL(environment.APP_ORIGIN);
  const isConfiguredHost = authority === configuredOrigin.host.toLowerCase();
  const previewOrigin = previewDeploymentOrigins(source).get(authority);
  if (!isConfiguredHost && !previewOrigin) {
    return invalidHost();
  }

  return Object.freeze({
    tenantId: "single-rwa",
    kind: "single",
    hostname: isConfiguredHost
      ? configuredOrigin.hostname.toLowerCase()
      : hostname,
    canonicalOrigin: isConfiguredHost
      ? environment.APP_ORIGIN
      : (previewOrigin ?? environment.APP_ORIGIN),
    state: "active",
    projectUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKeyRef: "SUPABASE_SERVICE_ROLE_KEY",
  });
}

export const getRequestTenantContext = cache(
  async (): Promise<TenantContext> => {
    const incomingHeaders = await headers();
    return resolveTenantContext(
      incomingHeaders.get("host"),
      getEnvironment(),
      process.env,
    );
  },
);

export function tenantContextForProxy(
  hostHeader: string | null,
  environment: Environment = getEnvironment(),
): TenantContext {
  return resolveTenantContext(hostHeader, environment, process.env);
}
