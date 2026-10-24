import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { createCsrfContext, csrfTokenFor } from "../../src/server/http/csrf";

/*
 * Real sign-in through the running app against YOUR disposable hosted Supabase
 * project (values from .env.local). Skipped unless LIVE_AUTH=1, so the normal
 * e2e run never depends on a hosted project.
 */
test.skip(
  process.env.LIVE_AUTH !== "1",
  "Set LIVE_AUTH=1 and fill .env.local to run against the hosted project.",
);

const ORIGIN = "http://127.0.0.1:3100";
const CSRF_COOKIE = "cp_csrf";

function setCookies(response: {
  headersArray(): { name: string; value: string }[];
}): string[] {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value);
}

function cookieValue(cookies: string[], name: string): string | undefined {
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match?.split(";")[0]?.slice(name.length + 1);
}

async function provisionAdmin(): Promise<{ email: string; code: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [local, domain] = (process.env.LIVE_TEST_EMAIL ?? "")
    .toLowerCase()
    .split("@");
  const email = `${local}+cp${randomBytes(4).toString("hex")}@${domain}`;

  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  const id = created.data.user?.id;
  expect(id, created.error?.message).toBeTruthy();

  const provisioned = await admin.rpc("provision_profile", {
    p_auth_user_id: id,
    p_representative_name: "Cookie Tester",
    p_is_admin: true,
    p_actor_profile_id: null,
  });
  expect(provisioned.error).toBeNull();
  const enabled = await admin.rpc("enable_profile", {
    p_profile_id: id,
    p_actor_profile_id: null,
  });
  expect(enabled.error).toBeNull();

  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const code = link.data?.properties?.email_otp;
  expect(code, link.error?.message).toMatch(/^\d{6}$/u);
  return { email, code: code ?? "" };
}

test("sign-in sets HttpOnly SDK cookies, rotates the CSRF context, and sign-out clears them", async () => {
  const { email, code } = await provisionAdmin();
  const firstContext = createCsrfContext();

  const api = await playwrightRequest.newContext({
    baseURL: ORIGIN,
    storageState: {
      cookies: [
        {
          name: CSRF_COOKIE,
          value: firstContext,
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

  const verify = await api.post("/api/auth/verify", {
    headers: { origin: ORIGIN, "x-csrf-token": csrfTokenFor(firstContext) },
    data: { email, code },
  });
  expect(verify.status(), await verify.text()).toBe(200);
  const verifyBody = (await verify.json()) as {
    data: { account: Record<string, unknown> };
  };
  expect(verifyBody.data.account).toMatchObject({
    representativeName: "Cookie Tester",
    isAdmin: true,
  });

  // No raw tokens in the JSON response.
  const text = JSON.stringify(verifyBody);
  expect(text).not.toMatch(/access_token|refresh_token|eyJ/u);

  // Actual cookie behaviour: SDK session cookies are HttpOnly, SameSite=Lax, path /.
  const cookies = setCookies(verify);
  const sessionCookies = cookies.filter((cookie) =>
    /^sb-[^=]*-auth-token/u.test(cookie),
  );
  expect(sessionCookies.length).toBeGreaterThan(0);
  for (const cookie of sessionCookies) {
    expect(cookie).toMatch(/;\s*HttpOnly/iu);
    expect(cookie).toMatch(/;\s*SameSite=Lax/iu);
    expect(cookie).toMatch(/;\s*Path=\//iu);
  }

  // The pre-authentication CSRF context is replaced.
  const secondContext = cookieValue(cookies, CSRF_COOKIE);
  expect(secondContext).toBeTruthy();
  expect(secondContext).not.toBe(firstContext);
  const csrfCookie =
    cookies.find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`)) ?? "";
  expect(csrfCookie).toMatch(/;\s*HttpOnly/iu);
  expect(csrfCookie).toMatch(/;\s*SameSite=Strict/iu);

  // The old token no longer works.
  const stale = await api.post("/api/auth/sign-out", {
    headers: { origin: ORIGIN, "x-csrf-token": csrfTokenFor(firstContext) },
    data: {},
  });
  expect(stale.status()).toBe(403);

  // Sign-out with the new context succeeds, clears SDK cookies and rotates again.
  const signOut = await api.post("/api/auth/sign-out", {
    headers: {
      origin: ORIGIN,
      "x-csrf-token": csrfTokenFor(secondContext ?? ""),
    },
    data: {},
  });
  expect(signOut.status()).toBe(204);
  const clearing = setCookies(signOut).filter((cookie) =>
    /^sb-[^=]*-auth-token/u.test(cookie),
  );
  expect(clearing.length).toBeGreaterThan(0);
  for (const cookie of clearing) {
    expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/iu);
  }
  const thirdContext = cookieValue(setCookies(signOut), CSRF_COOKIE);
  expect(thirdContext).toBeTruthy();
  expect(thirdContext).not.toBe(secondContext);

  // With no session left, signing out again is still a clean success.
  const again = await api.post("/api/auth/sign-out", {
    headers: {
      origin: ORIGIN,
      "x-csrf-token": csrfTokenFor(thirdContext ?? ""),
    },
    data: {},
  });
  expect(again.status()).toBe(204);

  await api.dispose();
});

test("an invalid code is a uniform 422 and sets no session", async () => {
  const context = createCsrfContext();
  const api = await playwrightRequest.newContext({
    baseURL: ORIGIN,
    storageState: {
      cookies: [
        {
          name: CSRF_COOKIE,
          value: context,
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

  const response = await api.post("/api/auth/verify", {
    headers: { origin: ORIGIN, "x-csrf-token": csrfTokenFor(context) },
    data: { email: "nobody@example.com", code: "000000" },
  });

  expect(response.status()).toBe(422);
  expect(await response.json()).toMatchObject({
    error: { code: "CODE_INVALID_OR_EXPIRED" },
  });
  expect(
    setCookies(response).filter((cookie) => cookie.startsWith("sb-")),
  ).toEqual([]);
  await api.dispose();
});

test("code requests get the generic acknowledgement for unknown addresses", async () => {
  const context = createCsrfContext();
  const api = await playwrightRequest.newContext({
    baseURL: ORIGIN,
    storageState: {
      cookies: [
        {
          name: CSRF_COOKIE,
          value: context,
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

  const response = await api.post("/api/auth/code", {
    headers: { origin: ORIGIN, "x-csrf-token": csrfTokenFor(context) },
    data: { email: `nobody+${randomBytes(4).toString("hex")}@example.com` },
  });

  expect(response.status()).toBe(202);
  expect(await response.json()).toMatchObject({
    data: { resendAfterSeconds: 60 },
  });
  await api.dispose();
});
