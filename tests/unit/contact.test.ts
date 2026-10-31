// Exercises the real contact route and mail transport with controlled external dependencies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, GET } from "@/app/api/contact/route";
import { createCsrfContext, csrfTokenFor } from "@/server/http/csrf";
import { parseEnvironment } from "@/server/config/environment";

const { context, rpc, transport, tenant } = vi.hoisted(() => ({
  context: { value: "" },
  rpc: vi.fn(),
  transport: vi.fn(),
  tenant: {
    tenantId: "single-rwa",
    kind: "single",
    hostname: "civic.example",
    canonicalOrigin: "https://civic.example",
    state: "active",
    projectUrl: "https://project.supabase.co",
    publishableKey: "synthetic-publishable-key",
    serviceRoleKeyRef: "SUPABASE_SERVICE_ROLE_KEY",
  },
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
vi.mock("@/server/db/clients", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/server/config/tenant-context", () => ({
  getRequestTenantContext: async () => tenant,
}));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("APP_ORIGIN", "https://civic.example");
  vi.stubEnv("MAINTENANCE_MODE", "0");
  vi.stubEnv("RESEND_API_KEY", "synthetic-key");
  vi.stubEnv("CONTACT_EMAIL_FROM", "support@civic.example");
  vi.stubEnv("CONTACT_EMAIL_TO", "admin@civic.example");
  context.value = createCsrfContext();
  rpc.mockReset().mockResolvedValue({ data: { allowed: true }, error: null });
  transport.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ id: "synthetic-message" }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(
  overrides: { origin?: string; token?: string; body?: unknown } = {},
) {
  return new Request("https://civic.example/api/contact", {
    method: "POST",
    headers: {
      origin: overrides.origin ?? "https://civic.example",
      "X-CSRF-Token": overrides.token ?? csrfTokenFor(context.value),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      overrides.body ?? {
        name: "Synthetic Resident",
        email: "RESIDENT@example.test",
        message: "A synthetic contact delivery test.",
      },
    ),
  });
}

describe("contact delivery", () => {
  it("sends through the provider before acknowledging acceptance", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect((await response.json()).data.message).toContain(
      "inbox is not yet confirmed",
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledOnce();
    const call = transport.mock.calls[0];
    if (!call) throw new Error("Expected provider request");
    const [url, options] = call;
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(options.body)).toEqual({
      from: "support@civic.example",
      to: ["admin@civic.example"],
      reply_to: "resident@example.test",
      subject: "Civic Pulse contact enquiry",
      text: expect.stringContaining("A synthetic contact delivery test."),
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([{ origin: "https://evil.example" }, { token: "wrong" }])(
    "rejects cross-site or invalid-CSRF requests before sending",
    async (overrides) => {
      expect((await POST(request(overrides))).status).toBe(403);
      expect(transport).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: "",
      email: "resident@example.test",
      message: "A valid-length message",
    },
    { name: "Test", email: "not-an-email", message: "A valid-length message" },
    { name: "Test", email: "resident@example.test", message: "short" },
    { name: "Test", email: "resident@example.test", message: "x".repeat(5001) },
  ])("rejects invalid contact data", async (body) => {
    expect((await POST(request({ body }))).status).toBe(422);
    expect(transport).not.toHaveBeenCalled();
  });

  it("fails closed when the mail provider is not configured", async () => {
    for (const key of [
      "RESEND_API_KEY",
      "CONTACT_EMAIL_FROM",
      "CONTACT_EMAIL_TO",
    ])
      vi.stubEnv(key, "");
    expect((await POST(request())).status).toBe(503);
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects incomplete provider settings without leaking secret values", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "test",
        RESEND_API_KEY: "do-not-print-this",
      }),
    ).toThrow("CONTACT_EMAIL_FROM");
    expect(() =>
      parseEnvironment({
        NODE_ENV: "test",
        RESEND_API_KEY: "do-not-print-this",
      }),
    ).not.toThrow("do-not-print-this");
  });

  it("does not send when the shared limiter is exhausted", async () => {
    rpc.mockResolvedValue({
      data: { allowed: false, retryAfterSeconds: 120 },
      error: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not send when the limiter is unavailable", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "synthetic outage" },
    });
    expect((await POST(request())).status).toBe(503);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([500, 429])(
    "does not report success for provider status %i or expose diagnostics",
    async (status) => {
      transport.mockResolvedValue(
        new Response("private provider diagnostic", { status }),
      );
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(
        "private provider diagnostic",
      );
    },
  );

  it("does not acknowledge an invalid provider response", async () => {
    transport.mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await POST(request())).status).toBe(503);
  });

  it("handles provider timeouts and connection failures safely", async () => {
    transport.mockRejectedValue(new Error("sensitive transport failure"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive transport failure");
  });

  it("rejects unsupported methods", async () => {
    expect(
      (await GET(new Request("https://civic.example/api/contact"))).status,
    ).toBe(405);
    expect(transport).not.toHaveBeenCalled();
  });
});
