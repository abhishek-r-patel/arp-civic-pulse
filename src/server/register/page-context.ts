// Authorized management page data and role guards for server-rendered screens.
import "server-only";
import { notFound, redirect } from "next/navigation";
import { getSessionState } from "@/server/authorization/account";
import { createAdminClient, createUserClient } from "@/server/db/clients";
import { getCsrfToken } from "@/server/http/csrf-cookie";
import type { RegisterDeps } from "@/server/register/shared";
import {
  getRwaProfile,
  loadCurrentBranding,
} from "@/server/settings/rwa-profile";
import {
  buildHouseholdTerms,
  type HouseholdTerms,
} from "@/shared/contracts/household-terms";
import type { RwaBranding, RwaProfile } from "@/shared/contracts/rwa-profile";
import { canViewAdministration } from "@/shared/contracts/register";

type PageContext = RegisterDeps & {
  /** Current RWA display values; settings-only fields are never included. */
  branding: RwaBranding;
  /** Household and identifier wording derived from the branding. */
  terms: HouseholdTerms;
  /** Shorthand for terms.identifierLabel ("Flat Number"). */
  identifierLabel: string;
  csrfToken: string | undefined;
};
type RwaSettingsPageContext = RegisterDeps &
  RwaProfile & { csrfToken: string | undefined };

async function verifiedAdminContext() {
  const session = await getSessionState();
  if (session.state !== "account") {
    redirect("/sign-in");
  }
  if (!canViewAdministration(session.account)) {
    notFound();
  }
  return { session, client: await createUserClient() };
}

/*
 * Page-level read guard for administrator and committee observer screens. The session was verified once for
 * this request (getSessionState is cached); data access still runs under the
 * administrator's own session, so RLS and the guarded routines re-check the
 * caller. Management mutations still require a current administrator.
 */
export async function adminPageContext(): Promise<PageContext> {
  const { session, client } = await verifiedAdminContext();
  const branding = await loadCurrentBranding();
  const terms = buildHouseholdTerms(
    branding.householdLabel,
    branding.identifierKind,
  );
  return {
    branding,
    terms,
    identifierLabel: terms.identifierLabel,
    client,
    admin: createAdminClient(),
    actor: session.account,
    csrfToken: await getCsrfToken(),
  };
}

export async function adminRwaSettingsPageContext(): Promise<RwaSettingsPageContext> {
  const { session, client } = await verifiedAdminContext();
  const profile = await getRwaProfile(client);
  return {
    ...profile,
    client,
    admin: createAdminClient(),
    actor: session.account,
    csrfToken: await getCsrfToken(),
  };
}

/*
 * Page-level guard for resident screens: any verified, enabled account. Whether
 * a particular vote is visible is decided by the database from the frozen
 * electorate, never by this layer.
 */
export async function memberPageContext(): Promise<PageContext> {
  const session = await getSessionState();
  if (session.state !== "account") {
    redirect("/sign-in");
  }

  const client = await createUserClient();
  const branding = await loadCurrentBranding();
  const terms = buildHouseholdTerms(
    branding.householdLabel,
    branding.identifierKind,
  );
  return {
    branding,
    terms,
    identifierLabel: terms.identifierLabel,
    client,
    admin: createAdminClient(),
    actor: session.account,
    csrfToken: await getCsrfToken(),
  };
}
