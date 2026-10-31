// Real HTTP checks for per-tenant Origin and session-cookie isolation, run
// against a local server (Host overrides) or, with TENANT_HTTP_REMOTE=1,
// against the hosted tenant hosts over HTTPS with production cookie names.
import { randomBytes } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { createCsrfContext, csrfCookieName } from "../../src/server/http/csrf";
import {
  isTenantSessionCookie,
  sessionCookieName,
} from "../../src/server/auth/session-cookies";
import {
  cookieName,
  cookieValue,
  endpoint,
  hostHeader,
  mutationHeaders,
  provisionAdmin,
  remote,
  requiredSetting as required,
  tenantHttpProjects,
  updatedCookies,
  verifyThroughHttp,
} from "./support/tenant-http";

test.describe("tenant host HTTP isolation", () => {
  test.skip(
    process.env.TENANT_HTTP_TEST !== "1",
    "Set up the two approved disposable projects and TENANT_HTTP_TEST=1.",
  );

  test("binds Origin, OTP sessions and sign-out to each tenant host", async ({
    request,
  }) => {
    const [projectA, projectB] = tenantHttpProjects();
    const [emailLocal, emailDomain] = required("LIVE_TEST_EMAIL")
      .toLowerCase()
      .split("@");
    const email = `${emailLocal}+cp-host-${randomBytes(4).toString("hex")}@${emailDomain}`;
    const accountA = await provisionAdmin(
      projectA,
      email,
      "Tenant A HTTP Tester",
    );
    const accountB = await provisionAdmin(
      projectB,
      email,
      "Tenant B HTTP Tester",
    );

    const signedInA = await verifyThroughHttp(request, projectA, accountA);
    const signedInB = await verifyThroughHttp(request, projectB, accountB);
    const cookieNameA = sessionCookieName(projectA.tenantId, remote);
    const cookieNameB = sessionCookieName(projectB.tenantId, remote);
    const namesA = signedInA.cookies.map(cookieName);
    const namesB = signedInB.cookies.map(cookieName);

    expect(
      namesA.some((name) => isTenantSessionCookie(name, cookieNameA)),
    ).toBe(true);
    expect(
      namesA.some((name) => isTenantSessionCookie(name, cookieNameB)),
    ).toBe(false);
    expect(
      namesB.some((name) => isTenantSessionCookie(name, cookieNameB)),
    ).toBe(true);
    expect(
      namesB.some((name) => isTenantSessionCookie(name, cookieNameA)),
    ).toBe(false);

    const [aOnA, bOnB, aOnB, bOnA] = await Promise.all([
      listAccounts(request, projectA.host, signedInA.cookies),
      listAccounts(request, projectB.host, signedInB.cookies),
      listAccounts(request, projectB.host, signedInA.cookies),
      listAccounts(request, projectA.host, signedInB.cookies),
    ]);
    expect(aOnA.status()).toBe(200);
    expect(bOnB.status()).toBe(200);
    expect(aOnB.status()).toBe(401);
    expect(bOnA.status()).toBe(401);

    const csrfA = cookieValue(signedInA.cookies, csrfCookieName(remote));
    const wrongOrigin = await request.post(
      endpoint(projectB.host, "/api/auth/sign-out"),
      {
        data: {},
        headers: mutationHeaders(
          projectB.host,
          `https://${projectA.host}`,
          signedInA.cookies,
          csrfA,
        ),
      },
    );
    expect(wrongOrigin.status()).toBe(403);
    expect(await wrongOrigin.json()).toMatchObject({
      error: { code: "CSRF_FAILED" },
    });

    // Forwarded headers must not move a request to another tenant's origin.
    const spoofedForwarding = await request.post(
      endpoint(projectA.host, "/api/auth/sign-out"),
      {
        data: {},
        headers: {
          ...mutationHeaders(
            projectA.host,
            `https://${projectB.host}`,
            signedInA.cookies,
            csrfA,
          ),
          "x-forwarded-host": projectB.host,
          "x-forwarded-proto": "https",
        },
      },
    );
    expect(spoofedForwarding.status()).toBe(403);

    const unknown = remote
      ? required("TENANT_HTTP_UNKNOWN_HOST")
      : "unknown.example.test";
    const unknownHost = await request.post(
      endpoint(unknown, "/api/auth/sign-out"),
      {
        data: {},
        headers: mutationHeaders(
          unknown,
          `https://${unknown}`,
          [],
          createCsrfContext(),
        ),
      },
    );
    expect(unknownHost.status()).toBe(404);

    const signOutA = await request.post(
      endpoint(projectA.host, "/api/auth/sign-out"),
      {
        data: {},
        headers: mutationHeaders(
          projectA.host,
          `https://${projectA.host}`,
          signedInA.cookies,
          csrfA,
        ),
      },
    );
    expect(signOutA.status()).toBe(204);
    const afterSignOutA = updatedCookies(signedInA.cookies, signOutA);
    expect(
      (await listAccounts(request, projectA.host, afterSignOutA)).status(),
    ).toBe(401);
    expect(
      (await listAccounts(request, projectB.host, signedInB.cookies)).status(),
    ).toBe(200);
  });
});

async function listAccounts(
  request: APIRequestContext,
  host: string,
  cookies: string[],
): Promise<APIResponse> {
  return request.get(endpoint(host, "/api/admin/accounts"), {
    headers: { ...hostHeader(host), cookie: cookies.join("; ") },
  });
}
