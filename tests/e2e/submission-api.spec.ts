import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import { createCsrfContext, csrfTokenFor } from "../../src/server/http/csrf";
import {
  activateVoteFor,
  freshCode,
  provisionAdmin,
  seedHousehold,
} from "./support/live";

/*
 * The member submission API over real HTTP against the running app and YOUR
 * disposable hosted Supabase project: origin and CSRF protection, cookie
 * sessions, response shapes and caching headers. Skipped unless LIVE_AUTH=1.
 */
test.skip(
  process.env.LIVE_AUTH !== "1",
  "Set LIVE_AUTH=1 and fill .env.local to run against the hosted project.",
);

const ORIGIN = "http://127.0.0.1:3100";
const CSRF_COOKIE = "cp_csrf";

test.beforeEach(() => {
  test.setTimeout(180_000);
});

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

// The token for whatever CSRF context the client currently holds (it rotates at sign-in).
async function token(api: APIRequestContext): Promise<string> {
  const state = await api.storageState();
  const context = state.cookies.find((c) => c.name === CSRF_COOKIE)?.value;
  expect(context).toBeTruthy();
  return csrfTokenFor(context ?? "");
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

async function post(
  api: APIRequestContext,
  path: string,
  data: unknown,
  headers: Record<string, string> = {},
) {
  return api.post(path, {
    headers: { origin: ORIGIN, "x-csrf-token": await token(api), ...headers },
    data,
  });
}

test.describe("POST /api/votes/{id}/submission", () => {
  test("accepts one ballot, answers with participation only, and then refuses a repeat", async () => {
    const member = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [member.householdId]);
    const api = await signedIn(member.email);
    const optionId = vote.options[0]?.id;

    const accepted = await post(api, `/api/votes/${vote.id}/submission`, {
      confirmed: true,
      optionId,
    });
    expect(accepted.status(), await accepted.text()).toBe(200);
    const body = (await accepted.json()) as {
      data: Record<string, unknown>;
      requestId: string;
    };
    // Participation only: no selection, option, household, timestamp or count.
    expect(body.data).toEqual({ voteId: vote.id, submitted: true });
    expect(JSON.stringify(body)).not.toContain(String(optionId));
    expect(accepted.headers()["cache-control"]).toMatch(/no-store/u);

    const status = await api.get(`/api/votes/${vote.id}/participation`);
    expect(status.status()).toBe(200);
    expect(((await status.json()) as { data: unknown }).data).toEqual({
      voteId: vote.id,
      status: "ACTIVE",
      submitted: true,
    });
    expect(status.headers()["cache-control"]).toMatch(/no-store/u);

    const other = vote.options[1]?.id;
    const repeat = await post(api, `/api/votes/${vote.id}/submission`, {
      confirmed: true,
      optionId: other,
    });
    expect(repeat.status()).toBe(409);
    const repeated = await repeat.text();
    expect(repeated).toContain("ALREADY_SUBMITTED");
    expect(repeated).not.toContain(String(other));
    await api.dispose();
  });

  test("records a complete CLOSED ballot with an explicit abstention", async () => {
    const member = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(
      adminUser.id,
      [member.householdId],
      "CLOSED",
    );
    const api = await signedIn(member.email);
    const office = vote.offices[0];

    const abstain = await post(api, `/api/votes/${vote.id}/submission`, {
      confirmed: true,
      selections: [{ officeId: office?.id, candidateId: null }],
    });
    expect(abstain.status(), await abstain.text()).toBe(200);
    expect(((await abstain.json()) as { data: unknown }).data).toEqual({
      voteId: vote.id,
      submitted: true,
    });
    await api.dispose();
  });

  test("refuses requests without a valid origin, CSRF token or session", async () => {
    const member = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [member.householdId]);
    const path = `/api/votes/${vote.id}/submission`;
    const body = { confirmed: true, optionId: vote.options[0]?.id };

    // Signed out, with a perfectly valid CSRF pair: not authenticated.
    const anonymous = await newClient();
    expect((await post(anonymous, path, body)).status()).toBe(401);

    const api = await signedIn(member.email);
    expect(
      (
        await api.post(path, { headers: { origin: ORIGIN }, data: body })
      ).status(),
    ).toBe(403);
    expect(
      (await post(api, path, body, { "x-csrf-token": "wrong" })).status(),
    ).toBe(403);
    expect(
      (
        await post(api, path, body, { origin: "https://evil.example" })
      ).status(),
    ).toBe(403);
    expect((await api.post(path, { data: body, headers: {} })).status()).toBe(
      403,
    );

    // None of the refused attempts consumed the household's single submission.
    const status = await api.get(`/api/votes/${vote.id}/participation`);
    expect(
      ((await status.json()) as { data: { submitted: boolean } }).data
        .submitted,
    ).toBe(false);
    await api.dispose();
    await anonymous.dispose();
  });

  test("rejects identity, timestamp and unknown fields with a validation error that never echoes values", async () => {
    const member = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [member.householdId]);
    const api = await signedIn(member.email);
    const path = `/api/votes/${vote.id}/submission`;
    const optionId = vote.options[0]?.id;

    for (const extra of [
      { householdId: member.householdId },
      { accountId: member.id },
      { acceptedAt: "2020-01-01T00:00:00Z" },
      { idempotencyKey: "SECRET-ECHO-CHECK" },
    ]) {
      const response = await post(api, path, {
        confirmed: true,
        optionId,
        ...extra,
      });
      expect(response.status(), JSON.stringify(extra)).toBe(422);
      const text = await response.text();
      expect(text).toContain("VALIDATION_FAILED");
      expect(text).not.toContain("SECRET-ECHO-CHECK");
      expect(text).not.toContain(member.householdId);
    }
    for (const bad of [
      { confirmed: true },
      { confirmed: false, optionId },
      { confirmed: true, optionId: "nope" },
      { confirmed: true, optionId, selections: [] },
    ]) {
      expect((await post(api, path, bad)).status()).toBe(422);
    }
    // A JSON scalar is valid JSON but not a ballot; a non-JSON body is the wrong media type.
    const scalar = await post(api, path, JSON.stringify("not an object"), {
      "content-type": "application/json",
    });
    expect(scalar.status()).toBe(422);
    expect((await post(api, path, "not json")).status()).toBe(415);
    const status = await api.get(`/api/votes/${vote.id}/participation`);
    expect(
      ((await status.json()) as { data: { submitted: boolean } }).data
        .submitted,
    ).toBe(false);
    await api.dispose();
  });

  test("answers 404 for a vote the caller is not entitled to, and 405 for unsupported methods", async () => {
    const entitled = await seedHousehold();
    const outsider = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [entitled.householdId]);
    const api = await signedIn(outsider.email);
    const path = `/api/votes/${vote.id}/submission`;

    const submit = await post(api, path, {
      confirmed: true,
      optionId: vote.options[0]?.id,
    });
    expect(submit.status()).toBe(404);
    expect(
      (await api.get(`/api/votes/${vote.id}/participation`)).status(),
    ).toBe(404);
    // An unknown id is indistinguishable from a real one the caller cannot see.
    const unknown = await post(
      api,
      "/api/votes/00000000-0000-4000-8000-000000000099/submission",
      { confirmed: true, optionId: vote.options[0]?.id },
    );
    expect(unknown.status()).toBe(404);

    const get = await api.get(path);
    expect(get.status()).toBe(405);
    expect(get.headers()["allow"]).toBe("POST");
    const wrong = await post(api, `/api/votes/${vote.id}/participation`, {});
    expect(wrong.status()).toBe(405);
    // A malformed id is indistinguishable from an unknown one.
    expect(
      (await api.get("/api/votes/not-a-uuid/participation")).status(),
    ).toBe(404);
    await api.dispose();
  });

  test("refuses a late submission with 409 and completes the vote at its deadline", async () => {
    const member = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(
      adminUser.id,
      [member.householdId],
      "OPEN",
      5_000,
    );
    const api = await signedIn(member.email);
    await new Promise((resolve) => setTimeout(resolve, 6_000));

    const late = await post(api, `/api/votes/${vote.id}/submission`, {
      confirmed: true,
      optionId: vote.options[0]?.id,
    });
    expect(late.status()).toBe(409);
    expect(await late.text()).toContain("VOTING_CLOSED");

    const status = await api.get(`/api/votes/${vote.id}/participation`);
    expect(((await status.json()) as { data: unknown }).data).toEqual({
      voteId: vote.id,
      status: "COMPLETED",
      submitted: false,
    });
    await api.dispose();
  });

  test("rejects an oversized body before doing any work", async () => {
    const member = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [member.householdId]);
    const api = await signedIn(member.email);
    const huge = await post(api, `/api/votes/${vote.id}/submission`, {
      confirmed: true,
      optionId: vote.options[0]?.id,
      padding: "x".repeat(40_000),
    });
    expect(huge.status()).toBe(413);
    await api.dispose();
  });
});
