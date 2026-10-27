// Explicit administrator mutations and committee read-only dependencies for register services.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTH_RATE_LIMITS, enforceRateLimit } from "@/server/auth/rate-limit";
import {
  loadEnabledAccount,
  requireAdmin,
  requireCommittee,
  type Account,
} from "@/server/authorization/account";
import { createAdminClient } from "@/server/db/clients";
import { toApiError } from "@/server/db/errors";
import { ApiError } from "@/server/http/errors";
import type { AccountStatus } from "@/shared/contracts/register";

export interface RegisterDeps {
  /** The administrator's own session: reads follow RLS, routines re-check the caller. */
  client: SupabaseClient;
  /** Server-only privileged client: Auth administration and the limiter only. */
  admin: SupabaseClient;
  actor: Account;
}

/** Verifies the caller is a current enabled administrator, then builds the dependencies. */
export async function registerDeps(): Promise<RegisterDeps> {
  const { account, client } = await requireAdmin();
  return { client, admin: createAdminClient(), actor: account };
}

/** Read-only management access; callers must retain admin guards for mutations. */
export async function committeeReadDeps(): Promise<RegisterDeps> {
  const { account, client } = await requireCommittee();
  return { client, admin: createAdminClient(), actor: account };
}

export async function enforceMutationLimit(deps: RegisterDeps): Promise<void> {
  await enforceRateLimit(
    deps.admin,
    AUTH_RATE_LIMITS.adminMutationByProfile,
    "profile",
    deps.actor.id,
    "DEPENDENCY_UNAVAILABLE",
  );
}

/** Re-checks current administrator capability before an Auth-only stage. */
export async function assertCurrentAdmin(deps: RegisterDeps): Promise<void> {
  const current = await loadEnabledAccount(deps.client, deps.actor.id);
  if (!current?.isAdmin) {
    throw new ApiError("FORBIDDEN");
  }
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export interface AuthIdentity {
  email: string | null;
  emailVerifiedAt: string | null;
}

/*
 * Email and verification state come from Auth for the authorized page only.
 * An Auth outage is an error, never an empty email presented as success.
 */
export async function loadAuthIdentities(
  admin: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, AuthIdentity>> {
  const identities = await mapLimit(ids, 8, async (id) => {
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (error) {
      if ((error as { status?: number }).status === 404) {
        return [id, { email: null, emailVerifiedAt: null }] as const;
      }
      throw new ApiError("DEPENDENCY_UNAVAILABLE");
    }
    return [
      id,
      {
        email: data.user.email?.toLowerCase() ?? null,
        emailVerifiedAt: data.user.email_confirmed_at ?? null,
      },
    ] as const;
  });
  return new Map(identities);
}

interface PostgrestFailure {
  code?: string;
  message?: string;
  details?: string | null;
}

/** Throws the mapped ApiError for a failed Data API response. */
export function assertOk(
  error: PostgrestFailure | null,
  status?: number,
): void {
  if (error) {
    throw toApiError({ ...error, status });
  }
}

export async function callRoutine<T>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error, status } = await client.rpc(name, args);
  assertOk(error, status);
  if (data === null || data === undefined) {
    throw new ApiError("INTERNAL_ERROR");
  }
  return data as T;
}

export function accountStatus(value: string): AccountStatus {
  if (value === "ENABLED" || value === "SUSPENDED" || value === "DELETED") {
    return value;
  }
  throw new ApiError("INTERNAL_ERROR");
}

// PostgREST filter values containing separators must be double-quoted.
export function postgrestQuote(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}
