import "server-only";
import { z } from "zod";
import { ApiError } from "@/server/http/errors";
import { buildPage, decodeCursor } from "@/server/http/cursor";
import {
  accountStatus,
  assertCurrentAdmin,
  assertOk,
  callRoutine,
  loadAuthIdentities,
  postgrestQuote,
  type RegisterDeps,
} from "@/server/register/shared";
import type {
  CreateHouseholdInput,
  HouseholdProjection,
  PatchHouseholdInput,
  householdListQuerySchema,
} from "@/shared/contracts/register";
import type { PageInfo } from "@/shared/contracts/pagination";
import { uuid } from "@/shared/validation/primitives";

/*
 * The household register. Reads follow RLS (administrators only); changes go
 * through guarded routines that audit atomically. Edits never touch frozen
 * electorate snapshots, so past votes keep their original names and
 * entitlements.
 */
const ENDPOINT = "/api/admin/households";
const COLUMNS =
  "id, identifier, identifier_normalized, representative_profile_id, is_eligible, updated_at, profiles(representative_name, status)";

interface HouseholdRow {
  id: string;
  identifier: string;
  identifier_normalized: string;
  representative_profile_id: string;
  is_eligible: boolean;
  updated_at: string;
  profiles: { representative_name: string; status: string } | null;
}

const positionSchema = z.object({
  key: z.string().max(400),
  id: uuid,
});

function toProjection(
  row: HouseholdRow,
  email: string | null,
): HouseholdProjection {
  if (!row.profiles) {
    // A household always has a representative profile (restrictive foreign key).
    throw new ApiError("INTERNAL_ERROR");
  }
  return {
    id: row.id,
    identifier: row.identifier,
    representativeAccountId: row.representative_profile_id,
    isEligible: row.is_eligible,
    updatedAt: new Date(row.updated_at).toISOString(),
    representative: {
      name: row.profiles.representative_name,
      email,
      status: accountStatus(row.profiles.status),
    },
  };
}

async function withEmails(
  deps: RegisterDeps,
  rows: readonly HouseholdRow[],
): Promise<HouseholdProjection[]> {
  const identities = await loadAuthIdentities(deps.admin, [
    ...new Set(rows.map((row) => row.representative_profile_id)),
  ]);
  return rows.map((row) =>
    toProjection(
      row,
      identities.get(row.representative_profile_id)?.email ?? null,
    ),
  );
}

export async function listHouseholds(
  deps: RegisterDeps,
  query: z.output<typeof householdListQuerySchema>,
): Promise<{ data: HouseholdProjection[]; page: PageInfo }> {
  // Exact identifier filters use the database's own normalisation.
  const normalized =
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
    endpoint: ENDPOINT,
    filters: { isEligible: query.isEligible, identifier: normalized },
  };

  let request = deps.client
    .from("households")
    .select(COLUMNS)
    .order("identifier_normalized", { ascending: true })
    .order("id", { ascending: true })
    .limit(query.limit + 1);
  if (query.isEligible !== undefined) {
    request = request.eq("is_eligible", query.isEligible);
  }
  if (normalized !== undefined) {
    request = request.eq("identifier_normalized", normalized);
  }
  if (query.cursor) {
    const { key, id } = decodeCursor(query.cursor, binding, positionSchema);
    request = request.or(
      `identifier_normalized.gt.${postgrestQuote(key)},and(identifier_normalized.eq.${postgrestQuote(key)},id.gt.${id})`,
    );
  }

  const { data, error, status } = await request.returns<HouseholdRow[]>();
  assertOk(error, status);

  const { rows, page } = buildPage(data ?? [], query.limit, binding, (row) => ({
    key: row.identifier_normalized,
    id: row.id,
  }));
  return { data: await withEmails(deps, rows), page: page satisfies PageInfo };
}

export async function getHousehold(
  deps: RegisterDeps,
  id: string,
): Promise<HouseholdProjection> {
  const { data, error, status } = await deps.client
    .from("households")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle<HouseholdRow>();
  assertOk(error, status);
  if (!data) {
    throw new ApiError("NOT_FOUND");
  }
  const [projection] = await withEmails(deps, [data]);
  if (!projection) {
    throw new ApiError("INTERNAL_ERROR");
  }
  return projection;
}

export async function createHousehold(
  deps: RegisterDeps,
  input: CreateHouseholdInput,
): Promise<HouseholdProjection> {
  await assertCurrentAdmin(deps);
  const created = await callRoutine<{ id: string }>(
    deps.client,
    "create_household",
    {
      p_identifier: input.identifier,
      p_representative_account_id: input.representativeAccountId,
      p_is_eligible: input.isEligible,
    },
  );
  return getHousehold(deps, created.id);
}

export async function updateHousehold(
  deps: RegisterDeps,
  id: string,
  changes: PatchHouseholdInput,
): Promise<HouseholdProjection> {
  await assertCurrentAdmin(deps);
  const defined = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  );
  await callRoutine(deps.client, "update_household", {
    p_household_id: id,
    p_changes: defined,
  });
  return getHousehold(deps, id);
}
