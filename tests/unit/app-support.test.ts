// App Support Access service ordering: identity from configuration, fail-safe Auth bans, early refusals.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/server/http/errors";
import type { RegisterDeps } from "@/server/register/shared";
import { setAppSupportAccess } from "@/server/settings/app-support";
import { appSupportAccessSchema } from "@/shared/contracts/app-support";
import { testTenantContext } from "../fixtures/tenant-context";

const env: { APP_SUPPORT_EMAIL?: string } = {};
vi.mock("@/server/config/environment", () => ({ getEnvironment: () => env }));

const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPORT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PREVIOUS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const adminRow = { id: ACTOR, representative_name: "Asha", is_admin: true };

type Result = { data: unknown; error: unknown; status?: number };
const ok = (data: unknown): Result => ({ data, error: null, status: 200 });

function world(profileReads: Result[], rpcResult: Result) {
  const events: string[] = [];
  const queue = [...profileReads];
  const query = () => {
    const result = queue.shift() ?? ok(null);
    const chain = {
      select: () => chain,
      eq: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(result),
      returns: () => Promise.resolve(result),
    };
    return chain;
  };
  const client = {
    from: (table: string) => {
      events.push(`read:${table}`);
      return query();
    },
  };
  const admin = {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      events.push(`rpc:${name}:${String(args.p_enabled)}`);
      return Promise.resolve(rpcResult);
    }),
    auth: {
      admin: {
        createUser: vi.fn(() => {
          events.push("auth:create");
          return Promise.resolve({
            data: { user: { id: SUPPORT } },
            error: null,
          });
        }),
        updateUserById: vi.fn(
          (id: string, change: { ban_duration: string }) => {
            events.push(`auth:ban:${id}:${change.ban_duration}`);
            return Promise.resolve({ data: {}, error: null });
          },
        ),
      },
    },
  };
  const deps: RegisterDeps = {
    tenant: testTenantContext,
    client: client as unknown as SupabaseClient,
    admin: admin as unknown as SupabaseClient,
    actor: { id: ACTOR, representativeName: "Asha", isAdmin: true },
  };
  return { deps, events, admin };
}

describe("App Support Access service", () => {
  beforeEach(() => {
    delete env.APP_SUPPORT_EMAIL;
  });

  it("accepts only a boolean toggle; the email never comes from the request", () => {
    expect(appSupportAccessSchema.safeParse({ enabled: true }).success).toBe(
      true,
    );
    expect(
      appSupportAccessSchema.safeParse({
        enabled: true,
        email: "someone@example.test",
      }).success,
    ).toBe(false);
  });

  it("refuses to enable without a configured support email, before any Auth or database change", async () => {
    const { deps, events } = world([ok(adminRow)], ok(null));
    const failure = await setAppSupportAccess(deps, { enabled: true }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).context).toEqual({
      reason: "APP_SUPPORT_NOT_CONFIGURED",
    });
    expect(events).toEqual(["read:profiles"]);
  });

  it("allows Auth sign-in before enabling, then bans every revoked support identity", async () => {
    env.APP_SUPPORT_EMAIL = "support@example.test";
    const { deps, events } = world(
      [
        ok(adminRow),
        ok(null),
        ok(adminRow),
        ok(adminRow),
        ok([{ id: SUPPORT }]),
      ],
      ok({ enabled: true, changed: true, revokedProfileIds: [PREVIOUS] }),
    );
    expect(await setAppSupportAccess(deps, { enabled: true })).toEqual({
      configured: true,
      email: "support@example.test",
      enabled: true,
    });
    expect(events).toEqual([
      "read:profiles",
      "auth:create",
      "read:profiles",
      "read:profiles",
      `auth:ban:${SUPPORT}:none`,
      "rpc:set_app_support_access:true",
      "read:profiles",
      `auth:ban:${PREVIOUS}:876000h`,
      "read:profiles",
    ]);
  });

  it("refuses an email that already belongs to an RWA account before changing its Auth ban", async () => {
    env.APP_SUPPORT_EMAIL = "support@example.test";
    const { deps, events, admin } = world(
      [ok(adminRow), ok({ is_app_support: false })],
      ok(null),
    );
    const failure = await setAppSupportAccess(deps, { enabled: true }).catch(
      (error: unknown) => error,
    );
    expect((failure as ApiError).code).toBe("REGISTER_CONFLICT");
    expect((failure as ApiError).context).toEqual({
      reason: "APP_SUPPORT_EMAIL_IN_USE",
    });
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(events).not.toContain("rpc:set_app_support_access:true");
  });

  it("suspends in the database before blocking Auth sign-in when turned off, even if unconfigured", async () => {
    const { deps, events } = world(
      [ok(adminRow), ok(adminRow), ok([])],
      ok({ enabled: false, changed: true, revokedProfileIds: [SUPPORT] }),
    );
    expect(await setAppSupportAccess(deps, { enabled: false })).toEqual({
      configured: false,
      email: null,
      enabled: false,
    });
    expect(events).toEqual([
      "read:profiles",
      "rpc:set_app_support_access:false",
      "read:profiles",
      `auth:ban:${SUPPORT}:876000h`,
      "read:profiles",
    ]);
  });
});
