// Source-discovered protected API access checks against an explicitly enabled disposable project.
import {
  closeSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import { Client } from "pg";
import {
  createCsrfContext,
  csrfCookieName,
  csrfTokenFor,
} from "../../src/server/http/csrf";
import {
  freshCode,
  provisionAdmin,
  seedHousehold,
  signInThroughUi,
} from "./support/live";

/*
 * Access control over real HTTP against the running app and YOUR disposable
 * hosted Supabase project (docs/API.md section 3, ARCHITECTURE.md section 06):
 * every API route is discovered from the source tree, so a route added later
 * cannot ship without being checked here. Skipped unless LIVE_AUTH=1.
 */
test.skip(
  process.env.LIVE_AUTH !== "1",
  "Set LIVE_AUTH=1 and fill .env.local to run against the hosted project.",
);

test.beforeEach(() => {
  test.setTimeout(300_000);
});

const ORIGIN = "http://127.0.0.1:3100";
const CSRF_COOKIE = csrfCookieName(false);
const UUID = "00000000-0000-4000-8000-000000000001";

interface ApiRoute {
  path: string;
  methods: ("GET" | "POST" | "PATCH" | "PUT" | "DELETE")[];
}

function discoverRoutes(): ApiRoute[] {
  const root = join(process.cwd(), "src", "app", "api");
  const found: ApiRoute[] = [];
  const readRouteSource = (path: string): string | null => {
    const descriptor = openSync(path, "r");
    try {
      if (!fstatSync(descriptor).isFile()) return null;
      return readFileSync(descriptor, "utf8");
    } finally {
      closeSync(descriptor);
    }
  };
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === "route.ts") {
        const source = readRouteSource(full);
        if (source === null) continue;
        const methods = (
          ["GET", "POST", "PATCH", "PUT", "DELETE"] as const
        ).filter((m) => new RegExp(`^\\s{2}${m}:`, "mu").test(source));
        const path =
          "/api/" +
          relative(root, dir)
            .split(sep)
            .filter(Boolean)
            .map((part) =>
              part === "[format]" ? "csv" : part.startsWith("[") ? UUID : part,
            )
            .join("/");
        found.push({ path: path.replace(/\/$/u, ""), methods });
      }
    }
  };
  walk(root);
  return found;
}

// Public by design: session establishment, liveness and support have their own protection tests.
const PUBLIC = [
  "/api/auth/code",
  "/api/auth/verify",
  "/api/auth/sign-out",
  "/api/internal/health",
  "/api/contact",
];
const routes = discoverRoutes();
const protectedRoutes = routes.filter((r) => !PUBLIC.includes(r.path));
const adminRoutes = protectedRoutes.filter((r) =>
  r.path.startsWith("/api/admin/"),
);

async function newClient(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: ORIGIN,
    storageState: {
      cookies: [
        {
          name: CSRF_COOKIE,
          value: createCsrfContext(),
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Strict",
        },
      ],
      origins: [],
    },
  });
}

const tokenOf = async (api: APIRequestContext) =>
  csrfTokenFor(
    (await api.storageState()).cookies.find((c) => c.name === CSRF_COOKIE)
      ?.value ?? "",
  );

async function signedIn(email: string): Promise<APIRequestContext> {
  const api = await newClient();
  const verify = await api.post("/api/auth/verify", {
    headers: { origin: ORIGIN, "x-csrf-token": await tokenOf(api) },
    data: { email, code: await freshCode(email) },
  });
  expect(verify.status(), await verify.text()).toBe(200);
  return api;
}

// A request that passes origin and CSRF checks, so the answer reflects identity, not CSRF.
async function call(api: APIRequestContext, method: string, path: string) {
  const headers: Record<string, string> =
    method === "GET"
      ? {}
      : { origin: ORIGIN, "x-csrf-token": await tokenOf(api) };
  return api.fetch(path, {
    method,
    headers,
    ...(method === "GET" ? {} : { data: {} }),
  });
}

async function asOwner(sql: string, params: unknown[]) {
  const client = new Client({
    connectionString: process.env.LIVE_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role cp_owner");
    await client.query(sql, params);
    await client.query("commit");
  } finally {
    await client.end();
  }
}

const codeOf = async (response: { json(): Promise<unknown> }) =>
  ((await response.json()) as { error?: { code?: string } }).error?.code;

test("the sweep covers every API route in the source tree", () => {
  // If this list changes, the new route is automatically included below; this pins what exists today.
  expect(protectedRoutes.length).toBeGreaterThanOrEqual(17);
  expect(adminRoutes.length).toBeGreaterThanOrEqual(10);
  for (const route of routes) {
    expect(route.methods.length, route.path).toBeGreaterThan(0);
  }
});

test.describe("unauthenticated callers", () => {
  test("every protected route answers 401 AUTH_REQUIRED, before any validation or lookup", async () => {
    const api = await newClient();
    for (const route of protectedRoutes) {
      for (const method of route.methods) {
        const response = await call(api, method, route.path);
        expect(response.status(), `${method} ${route.path}`).toBe(401);
        expect(await codeOf(response), `${method} ${route.path}`).toBe(
          "AUTH_REQUIRED",
        );
        expect(response.headers()["cache-control"]).toMatch(/no-store/u);
      }
    }
  });

  test("a mutation without the origin and CSRF proof is refused before identity is even considered", async () => {
    const api = await newClient();
    for (const route of protectedRoutes) {
      for (const method of route.methods.filter((m) => m !== "GET")) {
        const noOrigin = await api.fetch(route.path, { method, data: {} });
        expect(noOrigin.status(), `${method} ${route.path}`).toBe(403);
        expect(await codeOf(noOrigin)).toBe("CSRF_FAILED");
        const foreign = await api.fetch(route.path, {
          method,
          data: {},
          headers: {
            origin: "https://evil.example",
            "x-csrf-token": await tokenOf(api),
          },
        });
        expect(await codeOf(foreign), `${method} ${route.path}`).toBe(
          "CSRF_FAILED",
        );
      }
    }
  });

  test("pages never render protected content for a signed-out visitor", async ({
    page,
  }) => {
    for (const path of [
      "/",
      "/votes/" + UUID,
      "/votes/" + UUID + "/results",
      "/admin",
      "/admin/audit",
      "/admin/votes",
      "/admin/accounts",
      "/admin/households",
      `/admin/votes/${UUID}/participation`,
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in$|\/admin\/?$/u);
      await page.waitForLoadState("networkidle");
      const text = await page.locator("body").innerText();
      expect(text, path).not.toMatch(
        /Manage Votes|Audit History|Households? Register/u,
      );
    }
  });
});

test.describe("an enabled resident (not an administrator)", () => {
  test("is refused by every administrative route with 403, never 404 or data", async () => {
    const resident = await seedHousehold();
    const api = await signedIn(resident.email);
    for (const route of adminRoutes) {
      for (const method of route.methods) {
        const response = await call(api, method, route.path);
        expect(response.status(), `${method} ${route.path}`).toBe(403);
        expect(await codeOf(response), `${method} ${route.path}`).toBe(
          "FORBIDDEN",
        );
      }
    }
  });

  test("gets the same 404 for a vote they cannot see as for one that does not exist", async () => {
    const resident = await seedHousehold();
    const api = await signedIn(resident.email);
    const other = "00000000-0000-4000-8000-0000000000aa";
    for (const suffix of ["", "/results", "/participation", "/exports/csv"]) {
      const a = await api.get(`/api/votes/${UUID}${suffix}`);
      const b = await api.get(`/api/votes/${other}${suffix}`);
      expect([a.status(), b.status()], suffix).toEqual([404, 404]);
      expect(await codeOf(a)).toBe(await codeOf(b));
    }
  });

  test("cannot reach administrative pages: a plain not-found, no admin content", async ({
    page,
  }) => {
    const resident = await seedHousehold();
    await signInThroughUi(
      page,
      resident.email,
      await freshCode(resident.email),
    );
    for (const path of [
      "/admin/audit",
      "/admin/votes",
      "/admin/accounts",
      "/admin/households",
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1, name: "Page not found" }),
      ).toBeVisible();
    }
    // And the navigation never offers them.
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Audit History" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: "Manage Votes" })).toHaveCount(
      0,
    );
  });
});

test.describe("access that changes while a session is still valid", () => {
  test("suspension blocks every route at once, even with a valid token", async () => {
    const resident = await seedHousehold();
    const api = await signedIn(resident.email);
    expect((await api.get("/api/votes")).status()).toBe(200);

    await asOwner(
      "update public.profiles set status = 'SUSPENDED' where id = $1",
      [resident.id],
    );
    for (const route of protectedRoutes) {
      for (const method of route.methods) {
        const response = await call(api, method, route.path);
        expect(response.status(), `${method} ${route.path}`).toBe(403);
      }
    }
  });

  test("losing the administrator role takes effect on the next request", async () => {
    const admin = await provisionAdmin();
    const api = await signedIn(admin.email);
    expect((await api.get("/api/admin/audit")).status()).toBe(200);

    await asOwner("update public.profiles set is_admin = false where id = $1", [
      admin.id,
    ]);
    for (const route of adminRoutes) {
      for (const method of route.methods) {
        const response = await call(api, method, route.path);
        expect(response.status(), `${method} ${route.path}`).toBe(403);
      }
    }
    // Still a resident: member routes keep working.
    expect((await api.get("/api/votes")).status()).toBe(200);
  });

  test("a promoted resident gains administrative access without signing in again", async () => {
    const resident = await seedHousehold();
    const api = await signedIn(resident.email);
    expect((await api.get("/api/admin/audit")).status()).toBe(403);
    await asOwner("update public.profiles set is_admin = true where id = $1", [
      resident.id,
    ]);
    expect((await api.get("/api/admin/audit")).status()).toBe(200);
  });
});

test.describe("session lifecycle", () => {
  test("sign-out ends the session: the same cookie is refused afterwards", async () => {
    const resident = await seedHousehold();
    const api = await signedIn(resident.email);
    const saved = await api.storageState();
    expect((await api.get("/api/votes")).status()).toBe(200);

    const out = await api.post("/api/auth/sign-out", {
      headers: { origin: ORIGIN, "x-csrf-token": await tokenOf(api) },
      data: {},
    });
    expect(out.status()).toBe(204);
    expect((await api.get("/api/votes")).status()).toBe(401);

    // A copy of the old cookie (a stolen or replayed one) is refused too: Auth ended that session.
    const replay = await playwrightRequest.newContext({
      baseURL: ORIGIN,
      storageState: saved,
    });
    const replayed = await replay.get("/api/votes");
    expect(replayed.status()).toBe(401);
  });

  test("an expired access token is refreshed transparently and the session continues", async ({
    page,
    context,
  }) => {
    const resident = await seedHousehold();
    await signInThroughUi(
      page,
      resident.email,
      await freshCode(resident.email),
    );

    const authCookies = (await context.cookies()).filter(
      (c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"),
    );
    expect(authCookies.length).toBeGreaterThan(0);
    // Make the stored access token look expired, as it does after about an hour.
    for (const cookie of authCookies) {
      if (cookie.value.startsWith("base64-")) {
        const session = JSON.parse(
          Buffer.from(cookie.value.slice(7), "base64url").toString("utf8"),
        );
        session.expires_at = Math.floor(Date.now() / 1000) - 60;
        await context.addCookies([
          {
            ...cookie,
            value:
              "base64-" +
              Buffer.from(JSON.stringify(session)).toString("base64url"),
          },
        ]);
      }
    }

    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Votes" }),
    ).toBeVisible();
    const refreshed = (await context.cookies()).filter((c) =>
      c.name.startsWith("sb-"),
    );
    expect(
      refreshed.some(
        (c) => authCookies.find((a) => a.name === c.name)?.value !== c.value,
      ),
    ).toBe(true);

    // Past the refresh-token reuse window: the new pair was stored, so the old one is not needed.
    await page.waitForTimeout(15_000);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Votes" }),
    ).toBeVisible();
    expect((await page.request.get("/api/votes")).status()).toBe(200);
  });

  test("session cookies are HttpOnly, path-scoped, SameSite and limited to the configured lifetime", async ({
    page,
    context,
  }) => {
    const resident = await seedHousehold();
    await signInThroughUi(
      page,
      resident.email,
      await freshCode(resident.email),
    );
    const cookies = await context.cookies();
    const auth = cookies.filter((c) => c.name.startsWith("sb-"));
    expect(auth.length).toBeGreaterThan(0);
    for (const cookie of [
      ...auth,
      ...cookies.filter((c) => c.name === CSRF_COOKIE),
    ]) {
      expect(cookie.httpOnly, cookie.name).toBe(true);
      expect(cookie.path, cookie.name).toBe("/");
    }
    for (const cookie of auth) {
      expect(cookie.sameSite, cookie.name).toBe("Lax");
      const days = (cookie.expires - Date.now() / 1000) / 86_400;
      expect(
        days,
        `${cookie.name} lives ${days.toFixed(1)} days`,
      ).toBeLessThanOrEqual(14.01);
      expect(days).toBeGreaterThan(1);
    }
    // No token or session material is readable by page script.
    expect(await page.evaluate(() => document.cookie)).not.toMatch(
      /sb-|auth-token/u,
    );
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0);
  });

  test("tokens never appear in page HTML or API responses", async ({
    page,
  }) => {
    const resident = await seedHousehold();
    await signInThroughUi(
      page,
      resident.email,
      await freshCode(resident.email),
    );
    const html = await page.content();
    const body = await (await page.request.get("/api/votes")).text();
    for (const text of [html, body]) {
      expect(text).not.toMatch(
        /access_token|refresh_token|eyJ[A-Za-z0-9_-]{20,}\./u,
      );
    }
  });
});
