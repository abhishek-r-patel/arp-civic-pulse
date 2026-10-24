import { expect, test } from "@playwright/test";

// APP_ORIGIN is set to the web server's base URL in playwright.config.ts.
const ORIGIN = "http://127.0.0.1:3100";
const ROUTES = ["/api/auth/code", "/api/auth/verify", "/api/auth/sign-out"];
const BODIES: Record<string, unknown> = {
  "/api/auth/code": { email: "resident@example.test" },
  "/api/auth/verify": { email: "resident@example.test", code: "123456" },
  "/api/auth/sign-out": {},
};

for (const path of ROUTES) {
  test.describe(path, () => {
    test("rejects unsupported methods with Allow", async ({ request }) => {
      const response = await request.get(path);

      expect(response.status()).toBe(405);
      expect(response.headers().allow).toBe("POST");
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(await response.json()).toMatchObject({
        error: { code: "METHOD_NOT_ALLOWED" },
      });
    });

    test("rejects a mutation without an Origin header", async ({ request }) => {
      const response = await request.post(path, { data: BODIES[path] });

      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "CSRF_FAILED" },
      });
    });

    test("rejects a mismatched Origin", async ({ request }) => {
      const response = await request.post(path, {
        data: BODIES[path],
        headers: { origin: "https://evil.example.test" },
      });

      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "CSRF_FAILED" },
      });
    });

    test("rejects a matching Origin without a valid CSRF token", async ({
      request,
    }) => {
      const variants: Record<string, string>[] = [
        {},
        { "x-csrf-token": "not-the-token" },
      ];
      for (const headers of variants) {
        const response = await request.post(path, {
          data: BODIES[path],
          headers: { origin: ORIGIN, ...headers },
        });

        expect(response.status()).toBe(403);
        const body = (await response.json()) as {
          error: { code: string };
          requestId: string;
        };
        expect(body.error.code).toBe("CSRF_FAILED");
        expect(response.headers()["x-request-id"]).toBe(body.requestId);
      }
    });

    test("never echoes submitted values in protection failures", async ({
      request,
    }) => {
      const response = await request.post(path, {
        data: BODIES[path],
        headers: { origin: "https://evil.example.test" },
      });

      expect(await response.text()).not.toContain("resident@example.test");
    });
  });
}
