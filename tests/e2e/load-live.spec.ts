import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  createCsrfContext,
  csrfCookieName,
  csrfTokenFor,
} from "../../src/server/http/csrf";
import {
  activateVoteFor,
  asUser,
  freshCode,
  provisionAdmin,
  seedHousehold,
} from "./support/live";

/*
 * HTTP-level load against a PRODUCTION build (`npm run build`, then `next
 * start` on port 3100) and YOUR disposable hosted Supabase project:
 * the Data API, Auth, the guarded routines and the exports, end to end.
 * Skipped unless LOAD_LIVE=1. Numbers depend on this machine, this network and
 * the free-tier project, so they are evidence of behaviour and a sanity check
 * of the targets, not a capacity guarantee for the production hosting plan.
 *
 * Hosted Auth limits token verifications per IP, so a small, fixed pool of
 * signed-in members is reused; "100 concurrent users" is 100 requests in flight.
 */
test.skip(
  process.env.LOAD_LIVE !== "1",
  "Set LOAD_LIVE=1 (with a production server running) to run the HTTP load test.",
);

// A production server requires an HTTPS origin; point LOAD_ORIGIN at the TLS front (see docs/PILOT_READINESS.md).
const ORIGIN = process.env.LOAD_ORIGIN ?? "http://127.0.0.1:3100";
const SECURE = ORIGIN.startsWith("https://");
const CSRF_COOKIE = csrfCookieName(SECURE);
const HOST = new URL(ORIGIN).hostname;
const MEMBERS = 24;
const IN_FLIGHT = 100;
const P95_PAGE_MS = Number(process.env.LOAD_P95_MS ?? 2_000);
const P95_ACK_MS = Number(process.env.LOAD_P95_ACK_MS ?? 3_000);

test.beforeEach(() => {
  test.setTimeout(900_000);
});

interface Member {
  id: string;
  householdId: string;
  api: APIRequestContext;
}

async function newClient(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    storageState: {
      cookies: [
        {
          name: CSRF_COOKIE,
          value: createCsrfContext(),
          domain: HOST,
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: SECURE,
          sameSite: "Strict",
        },
      ],
      origins: [],
    },
  });
}

async function token(api: APIRequestContext): Promise<string> {
  const state = await api.storageState();
  return csrfTokenFor(
    state.cookies.find((c) => c.name === CSRF_COOKIE)?.value ?? "",
  );
}

async function signedIn(email: string): Promise<APIRequestContext> {
  const api = await newClient();
  const verify = await api.post("/api/auth/verify", {
    headers: { origin: ORIGIN, "x-csrf-token": await token(api) },
    data: { email, code: await freshCode(email) },
  });
  expect(verify.status(), await verify.text()).toBe(200);
  return api;
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    ] ?? 0
  );
};

async function inFlight<T>(
  items: readonly T[],
  width: number,
  task: (item: T) => Promise<unknown>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        await task(items[next++] as T);
      }
    }),
  );
}

test("100 requests in flight: reads, a submission burst, results and exports meet the targets", async () => {
  const timings: Record<string, number[]> = {};
  const failures: string[] = [];
  const timed = async (
    label: string,
    run: () => Promise<{ status(): number }>,
    ok: number[] = [200],
  ) => {
    const started = performance.now();
    const response = await run();
    (timings[label] ??= []).push(performance.now() - started);
    if (!ok.includes(response.status())) {
      failures.push(`${label}: HTTP ${response.status()}`);
    }
  };

  // Setup: an administrator and a pool of residents, each signed in once.
  const adminUser = await provisionAdmin();
  const residents = [];
  for (let i = 0; i < MEMBERS; i += 1) {
    residents.push(await seedHousehold());
  }
  const members: Member[] = [];
  for (const resident of residents) {
    members.push({
      id: resident.id,
      householdId: resident.householdId,
      api: await signedIn(resident.email),
    });
  }
  const vote = await activateVoteFor(
    adminUser.id,
    members.map((m) => m.householdId),
  );
  const options = vote.options.map((o) => o.id);

  // Phase 1: reads from many users at once (list + ballot), 100 in flight. Run twice: the first
  // pass meets a cold server (connections, JIT) and is REPORTED; the second is what the targets
  // are asserted on. A real deployment is warm by the time a vote is busy.
  const reads = members.flatMap((m) =>
    Array.from({ length: 3 }, (_, i) => ({
      m,
      kind: i % 2 === 0 ? "list" : "ballot",
    })),
  );
  const readOnce = (suffix: string) =>
    inFlight(reads, IN_FLIGHT, ({ m, kind }) =>
      kind === "list"
        ? timed(`GET /api/votes${suffix}`, () => m.api.get("/api/votes"))
        : timed(`GET /api/votes/{id}${suffix}`, () =>
            m.api.get(`/api/votes/${vote.id}`),
          ),
    );
  await readOnce(" (cold)");
  await readOnce("");
  // Phase 2: every member submits at the same moment, while others keep reading.
  const burst = inFlight(members, MEMBERS, async (m) =>
    timed("POST submission", async () =>
      m.api.post(`/api/votes/${vote.id}/submission`, {
        headers: { origin: ORIGIN, "x-csrf-token": await token(m.api) },
        data: {
          confirmed: true,
          optionId: options[Math.floor(Math.random() * options.length)],
        },
      }),
    ),
  );
  const background = inFlight(
    members.flatMap((m) => [m, m, m]),
    IN_FLIGHT - MEMBERS,
    (m) =>
      timed("GET participation (during burst)", () =>
        m.api.get(`/api/votes/${vote.id}/participation`),
      ),
  );
  await Promise.all([burst, background]);

  // PUBLIC responses are replaceable while ACTIVE; replacements never add participation.
  await inFlight(members, MEMBERS, async (m) =>
    timed("POST replace response", async () =>
      m.api.post(`/api/votes/${vote.id}/submission`, {
        headers: { origin: ORIGIN, "x-csrf-token": await token(m.api) },
        data: { confirmed: true, optionId: options[0] },
      }),
    ),
  );

  // Phase 3: complete the vote, then results and exports under load.
  await asUser(
    adminUser.id,
    "public.complete_vote_early($1, true, 'Load test')",
    [vote.id],
  );
  await inFlight(
    members.flatMap((m) => [m, m, m]),
    IN_FLIGHT,
    (m) =>
      timed("GET results", () => m.api.get(`/api/votes/${vote.id}/results`)),
  );
  await inFlight(members, 12, (m) =>
    timed("GET export csv", () =>
      m.api.get(`/api/votes/${vote.id}/exports/csv`),
    ),
  );
  await inFlight(members, 8, (m) =>
    timed("GET export pdf", () =>
      m.api.get(`/api/votes/${vote.id}/exports/pdf`),
    ),
  );

  const rows = Object.fromEntries(
    Object.entries(timings).map(([label, values]) => [
      label,
      {
        n: values.length,
        "p50 ms": Math.round(percentile(values, 50)),
        "p95 ms": Math.round(percentile(values, 95)),
        "max ms": Math.round(Math.max(...values)),
      },
    ]),
  );
  console.table(rows);

  // Exactness first: nothing lost, nothing doubled, and no unexpected status anywhere.
  expect(failures).toEqual([]);
  const results = (await (
    await members[0]?.api.get(`/api/votes/${vote.id}/results`)
  )?.json()) as {
    data: {
      submittedCount: string;
      eligibleCount: string;
      options: { count: string }[];
    };
  };
  expect(results.data.submittedCount).toBe(String(MEMBERS));
  expect(
    results.data.options.reduce((sum, o) => sum + Number(o.count), 0),
  ).toBe(MEMBERS);

  expect(percentile(timings["POST submission"] ?? [], 95)).toBeLessThan(
    P95_ACK_MS,
  );
  for (const label of Object.keys(timings).filter(
    (l) => l !== "POST submission" && !l.endsWith("(cold)"),
  )) {
    expect(percentile(timings[label] ?? [], 95), label).toBeLessThan(
      P95_PAGE_MS,
    );
  }

  for (const m of members) {
    await m.api.dispose();
  }
});
