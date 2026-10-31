// RWA-controlled App Support Access: enables or suspends the configured read-only support observer.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { z } from "zod";
import { getEnvironment } from "@/server/config/environment";
import {
  getRequestTenantContext,
  type TenantContext,
} from "@/server/config/tenant-context";
import { createUserClient } from "@/server/db/clients";
import { ApiError } from "@/server/http/errors";
import { log } from "@/server/observability/logger";
import { setAuthBan } from "@/server/register/accounts";
import { ensureAuthIdentity } from "@/server/register/provisioning";
import {
  assertCurrentAdmin,
  assertOk,
  callRoutine,
  type RegisterDeps,
} from "@/server/register/shared";
import type {
  AppSupportAccessInput,
  AppSupportStatus,
} from "@/shared/contracts/app-support";
import { uuid } from "@/shared/validation/primitives";

/*
 * The support identity always comes from server-only APP_SUPPORT_EMAIL, never
 * from the request, so an administrator can grant access only to the app
 * developer this deployment names. The database decides the rest: the profile
 * is rwa-readonly, never has a household or vote, and only
 * set_app_support_access may change it (audited). Auth and the database are
 * separate systems, so the order fails safe like account status changes:
 * Auth sign-in is allowed before the profile is enabled, and the profile is
 * suspended before Auth sign-in is blocked.
 */
const toggleResultSchema = z.object({ revokedProfileIds: z.array(uuid) });

async function supportEnabled(client: SupabaseClient): Promise<boolean> {
  const { data, error, status } = await client
    .from("profiles")
    .select("id")
    .eq("is_app_support", true)
    .eq("status", "ENABLED")
    .limit(1)
    .returns<{ id: string }[]>();
  assertOk(error, status);
  return (data ?? []).length > 0;
}

export async function getAppSupportStatus(
  deps: Pick<RegisterDeps, "client">,
): Promise<AppSupportStatus> {
  const email = getEnvironment().APP_SUPPORT_EMAIL ?? null;
  return {
    configured: email !== null,
    email,
    enabled: await supportEnabled(deps.client),
  };
}

/** One read per request for the management banner; an outage hides the banner, never the page. */
export const loadAppSupportActive = cache(
  async (tenant?: TenantContext): Promise<boolean> => {
    try {
      const resolvedTenant = tenant ?? (await getRequestTenantContext());
      return await supportEnabled(await createUserClient(resolvedTenant));
    } catch {
      log("warn", "app_support.status_unavailable", {});
      return false;
    }
  },
);

export async function setAppSupportAccess(
  deps: RegisterDeps,
  input: AppSupportAccessInput,
): Promise<AppSupportStatus> {
  await assertCurrentAdmin(deps);

  let supportId: string | null = null;
  if (input.enabled) {
    const email = getEnvironment().APP_SUPPORT_EMAIL;
    if (!email) {
      throw new ApiError("VALIDATION_FAILED", {
        context: { reason: "APP_SUPPORT_NOT_CONFIGURED" },
      });
    }
    supportId = (await ensureAuthIdentity(deps.admin, email)).id;

    // An identity that already belongs to an RWA account is refused before its Auth ban changes.
    const { data, error, status } = await deps.client
      .from("profiles")
      .select("is_app_support")
      .eq("id", supportId)
      .maybeSingle<{ is_app_support: boolean }>();
    assertOk(error, status);
    if (data && !data.is_app_support) {
      throw new ApiError("REGISTER_CONFLICT", {
        context: { reason: "APP_SUPPORT_EMAIL_IN_USE" },
      });
    }
    // Widening: allow Auth sign-in first; the profile grants nothing until enabled below.
    await setAuthBan(deps, supportId, false, false);
  }

  const parsed = toggleResultSchema.safeParse(
    await callRoutine<unknown>(deps.admin, "set_app_support_access", {
      p_auth_user_id: supportId,
      p_enabled: input.enabled,
      p_actor_profile_id: deps.actor.id,
    }),
  );
  if (!parsed.success) {
    throw new ApiError("INTERNAL_ERROR");
  }
  // Narrowing: these profiles are already suspended; block new Auth sign-ins too (retry-safe).
  for (const id of parsed.data.revokedProfileIds) {
    await setAuthBan(deps, id, true, true);
  }
  return getAppSupportStatus(deps);
}
