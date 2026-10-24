import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadEnabledAccount,
  type Account,
} from "@/server/authorization/account";
import { ApiError } from "@/server/http/errors";
import { log } from "@/server/observability/logger";
import { AUTH_RATE_LIMITS, enforceRateLimit } from "@/server/auth/rate-limit";
import { CODE_RESEND_SECONDS } from "@/shared/contracts/auth";

/*
 * OTP request, verification and sign-out on top of Supabase Auth, which owns
 * codes, attempts, tokens and sessions. No parallel OTP/session state exists
 * here. Provider responses are never forwarded to clients.
 */
export interface AuthDependencies {
  /** Server client carrying (and receiving) the caller's SDK cookie session. */
  client: SupabaseClient;
  /** Server-only privileged client, used solely for the supplemental limiter. */
  admin: SupabaseClient;
  /** Injectable for tests. */
  wait?: (milliseconds: number) => Promise<void>;
  clock?: () => number;
}

// Mitigates (does not eliminate) response-time differences between addresses
// that trigger an email send and those that do not.
export const MINIMUM_CODE_REQUEST_MS = 750;

type AuthFailure = { status?: number; code?: string } | null;

const isTemporary = (error: AuthFailure): boolean =>
  error !== null &&
  (error.status === undefined || error.status === 0 || error.status >= 500);

async function padTo(
  minimum: number,
  startedAt: number,
  deps: AuthDependencies,
): Promise<void> {
  const elapsed = (deps.clock ?? Date.now)() - startedAt;
  if (elapsed < minimum) {
    await (
      deps.wait ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    )(minimum - elapsed);
  }
}

/*
 * Same outcome for registered, unregistered, disabled and delivery-failed
 * addresses. Only a system-wide outage (5xx / network) is reported, uniformly.
 * The acknowledgement means "processed", never "delivered".
 */
export async function requestCode(
  deps: AuthDependencies,
  email: string,
): Promise<{ resendAfterSeconds: number }> {
  const startedAt = (deps.clock ?? Date.now)();

  try {
    await enforceRateLimit(
      deps.admin,
      AUTH_RATE_LIMITS.codeRequestByEmail,
      "email",
      email,
    );

    const { error } = await deps.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    if (error && isTemporary(error)) {
      log("error", "auth.code.provider_unavailable", {
        status: error.status ?? 0,
      });
      throw new ApiError("AUTH_UNAVAILABLE");
    }
    if (error) {
      // Unknown, disabled or throttled by Auth: indistinguishable from success.
      log("info", "auth.code.provider_declined", {
        status: error.status ?? 0,
        errorCode: error.code ?? "unknown",
      });
    }
    return { resendAfterSeconds: CODE_RESEND_SECONDS };
  } finally {
    await padTo(MINIMUM_CODE_REQUEST_MS, startedAt, deps);
  }
}

export async function verifyCode(
  deps: AuthDependencies,
  email: string,
  code: string,
): Promise<Account> {
  await enforceRateLimit(
    deps.admin,
    AUTH_RATE_LIMITS.verifyByEmail,
    "email",
    email,
  );

  const { data, error } = await deps.client.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });

  if (error) {
    if (error.status === 429) {
      throw new ApiError("RATE_LIMITED", {
        retryAfterSeconds: CODE_RESEND_SECONDS,
      });
    }
    if (isTemporary(error)) {
      throw new ApiError("AUTH_UNAVAILABLE");
    }
    return rejectCode();
  }

  const userId = data.user?.id;
  if (!userId || !data.session) {
    return rejectCode();
  }

  // An Auth session alone grants nothing: require a consistent enabled profile.
  const account = await loadEnabledAccount(deps.client, userId);
  if (!account) {
    await deps.client.auth.signOut({ scope: "local" }).catch(() => undefined);
    throw new ApiError("FORBIDDEN", {
      message: "This account cannot sign in. Contact the administrator.",
    });
  }
  return account;
}

function rejectCode(): never {
  throw new ApiError("CODE_INVALID_OR_EXPIRED");
}

/*
 * Signs out through Auth. No remaining session counts as success; any other
 * failure is surfaced, never reported as success.
 */
export async function signOut(
  deps: Pick<AuthDependencies, "client">,
): Promise<void> {
  const { error } = await deps.client.auth.signOut({ scope: "local" });
  if (!error) {
    return;
  }
  const status = (error as { status?: number }).status;
  if (
    error.name === "AuthSessionMissingError" ||
    status === 401 ||
    status === 403
  ) {
    return;
  }
  throw new ApiError("AUTH_UNAVAILABLE");
}
