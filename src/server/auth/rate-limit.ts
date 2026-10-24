import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toApiError } from "@/server/db/errors";
import { ApiError, type ApiErrorCode } from "@/server/http/errors";
import { log } from "@/server/observability/logger";

/*
 * Supplemental application rate limiting (docs/API.md section 9). Supabase Auth
 * keeps its own OTP limits; these budgets add endpoint-level protection. The
 * thresholds are provisional operational settings to be validated in the pilot.
 * Subjects are keyed HMAC digests under a dedicated key (never Auth signing
 * material); raw emails and addresses never reach the database.
 */
export interface RateLimitPolicy {
  scope: string;
  limit: number;
  windowSeconds: number;
}

export const AUTH_RATE_LIMITS = {
  codeRequestByEmail: {
    scope: "auth.code.email",
    limit: 5,
    windowSeconds: 900,
  },
  verifyByEmail: { scope: "auth.verify.email", limit: 10, windowSeconds: 900 },
  // Register changes by one administrator (provisional; validate in the pilot).
  adminMutationByProfile: {
    scope: "admin.mutation.profile",
    limit: 60,
    windowSeconds: 60,
  },
} as const satisfies Record<string, RateLimitPolicy>;

export const DIGEST_KEY_VERSION = 1;

// Member vote actions per signed-in profile (provisional; validate in the pilot).
// Rate limiting is abuse protection only: duplicate prevention is the database's unique participation.
export const VOTE_RATE_LIMITS = {
  submissionByProfile: {
    scope: "votes.submission.profile",
    limit: 20,
    windowSeconds: 60,
  },
  participationByProfile: {
    scope: "votes.participation.profile",
    limit: 60,
    windowSeconds: 60,
  },
  // Reading votes and results are cheap; the CSV render is the expensive one.
  readByProfile: {
    scope: "votes.read.profile",
    limit: 120,
    windowSeconds: 60,
  },
  exportByProfile: {
    scope: "votes.export.profile",
    limit: 10,
    windowSeconds: 60,
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type SubjectKind = "email" | "ip" | "profile";

let ephemeralKey: Buffer | undefined;

// Production requires RATE_LIMIT_HMAC_KEY (validated at startup); local
// development falls back to a per-process random key rather than a constant.
function digestKey(): Buffer {
  const configured = process.env.RATE_LIMIT_HMAC_KEY;
  if (configured) {
    return Buffer.from(configured, "utf8");
  }
  ephemeralKey ??= randomBytes(32);
  return ephemeralKey;
}

export function subjectDigest(
  kind: SubjectKind,
  value: string,
  key: Buffer = digestKey(),
): Buffer {
  return createHmac("sha256", key)
    .update(`civic-pulse:rate-limit:v${DIGEST_KEY_VERSION}:${kind}:${value}`)
    .digest();
}

/*
 * Consumes one unit and throws RATE_LIMITED (with whole-second Retry-After)
 * when the budget is exhausted. Counting is committed by the routine itself,
 * independent of whatever the caller does next. If the limiter cannot be
 * reached the request is refused with a uniform AUTH_UNAVAILABLE, never allowed
 * through unmetered.
 */
export async function enforceRateLimit(
  admin: SupabaseClient,
  policy: RateLimitPolicy,
  kind: SubjectKind,
  value: string,
  // Which error to report if the limiter itself cannot be reached.
  unavailable: ApiErrorCode = "AUTH_UNAVAILABLE",
): Promise<void> {
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_scope: policy.scope,
    p_subject_digests: [`\\x${subjectDigest(kind, value).toString("hex")}`],
    p_key_versions: [DIGEST_KEY_VERSION],
    p_limit: policy.limit,
    p_window_seconds: policy.windowSeconds,
  });

  if (error) {
    log("error", "ratelimit.unavailable", {
      errorName: toApiError(error).code,
    });
    throw new ApiError(unavailable);
  }

  const result = data as {
    allowed?: boolean;
    retryAfterSeconds?: number;
  } | null;
  if (!result || typeof result.allowed !== "boolean") {
    throw new ApiError(unavailable);
  }
  if (!result.allowed) {
    throw new ApiError("RATE_LIMITED", {
      retryAfterSeconds: result.retryAfterSeconds ?? 60,
    });
  }
}
