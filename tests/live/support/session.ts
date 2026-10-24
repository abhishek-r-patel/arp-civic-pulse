import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyCode } from "@/server/auth/otp";
import { ApiError } from "@/server/http/errors";
import {
  enableAccount,
  provisionAccount,
} from "@/server/register/provisioning";
import { emailOtp, liveEmail, publicClient, withSql } from "./live";

export async function apiError(action: Promise<unknown>): Promise<ApiError> {
  try {
    await action;
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an ApiError.");
}

export async function authUserExists(
  admin: SupabaseClient,
  email: string,
): Promise<boolean> {
  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) {
      throw new Error(error.message);
    }
    if (data.users.some((user) => user.email?.toLowerCase() === email)) {
      return true;
    }
    if (data.users.length < 200) {
      return false;
    }
  }
  return false;
}

export interface SignedIn {
  id: string;
  email: string;
  name: string;
  client: SupabaseClient;
}

// Provisions (as admin or resident), enables, and signs in through the real verifyCode.
export async function signIn(
  admin: SupabaseClient,
  options: { isAdmin: boolean; household?: boolean } = { isAdmin: true },
): Promise<SignedIn> {
  const email = liveEmail();
  const name = "Live Tester";
  const provisioned = await provisionAccount(admin, {
    email,
    representativeName: name,
    isAdmin: options.isAdmin,
    actorProfileId: null,
  });
  if (options.household) {
    await withSql((sql) =>
      sql.query(
        `insert into public.households (identifier, identifier_normalized, representative_profile_id, is_eligible)
         values ($1, app_private.normalize_key($1), $2, true)`,
        [`L-${provisioned.accountId.slice(0, 8)}`, provisioned.accountId],
      ),
    );
  }
  await enableAccount(admin, provisioned.accountId, null);

  const client = publicClient();
  await verifyCode({ client, admin }, email, await emailOtp(admin, email));
  return { id: provisioned.accountId, email, name, client };
}
