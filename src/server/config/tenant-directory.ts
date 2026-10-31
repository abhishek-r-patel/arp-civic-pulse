// Strictly parses the server-only hostname and backend directory.
import "server-only";
import { z } from "zod";

const dnsLabel = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const hostnamePattern = new RegExp(
  `^(?=.{1,253}$)(?:${dnsLabel}\\.)+${dnsLabel}$`,
);

const hostnameSchema = z
  .string()
  .regex(hostnamePattern)
  .refine(
    (value) => !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value),
    "must be a DNS hostname, not an IP address",
  );

const serviceRoleKeyRefSchema = z
  .string()
  .regex(/^TENANT_[0-9A-F]{32}_SUPABASE_SERVICE_ROLE_KEY$/u);

const stateSchema = z.enum(["provisioning", "active", "unavailable"]);

/*
 * Pilot limits (docs/IMPLEMENTATION_PLAN.md S01/S02). Every customer's service
 * key is a Vercel variable readable by the shared deployment, so the pilot is
 * capped at ten customer RWAs (demo and main excluded) and one main and one
 * demo host. Exceeding a limit rejects the whole directory rather than picking
 * which entries to serve.
 */
export const MAX_CUSTOMER_TENANTS = 10;
const MAX_ENTRIES_PER_KIND = { main: 1, demo: 1 } as const;

const mainEntrySchema = z.strictObject({
  host: hostnameSchema,
  kind: z.literal("main"),
  state: stateSchema,
});

const rwaEntrySchema = z.strictObject({
  host: hostnameSchema,
  kind: z.enum(["demo", "customer"]),
  tenantId: z.uuid(),
  state: stateSchema,
  projectUrl: z.string().url(),
  publishableKey: z.string().min(1),
  serviceRoleKeyRef: serviceRoleKeyRefSchema,
});

const tenantDirectoryEntrySchema = z.discriminatedUnion("kind", [
  mainEntrySchema,
  rwaEntrySchema,
]);

const tenantDirectoryEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  entries: z.array(z.unknown()).min(1),
});

export type TenantDirectoryEntry = z.output<typeof tenantDirectoryEntrySchema>;
export type RwaTenantDirectoryEntry = Exclude<
  TenantDirectoryEntry,
  { kind: "main" }
>;

export interface TenantDirectory {
  readonly version: 1;
  readonly entries: readonly TenantDirectoryEntry[];
  readonly invalidHosts: readonly string[];
}

function safeHost(value: unknown): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("host" in value) ||
    typeof value.host !== "string"
  ) {
    return undefined;
  }

  const hostname = value.host.toLowerCase();
  return hostnameSchema.safeParse(hostname).success ? hostname : undefined;
}

function validProjectOrigin(entry: RwaTenantDirectoryEntry): boolean {
  const expectedRef = `TENANT_${entry.tenantId
    .replaceAll("-", "")
    .toUpperCase()}_SUPABASE_SERVICE_ROLE_KEY`;
  if (entry.serviceRoleKeyRef !== expectedRef) return false;

  try {
    const projectUrl = new URL(entry.projectUrl);
    return (
      projectUrl.protocol === "https:" &&
      projectUrl.origin === entry.projectUrl &&
      /^[a-z0-9-]+\.supabase\.co$/u.test(projectUrl.hostname)
    );
  } catch {
    return false;
  }
}

function markDuplicateHosts(
  entries: readonly TenantDirectoryEntry[],
  key: (entry: TenantDirectoryEntry) => string | undefined,
  invalidHosts: Set<string>,
): void {
  const hostsByKey = new Map<string, string[]>();
  for (const entry of entries) {
    const value = key(entry);
    if (value === undefined) continue;
    const hosts = hostsByKey.get(value) ?? [];
    hosts.push(entry.host);
    hostsByKey.set(value, hosts);
  }
  for (const hosts of hostsByKey.values()) {
    if (hosts.length > 1) {
      for (const host of hosts) invalidHosts.add(host);
    }
  }
}

export function parseTenantDirectory(
  serialized: string | undefined,
): TenantDirectory {
  if (!serialized) {
    throw new Error("TENANT_DIRECTORY_JSON: is required");
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("TENANT_DIRECTORY_JSON: must be valid JSON");
  }

  const envelope = tenantDirectoryEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    const fields = [
      ...new Set(
        envelope.error.issues.map((issue) =>
          ["TENANT_DIRECTORY_JSON", ...issue.path].join("."),
        ),
      ),
    ];
    throw new Error(
      `Invalid tenant directory configuration: ${fields.join(", ")}`,
    );
  }

  // Counted by distinct host, so a duplicated entry is isolated (below), not fatal.
  const hostsByKind = new Map<string, Set<unknown>>();
  for (const value of envelope.data.entries) {
    if (typeof value !== "object" || value === null || !("kind" in value)) {
      continue;
    }
    const kind = String(value.kind);
    const hosts = hostsByKind.get(kind) ?? new Set<unknown>();
    hosts.add("host" in value ? value.host : value);
    hostsByKind.set(kind, hosts);
  }
  const countOf = (kind: string) => hostsByKind.get(kind)?.size ?? 0;
  if (countOf("customer") > MAX_CUSTOMER_TENANTS) {
    throw new Error(
      `Invalid tenant directory configuration: TENANT_DIRECTORY_JSON.entries has more than ${MAX_CUSTOMER_TENANTS} customer hosts`,
    );
  }
  for (const [kind, limit] of Object.entries(MAX_ENTRIES_PER_KIND)) {
    if (countOf(kind) > limit) {
      throw new Error(
        `Invalid tenant directory configuration: TENANT_DIRECTORY_JSON.entries has more than ${limit} ${kind} host`,
      );
    }
  }

  const invalidHosts = new Set<string>();
  const entries: TenantDirectoryEntry[] = [];
  for (const value of envelope.data.entries) {
    const parsed = tenantDirectoryEntrySchema.safeParse(value);
    if (!parsed.success) {
      const host = safeHost(value);
      if (host) invalidHosts.add(host);
      continue;
    }

    const entry = parsed.data;
    if (entry.kind !== "main" && !validProjectOrigin(entry)) {
      invalidHosts.add(entry.host);
      continue;
    }
    entries.push(entry);
  }

  markDuplicateHosts(entries, (entry) => entry.host, invalidHosts);
  markDuplicateHosts(
    entries,
    (entry) =>
      entry.kind === "main" ? undefined : entry.tenantId.toLowerCase(),
    invalidHosts,
  );
  markDuplicateHosts(
    entries,
    (entry) => (entry.kind === "main" ? undefined : entry.projectUrl),
    invalidHosts,
  );
  markDuplicateHosts(
    entries,
    (entry) => (entry.kind === "main" ? undefined : entry.serviceRoleKeyRef),
    invalidHosts,
  );

  const validEntries = entries.filter((entry) => !invalidHosts.has(entry.host));
  if (validEntries.length === 0) {
    throw new Error(
      "Invalid tenant directory configuration: TENANT_DIRECTORY_JSON.entries has no valid host entries",
    );
  }

  return Object.freeze({
    version: 1,
    entries: Object.freeze(validEntries),
    invalidHosts: Object.freeze([...invalidHosts]),
  });
}
