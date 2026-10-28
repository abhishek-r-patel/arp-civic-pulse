// Exercises the public self-registration route with controlled Auth and database dependencies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/register/route";
import { createCsrfContext, csrfTokenFor } from "@/server/http/csrf";

const NEW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EXISTING_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const { context, rpc, createUser, listUsers, deleteUser } = vi.hoisted(() => ({
  context: { value: "" },
  rpc: vi.fn(),
  createUser: vi.fn(),
  listUsers: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock("@/server/http/csrf-cookie", () => ({
  readCsrfContext: async () => context.value,
}));
vi.mock("@/server/config/environment", async (original) => {
  const actual = await original<typeof import("@/server/config/environment")>();
  return {
    ...actual,
    getEnvironment: () => actual.parseEnvironment(process.env),
  };
});
vi.mock("@/server/db/clients", () => ({
  createAdminClient: () => ({
    rpc,
    auth: { admin: { createUser, listUsers, deleteUser } },
  }),
}));

const allowed = { data: { allowed: true }, error: null };
const listed = { value: [] as unknown };
const conflict = (details: string) => ({
  data: null,
  error: { code: "P0001", message: "REGISTER_CONFLICT", details },
  status: 400,
});

function routine(result: unknown) {
  rpc.mockImplementation((name: string) =>
    Promise.resolve(
      name === "consume_rate_limit"
        ? allowed
        : name === "get_self_registration_households"
          ? { data: listed.value, error: null }
          : result,
    ),
  );
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("APP_ORIGIN", "https://civic.example");
  vi.stubEnv("MAINTENANCE_MODE", "0");
  context.value = createCsrfContext();
  listed.value = [];
  routine({ data: { id: NEW_ID, status: "SUSPENDED" }, error: null });
  createUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: NEW_ID } }, error: null });
  listUsers.mockReset().mockResolvedValue({
    data: { users: [{ id: EXISTING_ID, email: "taken@example.test" }] },
    error: null,
  });
  deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
});
afterEach(() => vi.unstubAllEnvs());

function request(
  overrides: { origin?: string; token?: string; body?: unknown } = {},
) {
  return new Request("https://civic.example/api/register", {
    method: "POST",
    headers: {
      origin: overrides.origin ?? "https://civic.example",
      "X-CSRF-Token": overrides.token ?? csrfTokenFor(context.value),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      overrides.body ?? {
        representativeName: " Synthetic Resident ",
        email: "NEW@example.test",
        identifier: " A-101 ",
        website: "",
      },
    ),
  });
}

const routineCall = () =>
  rpc.mock.calls.find(([name]) => name === "self_register_resident");

describe("resident self-registration", () => {
  it("creates a confirmed identity and a suspended, ineligible registration", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect((await response.json()).data.message).toContain("suspended");
    expect(createUser).toHaveBeenCalledWith({
      email: "new@example.test",
      email_confirm: true,
    });
    expect(routineCall()?.[1]).toEqual({
      p_auth_user_id: NEW_ID,
      p_representative_name: "Synthetic Resident",
      p_identifier: "A-101",
    });
    const scopes = rpc.mock.calls
      .filter(([name]) => name === "consume_rate_limit")
      .map(([, args]) => (args as { p_scope: string }).p_scope);
    expect(scopes).toEqual([
      "register.self.email",
      "register.self.household",
      "register.self.global",
    ]);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("reports an already registered email without deleting the existing identity", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", status: 422 },
    });
    routine(conflict("DUPLICATE_EMAIL"));
    const response = await POST(
      request({
        body: {
          representativeName: "Synthetic Resident",
          email: "taken@example.test",
          identifier: "A-101",
        },
      }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.context).toEqual({ reason: "DUPLICATE_EMAIL" });
    expect(body.error.fieldErrors[0].field).toBe("email");
    expect(routineCall()?.[1]).toMatchObject({ p_auth_user_id: EXISTING_ID });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("reports an already registered household and removes the identity it just created", async () => {
    routine(conflict("DUPLICATE_IDENTIFIER"));
    const response = await POST(request());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.context).toEqual({ reason: "DUPLICATE_IDENTIFIER" });
    expect(body.error.fieldErrors[0].field).toBe("identifier");
    expect(deleteUser).toHaveBeenCalledWith(NEW_ID);
  });

  it("rejects a household outside the configured list before creating any identity", async () => {
    listed.value = ["A-102", "Tower B 303"];
    const response = await POST(request());
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.context).toEqual({ reason: "UNKNOWN_HOUSEHOLD" });
    expect(body.error.fieldErrors[0].field).toBe("identifier");
    expect(createUser).not.toHaveBeenCalled();
    expect(routineCall()).toBeUndefined();
  });

  it("accepts a case or spacing variant of a configured household", async () => {
    listed.value = ["a-101"];
    expect((await POST(request())).status).toBe(202);
    expect(routineCall()).toBeDefined();
  });

  it("maps the routine's list check and removes the identity it just created", async () => {
    routine({
      data: null,
      error: {
        code: "P0001",
        message: "VALIDATION_FAILED",
        details: "UNKNOWN_HOUSEHOLD",
      },
      status: 400,
    });
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect((await response.json()).error.fieldErrors[0].field).toBe(
      "identifier",
    );
    expect(deleteUser).toHaveBeenCalledWith(NEW_ID);
  });

  it("refuses before Auth when the configured list cannot be read", async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "consume_rate_limit"
          ? allowed
          : { data: null, error: { message: "outage" }, status: 503 },
      ),
    );
    expect((await POST(request())).status).toBe(503);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot normally without touching Auth or the database", async () => {
    const response = await POST(
      request({
        body: {
          representativeName: "Bot",
          email: "bot@example.test",
          identifier: "Z-1",
          website: "https://spam.example",
        },
      }),
    );
    expect(response.status).toBe(202);
    expect(createUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([{ origin: "https://evil.example" }, { token: "wrong" }])(
    "rejects cross-site or invalid-CSRF requests before any work",
    async (overrides) => {
      expect((await POST(request(overrides))).status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
      expect(createUser).not.toHaveBeenCalled();
    },
  );

  it.each([
    { representativeName: "", email: "a@example.test", identifier: "A-1" },
    { representativeName: "A", email: "nope", identifier: "A-1" },
    { representativeName: "A", email: "a@example.test", identifier: "" },
    {
      representativeName: "A",
      email: "a@example.test",
      identifier: "<b>A</b>",
    },
    {
      representativeName: "A",
      email: "a@example.test",
      identifier: "A-1",
      isAdmin: true,
    },
  ])("rejects invalid or privileged registration data", async (body) => {
    expect((await POST(request({ body }))).status).toBe(422);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("stops before Auth when a budget is exhausted", async () => {
    rpc.mockResolvedValue({
      data: { allowed: false, retryAfterSeconds: 90 },
      error: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("reports a temporary failure and cleans up when the database stage fails", async () => {
    routine({ data: null, error: { message: "outage" }, status: 503 });
    expect((await POST(request())).status).toBe(503);
    expect(deleteUser).toHaveBeenCalledWith(NEW_ID);
  });

  it("rejects unsupported methods", async () => {
    expect(
      (await GET(new Request("https://civic.example/api/register"))).status,
    ).toBe(405);
  });
});
