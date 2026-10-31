// Tenant directory validation, fail-closed routing, and concurrent context isolation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnvironment } from "@/server/config/environment";
import { resolveTenantContext } from "@/server/config/tenant-context";
import type { TenantDirectoryEntry } from "@/server/config/tenant-directory";
import { createAdminClient, createUserClient } from "@/server/db/clients";
import { ApiError } from "@/server/http/errors";

const { createClientMock, createServerClientMock, cookiesMock } = vi.hoisted(
  () => ({
    createClientMock: vi.fn(),
    createServerClientMock: vi.fn(),
    cookiesMock: vi.fn(),
  }),
);
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

const demoId = "10000000-0000-4000-8000-000000000001";
const customerId = "20000000-0000-4000-8000-000000000002";
const secretRef = (tenantId: string) =>
  `TENANT_${tenantId.replaceAll("-", "").toUpperCase()}_SUPABASE_SERVICE_ROLE_KEY`;

const demoEntry: TenantDirectoryEntry = {
  host: "demo.example.test",
  kind: "demo",
  tenantId: demoId,
  state: "active",
  projectUrl: "https://demo-project.supabase.co",
  publishableKey: "sb_publishable_demo",
  serviceRoleKeyRef: secretRef(demoId),
};
const customerEntry: TenantDirectoryEntry = {
  host: "alpha.example.test",
  kind: "customer",
  tenantId: customerId,
  state: "active",
  projectUrl: "https://alpha-project.supabase.co",
  publishableKey: "sb_publishable_alpha",
  serviceRoleKeyRef: secretRef(customerId),
};
const mainEntry: TenantDirectoryEntry = {
  host: "example.test",
  kind: "main",
  state: "active",
};

function routedEnvironment(
  entries: TenantDirectoryEntry[] = [mainEntry, demoEntry, customerEntry],
) {
  return parseEnvironment({
    NODE_ENV: "production",
    APP_ORIGIN: "https://example.test",
    RATE_LIMIT_HMAC_KEY: "x".repeat(32),
    TENANT_ROUTING_ENABLED: "true",
    TENANT_DIRECTORY_JSON: JSON.stringify({ version: 1, entries }),
  });
}

function apiCode(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof ApiError ? error.code : undefined;
  }
  return undefined;
}

afterEach(() => {
  vi.unstubAllEnvs();
  createClientMock.mockReset();
  createServerClientMock.mockReset();
  cookiesMock.mockReset();
});

describe("tenant directory routing", () => {
  const environment = routedEnvironment();
  const secrets = {
    [secretRef(demoId)]: "sb_secret_demo",
    [secretRef(customerId)]: "sb_secret_alpha",
  };

  it("allows routed production config without a shared RWA backend", () => {
    expect(environment.TENANT_ROUTING_ENABLED).toBe(true);
    expect(environment.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(environment.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it("routes an exact customer host to its own immutable, secret-free context", () => {
    const tenant = resolveTenantContext(
      "alpha.example.test",
      environment,
      secrets,
    );

    expect(tenant).toMatchObject({
      tenantId: customerId,
      kind: "customer",
      projectUrl: "https://alpha-project.supabase.co",
      publishableKey: "sb_publishable_alpha",
      serviceRoleKeyRef: secretRef(customerId),
    });
    expect(Object.isFrozen(tenant)).toBe(true);
    expect(JSON.stringify(tenant)).not.toContain("sb_secret_alpha");
  });

  it("keeps concurrent demo and customer resolutions isolated", async () => {
    const [demo, customer] = await Promise.all([
      Promise.resolve().then(() =>
        resolveTenantContext("demo.example.test", environment, secrets),
      ),
      Promise.resolve().then(() =>
        resolveTenantContext("alpha.example.test", environment, secrets),
      ),
    ]);

    expect(demo).toMatchObject({
      tenantId: demoId,
      kind: "demo",
      projectUrl: "https://demo-project.supabase.co",
      publishableKey: "sb_publishable_demo",
    });
    expect(customer).toMatchObject({
      tenantId: customerId,
      kind: "customer",
      projectUrl: "https://alpha-project.supabase.co",
      publishableKey: "sb_publishable_alpha",
    });
  });

  it("binds concurrent privileged clients to each tenant project and secret reference", async () => {
    vi.stubEnv(secretRef(demoId), "sb_secret_demo");
    vi.stubEnv(secretRef(customerId), "sb_secret_alpha");
    const demo = resolveTenantContext(
      "demo.example.test",
      environment,
      secrets,
    );
    const customer = resolveTenantContext(
      "alpha.example.test",
      environment,
      secrets,
    );

    await Promise.all([createAdminClient(demo), createAdminClient(customer)]);

    expect(createClientMock).toHaveBeenCalledWith(
      "https://demo-project.supabase.co",
      "sb_secret_demo",
      expect.any(Object),
    );
    expect(createClientMock).toHaveBeenCalledWith(
      "https://alpha-project.supabase.co",
      "sb_secret_alpha",
      expect.any(Object),
    );
  });

  it("binds user clients to separate tenant session-cookie namespaces", async () => {
    vi.stubEnv("NODE_ENV", "test");
    cookiesMock.mockResolvedValue({
      getAll: () => [],
      set: vi.fn(),
    });
    const demo = resolveTenantContext(
      "demo.example.test",
      environment,
      secrets,
    );
    const customer = resolveTenantContext(
      "alpha.example.test",
      environment,
      secrets,
    );

    await Promise.all([createUserClient(demo), createUserClient(customer)]);

    expect(createServerClientMock).toHaveBeenCalledWith(
      "https://demo-project.supabase.co",
      "sb_publishable_demo",
      expect.objectContaining({
        cookieOptions: { name: `cp-${demoId}-auth-token` },
      }),
    );
    expect(createServerClientMock).toHaveBeenCalledWith(
      "https://alpha-project.supabase.co",
      "sb_publishable_alpha",
      expect.objectContaining({
        cookieOptions: { name: `cp-${customerId}-auth-token` },
      }),
    );
  });

  it("gives the main host no RWA backend", () => {
    expect(
      resolveTenantContext("example.test", environment, secrets),
    ).toMatchObject({
      kind: "main",
      tenantId: undefined,
      projectUrl: undefined,
      publishableKey: undefined,
      serviceRoleKeyRef: undefined,
    });
  });

  it.each([
    "unknown.example.test",
    "alpha.example.test.attacker.test",
    "alpha.example.test:443",
    "192.0.2.1",
  ])("rejects untrusted or malformed host %s without fallback", (host) => {
    expect(
      apiCode(() => resolveTenantContext(host, environment, secrets)),
    ).toBe("NOT_FOUND");
  });

  it.each(["provisioning", "unavailable"] as const)(
    "keeps a %s tenant unavailable",
    (state) => {
      const entries = [
        mainEntry,
        demoEntry,
        { ...customerEntry, state },
      ] satisfies TenantDirectoryEntry[];
      expect(
        apiCode(() =>
          resolveTenantContext(
            "alpha.example.test",
            routedEnvironment(entries),
            secrets,
          ),
        ),
      ).toBe("DEPENDENCY_UNAVAILABLE");
    },
  );

  it("fails closed for missing or malformed per-tenant credentials", () => {
    expect(
      apiCode(() =>
        resolveTenantContext("alpha.example.test", environment, {}),
      ),
    ).toBe("DEPENDENCY_UNAVAILABLE");
    expect(
      apiCode(() =>
        resolveTenantContext("alpha.example.test", environment, {
          ...secrets,
          [secretRef(customerId)]: "sb_secret_",
        }),
      ),
    ).toBe("DEPENDENCY_UNAVAILABLE");
    const unsafePublicKey = routedEnvironment([
      mainEntry,
      demoEntry,
      { ...customerEntry, publishableKey: "sb_secret_wrong" },
    ]);
    expect(
      apiCode(() =>
        resolveTenantContext("alpha.example.test", unsafePublicKey, secrets),
      ),
    ).toBe("DEPENDENCY_UNAVAILABLE");
  });

  it("fails globally on an invalid envelope and isolates bad entries", () => {
    expect(() => routedEnvironment([])).toThrow(/entries/u);
    expect(() =>
      routedEnvironment([
        {
          ...customerEntry,
          projectUrl: "https://not-a-supabase-project.example.test",
        },
      ]),
    ).toThrow(/no valid host entries/u);

    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        APP_ORIGIN: "https://example.test",
        RATE_LIMIT_HMAC_KEY: "x".repeat(32),
        TENANT_ROUTING_ENABLED: "true",
        TENANT_DIRECTORY_JSON: "{",
      }),
    ).toThrow(/TENANT_DIRECTORY_JSON/u);

    const duplicateHost = routedEnvironment([
      mainEntry,
      { ...mainEntry },
      demoEntry,
      customerEntry,
    ]);
    expect(
      apiCode(() =>
        resolveTenantContext("example.test", duplicateHost, secrets),
      ),
    ).toBe("DEPENDENCY_UNAVAILABLE");
    expect(
      resolveTenantContext("alpha.example.test", duplicateHost, secrets).kind,
    ).toBe("customer");

    const duplicateTenant = routedEnvironment([
      mainEntry,
      demoEntry,
      {
        ...customerEntry,
        tenantId: demoId,
        serviceRoleKeyRef: secretRef(demoId),
      },
    ]);
    expect(
      apiCode(() =>
        resolveTenantContext("demo.example.test", duplicateTenant, secrets),
      ),
    ).toBe("DEPENDENCY_UNAVAILABLE");
    expect(
      apiCode(() =>
        resolveTenantContext("alpha.example.test", duplicateTenant, secrets),
      ),
    ).toBe("DEPENDENCY_UNAVAILABLE");

    const invalidProject = routedEnvironment([
      mainEntry,
      demoEntry,
      { ...customerEntry, projectUrl: "https://alpha-project.example.test" },
    ]);
    expect(
      apiCode(() =>
        resolveTenantContext("alpha.example.test", invalidProject, secrets),
      ),
    ).toBe("DEPENDENCY_UNAVAILABLE");
    expect(
      resolveTenantContext("demo.example.test", invalidProject, secrets).kind,
    ).toBe("demo");

    const duplicateProject = routedEnvironment([
      mainEntry,
      demoEntry,
      { ...customerEntry, projectUrl: demoEntry.projectUrl },
    ]);
    expect(
      apiCode(() =>
        resolveTenantContext("demo.example.test", duplicateProject, secrets),
      ),
    ).toBe("DEPENDENCY_UNAVAILABLE");
    expect(
      apiCode(() =>
        resolveTenantContext("alpha.example.test", duplicateProject, secrets),
      ),
    ).toBe("DEPENDENCY_UNAVAILABLE");

    const invalidSecretReference = routedEnvironment([
      mainEntry,
      demoEntry,
      {
        ...customerEntry,
        serviceRoleKeyRef:
          "TENANT_30000000000040008000000000000003_SUPABASE_SERVICE_ROLE_KEY",
      },
    ]);
    expect(
      apiCode(() =>
        resolveTenantContext(
          "alpha.example.test",
          invalidSecretReference,
          secrets,
        ),
      ),
    ).toBe("DEPENDENCY_UNAVAILABLE");

    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        APP_ORIGIN: "https://example.test",
        RATE_LIMIT_HMAC_KEY: "x".repeat(32),
        TENANT_ROUTING_ENABLED: "true",
        TENANT_DIRECTORY_JSON: JSON.stringify({
          version: 2,
          entries: [],
        }),
      }),
    ).toThrow(/version/u);
  });

  it("limits legacy mode to the configured canonical host", () => {
    const legacy = parseEnvironment({
      APP_ORIGIN: "https://alpha.example.test",
      NEXT_PUBLIC_SUPABASE_URL: "https://alpha-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_alpha",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_alpha",
    });

    expect(resolveTenantContext("alpha.example.test", legacy)).toMatchObject({
      kind: "single",
      tenantId: "single-rwa",
    });
    expect(
      apiCode(() => resolveTenantContext("other.example.test", legacy)),
    ).toBe("NOT_FOUND");

    const localBrowserOrigin = parseEnvironment({
      APP_ORIGIN: "http://127.0.0.1:3100",
    });
    expect(
      resolveTenantContext("127.0.0.1:3100", localBrowserOrigin).kind,
    ).toBe("single");
  });

  it("accepts the Vercel Preview deployment's own hosts in single-tenant mode", () => {
    const legacy = parseEnvironment({
      APP_ORIGIN: "https://alpha.example.test",
    });
    const preview = {
      VERCEL_ENV: "preview",
      VERCEL_URL: "app-abc123-team.vercel.app",
      VERCEL_BRANCH_URL: "app-git-feature-team.vercel.app",
    };

    for (const host of [preview.VERCEL_URL, preview.VERCEL_BRANCH_URL]) {
      expect(resolveTenantContext(host, legacy, preview)).toMatchObject({
        kind: "single",
        hostname: host,
        canonicalOrigin: `https://${host}`,
      });
    }
    expect(
      apiCode(() =>
        resolveTenantContext("other-xyz-team.vercel.app", legacy, preview),
      ),
    ).toBe("NOT_FOUND");
  });

  it("keeps Production and directory mode exact-host only", () => {
    const legacy = parseEnvironment({
      APP_ORIGIN: "https://alpha.example.test",
    });
    const production = {
      VERCEL_ENV: "production",
      VERCEL_URL: "app-abc123-team.vercel.app",
    };
    expect(
      apiCode(() =>
        resolveTenantContext(production.VERCEL_URL, legacy, production),
      ),
    ).toBe("NOT_FOUND");

    const malformed = {
      VERCEL_ENV: "preview",
      VERCEL_URL: "https://app.vercel.app/path",
    };
    expect(
      apiCode(() => resolveTenantContext("app.vercel.app", legacy, malformed)),
    ).toBe("NOT_FOUND");

    const routed = routedEnvironment([mainEntry, demoEntry, customerEntry]);
    expect(
      apiCode(() =>
        resolveTenantContext("app-abc123-team.vercel.app", routed, {
          VERCEL_ENV: "preview",
          VERCEL_URL: "app-abc123-team.vercel.app",
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});
