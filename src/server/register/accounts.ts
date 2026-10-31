// Retry-safe account administration, RLS-bound Residents listing and page-scoped enrichment.
import "server-only";
import { z } from "zod";
import { toApiError } from "@/server/db/errors";
import { ApiError } from "@/server/http/errors";
import { buildPage, decodeCursor } from "@/server/http/cursor";
import { numberedPage } from "@/server/http/numbered-page";
import { log } from "@/server/observability/logger";
import {
  assertHouseholdFree,
  resolveHouseholdChoice,
} from "@/server/register/households";
import {
  ensureAuthIdentity,
  findAuthUserIdByEmail,
  provisionAccount,
} from "@/server/register/provisioning";
import {
  accountStatus,
  assertCurrentAdmin,
  assertOk,
  callRoutine,
  loadAuthIdentities,
  postgrestQuote,
  type AuthIdentity,
  type RegisterDeps,
} from "@/server/register/shared";
import {
  accountListQuerySchema,
  residentListQuerySchema,
  type ResidentTableQuery,
} from "@/shared/contracts/admin-votes";
import type {
  AccountProjection,
  AccountStatus,
  CreateAccountInput,
  PatchAccountInput,
  ReviewAccountProjection,
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
const PROFILE_COLUMNS =
  "id, representative_name, status, is_admin, is_readonly, self_registered, is_app_support, updated_at";
const ENDPOINT = "/api/admin/accounts";
const BAN_DURATION = "876000h";
const UNBAN_DURATION = "none";

interface ProfileRow {
  id: string;
  representative_name: string;
  status: string;
  is_admin: boolean;
  is_readonly?: boolean;
  self_registered?: boolean;
  is_app_support?: boolean;
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
    ...(row.is_readonly ? { isReadonly: true } : {}),
    ...(row.self_registered ? { selfRegistered: true } : {}),
    ...(row.is_app_support ? { isAppSupport: true } : {}),
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
    cause: {
      source: stage === "AUTH" ? "supabase_auth" : "database",
      code: `${stage}_STAGE_FAILED`,
    },
  });
}

export async function listAccounts(
  deps: RegisterDeps,
  query: z.output<typeof accountListQuerySchema>,
): Promise<{ data: ReviewAccountProjection[]; page: PageInfo }> {
  const binding = {
    endpoint: ENDPOINT,
    filters: {
      status: query.status,
      isAdmin: query.isAdmin,
      isReadonly: query.isReadonly,
      selfRegistered: query.selfRegistered,
    },
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
  if (query.isReadonly !== undefined) {
    request = request.eq("is_readonly", query.isReadonly);
  }
  if (query.selfRegistered !== undefined) {
    request = request.eq("self_registered", query.selfRegistered);
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
  return { data: await projectAccounts(deps, rows), page };
}

// The existing invoker view gives Residents flat/name ordering without changing account API cursors.
export async function listResidents(
  deps: RegisterDeps,
  query: z.output<typeof residentListQuerySchema>,
  requestedPage?: number,
): Promise<{ data: ReviewAccountProjection[]; page: PageInfo }> {
  const identifier =
    query.identifier === undefined
      ? undefined
      : await callRoutine<string>(
          deps.client,
          "normalize_household_identifier",
          {
            p_identifier: query.identifier,
          },
        );
  const binding = {
    endpoint: "/admin/residents",
    filters: {
      status: query.status,
      isAdmin: query.isAdmin,
      isReadonly: query.isReadonly,
      selfRegistered: query.selfRegistered,
      identifier,
      isEligible: query.isEligible,
      hasHousehold: query.hasHousehold,
    },
  };
  const window =
    requestedPage === undefined
      ? undefined
      : await numberedPage(
          deps,
          "residents",
          requestedPage,
          query.limit,
          binding,
        );
  if (window) query = { ...query, cursor: window.cursor };
  let request = deps.client
    .from("resident_directory")
    .select("id, sort_key")
    .order("sort_key", { ascending: true })
    .order("id", { ascending: true })
    .limit(query.limit + 1);
  if (query.status !== undefined) request = request.eq("status", query.status);
  if (query.isAdmin !== undefined)
    request = request.eq("is_admin", query.isAdmin);
  if (query.isReadonly !== undefined)
    request = request.eq("is_readonly", query.isReadonly);
  if (query.selfRegistered !== undefined)
    request = request.eq("self_registered", query.selfRegistered);
  if (identifier !== undefined)
    request = request.eq("household_identifier_normalized", identifier);
  if (query.isEligible !== undefined)
    request = request.eq("household_is_eligible", query.isEligible);
  if (query.hasHousehold === false) request = request.is("household_id", null);
  if (query.hasHousehold === true)
    request = request.not("household_id", "is", null);
  if (query.cursor) {
    const position = decodeCursor(query.cursor, binding, positionSchema);
    // Keep names out of cursors and stay within the shared size bound for Unicode names.
    const anchor = await deps.client
      .from("resident_directory")
      .select("sort_key")
      .eq("id", position.id)
      .maybeSingle<{ sort_key: string }>();
    assertOk(anchor.error, anchor.status);
    if (!anchor.data) {
      throw new ApiError("VALIDATION_FAILED", {
        fieldErrors: [
          {
            field: "cursor",
            code: "INVALID_CURSOR",
            message:
              "This resident is no longer available. Clear filters to restart the list.",
          },
        ],
      });
    }
    request = request.or(
      `sort_key.gt.${postgrestQuote(anchor.data.sort_key)},and(sort_key.eq.${postgrestQuote(anchor.data.sort_key)},id.gt.${position.id})`,
    );
  }
  const { data, error, status } =
    await request.returns<{ id: string; sort_key: string }[]>();
  assertOk(error, status);
  const { rows, page } = buildPage(data ?? [], query.limit, binding, (row) => ({
    id: row.id,
  }));
  if (window) page.numbered = window.numbered;
  if (!rows.length) return { data: [], page };
  // Read current profile columns separately: the historical view predates App Support.
  const profiles = await deps.client
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .in(
      "id",
      rows.map((row) => row.id),
    )
    .limit(rows.length)
    .returns<ProfileRow[]>();
  assertOk(profiles.error, profiles.status);
  const byId = new Map((profiles.data ?? []).map((row) => [row.id, row]));
  const ordered = rows.map((row) => {
    const profile = byId.get(row.id);
    if (!profile) throw new ApiError("DEPENDENCY_UNAVAILABLE");
    return profile;
  });
  return { data: await projectAccounts(deps, ordered), page };
}

const tableWindowSchema = z.object({
  ids: z.array(uuid).max(100),
  totalCount: z.string().regex(/^\d+$/u),
  currentPage: z.number().int().positive(),
  totalPages: z.number().int().positive(),
});

/** Global table sorting is performed before the bounded profile/Auth enrichment. */
export async function listResidentTable(
  deps: RegisterDeps,
  input: ResidentTableQuery,
  requestedPage: number,
): Promise<{ data: ReviewAccountProjection[]; page: PageInfo }> {
  const validated = input;
  const { limit, sort, direction } = validated;
  const parsed = tableWindowSchema.safeParse(
    await callRoutine(deps.client, "get_resident_table_page", {
      p_page: requestedPage,
      p_limit: limit,
      p_sort: sort,
      p_direction: direction,
      p_filters: Object.fromEntries(
        Object.entries(validated).filter(
          ([key, value]) =>
            !["limit", "cursor", "sort", "direction"].includes(key) &&
            value !== undefined,
        ),
      ),
    }),
  );
  if (!parsed.success) throw new ApiError("INTERNAL_ERROR");
  const { ids, ...numbered } = parsed.data;
  const total = Number(numbered.totalCount);
  const expectedRows = Math.min(
    limit,
    Math.max(0, total - (numbered.currentPage - 1) * limit),
  );
  if (
    !Number.isSafeInteger(total) ||
    numbered.totalPages !== Math.max(1, Math.ceil(total / limit)) ||
    numbered.currentPage !== Math.min(requestedPage, numbered.totalPages) ||
    ids.length !== expectedRows ||
    new Set(ids).size !== ids.length
  ) {
    throw new ApiError("INTERNAL_ERROR");
  }
  const page: PageInfo = {
    limit,
    hasMore: numbered.currentPage < numbered.totalPages,
    nextCursor: null,
    numbered,
  };
  if (!ids.length) return { data: [], page };
  const profiles = await deps.client
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .in("id", ids)
    .limit(ids.length)
    .returns<ProfileRow[]>();
  assertOk(profiles.error, profiles.status);
  const byId = new Map((profiles.data ?? []).map((row) => [row.id, row]));
  const ordered = ids.map((id) => {
    const profile = byId.get(id);
    if (!profile) throw new ApiError("DEPENDENCY_UNAVAILABLE");
    return profile;
  });
  return { data: await projectAccounts(deps, ordered), page };
}

async function projectAccounts(
  deps: RegisterDeps,
  rows: ProfileRow[],
): Promise<ReviewAccountProjection[]> {
  // Enrich only the authorized page through supported Auth administration.
  const identities = await loadAuthIdentities(
    deps.admin,
    rows.map((row) => row.id),
  );

  const assignments = rows.length
    ? await deps.client
        .from("households")
        .select("id, identifier, representative_profile_id, is_eligible")
        .in(
          "representative_profile_id",
          rows.map((row) => row.id),
        )
        .limit(rows.length)
        .returns<
          {
            id: string;
            identifier: string;
            representative_profile_id: string;
            is_eligible: boolean;
          }[]
        >()
    : { data: [], error: null, status: 200 };
  assertOk(assignments.error, assignments.status);
  const households = new Map(
    (assignments.data ?? []).map((household) => [
      household.representative_profile_id,
      {
        id: household.id,
        identifier: household.identifier,
        isEligible: household.is_eligible,
      },
    ]),
  );

  return rows.map((row) => ({
    ...toAccountProjection(
      row,
      identities.get(row.id) ?? { email: null, emailVerifiedAt: null },
    ),
    household: households.get(row.id) ?? null,
  }));
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

export const MAX_ASSIGNABLE = 200;

/*
 * Accounts that can represent a household: not deleted and not already
 * representing one (plus the current representative when editing). The most
 * recently created come first, which is the natural flow (create the account,
 * then assign it), and the list is capped, so callers show a notice when it is
 * full. Only these few are enriched with an email so same-named residents can
 * be told apart.
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
      // The App Support account can never represent a household.
      .eq("is_app_support", false)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
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
  const candidates = (profiles.data ?? []).filter(
    (row) => !assigned.has(row.id) || row.id === includeId,
  );
  // The current representative is always offered, even beyond the cap.
  const current = candidates.find((row) => row.id === includeId);
  const options = [
    ...(current ? [current] : []),
    ...candidates.filter((row) => row.id !== includeId),
  ]
    .slice(0, MAX_ASSIGNABLE)
    .sort(
      (left, right) =>
        left.representative_name.localeCompare(right.representative_name) ||
        left.id.localeCompare(right.id),
    );

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

  const accountId = input.household
    ? await createWithHousehold(deps, input, input.household)
    : await createWithoutHousehold(deps, input);

  if (input.enable) {
    // The account and household are already committed; a failed enable leaves them suspended.
    try {
      await updateAccount(deps, accountId, { status: "ENABLED" });
    } catch (error) {
      log("warn", "register.create_enable_failed", {
        errorCode: error instanceof ApiError ? error.code : "unknown",
      });
    }
  }
  return getAccount(deps, accountId);
}

async function createWithoutHousehold(
  deps: RegisterDeps,
  input: CreateAccountInput,
): Promise<string> {
  const result = await provisionAccount(deps.admin, {
    email: input.email,
    representativeName: input.representativeName,
    isAdmin: input.isAdmin,
    isReadonly: input.isReadonly,
    actorProfileId: deps.actor.id,
  });

  // An identical, already-complete account is a duplicate, not a second creation.
  if (result.authIdentity === "existing" && result.profile === "existing") {
    throw new ApiError("REGISTER_CONFLICT", {
      context: { reason: "DUPLICATE_EMAIL" },
    });
  }
  return result.accountId;
}

/*
 * All-or-nothing: the household is validated before any Auth identity exists,
 * the profile and household commit in one audited transaction, and an identity
 * created by this request is removed best-effort if that transaction fails.
 */
async function createWithHousehold(
  deps: RegisterDeps,
  input: CreateAccountInput,
  household: NonNullable<CreateAccountInput["household"]>,
): Promise<string> {
  const field = "household.identifier";
  const identifier = await resolveHouseholdChoice(
    deps,
    household.identifier,
    field,
  );
  await assertHouseholdFree(deps, identifier, field);

  await assertCurrentAdmin(deps);
  const identity = await ensureAuthIdentity(deps.admin, input.email);
  const { error } = await deps.admin.rpc("provision_profile_with_household", {
    p_auth_user_id: identity.id,
    p_representative_name: input.representativeName,
    p_is_admin: input.isAdmin,
    p_is_readonly: input.isReadonly ?? false,
    p_identifier: identifier,
    p_is_eligible: household.isEligible,
    p_actor_profile_id: deps.actor.id,
  });
  if (!error) {
    return identity.id;
  }

  if (identity.state === "created") {
    const removed = await deps.admin.auth.admin.deleteUser(identity.id);
    if (removed.error) {
      log("warn", "register.identity_cleanup_failed", {
        status: (removed.error as { status?: number }).status ?? 0,
      });
    }
  }
  const mapped = toApiError(error);
  if (mapped.context?.reason === "DUPLICATE_IDENTIFIER") {
    throw new ApiError("REGISTER_CONFLICT", {
      context: { reason: "DUPLICATE_IDENTIFIER" },
      fieldErrors: [
        {
          field,
          code: "ALREADY_ASSIGNED",
          message: "This is already assigned to another account.",
        },
      ],
    });
  }
  if (
    mapped.code === "REGISTER_CONFLICT" ||
    mapped.code === "FORBIDDEN" ||
    mapped.code === "VALIDATION_FAILED"
  ) {
    throw mapped;
  }
  log("warn", "register.create_with_household_failed", {
    errorCode: mapped.code,
  });
  throw new ApiError("DEPENDENCY_UNAVAILABLE", { cause: mapped.safeCause });
}

export async function setAuthBan(
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
  // Checked before any Auth stage: an email change must not reach this identity.
  if (current.isAppSupport) {
    throw new ApiError("LIFECYCLE_CONFLICT", {
      context: { reason: "APP_SUPPORT_MANAGED" },
    });
  }
  if (current.status === "DELETED") {
    // A repeated deletion may still need its Auth stage; it never restores or edits the profile.
    if (
      changes.status === "DELETED" &&
      Object.entries(changes).every(
        ([field, value]) => field === "status" || value === undefined,
      )
    ) {
      await setAuthBan(deps, id, true, true);
      return getAccount(deps, id);
    }
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
  if (changes.isReadonly !== undefined) {
    dbChanges.isReadonly = changes.isReadonly;
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
    if (target === "DELETED" || target === "SUSPENDED") {
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
