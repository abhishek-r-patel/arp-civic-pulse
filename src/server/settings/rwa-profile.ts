// RWA profile, branding, household wording and household-choice reads/updates.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { z } from "zod";
import { getSessionState } from "@/server/authorization/account";
import { createAdminClient, createUserClient } from "@/server/db/clients";
import {
  getRequestTenantContext,
  type TenantContext,
} from "@/server/config/tenant-context";
import { ApiError } from "@/server/http/errors";
import { log } from "@/server/observability/logger";
import {
  assertCurrentAdmin,
  callRoutine,
  type RegisterDeps,
} from "@/server/register/shared";
import type { HouseholdChoices } from "@/shared/contracts/register";
import {
  DEFAULT_HOUSEHOLDS_MAX_ITEMS,
  publicRwaIdentitySchema,
  rwaBrandingSchema,
  rwaProfileSchema,
  settingsListKey,
  type PublicRwaIdentity,
  type RwaBranding,
  type RwaProfile,
} from "@/shared/contracts/rwa-profile";
import {
  buildHouseholdTerms,
  DEFAULT_HOUSEHOLD_TERMS,
  type HouseholdTerms,
} from "@/shared/contracts/household-terms";

function parseProjection<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: T } | { success: false };
  },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError("INTERNAL_ERROR");
  }
  return result.data;
}

// Full profile access is admin-only; other callers get narrower projections.
export async function getRwaProfile(
  client: SupabaseClient,
): Promise<RwaProfile> {
  return parseProjection(
    rwaProfileSchema,
    await callRoutine<unknown>(client, "get_rwa_profile", {}),
  );
}

/** Display values for enabled members; excludes administrator-only settings. */
export async function getRwaBranding(
  client: SupabaseClient,
): Promise<RwaBranding> {
  return parseProjection(
    rwaBrandingSchema,
    await callRoutine<unknown>(client, "get_rwa_branding", {}),
  );
}

/** Names only, for the enabled-member Contact page directory. */
export async function getEnabledRwaAdminNames(
  client: SupabaseClient,
): Promise<string[]> {
  const rows = parseProjection(
    z.array(
      z.strictObject({
        representative_name: z.string().min(1).max(200),
      }),
    ),
    await callRoutine<unknown>(client, "get_enabled_rwa_admin_names", {}),
  );
  return rows.map((row) => row.representative_name);
}

/** One read per request for the shell and the page that renders inside it. */
export const loadCurrentBranding = cache(async (tenant?: TenantContext) =>
  getRwaBranding(
    await createUserClient(tenant ?? (await getRequestTenantContext())),
  ),
);

/** Public-page identity, read with the server-only service role. */
export async function getPublicRwaIdentity(
  tenant?: TenantContext,
): Promise<PublicRwaIdentity | null> {
  try {
    const resolvedTenant = tenant ?? (await getRequestTenantContext());
    return parseProjection(
      publicRwaIdentitySchema,
      await callRoutine<unknown>(
        await createAdminClient(resolvedTenant),
        "get_public_rwa_identity",
        {},
      ),
    );
  } catch {
    // Public pages must stay usable if settings are not initialized or unavailable.
    log("warn", "settings.public_identity_unavailable", {});
    return null;
  }
}

export const loadPublicRwaIdentity = cache(getPublicRwaIdentity);

/*
 * Household wording for the current request: the member branding for a
 * signed-in account, otherwise the public identity, otherwise the defaults.
 * Wording must never take a page down, so failures fall back to "Household".
 */
export const loadHouseholdTerms = cache(
  async (tenantContext?: TenantContext): Promise<HouseholdTerms> => {
    try {
      const tenant = tenantContext ?? (await getRequestTenantContext());
      const session = await getSessionState(tenant);
      if (session.state === "account") {
        const branding = await loadCurrentBranding(tenant);
        return buildHouseholdTerms(
          branding.householdLabel,
          branding.identifierKind,
        );
      }
      const identity = await loadPublicRwaIdentity(tenant);
      return identity
        ? buildHouseholdTerms(identity.householdLabel)
        : DEFAULT_HOUSEHOLD_TERMS;
    } catch {
      log("warn", "settings.household_terms_unavailable", {});
      return DEFAULT_HOUSEHOLD_TERMS;
    }
  },
);

/*
 * Household choices for administrator forms: when Default Households are
 * configured, only entries not yet in the register (plus `current`, the
 * account's own household) are offered and accepted. If the register read fails,
 * every default is offered and the database still rejects repeats.
 */
export async function loadHouseholdChoices(
  deps: RegisterDeps,
  current?: string,
): Promise<HouseholdChoices> {
  const { defaultHouseholds } = await getRwaProfile(deps.client);
  if (defaultHouseholds.length === 0) return { listed: false, options: [] };
  const { data, error } = await deps.client
    .from("households")
    .select("identifier")
    .limit(DEFAULT_HOUSEHOLDS_MAX_ITEMS * 2)
    .returns<{ identifier: string }[]>();
  if (error || !data) {
    log("warn", "settings.default_households_register_unavailable", {});
    return { listed: true, options: defaultHouseholds };
  }
  const currentKey = current === undefined ? null : settingsListKey(current);
  const used = new Set(
    data
      .map((row) => settingsListKey(row.identifier))
      .filter((key) => key !== currentKey),
  );
  return {
    listed: true,
    options: defaultHouseholds.filter(
      (item) => !used.has(settingsListKey(item)),
    ),
  };
}

/** Position names offered when adding offices to a PRIVATE vote draft. */
export async function listRwaPositions(deps: RegisterDeps): Promise<string[]> {
  return (await getRwaProfile(deps.client)).rwaPositions;
}

export async function updateRwaProfile(
  deps: RegisterDeps,
  profile: RwaProfile,
): Promise<RwaProfile> {
  await assertCurrentAdmin(deps);
  return parseProjection(
    rwaProfileSchema,
    await callRoutine<unknown>(deps.client, "update_rwa_profile", {
      p_settings: profile,
    }),
  );
}
