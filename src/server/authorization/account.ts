import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { connection } from "next/server";
import { createUserClient } from "@/server/db/clients";
import { toApiError } from "@/server/db/errors";
import { ApiError } from "@/server/http/errors";
import { log } from "@/server/observability/logger";

export interface Account {
  id: string;
  representativeName: string;
  isAdmin: boolean;
}

interface ProfileRow {
  id: string;
  representative_name: string;
  is_admin: boolean;
}

/*
 * Identity is verified with the Auth server (getUser), never taken from the
 * unverified session in the cookie. Returns null when there is no valid
 * session; an Auth outage is an error, not "signed out".
 */
export async function getVerifiedUserId(
  client: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await client.auth.getUser();

  if (data.user) {
    return data.user.id;
  }
  if (!error) {
    return null;
  }
  const status = (error as { status?: number }).status;
  if (
    error.name === "AuthSessionMissingError" ||
    status === 401 ||
    status === 403
  ) {
    return null;
  }
  throw new ApiError("AUTH_UNAVAILABLE");
}

/*
 * The current application account, from the caller's own session. RLS returns
 * the profile only while it is ENABLED, so a suspended or deleted profile (or
 * an Auth identity without a profile) yields null even with a valid JWT.
 */
export async function loadEnabledAccount(
  client: SupabaseClient,
  userId: string,
): Promise<Account | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id, representative_name, is_admin")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();

  if (error) {
    throw toApiError({
      ...error,
      status: error.code === "PGRST301" ? 401 : undefined,
    });
  }
  if (!data) {
    return null;
  }
  return {
    id: data.id,
    representativeName: data.representative_name,
    isAdmin: data.is_admin,
  };
}

/** 401 without a verified session; 403 without a current enabled profile. */
export async function requireAccount(
  client?: SupabaseClient,
): Promise<{ account: Account; client: SupabaseClient }> {
  const supabase = client ?? (await createUserClient());
  const userId = await getVerifiedUserId(supabase);
  if (!userId) {
    throw new ApiError("AUTH_REQUIRED");
  }

  const account = await loadEnabledAccount(supabase, userId);
  if (!account) {
    throw new ApiError("FORBIDDEN");
  }
  return { account, client: supabase };
}

/** Current role is read from the profile on every call, never from token claims. */
export async function requireAdmin(
  client?: SupabaseClient,
): Promise<{ account: Account; client: SupabaseClient }> {
  const context = await requireAccount(client);
  if (!context.account.isAdmin) {
    throw new ApiError("FORBIDDEN");
  }
  return context;
}

export type SessionState =
  | { state: "anonymous" }
  // A valid Auth session without a current enabled application profile.
  | { state: "blocked" }
  | { state: "account"; account: Account };

/*
 * For pages and the shell: one verification per request. A configuration or
 * Auth outage reads as "anonymous" so error and not-found pages still render;
 * protected data is never shown in that case.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  // Per-request data: opt out of prerendering BEFORE the try block, so the
  // framework's dynamic-rendering signal is never swallowed below.
  await connection();
  try {
    const { account } = await requireAccount();
    return { state: "account", account };
  } catch (error) {
    if (error instanceof ApiError && error.code === "FORBIDDEN") {
      return { state: "blocked" };
    }
    if (!(error instanceof ApiError && error.code === "AUTH_REQUIRED")) {
      log("warn", "session.unavailable", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return { state: "anonymous" };
  }
});
