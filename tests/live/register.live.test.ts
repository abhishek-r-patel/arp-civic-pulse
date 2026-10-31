import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyCode } from "@/server/auth/otp";
import { loadEnabledAccount } from "@/server/authorization/account";
import { callRoutine, type RegisterDeps } from "@/server/register/shared";
import {
  createAccount,
  getAccount,
  listAccounts,
  listAssignableAccounts,
  updateAccount,
} from "@/server/register/accounts";
import {
  createHousehold,
  listHouseholds,
  updateHousehold,
} from "@/server/register/households";
import { accountListQuerySchema } from "@/shared/contracts/admin-votes";
import { householdListQuerySchema } from "@/shared/contracts/register";
import {
  adminClient,
  emailOtp,
  hasLive,
  liveEmail,
  publicClient,
} from "./support/live";
import { apiError, signIn } from "./support/session";
import { testTenantContext } from "../fixtures/tenant-context";

/*
 * Register administration against real Supabase Auth and PostgREST, using the
 * actual service code with a real signed-in administrator. Users created here
 * cannot be deleted afterwards (by design); reset the disposable project when done.
 */
describe.skipIf(!hasLive)("live: register administration", () => {
  let admin: SupabaseClient;
  let deps: RegisterDeps;

  beforeAll(async () => {
    admin = adminClient();
    const adminUser = await signIn(admin);
    deps = {
      tenant: testTenantContext,
      client: adminUser.client,
      admin,
      actor: {
        id: adminUser.id,
        representativeName: adminUser.name,
        isAdmin: true,
      },
    };
  });

  const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  async function newResident(name = "Live Resident") {
    const email = liveEmail();
    const account = await createAccount(deps, {
      email,
      representativeName: name,
      isAdmin: false,
      enable: false,
    });
    return { email, account };
  }

  async function signInAs(email: string) {
    const client = publicClient();
    const account = await verifyCode(
      { tenant: testTenantContext, client, admin },
      email,
      await emailOtp(admin, email),
    );
    return { client, account };
  }

  async function bannedUntil(id: string): Promise<string | null> {
    const { data } = await admin.auth.admin.getUserById(id);
    return (
      (data.user as { banned_until?: string | null } | null)?.banned_until ??
      null
    );
  }

  describe("accounts", () => {
    it("creates a suspended account with its email from Auth and rejects a duplicate", async () => {
      const { email, account } = await newResident("Fresh Resident");

      expect(account).toMatchObject({
        representativeName: "Fresh Resident",
        status: "SUSPENDED",
        isAdmin: false,
        email,
      });
      expect(account.emailVerifiedAt).not.toBeNull();

      const duplicate = await apiError(
        createAccount(deps, {
          email,
          representativeName: "Fresh Resident",
          isAdmin: false,
          enable: false,
        }),
      );
      expect(duplicate.code).toBe("REGISTER_CONFLICT");
      expect(duplicate.context).toEqual({ reason: "DUPLICATE_EMAIL" });
    });

    it("keeps residents suspended until a household exists, then enables them and lets them sign in", async () => {
      const { email, account } = await newResident("Needs A Home");

      const blocked = await apiError(
        updateAccount(deps, account.id, { status: "ENABLED" }),
      );
      expect(blocked.code).toBe("PROVISIONING_INCOMPLETE");
      // Unassigned accounts are offered as representatives. The picker is capped and
      // the project accumulates accounts, so check the fact itself, not list position.
      const owned = await deps.client
        .from("households")
        .select("id")
        .eq("representative_profile_id", account.id);
      expect(owned.error).toBeNull();
      expect(owned.data).toEqual([]);

      await createHousehold(deps, {
        identifier: `E-${unique()}`,
        representativeAccountId: account.id,
        isEligible: true,
      });
      const enabled = await updateAccount(deps, account.id, {
        status: "ENABLED",
      });
      expect(enabled.status).toBe("ENABLED");
      expect(await bannedUntil(account.id)).toBeNull();

      const session = await signInAs(email);
      expect(session.account).toMatchObject({ id: account.id, isAdmin: false });
      // Assigned accounts leave the picker.
      expect(
        (await listAssignableAccounts(deps)).map((a) => a.id),
      ).not.toContain(account.id);
    });

    it("blocks a live session immediately on suspension, stops new sign-ins, and restores access on enabling", async () => {
      const { email, account } = await newResident("Suspend Me");
      await createHousehold(deps, {
        identifier: `S-${unique()}`,
        representativeAccountId: account.id,
        isEligible: true,
      });
      await updateAccount(deps, account.id, { status: "ENABLED" });
      const session = await signInAs(email);
      expect(
        await loadEnabledAccount(session.client, account.id),
      ).not.toBeNull();

      const suspended = await updateAccount(deps, account.id, {
        status: "SUSPENDED",
      });
      expect(suspended.status).toBe("SUSPENDED");
      // The existing session loses application access at once...
      expect(await loadEnabledAccount(session.client, account.id)).toBeNull();
      // ...and Auth refuses new sign-ins.
      expect(await bannedUntil(account.id)).not.toBeNull();
      await expect(signInAs(email)).rejects.toBeDefined();

      await updateAccount(deps, account.id, { status: "ENABLED" });
      expect(await bannedUntil(account.id)).toBeNull();
      expect((await signInAs(email)).account.id).toBe(account.id);
    });

    it("changes an email safely: verified in Auth, access restored, and the new address signs in", async () => {
      const { email, account } = await newResident("Change Email");
      await createHousehold(deps, {
        identifier: `C-${unique()}`,
        representativeAccountId: account.id,
        isEligible: true,
      });
      await updateAccount(deps, account.id, { status: "ENABLED" });
      const next = liveEmail();

      const updated = await updateAccount(deps, account.id, {
        email: next,
        representativeName: "Changed Email",
      });
      expect(updated).toMatchObject({
        email: next,
        status: "ENABLED",
        representativeName: "Changed Email",
      });
      expect(updated.email).not.toBe(email);
      expect((await signInAs(next)).account.id).toBe(account.id);
    });

    it("rejects an email owned by another identity without blocking anyone", async () => {
      const first = await newResident("Owner");
      const second = await newResident("Wants Owner Email");
      await createHousehold(deps, {
        identifier: `D-${unique()}`,
        representativeAccountId: second.account.id,
        isEligible: true,
      });
      await updateAccount(deps, second.account.id, { status: "ENABLED" });

      const conflict = await apiError(
        updateAccount(deps, second.account.id, { email: first.email }),
      );
      expect(conflict.code).toBe("REGISTER_CONFLICT");
      expect(conflict.context).toEqual({ reason: "DUPLICATE_EMAIL" });
      // Read the account directly: a list ordered by id would let this fail as the project grows.
      expect((await getAccount(deps, second.account.id)).status).toBe(
        "ENABLED",
      );
    });

    it("paginates with stable keyset cursors and enriches only the returned page", async () => {
      await newResident("Page A");
      await newResident("Page B");
      await newResident("Page C");

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
        const result = await listAccounts(
          deps,
          accountListQuerySchema.parse({
            limit: "2",
            ...(cursor && { cursor }),
          }),
        );
        expect(result.data.length).toBeLessThanOrEqual(2);
        expect(result.data.every((account) => account.email !== null)).toBe(
          true,
        );
        seen.push(...result.data.map((account) => account.id));
        if (!result.page.nextCursor) {
          break;
        }
        cursor = result.page.nextCursor;
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort()).toEqual(seen);
    });
  });

  describe("households", () => {
    it("reports specific conflict reasons for duplicate identifiers and double assignment", async () => {
      const a = await newResident("House A");
      const b = await newResident("House B");
      const identifier = `H-${unique()}`;
      await createHousehold(deps, {
        identifier,
        representativeAccountId: a.account.id,
        isEligible: true,
      });

      const duplicate = await apiError(
        createHousehold(deps, {
          identifier: ` ${identifier.toLowerCase()} `,
          representativeAccountId: b.account.id,
          isEligible: true,
        }),
      );
      expect(duplicate.code).toBe("REGISTER_CONFLICT");
      expect(duplicate.context).toEqual({ reason: "DUPLICATE_IDENTIFIER" });

      const assigned = await apiError(
        createHousehold(deps, {
          identifier: `H-${unique()}`,
          representativeAccountId: a.account.id,
          isEligible: true,
        }),
      );
      expect(assigned.context).toEqual({ reason: "REPRESENTATIVE_ASSIGNED" });
    });

    it("projects the representative and updates only the supplied fields", async () => {
      const rep = await newResident("Projected Rep");
      const identifier = `P-${unique()}`;
      const created = await createHousehold(deps, {
        identifier,
        representativeAccountId: rep.account.id,
        isEligible: false,
      });

      expect(created).toMatchObject({
        identifier,
        isEligible: false,
        representative: {
          name: "Projected Rep",
          email: rep.email,
          status: "SUSPENDED",
        },
      });
      const eligible = await updateHousehold(deps, created.id, {
        isEligible: true,
      });
      expect(eligible).toMatchObject({
        identifier,
        isEligible: true,
        representativeAccountId: rep.account.id,
      });
    });

    it("pages correctly through identifiers that contain filter syntax, and filters by normalised identifier", async () => {
      const marker = unique();
      const identifiers = [
        `T,${marker}`,
        `T"${marker}`,
        `T)${marker}`,
        `T(${marker}`,
      ];
      const ids: string[] = [];
      for (const identifier of identifiers) {
        const rep = await newResident("Tricky");
        ids.push(
          (
            await createHousehold(deps, {
              identifier,
              representativeAccountId: rep.account.id,
              isEligible: true,
            })
          ).id,
        );
      }

      // Find the page holding our rows with big pages (the project accumulates
      // households), then walk that neighbourhood one row at a time so a cursor
      // lands on every identifier that contains filter syntax.
      let start: string | undefined;
      let probe: string | undefined;
      let located = false;
      for (let pageNumber = 0; pageNumber < 500 && !located; pageNumber += 1) {
        const result = await listHouseholds(
          deps,
          householdListQuerySchema.parse({
            limit: "100",
            ...(probe && { cursor: probe }),
          }),
        );
        if (result.data.some((household) => ids.includes(household.id))) {
          start = probe;
          located = true;
        } else if (!result.page.nextCursor) {
          break;
        } else {
          probe = result.page.nextCursor;
        }
      }
      expect(located).toBe(true);

      const seen: string[] = [];
      let cursor = start;
      for (let pageNumber = 0; pageNumber < 400; pageNumber += 1) {
        const result = await listHouseholds(
          deps,
          householdListQuerySchema.parse({
            limit: "1",
            ...(cursor && { cursor }),
          }),
        );
        seen.push(...result.data.map((household) => household.id));
        if (!result.page.nextCursor || ids.every((id) => seen.includes(id))) {
          break;
        }
        cursor = result.page.nextCursor;
      }
      for (const id of ids) {
        expect(seen.filter((seenId) => seenId === id)).toHaveLength(1);
      }
      expect(new Set(seen).size).toBe(seen.length);

      const exact = await listHouseholds(
        deps,
        householdListQuerySchema.parse({
          identifier: `  t,${marker.toLowerCase()} `,
        }),
      );
      expect(exact.data.map((household) => household.id)).toEqual([ids[0]]);
    });

    it("filters by eligibility", async () => {
      const rep = await newResident("Not Eligible");
      const created = await createHousehold(deps, {
        identifier: `N-${unique()}`,
        representativeAccountId: rep.account.id,
        isEligible: false,
      });

      const notEligible = await listHouseholds(
        deps,
        householdListQuerySchema.parse({ isEligible: "false", limit: "100" }),
      );
      expect(notEligible.data.every((household) => !household.isEligible)).toBe(
        true,
      );
      // Combine with the exact identifier so the check cannot fall off a capped page.
      const mine = await listHouseholds(
        deps,
        householdListQuerySchema.parse({
          isEligible: "false",
          identifier: created.identifier,
        }),
      );
      expect(mine.data.map((household) => household.id)).toEqual([created.id]);
    });
  });

  describe("authorization", () => {
    it("refuses the guarded routines to a signed-in resident, even when called directly", async () => {
      const { email, account } = await newResident("Plain Resident");
      await createHousehold(deps, {
        identifier: `R-${unique()}`,
        representativeAccountId: account.id,
        isEligible: true,
      });
      await updateAccount(deps, account.id, { status: "ENABLED" });
      const { client } = await signInAs(email);
      const other = await newResident("Other");

      for (const [name, args] of [
        [
          "create_household",
          {
            p_identifier: `X-${unique()}`,
            p_representative_account_id: other.account.id,
            p_is_eligible: true,
          },
        ],
        [
          "update_household",
          { p_household_id: account.id, p_changes: { isEligible: false } },
        ],
        [
          "update_profile",
          { p_profile_id: other.account.id, p_changes: { isAdmin: true } },
        ],
      ] as const) {
        const error = await apiError(callRoutine(client, name, args));
        expect(error.code, name).toBe("FORBIDDEN");
      }
      expect(
        (
          await listAccounts(
            { ...deps, client },
            accountListQuerySchema.parse({}),
          )
        ).data,
      ).toHaveLength(1);
    });
  });
});
