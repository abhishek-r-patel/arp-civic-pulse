// Public resident self-registration: suspended, ineligible accounts that only an administrator can enable.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enforceRateLimit,
  type RateLimitPolicy,
} from "@/server/auth/rate-limit";
import { toApiError } from "@/server/db/errors";
import { ApiError } from "@/server/http/errors";
import { log } from "@/server/observability/logger";
import { ensureAuthIdentity } from "@/server/register/provisioning";
import type { SelfRegistrationInput } from "@/shared/contracts/register";
import { settingsListKey } from "@/shared/contracts/rwa-profile";

/*
 * Ordering (docs/DATABASE.md section 9): the Auth identity is created or found
 * first so a repeated email is reported before a taken household, then one
 * audited database transaction creates the SUSPENDED profile and INELIGIBLE
 * household. If that transaction fails, an identity created by THIS request is
 * deleted best-effort; profiles reference auth.users ON DELETE RESTRICT, so a
 * deletion can never remove an identity whose profile was actually committed.
 */
export const SELF_REGISTRATION_RATE_LIMITS = {
  byEmail: { scope: "register.self.email", limit: 3, windowSeconds: 3600 },
  byHousehold: {
    scope: "register.self.household",
    limit: 5,
    windowSeconds: 3600,
  },
  global: { scope: "register.self.global", limit: 100, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitPolicy>;

// Mirrors app_private.normalize_key so spacing or case variants share one budget.
function householdKey(identifier: string): string {
  return identifier
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function conflict(
  reason: "DUPLICATE_EMAIL" | "DUPLICATE_IDENTIFIER",
): ApiError {
  return reason === "DUPLICATE_EMAIL"
    ? new ApiError("REGISTER_CONFLICT", {
        message: "This email address is already registered.",
        context: { reason },
        fieldErrors: [
          {
            field: "email",
            code: "ALREADY_REGISTERED",
            message:
              "This email address is already registered. Sign in, or contact your RWA administrator if your account is not enabled yet.",
          },
        ],
      })
    : new ApiError("REGISTER_CONFLICT", {
        message: "This is already registered.",
        context: { reason },
        fieldErrors: [
          {
            field: "identifier",
            code: "ALREADY_REGISTERED",
            message:
              "This is already registered to another resident. Contact your RWA administrator if you live there.",
          },
        ],
      });
}

function unknownHousehold(): ApiError {
  return new ApiError("VALIDATION_FAILED", {
    context: { reason: "UNKNOWN_HOUSEHOLD" },
    fieldErrors: [
      {
        field: "identifier",
        code: "NOT_IN_LIST",
        message:
          "Choose an entry from the list. Contact your RWA administrator if yours is missing.",
      },
    ],
  });
}

/** Default Households configured by the RWA; empty means free-text entry. */
export async function loadSelfRegistrationHouseholds(
  admin: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await admin.rpc("get_self_registration_households");
  if (error) {
    const mapped = toApiError(error);
    log("warn", "self_registration.households_unavailable", {
      errorCode: mapped.code,
    });
    throw new ApiError("DEPENDENCY_UNAVAILABLE", { cause: mapped.safeCause });
  }
  if (!Array.isArray(data) || !data.every((item) => typeof item === "string")) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      cause: { source: "database", code: "UNEXPECTED_RESPONSE" },
    });
  }
  return data;
}

export async function selfRegister(
  admin: SupabaseClient,
  input: SelfRegistrationInput,
): Promise<void> {
  const limits = SELF_REGISTRATION_RATE_LIMITS;
  await enforceRateLimit(
    admin,
    limits.byEmail,
    "email",
    input.email,
    "DEPENDENCY_UNAVAILABLE",
  );
  await enforceRateLimit(
    admin,
    limits.byHousehold,
    "household",
    householdKey(input.identifier),
    "DEPENDENCY_UNAVAILABLE",
  );
  await enforceRateLimit(
    admin,
    limits.global,
    "email",
    "self-registration-global",
    "DEPENDENCY_UNAVAILABLE",
  );

  // Rejected before the Auth stage so no identity is created; the routine re-checks.
  const listed = await loadSelfRegistrationHouseholds(admin);
  const key = settingsListKey(input.identifier);
  if (
    listed.length > 0 &&
    !listed.some((item) => settingsListKey(item) === key)
  ) {
    throw unknownHousehold();
  }

  let identity: Awaited<ReturnType<typeof ensureAuthIdentity>>;
  try {
    identity = await ensureAuthIdentity(admin, input.email);
  } catch (error) {
    // The resident can simply retry; nothing usable was created.
    if (error instanceof ApiError && error.code === "PROVISIONING_INCOMPLETE") {
      throw new ApiError("DEPENDENCY_UNAVAILABLE", { cause: error.safeCause });
    }
    throw error;
  }

  const { error } = await admin.rpc("self_register_resident", {
    p_auth_user_id: identity.id,
    p_representative_name: input.representativeName,
    p_identifier: input.identifier,
  });
  if (!error) {
    return;
  }

  if (identity.state === "created") {
    const removed = await admin.auth.admin.deleteUser(identity.id);
    if (removed.error) {
      log("warn", "self_registration.identity_cleanup_failed", {
        status: (removed.error as { status?: number }).status ?? 0,
      });
    }
  }
  const mapped = toApiError(error);
  const reason = mapped.context?.reason;
  if (
    mapped.code === "REGISTER_CONFLICT" &&
    (reason === "DUPLICATE_EMAIL" || reason === "DUPLICATE_IDENTIFIER")
  ) {
    throw conflict(reason);
  }
  if (mapped.code === "VALIDATION_FAILED" && reason === "UNKNOWN_HOUSEHOLD") {
    throw unknownHousehold();
  }
  if (
    mapped.code === "REGISTER_CONFLICT" ||
    mapped.code === "VALIDATION_FAILED"
  ) {
    throw mapped;
  }
  log("warn", "self_registration.profile_stage_failed", {
    errorCode: mapped.code,
  });
  throw new ApiError("DEPENDENCY_UNAVAILABLE", { cause: mapped.safeCause });
}
