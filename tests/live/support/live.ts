import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { operationalDatabaseClient } from "../../../scripts/ops/database";

const env = process.env;

export const hasLive = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL &&
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  env.SUPABASE_SERVICE_ROLE_KEY &&
  env.LIVE_TEST_EMAIL,
);
export const hasSql = Boolean(env.LIVE_DATABASE_URL);
export const hasTenantTestSettings = Boolean(
  env.TENANT_TEST_SUPABASE_URL ||
  env.TENANT_TEST_SUPABASE_PUBLISHABLE_KEY ||
  env.TENANT_TEST_SUPABASE_SERVICE_ROLE_KEY ||
  env.TENANT_TEST_DATABASE_URL,
);

// In-memory sessions only: nothing is persisted and no refresh timers run.
const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

export const adminClient = (): SupabaseClient =>
  createClient(
    env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    clientOptions,
  );

export const publicClient = (): SupabaseClient =>
  createClient(
    env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    clientOptions,
  );

export const tenantTestAdminClient = (): SupabaseClient =>
  createClient(
    env.TENANT_TEST_SUPABASE_URL ?? "",
    env.TENANT_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "",
    clientOptions,
  );

export const tenantTestPublicClient = (): SupabaseClient =>
  createClient(
    env.TENANT_TEST_SUPABASE_URL ?? "",
    env.TENANT_TEST_SUPABASE_PUBLISHABLE_KEY ?? "",
    clientOptions,
  );

// Hosted Auth rejects made-up domains, so plus-address the tester's real mailbox.
export function liveEmail(): string {
  const [local, domain] = (env.LIVE_TEST_EMAIL ?? "").toLowerCase().split("@");
  return `${local}+cp${randomBytes(4).toString("hex")}@${domain}`;
}

// generateLink returns the same six-digit code an email would carry, without sending mail.
export async function emailOtp(
  admin: SupabaseClient,
  email: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const code = data?.properties?.email_otp;
  if (error || !code) {
    throw new Error(
      `Could not obtain a one-time code (${error?.message ?? "no code returned"}).`,
    );
  }
  return code;
}

export async function withSql<T>(
  fn: (client: Client) => Promise<T>,
  connectionString = env.LIVE_DATABASE_URL ?? "",
): Promise<T> {
  const client = operationalDatabaseClient(connectionString);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
