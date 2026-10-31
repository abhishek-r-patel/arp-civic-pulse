// S03 cross-surface tenant isolation over real HTTP: interleaved requests to two
// tenant hosts must keep data, branding, exports, rate limits and error IDs apart.
import { randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createCsrfContext } from "../../src/server/http/csrf";
import { isErrorId } from "../../src/shared/observability/error-id";
import { operationalDatabaseClient } from "../../scripts/ops/database";
import { asUser, ensureFixturePolicy } from "./support/live";
import {
  endpoint,
  hostHeader,
  mutationHeaders,
  provisionAdmin,
  requiredSetting,
  tenantHttpProjects,
  verifyThroughHttp,
  type TenantHttpProject,
} from "./support/tenant-http";

interface SeededTenant {
  project: TenantHttpProject;
  rwaName: string;
  voteId: string;
  voteTitle: string;
  cookies: string[];
}

test.describe("tenant cross-surface isolation", () => {
  test.skip(
    process.env.TENANT_HTTP_TEST !== "1",
    "Set up the two approved disposable projects and TENANT_HTTP_TEST=1.",
  );
  test.setTimeout(240_000);

  test("keeps data, branding, exports, rate limits and error IDs per tenant", async ({
    request,
  }) => {
    const [projectA, projectB] = tenantHttpProjects();
    const run = randomBytes(3).toString("hex");
    const [emailLocal, emailDomain] = requiredSetting("LIVE_TEST_EMAIL")
      .toLowerCase()
      .split("@");
    const email = `${emailLocal}+cp-iso-${run}@${emailDomain}`;

    // Same email in both projects: two independent memberships, never one.
    const [a, b] = await Promise.all([
      seedTenant(request, projectA, email, run, "Tenant A Synthetic RWA"),
      seedTenant(request, projectB, email, run, "Tenant B Synthetic RWA"),
    ]);
    expect(a.rwaName).not.toBe(b.rwaName);

    // Several interleaved rounds so concurrent requests share warm instances.
    for (let round = 0; round < 3; round += 1) {
      const checks = [a, b].flatMap((own) => {
        const other = own === a ? b : a;
        return [
          checkPublicBranding(request, own, other),
          checkVoteList(request, own, other),
          checkOwnExport(request, own, other),
          checkForeignVoteHidden(request, own, other),
        ];
      });
      await Promise.all(checks);
    }

    // Exhaust the verify budget for one unknown address on host A only.
    const probe = `${emailLocal}+cp-rl-${run}@${emailDomain}`;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push((await wrongCode(request, a.project, probe)).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 422)).toBe(true);
    expect(statuses[10]).toBe(429);
    const onB = await wrongCode(request, b.project, probe);
    expect(onB.status).toBe(422);
    const againOnA = await wrongCode(request, a.project, probe);
    expect(againOnA.status).toBe(429);

    // Error IDs name the area and are unique per request on either host.
    const ids = [onB.requestId, againOnA.requestId];
    for (const id of ids) {
      expect(isErrorId(id)).toBe(true);
      expect(id.startsWith("AUTH-")).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

async function seedTenant(
  request: APIRequestContext,
  project: TenantHttpProject,
  email: string,
  run: string,
  defaultName: string,
): Promise<SeededTenant> {
  if (!project.databaseUrl) {
    throw new Error(
      `Missing tenant HTTP test setting: TENANT_HTTP_PROJECT_${project.label}_DATABASE_URL.`,
    );
  }
  const account = await provisionAdmin(
    project,
    email,
    `Tenant ${project.label} Isolation Admin`,
  );
  await ensureFixturePolicy(account.id, project.databaseUrl, defaultName);

  const sql = operationalDatabaseClient(project.databaseUrl);
  await sql.connect();
  let householdId = "";
  let rwaName = "";
  try {
    const identifier = `ISO-${project.label}-${run}`;
    const inserted = await sql.query<{ id: string }>(
      `insert into public.households (identifier, identifier_normalized, representative_profile_id, is_eligible)
       values ($1, app_private.normalize_key($1), $2, true) returning id`,
      [identifier, account.id],
    );
    householdId = inserted.rows[0]?.id ?? "";
    const settings = await sql.query<{ name: string }>(
      "select name from public.rwa_settings where id = 1",
    );
    rwaName = settings.rows[0]?.name ?? "";
  } finally {
    await sql.end();
  }
  expect(householdId).not.toBe("");
  expect(rwaName).not.toBe("");

  const voteTitle = `Isolation ${project.label} ${run}`;
  const draft = await asUser<{ id: string }>(
    account.id,
    "public.create_draft($1)",
    ["PUBLIC"],
    project.databaseUrl,
  );
  await asUser(
    account.id,
    "public.update_draft($1, 1, $2::jsonb)",
    [
      draft.id,
      JSON.stringify({
        title: voteTitle,
        closesAt: new Date(Date.now() + 3_600_000).toISOString(),
        options: [
          { label: "Yes", position: 1 },
          { label: "No", position: 2 },
        ],
        eligibleHouseholdIds: [householdId],
      }),
    ],
    project.databaseUrl,
  );
  await asUser(
    account.id,
    "public.activate_vote($1, 2, true)",
    [draft.id],
    project.databaseUrl,
  );
  await asUser(
    account.id,
    "public.complete_vote_early($1, true, $2)",
    [draft.id, "Synthetic tenant isolation check"],
    project.databaseUrl,
  );

  const signedIn = await verifyThroughHttp(request, project, account);
  return {
    project,
    rwaName,
    voteId: draft.id,
    voteTitle,
    cookies: signedIn.cookies,
  };
}

function get(
  request: APIRequestContext,
  tenant: SeededTenant,
  path: string,
  signedIn = true,
) {
  return request.get(endpoint(tenant.project.host, path), {
    headers: {
      ...hostHeader(tenant.project.host),
      ...(signedIn ? { cookie: tenant.cookies.join("; ") } : {}),
    },
  });
}

async function checkPublicBranding(
  request: APIRequestContext,
  own: SeededTenant,
  other: SeededTenant,
): Promise<void> {
  const response = await get(request, own, "/sign-in", false);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain(own.rwaName);
  expect(html).not.toContain(other.rwaName);
  expect(html).not.toContain(other.project.ref);
  expect(html).not.toContain(own.project.serviceRoleKey);
}

async function checkVoteList(
  request: APIRequestContext,
  own: SeededTenant,
  other: SeededTenant,
): Promise<void> {
  const response = await get(
    request,
    own,
    "/api/admin/votes?status=COMPLETED&limit=100",
  );
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).not.toContain(other.voteId);
  expect(body).not.toContain(other.voteTitle);
  expect(isErrorId(response.headers()["x-request-id"] ?? "")).toBe(true);

  const detail = await get(request, own, `/api/votes/${own.voteId}`);
  expect(detail.status()).toBe(200);
  expect(await detail.text()).toContain(own.voteTitle);
}

async function checkOwnExport(
  request: APIRequestContext,
  own: SeededTenant,
  other: SeededTenant,
): Promise<void> {
  const response = await get(
    request,
    own,
    `/api/votes/${own.voteId}/exports/csv`,
  );
  expect(response.status()).toBe(200);
  const csv = await response.text();
  expect(csv).toContain(own.voteTitle);
  expect(csv).toContain(own.rwaName);
  expect(csv).not.toContain(other.voteTitle);
  expect(csv).not.toContain(other.rwaName);
}

async function checkForeignVoteHidden(
  request: APIRequestContext,
  own: SeededTenant,
  other: SeededTenant,
): Promise<void> {
  const [detail, exported] = await Promise.all([
    get(request, own, `/api/votes/${other.voteId}`),
    get(request, own, `/api/votes/${other.voteId}/exports/csv`),
  ]);
  expect(detail.status()).toBe(404);
  expect(exported.status()).toBe(404);
  expect(await exported.text()).not.toContain(other.voteTitle);
}

async function wrongCode(
  request: APIRequestContext,
  project: TenantHttpProject,
  email: string,
): Promise<{ status: number; requestId: string }> {
  const context = createCsrfContext();
  const response = await request.post(
    endpoint(project.host, "/api/auth/verify"),
    {
      data: { email, code: "000000" },
      headers: mutationHeaders(
        project.host,
        `https://${project.host}`,
        [],
        context,
      ),
    },
  );
  const body = (await response.json()) as { requestId?: string };
  return { status: response.status(), requestId: body.requestId ?? "" };
}
