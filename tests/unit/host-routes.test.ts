// Host-kind routing: the main website serves only its pages, and the demo refuses email routes.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  demoRequestAllowed,
  mainHostApiAllowed,
  mainHostRoute,
} from "@/shared/host-routes";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const demoId = "10000000-0000-4000-8000-000000000001";
const demoKeyRef = `TENANT_${demoId.replaceAll("-", "").toUpperCase()}_SUPABASE_SERVICE_ROLE_KEY`;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("main host page routing", () => {
  it.each([
    ["/", "/site"],
    ["/contact", "/site/contact"],
    ["/privacy", "/site/privacy"],
    ["/robots.txt", "/robots.txt"],
    ["/sitemap.xml", "/sitemap.xml"],
    ["/opengraph-image", "/opengraph-image"],
    ["/icon.svg", "/icon.svg"],
  ])("serves %s from %s", (path, target) => {
    expect(mainHostRoute(path)).toBe(target);
  });

  it.each([
    "/sign-in",
    "/register",
    "/admin/residents",
    "/votes/11111111-1111-4111-8111-111111111111",
    "/user-guide",
    "/tech-guide",
    "/site",
    "/site/contact",
    "/contact/",
  ])("turns RWA and internal path %s into a 404", (path) => {
    expect(mainHostRoute(path)).toBe("/site/not-found");
  });

  it("answers only the health check on the main host API", () => {
    expect(mainHostApiAllowed("/api/internal/health")).toBe(true);
    expect(mainHostApiAllowed("/api/contact")).toBe(false);
    expect(mainHostApiAllowed("/api/auth/code")).toBe(false);
  });
});

describe("demo write policy", () => {
  it.each([
    ["GET", "/api/votes", true],
    ["HEAD", "/api/votes", true],
    ["GET", "/api/auth/code", true],
    ["POST", "/api/demo/session", true],
    ["POST", "/api/auth/sign-out", true],
    ["POST", "/api/votes/1/submission", true],
    ["PATCH", "/api/admin/settings", true],
    ["DELETE", "/api/admin/accounts/1", true],
    ["POST", "/api/auth/code", false],
    ["POST", "/api/auth/verify", false],
    ["POST", "/api/register", false],
    ["POST", "/api/contact", false],
  ] as const)("%s %s allowed: %s", (method, path, allowed) => {
    expect(demoRequestAllowed(method, path)).toBe(allowed);
  });
});

async function routedRoute() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ORIGIN", "https://example.test");
  vi.stubEnv("RATE_LIMIT_HMAC_KEY", "x".repeat(32));
  vi.stubEnv("TENANT_ROUTING_ENABLED", "true");
  vi.stubEnv(
    "TENANT_DIRECTORY_JSON",
    JSON.stringify({
      version: 1,
      entries: [
        { host: "example.test", kind: "main", state: "active" },
        {
          host: "demo.example.test",
          kind: "demo",
          tenantId: demoId,
          state: "active",
          projectUrl: "https://demoproject.supabase.co",
          publishableKey: "sb_publishable_demo",
          serviceRoleKeyRef: demoKeyRef,
        },
      ],
    }),
  );
  vi.stubEnv(demoKeyRef, "sb_secret_demo");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  return (await import("@/server/http/route")).route;
}

describe("API host-kind guard", () => {
  it("returns 404 for RWA APIs on the main host without running the handler", async () => {
    const route = await routedRoute();
    const handler = vi.fn(() => new Response("ran"));
    const { POST } = route({ POST: handler });
    const response = await POST(
      new Request("https://example.test/api/auth/code", {
        method: "POST",
        headers: { host: "example.test" },
      }),
    );
    expect(response.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses demo email routes with a plain explanation and lets other changes through", async () => {
    const route = await routedRoute();
    const handler = vi.fn(() => new Response("ran"));
    const { GET, POST } = route({ GET: handler, POST: handler });
    const email = await POST(
      new Request("https://demo.example.test/api/auth/code", {
        method: "POST",
        headers: { host: "demo.example.test" },
      }),
    );
    expect(email.status).toBe(403);
    const body = (await email.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("DEMO_EMAIL_DISABLED");
    expect(body.error.message).toMatch(/demo/iu);
    expect(handler).not.toHaveBeenCalled();

    const write = await POST(
      new Request("https://demo.example.test/api/votes/1/submission", {
        method: "POST",
        headers: { host: "demo.example.test" },
      }),
    );
    expect(await write.text()).toBe("ran");
    const read = await GET(
      new Request("https://demo.example.test/api/votes", {
        headers: { host: "demo.example.test" },
      }),
    );
    expect(await read.text()).toBe("ran");
  });
});
