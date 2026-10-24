import "server-only";
import { z } from "zod";
import { ApiError } from "@/server/http/errors";
import { buildPage, decodeCursor } from "@/server/http/cursor";
import { log } from "@/server/observability/logger";
import {
  findAuthUserIdByEmail,
  provisionAccount,
} from "@/server/register/provisioning";
import {
  accountStatus,
  assertCurrentAdmin,
  assertOk,
  callRoutine,
  loadAuthIdentities,
  type AuthIdentity,
  type RegisterDeps,
} from "@/server/register/shared";
import { accountListQuerySchema } from "@/shared/contracts/admin-votes";
import type {
  AccountProjection,
  AccountStatus,
  CreateAccountInput,
  PatchAccountInput,
} from "@/shared/contracts/register";
import type { PageInfo } from "@/shared/contracts/pagination";
import { uuid } from "@/shared/validation/primitives";

/*
 * Accounts are one Supabase Auth identity plus its application profile. The
 * database stages are atomic and audited; Auth stages are separate, so every
 * workflow orders them to fail SAFE: a profile is blocked first when access is
 * being narrowed or an identity is being changed, and re-enabled only after
 * the Auth side is verified consistent. A failure leaves the profile blocked.
 */
const PROFILE_COLUMNS = "id, representative_name, status, is_admin, updated_at";
const ENDPOINT = "/api/admin/accounts";
const BAN_DURATION = "876000h";
const UNBAN_DURATION = "none";

interface ProfileRow {
  id: string;
  representative_name: string;
  status: string;
  is_admin: boolean;
  updated_at: string;
}

const positionSchema = z.object({ id: uuid });

export function toAccountProjection(
  row: ProfileRow,
  identity: AuthIdentity,
): AccountProjection {
  return {
    id: row.id,
    email: identity.email,
    representativeName: row.representative_name,
    status: accountStatus(row.status),
    isAdmin: row.is_admin,
    emailVerifiedAt: identity.emailVerifiedAt,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function incomplete(
  stage: "AUTH" | "PROFILE",
  profileBlocked: boolean,
): ApiError {
  return new ApiError("PROVISIONING_INCOMPLETE", {
    context: { stage, profileBlocked },
  });
}

export async function listAccounts(
  deps: RegisterDeps,
  query: z.output<typeof accountListQuerySchema>,
): Promise<{ data: AccountProjection[]; page: PageInfo }> {
  const binding = {
    endpoint: ENDPOINT,
    filters: { status: query.status, isAdmin: query.isAdmin },
  };

  let request = deps.client
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .order("id", { ascending: true })
    .limit(query.limit + 1);
  if (query.status) {
    request = request.eq("status", query.status);
  }
  if (query.isAdmin !== undefined) {
    request = request.eq("is_admin", query.isAdmin);
  }
  if (query.cursor) {
    request = request.gt(
      "id",
      decodeCursor(query.cursor, binding, positionSchema).id,
    );
  }

  const { data, error, status } = await request.returns<ProfileRow[]>();
  assertOk(error, status);

  const { rows, page } = buildPage(data ?? [], query.limit, binding, (row) => ({
    id: row.id,
  }));
  // Enrich only the authorized page through supported Auth administration.
  const identities = await loadAuthIdentities(
    deps.admin,
    rows.map((row) => row.id),
  );

  return {
    data: rows.map((row) =>
      toAccountProjection(
        row,
        identities.get(row.id) ?? { email: null, emailVerifiedAt: null },
      ),
    ),
    page,
  };
}

export async function getAccount(
  deps: RegisterDeps,
  id: string,
): Promise<AccountProjection> {
  const { data, error, status } = await deps.client
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", id)
    .maybeSingle<ProfileRow>();
  assertOk(error, status);
  if (!data) {
    throw new ApiError("NOT_FOUND");
  }
  const identities = await loadAuthIdentities(deps.admin, [id]);
  return toAccountProjection(
    data,
    identities.get(id) ?? { email: null, emailVerifiedAt: null },
  );
}

export interface AssignableAccount {
  id: string;
  name: string;
  email: string | null;
  status: AccountStatus;
}

const MAX_ASSIGNABLE = 200;

/*
 * Accounts that can represent a household: not deleted and not already
 * representing one (plus the current representative when editing). Only these
 * few are enriched with an email so same-named residents can be told apart.
 */
export async function listAssignableAccounts(
  deps: RegisterDeps,
  includeId?: string,
): Promise<AssignableAccount[]> {
  const [profiles, households] = await Promise.all([
    deps.client
      .from("profiles")
      .select("id, representative_name, status")
      .neq("status", "DELETED")
      .order("representative_name", { ascending: true })
      .order("id", { ascending: true })
      .limit(2000)
      .returns<{ id: string; representative_name: string; status: string }[]>(),
    deps.client
      .from("households")
      .select("representative_profile_id")
      .limit(5000)
      .returns<{ representative_profile_id: string }[]>(),
  ]);
  assertOk(profiles.error, profiles.status);
  assertOk(households.error, households.status);

  const assigned = new Set(
    (households.data ?? []).map((row) => row.representative_profile_id),
  );
  const options = (profiles.data ?? [])
    .filter((row) => !assigned.has(row.id) || row.id === includeId)
    .slice(0, MAX_ASSIGNABLE);

  const identities = await loadAuthIdentities(
    deps.admin,
    options.map((row) => row.id),
  );
  return options.map((row) => ({
    id: row.id,
    name: row.representative_name,
    email: identities.get(row.id)?.email ?? null,
    status: accountStatus(row.status),
  }));
}

export async function createAccount(
  deps: RegisterDeps,
  input: CreateAccountInput,
): Promise<AccountProjection> {
  await assertCurrentAdmin(deps);

  const result = await provisionAccount(deps.admin, {
    email: input.email,
    representativeName: input.representativeName,
    isAdmin: input.isAdmin,
    actorProfileId: deps.actor.id,
  });

  // An identical, already-complete account is a duplicate, not a second creation.
  if (result.authIdentity === "existing" && result.profile === "existing") {
    throw new ApiError("REGISTER_CONFLICT", {
      context: { reason: "DUPLICATE_EMAIL" },
    });
  }
  return getAccount(deps, result.accountId);
}

async function setAuthBan(
  deps: RegisterDeps,
  id: string,
  banned: boolean,
  profileBlocked: boolean,
): Promise<void> {
  await assertCurrentAdmin(deps);
  const { error } = await deps.admin.auth.admin.updateUserById(id, {
    ban_duration: banned ? BAN_DURATION : UNBAN_DURATION,
  });
  if (error) {
    log("warn", "register.auth_ban_failed", {
      status: (error as { status?: number }).status ?? 0,
    });
    throw incomplete("AUTH", profileBlocked);
  }
}

async function changeEmail(
  deps: RegisterDeps,
  current: AccountProjection,
  email: string,
): Promise<boolean> {
  const owner = await findAuthUserIdByEmail(deps.admin, email);
  if (owner && owner !== current.id) {
    throw new ApiError("REGISTER_CONFLICT", {
      context: { reason: "DUPLICATE_EMAIL" },
    });
  }

  // Block first; the profile stays blocked until the Auth identity is verified.
  const mustBlock = current.status === "ENABLED";
  if (mustBlock) {
    await callRoutine(deps.client, "update_profile", {
      p_profile_id: current.id,
      p_changes: { status: "SUSPENDED" },
    });
  }

  await assertCurrentAdmin(deps);
  const updated = await deps.admin.auth.admin.updateUserById(current.id, {
    email,
    email_confirm: true,
  });
  if (updated.error) {
    const code = (updated.error as { code?: string }).code;
    if (code === "email_exists") {
      throw new ApiError("REGISTER_CONFLICT", {
        context: { reason: "DUPLICATE_EMAIL" },
      });
    }
    log("warn", "register.auth_email_failed", {
      errorCode: code ?? "unknown",
      status: (updated.error as { status?: number }).status ?? 0,
    });
    throw incomplete("AUTH", mustBlock);
  }

  const verified = await deps.admin.auth.admin.getUserById(current.id);
  if (verified.error || verified.data.user.email?.toLowerCase() !== email) {
    throw incomplete("AUTH", mustBlock);
  }
  return mustBlock;
}

export async function updateAccount(
  deps: RegisterDeps,
  id: string,
  changes: PatchAccountInput,
): Promise<AccountProjection> {
  await assertCurrentAdmin(deps);

  const current = await getAccount(deps, id);
  if (current.status === "DELETED") {
    throw new ApiError("LIFECYCLE_CONFLICT", {
      context: { reason: "DELETED_PROFILE" },
    });
  }

  let blocked = false;
  if (changes.email !== undefined && changes.email !== current.email) {
    blocked = await changeEmail(deps, current, changes.email);
  }

  const effectiveStatus: AccountStatus = blocked ? "SUSPENDED" : current.status;
  // An email change restores the previous access unless a status was requested.
  const target: AccountStatus | undefined =
    changes.status ?? (blocked ? current.status : undefined);

  const dbChanges: Record<string, unknown> = {};
  if (
    changes.representativeName !== undefined &&
    changes.representativeName !== current.representativeName
  ) {
    dbChanges.representativeName = changes.representativeName;
  }
  if (changes.isAdmin !== undefined && changes.isAdmin !== current.isAdmin) {
    dbChanges.isAdmin = changes.isAdmin;
  }
  if (target !== undefined && target !== effectiveStatus) {
    dbChanges.status = target;
  }

  try {
    if (target === "ENABLED" && effectiveStatus !== "ENABLED") {
      // Widening access: allow sign-in at Auth first, then enable the profile.
      await setAuthBan(deps, id, false, true);
    }
    if (Object.keys(dbChanges).length > 0) {
      await callRoutine(deps.client, "update_profile", {
        p_profile_id: id,
        p_changes: dbChanges,
      });
    }
    if (
      target === "DELETED" ||
      (target === "SUSPENDED" && effectiveStatus === "ENABLED")
    ) {
      // Narrowing access: the profile is already blocked; now stop new Auth sign-ins.
      await setAuthBan(deps, id, true, true);
    }
  } catch (error) {
    // A refused restore after an email change leaves the profile blocked and says so.
    if (
      blocked &&
      error instanceof ApiError &&
      !(error.context && "profileBlocked" in error.context)
    ) {
      throw incomplete("PROFILE", true);
    }
    throw error;
  }

  return getAccount(deps, id);
}
