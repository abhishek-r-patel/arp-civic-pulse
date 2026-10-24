import { afterEach, describe, expect, it, vi } from "vitest";
import { route } from "@/server/http/route";
import { GET as health } from "@/app/api/internal/health/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("maintenance mode at the API", () => {
  const { GET } = route({ GET: () => new Response("served") });
  const call = (handler: typeof GET, path: string) =>
    handler(new Request(`http://localhost${path}`));

  it("serves normally when off", async () => {
    expect(await (await call(GET, "/api/votes")).text()).toBe("served");
  });

  it("answers 503 for every data route when on, without running the handler", async () => {
    vi.stubEnv("MAINTENANCE_MODE", "1");
    const response = await call(GET, "/api/votes");
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as {
      error: { code: string };
      requestId: string;
    };
    expect(body.error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(body.requestId).toBeTruthy();
  });

  it("reports the service as unavailable on the health route, with only a status and a support id", async () => {
    vi.stubEnv("MAINTENANCE_MODE", "1");
    const response = await call(health, "/api/internal/health");
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      data: unknown;
      requestId: string;
    };
    expect(body.data).toEqual({ status: "unavailable" });
    expect(Object.keys(body).sort()).toEqual(["data", "requestId"]);
  });

  it("reports unavailable, never an error detail, when the database cannot be reached", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "not-a-real-key");
    const response = await call(health, "/api/internal/health");
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain('"status":"unavailable"');
    expect(text).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|fetch failed|key/iu);
  });
});
