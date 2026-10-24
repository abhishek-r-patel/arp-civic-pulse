import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect } from "@playwright/test";

/*
 * Helpers for the LIVE_AUTH browser specs. They talk to YOUR disposable hosted
 * Supabase project through the service-role key from .env.local, and obtain
 * one-time codes through the Auth admin API instead of an inbox.
 */
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function plusEmail(): string {
  const [local, domain] = (process.env.LIVE_TEST_EMAIL ?? "")
    .toLowerCase()
    .split("@");
  return `${local}+cp${randomBytes(4).toString("hex")}@${domain}`;
}

export async function freshCode(email: string): Promise<string> {
  const link = await admin().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const code = link.data?.properties?.email_otp;
  expect(code, link.error?.message).toMatch(/^\d{6}$/u);
  return code ?? "";
}

export async function provisionAdmin(
  name = "Browser Admin",
): Promise<{ id: string; email: string; code: string }> {
  const client = admin();
  const email = plusEmail();

  const created = await client.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  const id = created.data.user?.id;
  expect(id, created.error?.message).toBeTruthy();

  const provisioned = await client.rpc("provision_profile", {
    p_auth_user_id: id,
    p_representative_name: name,
    p_is_admin: true,
    p_actor_profile_id: null,
  });
  expect(provisioned.error).toBeNull();
  const enabled = await client.rpc("enable_profile", {
    p_profile_id: id,
    p_actor_profile_id: null,
  });
  expect(enabled.error).toBeNull();

  return { id: id ?? "", email, code: await freshCode(email) };
}
