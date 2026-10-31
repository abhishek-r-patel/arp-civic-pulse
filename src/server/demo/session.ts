// One-click sign-in as a fictional demo persona; never sends email or creates accounts.
import "server-only";
import { createHmac } from "node:crypto";
import type { AuthDependencies } from "@/server/auth/otp";
import { enforceRateLimit } from "@/server/auth/rate-limit";
import {
  loadEnabledAccount,
  type Account,
} from "@/server/authorization/account";
import { ApiError } from "@/server/http/errors";
import { log } from "@/server/observability/logger";
import { DEMO_PERSONAS, type DemoPersona } from "@/shared/demo";

// Shared by every visitor; caps how fast anyone can mint demo sessions.
export const DEMO_SESSION_LIMIT = {
  scope: "demo.session.global",
  limit: 300,
  windowSeconds: 3600,
} as const;

const DEMO_NOT_READY =
  "The demo is being reset or set up. Try again in a few minutes.";

/*
 * Only for the demo host. Every visitor shares each persona, so sign-in uses a
 * password derived on the server (HMAC of the demo project's service-role key
 * and the persona email). Unlike one-time codes, a password sign-in never
 * invalidates another visitor's sign-in. The password never leaves the server
 * and no email is sent. If it does not match (new persona after
 * `npm run ops -- demo-reset`, or a rotated key), the server sets it with the
 * Auth admin API and signs in again; concurrent repairs write the same value.
 * Missing personas fail closed.
 */
export async function signInAsDemoPersona(
  deps: AuthDependencies,
  persona: DemoPersona,
): Promise<Account> {
  if (deps.tenant.kind !== "demo") {
    throw new ApiError("NOT_FOUND", {
      cause: { source: "tenant_config", code: "NOT_DEMO_HOST" },
    });
  }
  await enforceRateLimit(
    deps.admin,
    DEMO_SESSION_LIMIT,
    "email",
    "demo-session-global",
  );

  const { email } = DEMO_PERSONAS[persona];
  const userId = await personaPasswordSignIn(deps, persona, email);
  const account = await loadEnabledAccount(deps.client, userId);
  if (!account) {
    await deps.client.auth.signOut({ scope: "local" }).catch(() => undefined);
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      message: DEMO_NOT_READY,
      cause: { source: "tenant_config", code: "DEMO_PERSONA_NOT_ENABLED" },
    });
  }
  log("info", "demo.persona_signed_in", { persona });
  return account;
}

export function demoPersonaPassword(serviceKey: string, email: string) {
  const digest = createHmac("sha256", serviceKey)
    .update(`civic-pulse-demo-persona:${email}`)
    .digest("base64url");
  // Fixed prefix satisfies any upper/lower/digit/symbol password policy.
  return `Demo-1:${digest}`;
}

async function personaPasswordSignIn(
  deps: AuthDependencies,
  persona: DemoPersona,
  email: string,
): Promise<string> {
  const serviceKey = deps.tenant.serviceRoleKeyRef
    ? process.env[deps.tenant.serviceRoleKeyRef]
    : undefined;
  if (!serviceKey) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      cause: { source: "tenant_config", code: "SERVICE_KEY_MISSING" },
    });
  }
  const password = demoPersonaPassword(serviceKey, email);

  const first = await deps.client.auth.signInWithPassword({ email, password });
  if (!first.error && first.data.user && first.data.session) {
    return first.data.user.id;
  }
  if (first.error?.code !== "invalid_credentials") throw authFailure(first);

  // `generateLink` only looks the persona up here; it sends no email.
  const { data, error } = await deps.admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const personaId = data?.user?.id;
  if (error || !personaId) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      message: DEMO_NOT_READY,
      cause: {
        source: "supabase_auth",
        code: error?.code ?? "DEMO_PERSONA_MISSING",
        status: error?.status,
      },
    });
  }
  const updated = await deps.admin.auth.admin.updateUserById(personaId, {
    password,
  });
  if (updated.error) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      message: DEMO_NOT_READY,
      cause: {
        source: "supabase_auth",
        code: updated.error.code ?? "DEMO_PASSWORD_NOT_SET",
        status: updated.error.status,
      },
    });
  }
  log("info", "demo.persona_password_set", { persona });

  const second = await deps.client.auth.signInWithPassword({ email, password });
  if (!second.error && second.data.user && second.data.session) {
    return second.data.user.id;
  }
  throw authFailure(second);
}

function authFailure(result: {
  error: { code?: string; status?: number } | null;
}): ApiError {
  return new ApiError("AUTH_UNAVAILABLE", {
    cause: {
      source: "supabase_auth",
      code: result.error?.code ?? "DEMO_SESSION_NOT_CREATED",
      status: result.error?.status,
    },
  });
}
