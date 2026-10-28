// Retry-safe Auth identity provisioning coordinated with guarded profile routines.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { toApiError } from "@/server/db/errors";
import { ApiError } from "@/server/http/errors";
import { log } from "@/server/observability/logger";
import { emailAddress, nameText, uuid } from "@/shared/validation/primitives";

/*
 * Retry-safe provisioning coordinator (docs/DATABASE.md section 9). Supabase
 * Auth and the application database are separate systems, so this is NOT one
 * transaction:
 *   1. create or identify the Auth identity (Auth admin API), then
 *   2. create or re-validate the profile and audit it in ONE database
 *      transaction (public.provision_profile).
 * A failure after step 1 leaves a recoverable, visible partial state
 * (PROVISIONING_INCOMPLETE); the Auth identity is never deleted as a blind
 * rollback and the profile stays SUSPENDED, so it grants no access. Repeating
 * the call finishes the job without creating duplicates.
 */
const inputSchema = z.strictObject({
  email: emailAddress,
  representativeName: nameText,
  isAdmin: z.boolean(),
  isReadonly: z.boolean().optional(),
  actorProfileId: uuid.nullable(),
});

export type ProvisionInput = z.input<typeof inputSchema>;

export interface ProvisionResult {
  accountId: string;
  authIdentity: "created" | "existing";
  profile: "created" | "existing";
}

const MAX_LOOKUP_PAGES = 25;
const LOOKUP_PAGE_SIZE = 200;

function incomplete(
  stage: "AUTH" | "PROFILE",
  authIdentity?: "created" | "existing",
): ApiError {
  return new ApiError("PROVISIONING_INCOMPLETE", {
    context: { stage, ...(authIdentity && { authIdentity }) },
  });
}

export async function findAuthUserIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= MAX_LOOKUP_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: LOOKUP_PAGE_SIZE,
    });
    if (error) {
      log("warn", "provisioning.identity_lookup_failed", {
        status: error.status ?? 0,
      });
      throw new ApiError("DEPENDENCY_UNAVAILABLE");
    }
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email,
    );
    if (match) {
      return match.id;
    }
    if (data.users.length < LOOKUP_PAGE_SIZE) {
      return null;
    }
  }
  log("warn", "provisioning.identity_lookup_incomplete", {
    errorCode: "LOOKUP_LIMIT",
  });
  throw new ApiError("DEPENDENCY_UNAVAILABLE");
}

export async function ensureAuthIdentity(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string; state: "created" | "existing" }> {
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (!created.error && created.data.user) {
    return { id: created.data.user.id, state: "created" };
  }

  const code = (created.error as { code?: string } | null)?.code;
  if (code === "email_exists" || code === "user_already_exists") {
    const existing = await findAuthUserIdByEmail(admin, email);
    if (existing) {
      return { id: existing, state: "existing" };
    }
  }

  log("warn", "provisioning.auth_stage_failed", {
    errorCode: code ?? "unknown",
    status: (created.error as { status?: number } | null)?.status ?? 0,
  });
  throw incomplete("AUTH");
}

export async function provisionAccount(
  admin: SupabaseClient,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED");
  }
  const { email, representativeName, isAdmin, isReadonly, actorProfileId } =
    parsed.data;

  const identity = await ensureAuthIdentity(admin, email);

  const { data, error } = await admin.rpc("provision_profile", {
    p_auth_user_id: identity.id,
    p_representative_name: representativeName,
    p_is_admin: isAdmin,
    p_actor_profile_id: actorProfileId,
    ...(isReadonly !== undefined ? { p_is_readonly: isReadonly } : {}),
  });

  if (error) {
    const mapped = toApiError(error);
    // A genuine conflict or authorization failure is reported as such; anything
    // else after the Auth stage is a partial, retryable provisioning state.
    if (mapped.code === "REGISTER_CONFLICT" || mapped.code === "FORBIDDEN") {
      throw mapped;
    }
    log("warn", "provisioning.profile_stage_failed", {
      errorCode: mapped.code,
    });
    throw incomplete("PROFILE", identity.state);
  }

  const result = data as { id?: string; created?: boolean } | null;
  if (!result?.id) {
    throw incomplete("PROFILE", identity.state);
  }

  return {
    accountId: result.id,
    authIdentity: identity.state,
    profile: result.created ? "created" : "existing",
  };
}

/** Enables a consistent profile (residents need a household assignment first; management roles may have none). */
export async function enableAccount(
  admin: SupabaseClient,
  accountId: string,
  actorProfileId: string | null,
): Promise<{ status: string; changed: boolean }> {
  const { data, error } = await admin.rpc("enable_profile", {
    p_profile_id: accountId,
    p_actor_profile_id: actorProfileId,
  });
  if (error) {
    throw toApiError(error);
  }
  const result = data as { status?: string; changed?: boolean } | null;
  if (!result?.status) {
    throw new ApiError("INTERNAL_ERROR");
  }
  return { status: result.status, changed: result.changed === true };
}
