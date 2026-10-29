// Account/register behavior, including independent page-scoped review actions.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { toApiError } from "@/server/db/errors";
import { ApiError } from "@/server/http/errors";
import {
  MAX_ASSIGNABLE,
  createAccount,
  listAccounts,
  listResidents,
  listResidentTable,
  listAssignableAccounts,
  updateAccount,
} from "@/server/register/accounts";
import {
  createHousehold,
  getHousehold,
  listHouseholds,
  updateHousehold,
} from "@/server/register/households";
import { postgrestQuote, type RegisterDeps } from "@/server/register/shared";
import {
  accountListQuerySchema,
  residentListQuerySchema,
  residentTableQuerySchema,
} from "@/shared/contracts/admin-votes";
import {
  accountReviewTargets,
  canReviewAccount,
  type ReviewAccountProjection,
  createAccountSchema,
  createHouseholdSchema,
  householdListQuerySchema,
  patchAccountSchema,
  patchHouseholdSchema,
} from "@/shared/contracts/register";

/*
 * Logic tests with call-order recording. Database behaviour is covered by the
 * real-PostgreSQL integration tests and Auth behaviour by the live tests.
 */
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HOUSEHOLD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Result = { data: unknown; error: unknown; status?: number };
const asClient = (value: object) => value as unknown as SupabaseClient;

class Query {
  calls: [string, unknown[]][] = [];
  constructor(private readonly result: Result) {}
  private record(name: string, args: unknown[]): this {
    this.calls.push([name, args]);
    return this;
  }
  select = (...args: unknown[]) => this.record("select", args);
  order = (...args: unknown[]) => this.record("order", args);
  limit = (...args: unknown[]) => this.record("limit", args);
  eq = (...args: unknown[]) => this.record("eq", args);
  is = (...args: unknown[]) => this.record("is", args);
  not = (...args: unknown[]) => this.record("not", args);
  in = (...args: unknown[]) => this.record("in", args);
  neq = (...args: unknown[]) => this.record("neq", args);
  gt = (...args: unknown[]) => this.record("gt", args);
  or = (...args: unknown[]) => this.record("or", args);
  returns = () => Promise.resolve(this.result);
  maybeSingle = () => Promise.resolve(this.result);
}

interface World {
  deps: RegisterDeps;
  events: string[];
  queries: { table: string; query: Query }[];
  rpcCalls: { name: string; args: Record<string, unknown> }[];
  admin: {
    getUserById: ReturnType<typeof vi.fn>;
    updateUserById: ReturnType<typeof vi.fn>;
    listUsers: ReturnType<typeof vi.fn>;
  };
}

const profile = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  representative_name: "Alice Rao",
  status: "ENABLED",
  is_admin: false,
  updated_at: "2030-01-01T00:00:00Z",
  ...over,
});
const adminRow = { id: ACTOR, representative_name: "Asha", is_admin: true };
const ok = (data: unknown): Result => ({ data, error: null, status: 200 });

function world(
  options: {
    tables?: Record<string, Result[]>;
    rpc?: Record<string, Result | Result[]>;
    authUsers?: Record<
      string,
      { email: string; email_confirmed_at?: string } | null
    >;
    updateUserError?: { code?: string; status?: number } | null;
    getUserByIdAfterUpdate?: string;
    adminLostAfterFirstCheck?: boolean;
  } = {},
): World {
  const events: string[] = [];
  const queues = Object.fromEntries(
    Object.entries(options.tables ?? {}).map(([table, results]) => [
      table,
      [...results],
    ]),
  );
  const rpcQueues = Object.fromEntries(
    Object.entries(options.rpc ?? {}).map(([name, value]) => [
      name,
      Array.isArray(value) ? [...value] : [value],
    ]),
  );
  const queries: World["queries"] = [];
  const rpcCalls: World["rpcCalls"] = [];

  const client = {
    from: (table: string) => {
      const next = queues[table]?.shift() ?? ok(null);
      const query = new Query(next);
      queries.push({ table, query });
      events.push(`from:${table}`);
      return query;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      events.push(`rpc:${name}`);
      const queue = rpcQueues[name];
      const result =
        queue && queue.length > 0
          ? queue.length > 1
            ? queue.shift()
            : queue[0]
          : ok({});
      return Promise.resolve(result);
    },
  };

  const users = options.authUsers ?? {};
  let emailUpdated = false;
  const getUserById = vi.fn((id: string) => {
    events.push(`auth:get:${id === TARGET ? "target" : id}`);
    const user = users[id];
    if (user === null) {
      return Promise.resolve({ data: { user: null }, error: { status: 404 } });
    }
    // The identity reports the new email only after the update call succeeded.
    const email =
      emailUpdated && options.getUserByIdAfterUpdate
        ? options.getUserByIdAfterUpdate
        : (user?.email ?? `${id}@example.test`);
    return Promise.resolve({
      data: {
        user: {
          id,
          email,
          email_confirmed_at: user?.email_confirmed_at ?? null,
        },
      },
      error: null,
    });
  });
  const updateUserById = vi.fn(
    (_id: string, attributes: Record<string, unknown>) => {
      events.push(
        "ban_duration" in attributes
          ? `auth:ban:${String(attributes.ban_duration)}`
          : "auth:email",
      );
      const error =
        "email" in attributes ? (options.updateUserError ?? null) : null;
      if ("email" in attributes && !error) {
        emailUpdated = true;
      }
      return Promise.resolve({ data: {}, error });
    },
  );
  const listUsers = vi.fn(() => {
    events.push("auth:list");
    return Promise.resolve({ data: { users: [] }, error: null });
  });
  const admin = {
    auth: {
      admin: {
        getUserById,
        updateUserById,
        listUsers,
        createUser: vi.fn(),
        deleteUser: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      },
    },
    rpc: client.rpc,
  };

  return {
    deps: {
      client: asClient(client),
      admin: asClient(admin),
      actor: { id: ACTOR, representativeName: "Asha", isAdmin: true },
    },
    events,
    queries,
    rpcCalls,
    admin: { getUserById, updateUserById, listUsers },
  };
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

describe("register contracts", () => {
  it("normalises account input and defaults isAdmin to false", () => {
    expect(
      createAccountSchema.parse({
        email: " New@Example.TEST ",
        representativeName: "  Alice Rao ",
      }),
    ).toEqual({
      email: "new@example.test",
      representativeName: "Alice Rao",
      isAdmin: false,
      enable: false,
    });
  });

  it("rejects unknown fields and hostile text", () => {
    for (const bad of [
      { email: "a@example.test", representativeName: "A", role: "admin" },
      { email: "a@example.test", representativeName: "<b>A</b>" },
      { email: "nope", representativeName: "A" },
      { email: "a@example.test", representativeName: "A", isAdmin: "yes" },
    ]) {
      expect(createAccountSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("requires at least one changed field on patches and never accepts null", () => {
    expect(patchAccountSchema.safeParse({}).success).toBe(false);
    expect(patchAccountSchema.safeParse({ status: "ENABLED" }).success).toBe(
      true,
    );
    expect(patchAccountSchema.safeParse({ status: "ACTIVE" }).success).toBe(
      false,
    );
    expect(
      patchAccountSchema.safeParse({ representativeName: null }).success,
    ).toBe(false);
    expect(patchHouseholdSchema.safeParse({}).success).toBe(false);
    expect(patchHouseholdSchema.safeParse({ isEligible: false }).success).toBe(
      true,
    );
    expect(
      patchHouseholdSchema.safeParse({ identifier: "A-1", extra: 1 }).success,
    ).toBe(false);
  });

  it("bounds household identifiers and requires a UUID representative", () => {
    const base = { representativeAccountId: TARGET };
    expect(
      createHouseholdSchema.parse({ ...base, identifier: " A-101 " }),
    ).toEqual({
      ...base,
      identifier: "A-101",
      isEligible: false,
    });
    expect(
      createHouseholdSchema.safeParse({ ...base, identifier: "x".repeat(101) })
        .success,
    ).toBe(false);
    expect(
      createHouseholdSchema.safeParse({
        identifier: "A-1",
        representativeAccountId: "1",
      }).success,
    ).toBe(false);
  });

  it("limits list queries to documented filters", () => {
    expect(
      accountListQuerySchema.safeParse({ status: "ENABLED", isAdmin: "false" })
        .success,
    ).toBe(true);
    expect(
      accountListQuerySchema.safeParse({ email: "a@example.test" }).success,
    ).toBe(false);
    expect(
      householdListQuerySchema.safeParse({
        isEligible: "true",
        identifier: "A-1",
      }).success,
    ).toBe(true);
    expect(householdListQuerySchema.safeParse({ search: "a" }).success).toBe(
      false,
    );
  });
});

describe("account review assignments", () => {
  const resident: ReviewAccountProjection = {
    id: TARGET,
    email: "resident@example.test",
    representativeName: "Resident",
    status: "SUSPENDED",
    isAdmin: false,
    emailVerifiedAt: null,
    updatedAt: "2030-01-01T00:00:00Z",
    household: { id: HOUSEHOLD, identifier: "A-101", isEligible: false },
  };
  it("keeps enabling and eligibility independent and never targets hidden IDs", () => {
    const selected = new Set([TARGET, OTHER]);
    expect(accountReviewTargets([resident], selected, "enable")).toEqual([
      resident,
    ]);
    expect(accountReviewTargets([resident], selected, "eligible")).toEqual([
      resident,
    ]);
    expect(canReviewAccount({ ...resident, status: "ENABLED" }, "enable")).toBe(
      false,
    );
    expect(
      canReviewAccount({ ...resident, status: "ENABLED" }, "eligible"),
    ).toBe(true);
    expect(
      canReviewAccount(
        {
          ...resident,
          household: { id: HOUSEHOLD, identifier: "A-101", isEligible: true },
        },
        "eligible",
      ),
    ).toBe(false);
  });
  it("requires a flat for residents but permits selected suspended administrators without one", () => {
    expect(canReviewAccount({ ...resident, household: null }, "enable")).toBe(
      false,
    );
    expect(
      canReviewAccount(
        { ...resident, household: null, isAdmin: true },
        "enable",
      ),
    ).toBe(true);
    expect(
      canReviewAccount(
        { ...resident, household: null, isAdmin: true },
        "eligible",
      ),
    ).toBe(false);
    expect(
      canReviewAccount({ ...resident, status: "DELETED" }, "eligible"),
    ).toBe(false);
    expect(canReviewAccount({ ...resident, email: null }, "enable")).toBe(
      false,
    );
  });
  it("enriches only the visible page with household identifiers and eligibility", async () => {
    const w = world({
      tables: {
        profiles: [ok([profile(TARGET)])],
        households: [
          ok([
            {
              id: HOUSEHOLD,
              identifier: "A-101",
              representative_profile_id: TARGET,
              is_eligible: false,
            },
          ]),
        ],
      },
    });
    const result = await listAccounts(w.deps, accountListQuerySchema.parse({}));
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: TARGET,
      household: { id: HOUSEHOLD, identifier: "A-101", isEligible: false },
    });
    expect(
      w.queries.find((query) => query.table === "households")?.query.calls,
    ).toContainEqual(["in", ["representative_profile_id", [TARGET]]]);
  });
});

describe("toApiError conflict reasons", () => {
  it("exposes only allowlisted machine-readable reasons", () => {
    const withReason = toApiError({
      code: "P0001",
      message: "REGISTER_CONFLICT",
      details: "DUPLICATE_IDENTIFIER",
      status: 400,
    });
    expect(withReason.code).toBe("REGISTER_CONFLICT");
    expect(withReason.context).toEqual({ reason: "DUPLICATE_IDENTIFIER" });

    const leaked = toApiError({
      code: "P0001",
      message: "REGISTER_CONFLICT",
      details: "Key (identifier)=(secret) exists",
      status: 400,
    });
    expect(leaked.context).toBeUndefined();
  });

  it("maps submission outcomes without echoing anything", () => {
    for (const [message, code] of [
      ["ALREADY_SUBMITTED", "ALREADY_SUBMITTED"],
      ["VOTING_CLOSED", "VOTING_CLOSED"],
      ["NOT_FOUND", "NOT_FOUND"],
    ] as const) {
      const error = toApiError({
        code: "P0001",
        message,
        details: "selection abc",
        status: 400,
      });
      expect(error.code).toBe(code);
      expect(error.context).toBeUndefined();
    }
  });
});

describe("listAssignableAccounts", () => {
  const rows = Array.from({ length: 250 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    // Newest first (index 0), with names that sort the other way round.
    representative_name: `Resident ${String(index).padStart(3, "0")}`,
    status: "ENABLED",
  }));

  it("asks for the newest accounts first, so a just-created account is always offered", async () => {
    const w = world({
      tables: { profiles: [ok(rows)], households: [ok([])] },
    });
    await listAssignableAccounts(w.deps);
    const profiles = w.queries.find((q) => q.table === "profiles");
    const order = profiles?.query.calls
      .filter(([name]) => name === "order")
      .map(([, args]) => [
        args[0],
        (args[1] as { ascending: boolean }).ascending,
      ]);
    expect(order).toEqual([
      ["created_at", false],
      ["id", false],
    ]);
  });

  it("caps the list, drops assigned accounts, keeps the current representative, and sorts by name", async () => {
    const oldest = rows[249]?.id ?? "";
    const assigned = rows[0]?.id ?? "";
    const w = world({
      tables: {
        profiles: [ok(rows)],
        households: [
          ok([
            { representative_profile_id: oldest },
            { representative_profile_id: assigned },
          ]),
        ],
      },
    });
    const result = await listAssignableAccounts(w.deps, oldest);

    expect(result).toHaveLength(MAX_ASSIGNABLE);
    const ids = result.map((account) => account.id);
    // The account being edited is offered even though it is the oldest of all.
    expect(ids).toContain(oldest);
    // Another household's representative is not.
    expect(ids).not.toContain(assigned);
    const names = result.map((account) => account.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("returns fewer than the cap when fewer accounts are available", async () => {
    const w = world({
      tables: { profiles: [ok(rows.slice(0, 3))], households: [ok([])] },
    });
    expect(await listAssignableAccounts(w.deps)).toHaveLength(3);
  });
});

describe("listResidents", () => {
  const query = (over: Record<string, unknown> = {}) =>
    residentListQuerySchema.parse(over);

  it("uses the numbered anchor and only enriches that page, leaving API-style calls unchanged", async () => {
    const w = world({
      rpc: {
        get_list_page: ok({
          totalCount: "2",
          currentPage: 2,
          totalPages: 2,
          position: { id: TARGET },
        }),
      },
      tables: {
        resident_directory: [
          ok([{ id: OTHER, sort_key: "1\u001fobserver" }]),
          ok({ sort_key: "0a-101\u001falice" }),
        ],
        profiles: [ok([profile(OTHER)])],
      },
    });
    const result = await listResidents(w.deps, query({ limit: "1" }), 2);
    expect(result.page.numbered).toEqual({
      totalCount: "2",
      currentPage: 2,
      totalPages: 2,
    });
    expect(w.admin.getUserById).toHaveBeenCalledWith(OTHER);
    expect(w.admin.getUserById).not.toHaveBeenCalledWith(TARGET);
    expect(w.rpcCalls[0]?.args.p_page).toBe(2);
  });

  it("uses flat/name ordering and preserves App Support and page-scoped enrichment", async () => {
    const key = `0${"房".repeat(100)}\u001f${"名".repeat(200)}`;
    const w = world({
      tables: {
        resident_directory: [
          ok([
            { id: TARGET, sort_key: key },
            { id: OTHER, sort_key: "1\u001fobserver" },
          ]),
        ],
        profiles: [
          ok([profile(TARGET, { is_app_support: true, is_readonly: true })]),
        ],
      },
    });
    const result = await listResidents(
      w.deps,
      query({ limit: "1", isAdmin: "false" }),
    );
    expect(w.queries[0]?.query.calls).toContainEqual([
      "order",
      ["sort_key", { ascending: true }],
    ]);
    expect(w.queries[0]?.query.calls).toContainEqual([
      "order",
      ["id", { ascending: true }],
    ]);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.isAppSupport).toBe(true);
    expect(w.admin.getUserById).toHaveBeenCalledTimes(1);
    expect(w.admin.getUserById).not.toHaveBeenCalledWith(OTHER);
    expect(result.page.nextCursor?.length).toBeLessThanOrEqual(512);

    const next = world({
      tables: { resident_directory: [ok([]), ok({ sort_key: key })] },
    });
    await listResidents(
      next.deps,
      query({ limit: "1", isAdmin: "false", cursor: result.page.nextCursor }),
    );
    expect(next.queries[0]?.query.calls).toContainEqual([
      "or",
      [
        `sort_key.gt.${postgrestQuote(key)},and(sort_key.eq.${postgrestQuote(key)},id.gt.${TARGET})`,
      ],
    ]);
    expect(next.admin.getUserById).not.toHaveBeenCalled();

    const mismatched = world();
    expect(
      (
        await failure(
          listResidents(
            mismatched.deps,
            query({
              limit: "1",
              isAdmin: "false",
              hasHousehold: "false",
              cursor: result.page.nextCursor,
            }),
          ),
        )
      ).code,
    ).toBe("VALIDATION_FAILED");
  });

  it("filters unassigned accounts in the invoker view before pagination", async () => {
    const w = world({ tables: { resident_directory: [ok([])] } });
    await listResidents(
      w.deps,
      query({
        hasHousehold: "false",
        isReadonly: "true",
        selfRegistered: "false",
      }),
    );
    expect(w.queries[0]?.query.calls).toContainEqual([
      "is",
      ["household_id", null],
    ]);
    expect(w.queries[0]?.query.calls).toContainEqual([
      "eq",
      ["is_readonly", true],
    ]);
    expect(w.queries[0]?.query.calls).toContainEqual([
      "eq",
      ["self_registered", false],
    ]);
    expect(w.admin.getUserById).not.toHaveBeenCalled();
  });

  it("normalizes exact-flat filters and applies eligibility in the invoker view", async () => {
    const w = world({
      tables: { resident_directory: [ok([])] },
      rpc: { normalize_household_identifier: ok("a-101") },
    });
    await listResidents(
      w.deps,
      query({ identifier: "A-101", isEligible: "false" }),
    );
    expect(w.queries[0]?.query.calls).toContainEqual([
      "eq",
      ["household_identifier_normalized", "a-101"],
    ]);
    expect(w.queries[0]?.query.calls).toContainEqual([
      "eq",
      ["household_is_eligible", false],
    ]);
  });

  it("fails explicitly if current profile enrichment disappears", async () => {
    const w = world({
      tables: {
        resident_directory: [
          ok([{ id: TARGET, sort_key: "0a-101\u001falice" }]),
        ],
        profiles: [ok([])],
      },
    });
    expect((await failure(listResidents(w.deps, query()))).code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
  });
});

describe("listResidentTable", () => {
  const query = (over: Record<string, unknown> = {}) =>
    residentTableQuerySchema.parse(over);
  const metadata = {
    ids: [OTHER, TARGET],
    totalCount: "4",
    currentPage: 2,
    totalPages: 2,
  };
  it("preserves database ordering and enriches only returned IDs", async () => {
    const w = world({
      rpc: { get_resident_table_page: ok(metadata) },
      tables: { profiles: [ok([profile(TARGET), profile(OTHER)])] },
    });
    const result = await listResidentTable(
      w.deps,
      query({
        limit: "2",
        sort: "updated",
        direction: "desc",
        representative: "Alice",
        identifierContains: "a-1",
        isAdmin: "false",
      }),
      2,
    );
    expect(result.data.map((row) => row.id)).toEqual([OTHER, TARGET]);
    expect(result.page.numbered).toEqual({
      totalCount: "4",
      currentPage: 2,
      totalPages: 2,
    });
    expect(w.rpcCalls).toEqual([
      {
        name: "get_resident_table_page",
        args: {
          p_page: 2,
          p_limit: 2,
          p_sort: "updated",
          p_direction: "desc",
          p_filters: {
            representative: "Alice",
            isAdmin: false,
            identifierContains: "a-1",
          },
        },
      },
    ]);
    expect(w.queries[0]?.query.calls).toContainEqual(["limit", [2]]);
    expect(w.admin.getUserById).toHaveBeenCalledTimes(2);
  });
  it("returns honest empty metadata without fetching profiles or Auth users", async () => {
    const w = world({
      rpc: {
        get_resident_table_page: ok({
          ids: [],
          totalCount: "0",
          currentPage: 1,
          totalPages: 1,
        }),
      },
    });
    expect((await listResidentTable(w.deps, query(), 9)).data).toEqual([]);
    expect(w.queries).toHaveLength(0);
    expect(w.admin.getUserById).not.toHaveBeenCalled();
  });
  it.each([
    { ...metadata, ids: [TARGET, TARGET] },
    { ...metadata, totalCount: "9007199254740992" },
    { ...metadata, currentPage: 1 },
    { ...metadata, totalPages: 3 },
    { ...metadata, ids: [] },
    { ...metadata, ids: ["invalid"] },
  ])("rejects inconsistent RPC metadata %#", async (value) => {
    const w = world({ rpc: { get_resident_table_page: ok(value) } });
    expect(
      (await failure(listResidentTable(w.deps, query({ limit: "2" }), 2))).code,
    ).toBe("INTERNAL_ERROR");
    expect(w.admin.getUserById).not.toHaveBeenCalled();
  });
  it("fails explicitly if a profile disappears after the window query", async () => {
    const w = world({
      rpc: { get_resident_table_page: ok(metadata) },
      tables: { profiles: [ok([])] },
    });
    expect(
      (await failure(listResidentTable(w.deps, query({ limit: "2" }), 2))).code,
    ).toBe("DEPENDENCY_UNAVAILABLE");
  });
});

describe("listAccounts", () => {
  const query = (over: Record<string, unknown> = {}) =>
    accountListQuerySchema.parse(over);

  it("filters profile-first and fetches one extra row to detect another page", async () => {
    const rows = [profile(TARGET), profile(OTHER), profile(ACTOR)];
    const w = world({ tables: { profiles: [ok(rows)] } });
    const result = await listAccounts(
      w.deps,
      query({ limit: "2", status: "ENABLED", isAdmin: "false" }),
    );

    const calls = w.queries[0]?.query.calls ?? [];
    expect(calls).toContainEqual(["limit", [3]]);
    expect(calls).toContainEqual(["eq", ["status", "ENABLED"]]);
    expect(calls).toContainEqual(["eq", ["is_admin", false]]);
    expect(result.data).toHaveLength(2);
    expect(result.page).toMatchObject({ limit: 2, hasMore: true });
    expect(result.page.nextCursor).toEqual(expect.any(String));
  });

  it("enriches only the returned page through Auth and never looks up the extra row", async () => {
    const w = world({
      tables: {
        profiles: [ok([profile(TARGET), profile(OTHER), profile(ACTOR)])],
      },
      authUsers: {
        [TARGET]: {
          email: "alice@example.test",
          email_confirmed_at: "2030-01-01T00:00:00Z",
        },
      },
    });
    const result = await listAccounts(w.deps, query({ limit: "2" }));

    expect(w.admin.getUserById).toHaveBeenCalledTimes(2);
    expect(w.admin.getUserById).not.toHaveBeenCalledWith(ACTOR);
    expect(result.data[0]).toMatchObject({
      id: TARGET,
      email: "alice@example.test",
      emailVerifiedAt: "2030-01-01T00:00:00Z",
    });
  });

  it("resumes after the cursor and rejects a cursor from another filter", async () => {
    const first = world({
      tables: { profiles: [ok([profile(TARGET), profile(OTHER)])] },
    });
    const page = await listAccounts(
      first.deps,
      query({ limit: "1", status: "ENABLED" }),
    );

    const second = world({ tables: { profiles: [ok([profile(OTHER)])] } });
    await listAccounts(
      second.deps,
      query({ limit: "1", status: "ENABLED", cursor: page.page.nextCursor }),
    );
    expect(second.queries[0]?.query.calls).toContainEqual([
      "gt",
      ["id", TARGET],
    ]);

    const mismatched = world();
    const error = await failure(
      listAccounts(
        mismatched.deps,
        query({
          limit: "1",
          status: "SUSPENDED",
          cursor: page.page.nextCursor,
        }),
      ),
    );
    expect(error.code).toBe("VALIDATION_FAILED");
  });

  it("fails visibly when Auth enrichment is unavailable", async () => {
    const w = world({ tables: { profiles: [ok([profile(TARGET)])] } });
    w.admin.getUserById.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 503 },
    });
    expect((await failure(listAccounts(w.deps, query()))).code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
  });

  it("returns an empty page without calling Auth", async () => {
    const w = world({ tables: { profiles: [ok([])] } });
    const result = await listAccounts(w.deps, query());
    expect(result).toMatchObject({
      data: [],
      page: { hasMore: false, nextCursor: null },
    });
    expect(w.admin.getUserById).not.toHaveBeenCalled();
  });
});

describe("createAccount", () => {
  const input = {
    email: "new@example.test",
    representativeName: "New Person",
    isAdmin: false,
    enable: false,
  };

  it("re-checks the caller's current authority before touching Auth", async () => {
    const w = world({ tables: { profiles: [ok(null)] } });
    const error = await failure(createAccount(w.deps, input));

    expect(error.code).toBe("FORBIDDEN");
    expect(w.events.some((event) => event.startsWith("auth:"))).toBe(false);
  });

  it("provisions on behalf of the acting administrator and returns the suspended account", async () => {
    const w = world({
      tables: {
        profiles: [ok(adminRow), ok(profile(TARGET, { status: "SUSPENDED" }))],
      },
      rpc: { provision_profile: ok({ id: TARGET, created: true }) },
    });
    (
      w.deps.admin as unknown as {
        auth: { admin: { createUser: ReturnType<typeof vi.fn> } };
      }
    ).auth.admin.createUser.mockResolvedValue({
      data: { user: { id: TARGET } },
      error: null,
    });
    const account = await createAccount(w.deps, input);

    expect(w.rpcCalls[0]).toEqual({
      name: "provision_profile",
      args: {
        p_auth_user_id: TARGET,
        p_representative_name: "New Person",
        p_is_admin: false,
        p_actor_profile_id: ACTOR,
      },
    });
    expect(account).toMatchObject({ id: TARGET, status: "SUSPENDED" });
  });

  it("reports an identical, already complete account as a duplicate email", async () => {
    const w = world({
      tables: { profiles: [ok(adminRow)] },
      rpc: { provision_profile: ok({ id: TARGET, created: false }) },
    });
    (
      w.deps.admin as unknown as {
        auth: {
          admin: {
            createUser: ReturnType<typeof vi.fn>;
            listUsers: ReturnType<typeof vi.fn>;
          };
        };
      }
    ).auth.admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", status: 422 },
    });
    (
      w.deps.admin as unknown as {
        auth: { admin: { listUsers: ReturnType<typeof vi.fn> } };
      }
    ).auth.admin.listUsers.mockResolvedValue({
      data: { users: [{ id: TARGET, email: "new@example.test" }] },
      error: null,
    });
    const error = await failure(createAccount(w.deps, input));

    expect(error.code).toBe("REGISTER_CONFLICT");
    expect(error.context).toEqual({ reason: "DUPLICATE_EMAIL" });
  });
});

describe("createAccount with a household", () => {
  const settings = (defaultHouseholds: string[]) => ({
    fullName: "Lakeview Residents Welfare Association",
    alias: "Lakeview RWA",
    address: "",
    email: "",
    phone: "",
    website: "",
    accentPalette: "TEAL",
    welcomeMessage: "",
    householdLabel: "Flat",
    identifierKind: "NUMBER",
    defaultHouseholds,
    rwaPositions: [],
  });
  const input = (identifier: string) => ({
    email: "new@example.test",
    representativeName: "New Person",
    isAdmin: false,
    enable: false,
    household: { identifier, isEligible: true },
  });
  const adminAuth = (w: World) =>
    w.deps.admin as unknown as {
      auth: {
        admin: {
          createUser: ReturnType<typeof vi.fn>;
          deleteUser: ReturnType<typeof vi.fn>;
        };
      };
    };
  const created = (w: World) =>
    adminAuth(w).auth.admin.createUser.mockResolvedValue({
      data: { user: { id: TARGET } },
      error: null,
    });

  it("creates the account and its listed household in one routine, using the configured spelling", async () => {
    const w = world({
      tables: {
        profiles: [
          ok(adminRow),
          ok(adminRow),
          ok(profile(TARGET, { status: "SUSPENDED" })),
        ],
        households: [ok([])],
      },
      rpc: {
        get_rwa_profile: ok(settings(["Tower B 303"])),
        normalize_household_identifier: ok("tower b 303"),
        provision_profile_with_household: ok({
          id: TARGET,
          householdId: HOUSEHOLD,
        }),
      },
    });
    created(w);
    const account = await createAccount(w.deps, input(" tower  B 303 "));

    expect(
      w.rpcCalls.find(
        (call) => call.name === "provision_profile_with_household",
      )?.args,
    ).toEqual({
      p_auth_user_id: TARGET,
      p_representative_name: "New Person",
      p_is_admin: false,
      p_is_readonly: false,
      p_identifier: "Tower B 303",
      p_is_eligible: true,
      p_actor_profile_id: ACTOR,
    });
    expect(account).toMatchObject({ id: TARGET, status: "SUSPENDED" });
    expect(adminAuth(w).auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("rejects an unlisted household before creating any identity", async () => {
    const w = world({
      tables: { profiles: [ok(adminRow)] },
      rpc: { get_rwa_profile: ok(settings(["A-101"])) },
    });
    const error = await failure(createAccount(w.deps, input("Z-9")));

    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.context).toEqual({ reason: "UNKNOWN_HOUSEHOLD" });
    expect(error.fieldErrors?.[0]?.field).toBe("household.identifier");
    expect(adminAuth(w).auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("rejects a household that is already assigned before creating any identity", async () => {
    const w = world({
      tables: { profiles: [ok(adminRow)], households: [ok([{ id: OTHER }])] },
      rpc: {
        get_rwa_profile: ok(settings([])),
        normalize_household_identifier: ok("a-101"),
      },
    });
    const error = await failure(createAccount(w.deps, input("A-101")));

    expect(error.code).toBe("REGISTER_CONFLICT");
    expect(error.context).toEqual({ reason: "DUPLICATE_IDENTIFIER" });
    expect(adminAuth(w).auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("removes the identity it created when the database step fails", async () => {
    const w = world({
      tables: {
        profiles: [ok(adminRow), ok(adminRow)],
        households: [ok([])],
      },
      rpc: {
        get_rwa_profile: ok(settings([])),
        normalize_household_identifier: ok("a-101"),
        provision_profile_with_household: {
          data: null,
          error: {
            code: "P0001",
            message: "REGISTER_CONFLICT",
            details: "DUPLICATE_IDENTIFIER",
          },
          status: 400,
        },
      },
    });
    created(w);
    const error = await failure(createAccount(w.deps, input("A-101")));

    expect(error.context).toEqual({ reason: "DUPLICATE_IDENTIFIER" });
    expect(adminAuth(w).auth.admin.deleteUser).toHaveBeenCalledWith(TARGET);
  });

  it("only lets administrators be enabled without a household", () => {
    const base = {
      email: "a@example.test",
      representativeName: "A",
      enable: true,
    };
    expect(createAccountSchema.safeParse(base).success).toBe(false);
    expect(
      createAccountSchema.safeParse({ ...base, isAdmin: true }).success,
    ).toBe(true);
    expect(
      createAccountSchema.safeParse({
        ...base,
        household: { identifier: "A-1" },
      }).success,
    ).toBe(true);
  });
});

describe("updateAccount", () => {
  const current = (over: Record<string, unknown> = {}) =>
    ok(profile(TARGET, over));

  it("changes profile fields in one audited database call and touches nothing in Auth", async () => {
    const w = world({
      tables: {
        profiles: [
          ok(adminRow),
          current(),
          current({ representative_name: "Alice R." }),
        ],
      },
    });
    const account = await updateAccount(w.deps, TARGET, {
      representativeName: "Alice R.",
      isAdmin: true,
    });

    expect(w.rpcCalls).toEqual([
      {
        name: "update_profile",
        args: {
          p_profile_id: TARGET,
          p_changes: { representativeName: "Alice R.", isAdmin: true },
        },
      },
    ]);
    expect(
      w.events.filter(
        (e) => e.startsWith("auth:") && !e.startsWith("auth:get"),
      ),
    ).toEqual([]);
    expect(account.representativeName).toBe("Alice R.");
  });

  it("does nothing for unchanged values", async () => {
    const w = world({
      tables: { profiles: [ok(adminRow), current(), current()] },
    });
    await updateAccount(w.deps, TARGET, {
      representativeName: "Alice Rao",
      status: "ENABLED",
    });
    expect(w.rpcCalls).toEqual([]);
  });

  it("blocks the profile in the database BEFORE stopping Auth sign-in on suspension", async () => {
    const w = world({
      tables: {
        profiles: [
          ok(adminRow),
          current(),
          ok(adminRow),
          current({ status: "SUSPENDED" }),
        ],
      },
    });
    await updateAccount(w.deps, TARGET, { status: "SUSPENDED" });

    const order = w.events.filter(
      (e) => e.startsWith("rpc:") || e.startsWith("auth:ban"),
    );
    expect(order).toEqual(["rpc:update_profile", "auth:ban:876000h"]);
  });

  it("allows Auth sign-in BEFORE enabling a profile", async () => {
    const w = world({
      tables: {
        profiles: [
          ok(adminRow),
          current({ status: "SUSPENDED" }),
          ok(adminRow),
          current(),
        ],
      },
    });
    await updateAccount(w.deps, TARGET, { status: "ENABLED" });

    const order = w.events.filter(
      (e) => e.startsWith("rpc:") || e.startsWith("auth:ban"),
    );
    expect(order).toEqual(["auth:ban:none", "rpc:update_profile"]);
  });

  it.each(["SUSPENDED", "DELETED"] as const)(
    "retries an incomplete Auth ban when the profile is already %s",
    async (status) => {
      const w = world({
        tables: {
          profiles: [
            ok(adminRow),
            current({ status }),
            ok(adminRow),
            current({ status }),
          ],
        },
      });
      const account = await updateAccount(w.deps, TARGET, { status });
      expect(w.admin.updateUserById).toHaveBeenCalledWith(TARGET, {
        ban_duration: "876000h",
      });
      expect(w.rpcCalls).toEqual([]);
      expect(account.status).toBe(status);
    },
  );

  it.each(["SUSPENDED", "DELETED"] as const)(
    "does not falsely report a completed %s retry while Auth still fails",
    async (status) => {
      const w = world({
        tables: { profiles: [ok(adminRow), current({ status }), ok(adminRow)] },
      });
      w.admin.updateUserById.mockResolvedValueOnce({
        data: {},
        error: { status: 503 },
      });
      const error = await failure(updateAccount(w.deps, TARGET, { status }));
      expect(error.code).toBe("PROVISIONING_INCOMPLETE");
      expect(error.context).toEqual({ stage: "AUTH", profileBlocked: true });
      expect(w.rpcCalls).toEqual([]);
    },
  );

  it("leaves Auth unchanged and surfaces the database's reason when enabling is refused", async () => {
    const w = world({
      tables: {
        profiles: [
          ok(adminRow),
          current({ status: "SUSPENDED" }),
          ok(adminRow),
        ],
      },
      rpc: {
        update_profile: {
          data: null,
          error: { code: "P0001", message: "PROVISIONING_INCOMPLETE" },
          status: 400,
        },
      },
    });
    const error = await failure(
      updateAccount(w.deps, TARGET, { status: "ENABLED" }),
    );
    expect(error.code).toBe("PROVISIONING_INCOMPLETE");
  });

  it.each([
    { representativeName: "X" },
    { status: "DELETED", representativeName: "X" },
    { status: "ENABLED" },
  ] as const)(
    "refuses to edit or restore a deleted account: %j",
    async (changes) => {
      const w = world({
        tables: { profiles: [ok(adminRow), current({ status: "DELETED" })] },
      });
      const error = await failure(updateAccount(w.deps, TARGET, changes));
      expect(error.code).toBe("LIFECYCLE_CONFLICT");
      expect(w.rpcCalls).toEqual([]);
      expect(w.admin.updateUserById).not.toHaveBeenCalled();
    },
  );

  it("surfaces the last-administrator guard as a conflict", async () => {
    const w = world({
      tables: { profiles: [ok(adminRow), current({ is_admin: true })] },
      rpc: {
        update_profile: {
          data: null,
          error: {
            code: "P0001",
            message: "LIFECYCLE_CONFLICT",
            details: "LAST_ADMIN",
          },
          status: 400,
        },
      },
    });
    const error = await failure(
      updateAccount(w.deps, TARGET, { isAdmin: false }),
    );
    expect(error.code).toBe("LIFECYCLE_CONFLICT");
    expect(error.context).toEqual({ reason: "LAST_ADMIN" });
  });

  describe("email change", () => {
    it("does not suspend the account or change Auth when the duplicate lookup is unavailable", async () => {
      const w = world({ tables: { profiles: [ok(adminRow), current()] } });
      w.admin.listUsers.mockResolvedValueOnce({
        data: null,
        error: { status: 503 },
      });
      const error = await failure(
        updateAccount(w.deps, TARGET, { email: "new@example.test" }),
      );
      expect(error.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(w.rpcCalls).toEqual([]);
      expect(w.admin.updateUserById).not.toHaveBeenCalled();
    });
    const enabled = () => current({ status: "ENABLED" });
    const full = (final: Result = current()) => ({
      profiles: [ok(adminRow), enabled(), ok(adminRow), ok(adminRow), final],
    });

    it("blocks first, changes and verifies the Auth identity, then restores access", async () => {
      const w = world({
        tables: full(),
        authUsers: { [TARGET]: { email: "old@example.test" } },
        getUserByIdAfterUpdate: "new@example.test",
      });
      await updateAccount(w.deps, TARGET, { email: "new@example.test" });

      const order = w.events.filter(
        (e) =>
          e.startsWith("rpc:") ||
          (e.startsWith("auth:") && e !== "auth:get:" + TARGET) ||
          e === "auth:get:target",
      );
      const sequence = order.filter((e) => e !== "auth:get:target" || true);
      expect(sequence.indexOf("auth:list")).toBeLessThan(
        sequence.indexOf("rpc:update_profile"),
      );
      expect(w.rpcCalls[0]?.args).toEqual({
        p_profile_id: TARGET,
        p_changes: { status: "SUSPENDED" },
      });
      expect(w.events.indexOf("rpc:update_profile")).toBeLessThan(
        w.events.indexOf("auth:email"),
      );
      expect(w.events.indexOf("auth:email")).toBeLessThan(
        w.events.lastIndexOf("rpc:update_profile"),
      );
      expect(w.rpcCalls.at(-1)?.args).toEqual({
        p_profile_id: TARGET,
        p_changes: { status: "ENABLED" },
      });
    });

    it("rejects an email that belongs to another identity before blocking anyone", async () => {
      const w = world({
        tables: { profiles: [ok(adminRow), enabled()] },
        authUsers: { [TARGET]: { email: "old@example.test" } },
      });
      w.admin.listUsers.mockResolvedValue({
        data: { users: [{ id: OTHER, email: "new@example.test" }] },
        error: null,
      });
      const error = await failure(
        updateAccount(w.deps, TARGET, { email: "new@example.test" }),
      );

      expect(error.code).toBe("REGISTER_CONFLICT");
      expect(error.context).toEqual({ reason: "DUPLICATE_EMAIL" });
      expect(w.rpcCalls).toEqual([]);
    });

    it("keeps the profile BLOCKED and reports partial state when the Auth change fails", async () => {
      const w = world({
        tables: full(),
        authUsers: { [TARGET]: { email: "old@example.test" } },
        updateUserError: { status: 500 },
      });
      const error = await failure(
        updateAccount(w.deps, TARGET, { email: "new@example.test" }),
      );

      expect(error.code).toBe("PROVISIONING_INCOMPLETE");
      expect(error.context).toEqual({ stage: "AUTH", profileBlocked: true });
      expect(w.rpcCalls.map((c) => c.args.p_changes)).toEqual([
        { status: "SUSPENDED" },
      ]);
    });

    it("keeps the profile blocked when the new email cannot be verified", async () => {
      const w = world({
        tables: full(),
        authUsers: { [TARGET]: { email: "old@example.test" } },
        getUserByIdAfterUpdate: "unexpected@example.test",
      });
      const error = await failure(
        updateAccount(w.deps, TARGET, { email: "new@example.test" }),
      );

      expect(error.code).toBe("PROVISIONING_INCOMPLETE");
      expect(w.rpcCalls).toHaveLength(1);
    });

    it("stops before the Auth stage if the caller is no longer an administrator", async () => {
      const w = world({
        tables: { profiles: [ok(adminRow), enabled(), ok(null)] },
        authUsers: { [TARGET]: { email: "old@example.test" } },
      });
      const error = await failure(
        updateAccount(w.deps, TARGET, { email: "new@example.test" }),
      );

      expect(error.code).toBe("FORBIDDEN");
      expect(w.events).not.toContain("auth:email");
    });

    it("does not re-enable an account that was already suspended", async () => {
      const w = world({
        tables: {
          profiles: [
            ok(adminRow),
            current({ status: "SUSPENDED" }),
            ok(adminRow),
            current({ status: "SUSPENDED" }),
          ],
        },
        authUsers: { [TARGET]: { email: "old@example.test" } },
        getUserByIdAfterUpdate: "new@example.test",
      });
      await updateAccount(w.deps, TARGET, { email: "new@example.test" });

      expect(w.rpcCalls).toEqual([]);
    });

    it("reports a late database refusal as blocked partial state", async () => {
      const w = world({
        tables: full(),
        authUsers: { [TARGET]: { email: "old@example.test" } },
        getUserByIdAfterUpdate: "new@example.test",
        rpc: {
          update_profile: [
            ok({}),
            {
              data: null,
              error: { code: "P0001", message: "PROVISIONING_INCOMPLETE" },
              status: 400,
            },
          ],
        },
      });
      const error = await failure(
        updateAccount(w.deps, TARGET, { email: "new@example.test" }),
      );

      expect(error.code).toBe("PROVISIONING_INCOMPLETE");
      expect(error.context).toEqual({ stage: "PROFILE", profileBlocked: true });
    });
  });
});

describe("households service", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: HOUSEHOLD,
    identifier: "A-101",
    identifier_normalized: "a-101",
    representative_profile_id: TARGET,
    is_eligible: true,
    updated_at: "2030-01-01T00:00:00Z",
    profiles: { representative_name: "Alice Rao", status: "ENABLED" },
    ...over,
  });
  const listQuery = (over: Record<string, unknown> = {}) =>
    householdListQuerySchema.parse(over);

  it("orders by normalised identifier then id and projects representative details", async () => {
    const w = world({
      tables: { households: [ok([row()])] },
      authUsers: { [TARGET]: { email: "alice@example.test" } },
    });
    const result = await listHouseholds(w.deps, listQuery());

    const calls = w.queries[0]?.query.calls ?? [];
    expect(calls.filter(([name]) => name === "order")).toEqual([
      ["order", ["identifier_normalized", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
    ]);
    expect(result.data[0]).toEqual({
      id: HOUSEHOLD,
      identifier: "A-101",
      representativeAccountId: TARGET,
      isEligible: true,
      updatedAt: "2030-01-01T00:00:00.000Z",
      representative: {
        name: "Alice Rao",
        email: "alice@example.test",
        status: "ENABLED",
      },
    });
  });

  it("filters eligibility and uses the database's normalisation for exact identifiers", async () => {
    const w = world({
      tables: { households: [ok([])] },
      rpc: { normalize_household_identifier: ok("a-101") },
    });
    await listHouseholds(
      w.deps,
      listQuery({ isEligible: "false", identifier: " A-101 " }),
    );

    expect(w.rpcCalls[0]).toEqual({
      name: "normalize_household_identifier",
      args: { p_identifier: "A-101" },
    });
    const calls = w.queries[0]?.query.calls ?? [];
    expect(calls).toContainEqual(["eq", ["is_eligible", false]]);
    expect(calls).toContainEqual(["eq", ["identifier_normalized", "a-101"]]);
  });

  it("builds a safe keyset condition even when the cursor key contains filter syntax", async () => {
    const tricky = 'a,b)"\\c';
    const first = world({
      tables: {
        households: [
          ok([row({ identifier_normalized: tricky }), row({ id: OTHER })]),
        ],
      },
    });
    const page = await listHouseholds(first.deps, listQuery({ limit: "1" }));

    const second = world({ tables: { households: [ok([])] } });
    await listHouseholds(
      second.deps,
      listQuery({ limit: "1", cursor: page.page.nextCursor }),
    );
    const condition = (second.queries[0]?.query.calls.find(
      ([name]) => name === "or",
    )?.[1] ?? [])[0];

    expect(condition).toBe(
      `identifier_normalized.gt.${postgrestQuote(tricky)},and(identifier_normalized.eq.${postgrestQuote(tricky)},id.gt.${HOUSEHOLD})`,
    );
    expect(postgrestQuote(tricky)).toBe('"a,b)\\"\\\\c"');
  });

  it("looks each representative up once per page", async () => {
    const w = world({
      tables: {
        households: [
          ok([row(), row({ id: OTHER, identifier_normalized: "a-102" })]),
        ],
      },
    });
    await listHouseholds(w.deps, listQuery());
    expect(w.admin.getUserById).toHaveBeenCalledTimes(1);
  });

  it("returns not-found for a missing household", async () => {
    const w = world({ tables: { households: [ok(null)] } });
    expect((await failure(getHousehold(w.deps, HOUSEHOLD))).code).toBe(
      "NOT_FOUND",
    );
  });

  it("creates through the guarded routine and returns the stored household", async () => {
    const w = world({
      tables: { profiles: [ok(adminRow)], households: [ok(row())] },
      rpc: { create_household: ok({ id: HOUSEHOLD }) },
    });
    const created = await createHousehold(w.deps, {
      identifier: "A-101",
      representativeAccountId: TARGET,
      isEligible: true,
    });

    expect(w.rpcCalls[0]).toEqual({
      name: "create_household",
      args: {
        p_identifier: "A-101",
        p_representative_account_id: TARGET,
        p_is_eligible: true,
      },
    });
    expect(created.id).toBe(HOUSEHOLD);
  });

  it("explains conflicts with a machine-readable reason", async () => {
    const w = world({
      tables: { profiles: [ok(adminRow)] },
      rpc: {
        create_household: {
          data: null,
          error: {
            code: "P0001",
            message: "REGISTER_CONFLICT",
            details: "DUPLICATE_IDENTIFIER",
          },
          status: 400,
        },
      },
    });
    const error = await failure(
      createHousehold(w.deps, {
        identifier: "A-101",
        representativeAccountId: TARGET,
        isEligible: false,
      }),
    );

    expect(error.code).toBe("REGISTER_CONFLICT");
    expect(error.context).toEqual({ reason: "DUPLICATE_IDENTIFIER" });
  });

  it("sends only the fields that were supplied", async () => {
    const w = world({
      tables: { profiles: [ok(adminRow)], households: [ok(row())] },
      rpc: { update_household: ok({}) },
    });
    await updateHousehold(w.deps, HOUSEHOLD, { isEligible: false });

    expect(w.rpcCalls[0]).toEqual({
      name: "update_household",
      args: { p_household_id: HOUSEHOLD, p_changes: { isEligible: false } },
    });
  });

  it("requires a current administrator for changes", async () => {
    const w = world({ tables: { profiles: [ok(null)] } });
    expect(
      (await failure(updateHousehold(w.deps, HOUSEHOLD, { isEligible: true })))
        .code,
    ).toBe("FORBIDDEN");
    expect(w.rpcCalls).toEqual([]);
  });
});
