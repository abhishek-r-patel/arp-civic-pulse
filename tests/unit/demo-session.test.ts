import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  demoPersonaPassword,
  signInAsDemoPersona,
} from "@/server/demo/session";
import { ApiError } from "@/server/http/errors";
import { demoSessionSchema } from "@/shared/demo";
import { testTenantContext } from "../fixtures/tenant-context";

/*
 * Logic tests with injected fakes for the demo persona sign-in. They prove the
 * host guard, rate limiting and failure mapping; real Supabase Auth behaviour
 * is verified on the hosted demo.
 */
vi.mock("server-only", () => ({}));

const USER_ID = "22222222-2222-4222-8222-222222222222";
const SERVICE_KEY = "sb_secret_demo_unit_test_key";
type Fake = Record<string, unknown>;
const asClient = (value: Fake) => value as unknown as SupabaseClient;
const demoTenant = {
  ...testTenantContext,
  kind: "demo" as const,
  serviceRoleKeyRef: "DEMO_UNIT_SERVICE_KEY",
};
const signedIn = {
  data: { user: { id: USER_ID }, session: { access_token: "t" } },
  error: null,
};
const wrongPassword = {
  data: { user: null, session: null },
  error: { code: "invalid_credentials", status: 400 },
};

function setup({
  allowed = true,
  link = { data: { user: { id: USER_ID } }, error: null } as Fake,
  signIns = [signedIn] as Fake[],
  updated = { data: {}, error: null } as Fake,
  row = {
    id: USER_ID,
    representative_name: "Asha Demo",
    is_admin: false,
  } as Fake | null,
  tenant = demoTenant as typeof testTenantContext,
} = {}) {
  vi.stubEnv("DEMO_UNIT_SERVICE_KEY", SERVICE_KEY);
  const generateLink = vi.fn().mockResolvedValue(link);
  const updateUserById = vi.fn().mockResolvedValue(updated);
  const rpc = vi.fn().mockResolvedValue({
    data: { allowed, count: 1, retryAfterSeconds: allowed ? 0 : 60 },
    error: null,
  });
  const signInWithPassword = vi.fn();
  for (const result of signIns)
    signInWithPassword.mockResolvedValueOnce(result);
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  const deps = {
    tenant,
    admin: asClient({ rpc, auth: { admin: { generateLink, updateUserById } } }),
    client: asClient({
      from: () => query,
      auth: { signInWithPassword, signOut },
    }),
  };
  return {
    deps,
    generateLink,
    updateUserById,
    signInWithPassword,
    signOut,
    rpc,
  };
}

async function failure(action: Promise<unknown>): Promise<ApiError> {
  try {
    await action;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("Expected an ApiError.");
}

describe("signInAsDemoPersona", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("signs in with the server-derived persona password", async () => {
    const { deps, signInWithPassword, generateLink } = setup();
    await expect(signInAsDemoPersona(deps, "resident")).resolves.toMatchObject({
      id: USER_ID,
      representativeName: "Asha Demo",
    });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "demo-resident@example.com",
      password: demoPersonaPassword(SERVICE_KEY, "demo-resident@example.com"),
    });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("derives a different, key-bound password per persona", () => {
    const resident = demoPersonaPassword(SERVICE_KEY, "a@example.com");
    expect(resident).toBe(demoPersonaPassword(SERVICE_KEY, "a@example.com"));
    expect(resident).not.toBe(
      demoPersonaPassword(SERVICE_KEY, "b@example.com"),
    );
    expect(resident).not.toBe(demoPersonaPassword("other", "a@example.com"));
    expect(resident).not.toContain(SERVICE_KEY);
  });

  it("is not found on any host other than the demo", async () => {
    const { deps, signInWithPassword } = setup({ tenant: testTenantContext });
    expect((await failure(signInAsDemoPersona(deps, "resident"))).code).toBe(
      "NOT_FOUND",
    );
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("stops before Auth when the shared demo limit is reached", async () => {
    const { deps, signInWithPassword } = setup({ allowed: false });
    expect((await failure(signInAsDemoPersona(deps, "resident"))).code).toBe(
      "RATE_LIMITED",
    );
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("sets the password once and signs in when it does not match yet", async () => {
    const { deps, updateUserById, signInWithPassword } = setup({
      signIns: [wrongPassword, signedIn],
    });
    await expect(signInAsDemoPersona(deps, "resident")).resolves.toMatchObject({
      id: USER_ID,
    });
    expect(updateUserById).toHaveBeenCalledWith(USER_ID, {
      password: demoPersonaPassword(SERVICE_KEY, "demo-resident@example.com"),
    });
    expect(signInWithPassword).toHaveBeenCalledTimes(2);
  });

  it("fails closed with a reset message when the persona is missing", async () => {
    const { deps, updateUserById } = setup({
      signIns: [wrongPassword],
      link: { data: null, error: { code: "user_not_found", status: 404 } },
    });
    const error = await failure(signInAsDemoPersona(deps, "committee"));
    expect(error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(error.message).toContain("demo is being reset");
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("maps a sign-in that still fails after the repair to AUTH_UNAVAILABLE", async () => {
    const { deps } = setup({ signIns: [wrongPassword, wrongPassword] });
    expect((await failure(signInAsDemoPersona(deps, "resident"))).code).toBe(
      "AUTH_UNAVAILABLE",
    );
  });

  it("does not repair the password on other Auth failures", async () => {
    const { deps, updateUserById } = setup({
      signIns: [
        {
          data: { user: null, session: null },
          error: { code: "over_request_rate_limit", status: 429 },
        },
      ],
    });
    expect((await failure(signInAsDemoPersona(deps, "resident"))).code).toBe(
      "AUTH_UNAVAILABLE",
    );
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("fails closed when the demo service key is not configured", async () => {
    const { deps, signInWithPassword } = setup();
    vi.stubEnv("DEMO_UNIT_SERVICE_KEY", "");
    expect((await failure(signInAsDemoPersona(deps, "resident"))).code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs out and fails closed when the persona profile is not enabled", async () => {
    const { deps, signOut } = setup({ row: null });
    expect((await failure(signInAsDemoPersona(deps, "resident"))).code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("demoSessionSchema", () => {
  it("accepts only known personas and no extra fields", () => {
    expect(demoSessionSchema.safeParse({ persona: "resident" }).success).toBe(
      true,
    );
    expect(demoSessionSchema.safeParse({ persona: "admin" }).success).toBe(
      true,
    );
    expect(demoSessionSchema.safeParse({ persona: "owner" }).success).toBe(
      false,
    );
    expect(
      demoSessionSchema.safeParse({ persona: "resident", email: "x" }).success,
    ).toBe(false);
  });
});
