import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { getSessionState } from "@/server/authorization/account";
import { createAdminClient, createUserClient } from "@/server/db/clients";
import { ApiError } from "@/server/http/errors";
import { log } from "@/server/observability/logger";
import {
  assertCurrentAdmin,
  callRoutine,
  type RegisterDeps,
} from "@/server/register/shared";
import {
  publicRwaIdentitySchema,
  rwaBrandingSchema,
  rwaProfileSchema,
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

/** One read per request for the shell and the page that renders inside it. */
export const loadCurrentBranding = cache(async () =>
  getRwaBranding(await createUserClient()),
);

/** Public-page identity, read with the server-only service role. */
export async function getPublicRwaIdentity(): Promise<PublicRwaIdentity | null> {
  try {
    return parseProjection(
      publicRwaIdentitySchema,
      await callRoutine<unknown>(
        createAdminClient(),
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
export const loadHouseholdTerms = cache(async (): Promise<HouseholdTerms> => {
  try {
    const session = await getSessionState();
    if (session.state === "account") {
      const branding = await loadCurrentBranding();
      return buildHouseholdTerms(
        branding.householdLabel,
        branding.identifierKind,
      );
    }
    const identity = await loadPublicRwaIdentity();
    return identity
      ? buildHouseholdTerms(identity.householdLabel)
      : DEFAULT_HOUSEHOLD_TERMS;
  } catch {
    log("warn", "settings.household_terms_unavailable", {});
    return DEFAULT_HOUSEHOLD_TERMS;
  }
});

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
