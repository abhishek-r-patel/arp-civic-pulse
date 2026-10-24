import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  requestCode,
  signOut,
  verifyCode,
  MINIMUM_CODE_REQUEST_MS,
} from "@/server/auth/otp";
import { enforceRateLimit, subjectDigest } from "@/server/auth/rate-limit";
import {
  getVerifiedUserId,
  loadEnabledAccount,
  requireAccount,
  requireAdmin,
} from "@/server/authorization/account";
import { toApiError } from "@/server/db/errors";
import { ApiError } from "@/server/http/errors";
import {
  enableAccount,
  provisionAccount,
} from "@/server/register/provisioning";
import { CODE_RESEND_SECONDS } from "@/shared/contracts/auth";

/*
 * Logic tests with injected fakes. They prove our mapping, ordering and
 * redaction decisions; they do NOT prove Supabase Auth behaviour (codes,
 * expiry, sessions, cookies), which needs a real project.
 */
const USER_ID = "11111111-1111-4111-8111-111111111111";
type Fake = Record<string, unknown>;
const asClient = (value: Fake) => value as unknown as SupabaseClient;

function codeOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}
async function failure(action: Promise<unknown>): Promise<ApiError> {
  try {
    await action;
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an ApiError.");
}

const allowAdmin = (allowed = true, retryAfterSeconds = 0) =>
  asClient({
    rpc: vi.fn().mockResolvedValue({
      data: { allowed, count: 1, retryAfterSeconds },
      error: null,
    }),
  });

function profileClient(row: Fake | null, extra: Fake = {}): SupabaseClient {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return asClient({ from: () => query, ...extra });
}

describe("toApiError", () => {
  it.each([
    ["VOTE_FROZEN", "VOTE_FROZEN"],
    ["FORBIDDEN", "FORBIDDEN"],
    ["ACTIVATION_BLOCKED", "ACTIVATION_BLOCKED"],
    ["VOTING_CLOSED", "VOTING_CLOSED"],
    ["AUTH_IDENTITY_MISSING", "PROVISIONING_INCOMPLETE"],
    ["IMMUTABLE_RECORD", "LIFECYCLE_CONFLICT"],
    ["BALLOT_TYPE_MISMATCH", "VALIDATION_FAILED"],
  ])("maps the database token %s to %s", (token, expected) => {
    expect(
      toApiError({ code: "P0001", message: token, status: 400 }).code,
    ).toBe(expected);
  });

  it("never surfaces unknown or internal tokens, details or SQL text", () => {
    for (const message of [
      "INVARIANT_VIOLATION",
      "select * from votes",
      "INTERNAL_ERROR",
      "",
    ]) {
      const error = toApiError({ code: "P0001", message, status: 400 });
      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.message).not.toContain("select");
    }
  });

  it("maps privilege, uniqueness and connectivity failures", () => {
    expect(
      toApiError({
        code: "42501",
        message: "permission denied for table votes",
        status: 403,
      }).code,
    ).toBe("FORBIDDEN");
    expect(toApiError({ code: "23505", status: 409 }).code).toBe(
      "REGISTER_CONFLICT",
    );
    expect(toApiError({ status: 503 }).code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(toApiError({ code: "08006" }).code).toBe("DEPENDENCY_UNAVAILABLE");
    // A bounded lock wait or statement timeout is temporary, never a domain outcome.
    expect(toApiError({ code: "55P03", status: 400 }).code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
    expect(toApiError({ code: "57014", status: 400 }).code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
    expect(toApiError({ code: "22P02", status: 400 }).code).toBe(
      "INTERNAL_ERROR",
    );
  });
});

describe("rate limiting", () => {
  it("derives stable, keyed, 32-byte digests that separate subject kinds and keys", () => {
    const key = Buffer.alloc(32, 7);
    const digest = subjectDigest("email", "a@example.test", key);
    expect(digest).toHaveLength(32);
    expect(subjectDigest("email", "a@example.test", key).equals(digest)).toBe(
      true,
    );
    expect(subjectDigest("ip", "a@example.test", key).equals(digest)).toBe(
      false,
    );
    expect(subjectDigest("email", "b@example.test", key).equals(digest)).toBe(
      false,
    );
    expect(
      subjectDigest("email", "a@example.test", Buffer.alloc(32, 8)).equals(
        digest,
      ),
    ).toBe(false);
    expect(digest.toString("utf8")).not.toContain("example");
  });

  it("sends only a digest, never the raw subject", async () => {
    const admin = allowAdmin();
    await enforceRateLimit(
      admin,
      { scope: "auth.code.email", limit: 5, windowSeconds: 900 },
      "email",
      "resident@example.test",
    );
    const args = JSON.stringify(
      (admin.rpc as ReturnType<typeof vi.fn>).mock.calls,
    );
    expect(args).not.toContain("resident@example.test");
    expect(args).toContain("auth.code.email");
  });

  it("rejects with RATE_LIMITED and whole-second Retry-After", async () => {
    const error = await failure(
      enforceRateLimit(
        allowAdmin(false, 42),
        { scope: "s", limit: 1, windowSeconds: 60 },
        "email",
        "x",
      ),
    );
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(42);
  });

  it("fails closed when the limiter is unavailable", async () => {
    const admin = asClient({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "08006", message: "down" },
      }),
    });
    expect(
      codeOf(
        await failure(
          enforceRateLimit(
            admin,
            { scope: "s", limit: 1, windowSeconds: 60 },
            "email",
            "x",
          ),
        ),
      ),
    ).toBe("AUTH_UNAVAILABLE");
  });
});

describe("requestCode", () => {
  const deps = (
    signInWithOtp: ReturnType<typeof vi.fn>,
    admin = allowAdmin(),
  ) => ({
    client: asClient({ auth: { signInWithOtp } }),
    admin,
    wait: vi.fn().mockResolvedValue(undefined),
    clock: vi.fn().mockReturnValue(0),
  });

  it("requests a code without ever creating users", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ data: {}, error: null });
    const result = await requestCode(deps(signInWithOtp), "a@example.test");

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "a@example.test",
      options: { shouldCreateUser: false },
    });
    expect(result).toEqual({ resendAfterSeconds: CODE_RESEND_SECONDS });
  });

  it("returns the identical outcome when Auth declines the address (unknown, disabled, throttled)", async () => {
    const declined = [
      { status: 422, code: "signup_disabled" },
      { status: 400, code: "user_banned" },
      { status: 429, code: "over_email_send_rate_limit" },
    ];
    for (const error of declined) {
      const result = await requestCode(
        deps(vi.fn().mockResolvedValue({ data: null, error })),
        "a@example.test",
      );
      expect(result).toEqual({ resendAfterSeconds: CODE_RESEND_SECONDS });
    }
  });

  it("reports only a uniform outage for provider/network failures", async () => {
    for (const error of [
      { status: 500 },
      { status: 502 },
      { status: undefined },
    ]) {
      expect(
        codeOf(
          await failure(
            requestCode(
              deps(vi.fn().mockResolvedValue({ data: null, error })),
              "a@example.test",
            ),
          ),
        ),
      ).toBe("AUTH_UNAVAILABLE");
    }
  });

  it("applies the application budget before contacting Auth", async () => {
    const signInWithOtp = vi.fn();
    const error = await failure(
      requestCode(deps(signInWithOtp, allowAdmin(false, 30)), "a@example.test"),
    );
    expect(error.code).toBe("RATE_LIMITED");
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("pads fast responses to the minimum duration, including rejections", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValue(100);
    await requestCode(
      {
        client: asClient({
          auth: {
            signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
          },
        }),
        admin: allowAdmin(),
        wait,
        clock,
      },
      "a@example.test",
    );
    expect(wait).toHaveBeenCalledWith(MINIMUM_CODE_REQUEST_MS - 100);

    const rejectedWait = vi.fn().mockResolvedValue(undefined);
    await failure(
      requestCode(
        {
          client: asClient({ auth: { signInWithOtp: vi.fn() } }),
          admin: allowAdmin(false),
          wait: rejectedWait,
          clock: () => 0,
        },
        "a@example.test",
      ),
    );
    expect(rejectedWait).toHaveBeenCalled();
  });
});

describe("verifyCode", () => {
  const session = { user: { id: USER_ID }, session: { access_token: "t" } };
  const make = (
    verifyOtp: ReturnType<typeof vi.fn>,
    row: Fake | null,
    signOutFn = vi.fn().mockResolvedValue({ error: null }),
  ) => ({
    client: profileClient(row, { auth: { verifyOtp, signOut: signOutFn } }),
    admin: allowAdmin(),
    signOutFn,
  });

  it("returns the account only for a verified code and an enabled profile", async () => {
    const { client, admin } = make(
      vi.fn().mockResolvedValue({ data: session, error: null }),
      { id: USER_ID, representative_name: "Alice Rao", is_admin: false },
    );
    await expect(
      verifyCode({ client, admin }, "a@example.test", "123456"),
    ).resolves.toEqual({
      id: USER_ID,
      representativeName: "Alice Rao",
      isAdmin: false,
    });
  });

  it("verifies with the normalised email and token as an email OTP", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ data: session, error: null });
    const { client, admin } = make(verifyOtp, {
      id: USER_ID,
      representative_name: "A",
      is_admin: true,
    });
    await verifyCode({ client, admin }, "a@example.test", "123456");
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "a@example.test",
      token: "123456",
      type: "email",
    });
  });

  it("does not distinguish invalid, expired or unknown codes", async () => {
    for (const error of [
      { status: 403, code: "otp_expired" },
      { status: 400, code: "validation_failed" },
      { status: 422, code: "user_not_found" },
    ]) {
      const { client, admin } = make(
        vi
          .fn()
          .mockResolvedValue({ data: { user: null, session: null }, error }),
        null,
      );
      expect(
        codeOf(
          await failure(
            verifyCode({ client, admin }, "a@example.test", "123456"),
          ),
        ),
      ).toBe("CODE_INVALID_OR_EXPIRED");
    }
  });

  it("maps provider throttling and outages", async () => {
    const throttled = make(
      vi.fn().mockResolvedValue({ data: {}, error: { status: 429 } }),
      null,
    );
    expect(
      (await failure(verifyCode(throttled, "a@example.test", "123456"))).code,
    ).toBe("RATE_LIMITED");

    const down = make(
      vi.fn().mockResolvedValue({ data: {}, error: { status: 503 } }),
      null,
    );
    expect(
      codeOf(await failure(verifyCode(down, "a@example.test", "123456"))),
    ).toBe("AUTH_UNAVAILABLE");
  });

  it("signs out and refuses an Auth session that has no enabled application profile", async () => {
    const { client, admin, signOutFn } = make(
      vi.fn().mockResolvedValue({ data: session, error: null }),
      null,
    );
    const error = await failure(
      verifyCode({ client, admin }, "a@example.test", "123456"),
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(signOutFn).toHaveBeenCalledWith({ scope: "local" });
  });

  it("does not verify when the application budget is exhausted", async () => {
    const verifyOtp = vi.fn();
    const client = asClient({ auth: { verifyOtp } });
    const error = await failure(
      verifyCode(
        { client, admin: allowAdmin(false, 20) },
        "a@example.test",
        "123456",
      ),
    );
    expect(error.code).toBe("RATE_LIMITED");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("succeeds, and treats an already-missing session as success", async () => {
    await signOut({
      client: asClient({
        auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
      }),
    });
    await signOut({
      client: asClient({
        auth: {
          signOut: vi.fn().mockResolvedValue({
            error: { name: "AuthSessionMissingError", status: 400 },
          }),
        },
      }),
    });
  });

  it("surfaces genuine failures instead of reporting success", async () => {
    const client = asClient({
      auth: {
        signOut: vi.fn().mockResolvedValue({
          error: { name: "AuthRetryableFetchError", status: 502 },
        }),
      },
    });
    expect(codeOf(await failure(signOut({ client })))).toBe("AUTH_UNAVAILABLE");
  });
});

describe("current account and authorization", () => {
  const verified = (user: Fake | null, error: Fake | null = null) => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error }) },
  });

  it("verifies identity with the Auth server rather than trusting the cookie session", async () => {
    const client = asClient(verified({ id: USER_ID }));
    await expect(getVerifiedUserId(client)).resolves.toBe(USER_ID);
    expect(
      (client as unknown as { auth: { getUser: unknown } }).auth
        .getUser as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalled();
  });

  it("treats a missing session as signed out but an Auth outage as an error", async () => {
    await expect(
      getVerifiedUserId(
        asClient(
          verified(null, { name: "AuthSessionMissingError", status: 400 }),
        ),
      ),
    ).resolves.toBeNull();
    await expect(
      getVerifiedUserId(
        asClient(verified(null, { name: "AuthApiError", status: 401 })),
      ),
    ).resolves.toBeNull();
    expect(
      codeOf(
        await failure(
          getVerifiedUserId(
            asClient(
              verified(null, { name: "AuthRetryableFetchError", status: 502 }),
            ),
          ),
        ),
      ),
    ).toBe("AUTH_UNAVAILABLE");
  });

  it("yields no account for a suspended, deleted or profile-less identity", async () => {
    // RLS withholds the row, so the profile query returns nothing.
    await expect(
      loadEnabledAccount(profileClient(null), USER_ID),
    ).resolves.toBeNull();
  });

  it("returns 401 without a session and 403 without an enabled profile", async () => {
    expect(
      codeOf(
        await failure(
          requireAccount(
            asClient(verified(null, { name: "AuthSessionMissingError" })),
          ),
        ),
      ),
    ).toBe("AUTH_REQUIRED");

    const noProfile = profileClient(null, verified({ id: USER_ID }));
    expect(codeOf(await failure(requireAccount(noProfile)))).toBe("FORBIDDEN");
  });

  it("requires the administrator flag from the current profile, not token claims", async () => {
    const member = profileClient(
      { id: USER_ID, representative_name: "A", is_admin: false },
      {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: USER_ID, app_metadata: { is_admin: true } } },
            error: null,
          }),
        },
      },
    );
    expect(codeOf(await failure(requireAdmin(member)))).toBe("FORBIDDEN");

    const admin = profileClient(
      { id: USER_ID, representative_name: "A", is_admin: true },
      verified({ id: USER_ID }),
    );
    await expect(requireAdmin(admin)).resolves.toMatchObject({
      account: { isAdmin: true },
    });
  });
});

describe("provisionAccount", () => {
  const input = {
    email: " Resident@Example.test ",
    representativeName: "Alice Rao",
    isAdmin: false,
    actorProfileId: null,
  };
  const make = (
    overrides: { createUser?: Fake; listUsers?: Fake; rpc?: Fake } = {},
  ) => {
    const createUser = vi.fn().mockResolvedValue(
      overrides.createUser ?? {
        data: { user: { id: USER_ID } },
        error: null,
      },
    );
    const listUsers = vi
      .fn()
      .mockResolvedValue(
        overrides.listUsers ?? { data: { users: [] }, error: null },
      );
    const rpc = vi
      .fn()
      .mockResolvedValue(
        overrides.rpc ?? { data: { id: USER_ID, created: true }, error: null },
      );
    return {
      admin: asClient({ auth: { admin: { createUser, listUsers } }, rpc }),
      createUser,
      listUsers,
      rpc,
    };
  };

  it("creates the Auth identity, then the profile, normalising the email", async () => {
    const { admin, createUser, rpc } = make();
    const result = await provisionAccount(admin, input);

    expect(createUser).toHaveBeenCalledWith({
      email: "resident@example.test",
      email_confirm: true,
    });
    expect(rpc).toHaveBeenCalledWith("provision_profile", {
      p_auth_user_id: USER_ID,
      p_representative_name: "Alice Rao",
      p_is_admin: false,
      p_actor_profile_id: null,
    });
    expect(result).toEqual({
      accountId: USER_ID,
      authIdentity: "created",
      profile: "created",
    });
  });

  it("reuses an existing Auth identity instead of creating a duplicate", async () => {
    const { admin } = make({
      createUser: {
        data: { user: null },
        error: { code: "email_exists", status: 422 },
      },
      listUsers: {
        data: { users: [{ id: USER_ID, email: "Resident@example.test" }] },
        error: null,
      },
      rpc: { data: { id: USER_ID, created: false }, error: null },
    });
    await expect(provisionAccount(admin, input)).resolves.toEqual({
      accountId: USER_ID,
      authIdentity: "existing",
      profile: "existing",
    });
  });

  it("reports an Auth-stage failure as incomplete without touching the database", async () => {
    const { admin, rpc } = make({
      createUser: { data: { user: null }, error: { status: 500 } },
    });
    const error = await failure(provisionAccount(admin, input));

    expect(error.code).toBe("PROVISIONING_INCOMPLETE");
    expect(error.context).toEqual({ stage: "AUTH" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the Auth identity and reports a profile-stage failure as recoverable", async () => {
    const { admin } = make({
      rpc: { data: null, error: { code: "08006", message: "connection lost" } },
    });
    const error = await failure(provisionAccount(admin, input));

    expect(error.code).toBe("PROVISIONING_INCOMPLETE");
    expect(error.context).toEqual({
      stage: "PROFILE",
      authIdentity: "created",
    });
    expect(error.status).toBe(503);
  });

  it("surfaces genuine register conflicts and authorization failures unchanged", async () => {
    const conflict = make({
      rpc: {
        data: null,
        error: { code: "P0001", message: "REGISTER_CONFLICT", status: 400 },
      },
    });
    expect(codeOf(await failure(provisionAccount(conflict.admin, input)))).toBe(
      "REGISTER_CONFLICT",
    );

    const forbidden = make({
      rpc: {
        data: null,
        error: { code: "P0001", message: "FORBIDDEN", status: 400 },
      },
    });
    expect(
      codeOf(await failure(provisionAccount(forbidden.admin, input))),
    ).toBe("FORBIDDEN");
  });

  it("validates input before any external call", async () => {
    const { admin, createUser } = make();
    for (const bad of [
      { ...input, email: "not-an-email" },
      { ...input, representativeName: "<b>x</b>" },
      { ...input, actorProfileId: "nope" },
      { ...input, extra: true } as never,
    ]) {
      expect(codeOf(await failure(provisionAccount(admin, bad)))).toBe(
        "VALIDATION_FAILED",
      );
    }
    expect(createUser).not.toHaveBeenCalled();
  });

  it("never includes the email in a partial-state error", async () => {
    const { admin } = make({
      createUser: { data: { user: null }, error: { status: 500 } },
    });
    const error = await failure(provisionAccount(admin, input));
    expect(JSON.stringify([error.message, error.context])).not.toContain(
      "example.test",
    );
  });
});

describe("enableAccount", () => {
  it("returns the new status and maps routine failures", async () => {
    const ok = asClient({
      rpc: vi.fn().mockResolvedValue({
        data: { status: "ENABLED", changed: true },
        error: null,
      }),
    });
    await expect(enableAccount(ok, USER_ID, null)).resolves.toEqual({
      status: "ENABLED",
      changed: true,
    });

    const incomplete = asClient({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "P0001",
          message: "PROVISIONING_INCOMPLETE",
          status: 400,
        },
      }),
    });
    expect(
      codeOf(await failure(enableAccount(incomplete, USER_ID, null))),
    ).toBe("PROVISIONING_INCOMPLETE");
  });
});
