import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { enforceRateLimit } from "@/server/auth/rate-limit";
import { requestCode, verifyCode } from "@/server/auth/otp";
import {
  getVerifiedUserId,
  loadEnabledAccount,
  requireAccount,
  requireAdmin,
} from "@/server/authorization/account";
import {
  enableAccount,
  provisionAccount,
} from "@/server/register/provisioning";
import { CODE_RESEND_SECONDS } from "@/shared/contracts/auth";
import {
  adminClient,
  emailOtp,
  hasLive,
  hasSql,
  liveEmail,
  publicClient,
  withSql,
} from "./support/live";
import { apiError, authUserExists, signIn } from "./support/session";

/*
 * Real Supabase Auth + PostgREST. Exercises the actual service code with real
 * clients. The hosted project is disposable: users created here cannot be
 * deleted afterwards (profiles and audit events restrict deletion by design),
 * so delete or reset the project when finished.
 */
const TABLES = [
  "rwa_settings",
  "profiles",
  "households",
  "votes",
  "offices",
  "candidates",
  "poll_options",
  "electorate",
  "participation",
  "open_responses",
  "closed_tallies",
  "audit_events",
  "rate_limit_buckets",
];
const PERMISSION_DENIED = "42501";

describe.skipIf(!hasLive)("live: Supabase Auth and API posture", () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = adminClient();
  });

  describe("sign-up is disabled", () => {
    it("rejects password sign-up and OTP sign-up and creates no user", async () => {
      const anon = publicClient();
      const email = liveEmail();

      const password = await anon.auth.signUp({
        email,
        password: "Str0ng-Passw0rd-123!",
      });
      expect(password.error).not.toBeNull();

      const otp = await anon.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      expect(otp.error).not.toBeNull();

      expect(await authUserExists(admin, email)).toBe(false);
    });
  });

  describe("direct Data API access", () => {
    it("denies anonymous reads of every application table", async () => {
      const anon = publicClient();
      for (const table of TABLES) {
        const result = await anon.from(table).select("*").limit(1);
        expect(result.data, table).toBeNull();
        expect(result.error?.code, table).toBe(PERMISSION_DENIED);
      }
    });

    it("denies anonymous calls to server-only routines", async () => {
      const anon = publicClient();
      const calls = [
        anon.rpc("provision_profile", {
          p_auth_user_id: "00000000-0000-4000-8000-000000000000",
          p_representative_name: "X",
        }),
        anon.rpc("enable_profile", {
          p_profile_id: "00000000-0000-4000-8000-000000000000",
        }),
        anon.rpc("consume_rate_limit", {
          p_scope: "x",
          p_subject_digests: [],
          p_key_versions: [],
          p_limit: 1,
          p_window_seconds: 60,
        }),
      ];
      for (const result of await Promise.all(calls)) {
        expect(result.error).not.toBeNull();
      }
    });

    it("gives even the service-role key no table access", async () => {
      for (const table of [
        "profiles",
        "votes",
        "open_responses",
        "closed_tallies",
      ]) {
        const result = await admin.from(table).select("*").limit(1);
        expect(result.error?.code, table).toBe(PERMISSION_DENIED);
      }
    });
  });

  describe("provisioning against real Auth", () => {
    it("is retry-safe, reuses the Auth identity and rejects disagreeing retries", async () => {
      const email = liveEmail();
      const input = {
        email,
        representativeName: "Prov Tester",
        isAdmin: true,
        actorProfileId: null,
      };

      const first = await provisionAccount(admin, input);
      expect(first).toMatchObject({
        authIdentity: "created",
        profile: "created",
      });

      const retry = await provisionAccount(admin, input);
      expect(retry).toEqual({
        accountId: first.accountId,
        authIdentity: "existing",
        profile: "existing",
      });

      const conflict = await apiError(
        provisionAccount(admin, {
          ...input,
          representativeName: "Someone Else",
        }),
      );
      expect(conflict.code).toBe("REGISTER_CONFLICT");

      // Suspended until explicitly enabled: no application access yet.
      const client = publicClient();
      await verifyCode(
        { client, admin },
        email,
        await emailOtp(admin, email),
      ).catch(() => undefined);
      expect(await getVerifiedUserId(client)).toBeNull();
    });

    it("finishes a half-provisioned identity (Auth identity without a profile)", async () => {
      const email = liveEmail();
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      expect(created.error).toBeNull();

      const result = await provisionAccount(admin, {
        email,
        representativeName: "Half Done",
        isAdmin: false,
        actorProfileId: null,
      });
      expect(result).toMatchObject({
        authIdentity: "existing",
        profile: "created",
        accountId: created.data.user?.id,
      });
    });
  });

  describe("code issuance and verification", () => {
    it("issues six-digit codes", async () => {
      const email = liveEmail();
      await admin.auth.admin.createUser({ email, email_confirm: true });
      expect(await emailOtp(admin, email)).toMatch(/^\d{6}$/u);
    });

    it("acknowledges unknown addresses generically, slowly enough to mask timing, and creates no user", async () => {
      const email = liveEmail();
      const started = Date.now();
      const result = await requestCode(
        { client: publicClient(), admin },
        email,
      );

      expect(result).toEqual({ resendAfterSeconds: CODE_RESEND_SECONDS });
      expect(Date.now() - started).toBeGreaterThanOrEqual(700);
      expect(await authUserExists(admin, email)).toBe(false);
    });

    it("verifies once: success, then replay and wrong codes are indistinguishable failures", async () => {
      const email = liveEmail();
      const provisioned = await provisionAccount(admin, {
        email,
        representativeName: "Replay Tester",
        isAdmin: true,
        actorProfileId: null,
      });
      await enableAccount(admin, provisioned.accountId, null);

      const code = await emailOtp(admin, email);
      const client = publicClient();
      const account = await verifyCode({ client, admin }, email, code);
      expect(account).toEqual({
        id: provisioned.accountId,
        representativeName: "Replay Tester",
        isAdmin: true,
      });
      expect(await getVerifiedUserId(client)).toBe(provisioned.accountId);

      const replay = await apiError(
        verifyCode({ client: publicClient(), admin }, email, code),
      );
      const wrong = await apiError(
        verifyCode({ client: publicClient(), admin }, email, "000000"),
      );
      expect(replay.code).toBe("CODE_INVALID_OR_EXPIRED");
      expect(wrong.code).toBe("CODE_INVALID_OR_EXPIRED");
      expect(replay.message).toBe(wrong.message);
    });

    it("refuses an Auth session without an enabled profile and signs it out", async () => {
      const suspendedEmail = liveEmail();
      await provisionAccount(admin, {
        email: suspendedEmail,
        representativeName: "Still Suspended",
        isAdmin: true,
        actorProfileId: null,
      });
      const noProfileEmail = liveEmail();
      await admin.auth.admin.createUser({
        email: noProfileEmail,
        email_confirm: true,
      });

      for (const email of [suspendedEmail, noProfileEmail]) {
        const client = publicClient();
        const error = await apiError(
          verifyCode({ client, admin }, email, await emailOtp(admin, email)),
        );
        expect(error.code).toBe("FORBIDDEN");
        expect(await getVerifiedUserId(client)).toBeNull();
      }
    });
  });

  describe("signed-in posture over the real Data API", () => {
    it("lets an administrator read profiles for register administration", async () => {
      const user = await signIn(admin);

      const profiles = await user.client.from("profiles").select("id");
      expect(profiles.error).toBeNull();
      expect(profiles.data?.map((row) => row.id)).toContain(user.id);
    });

    it.skipIf(!hasSql)(
      "lets a member read only their profile and blocks every write and private table",
      async () => {
        const user = await signIn(admin, { isAdmin: false, household: true });

        const own = await user.client.from("profiles").select("id");
        expect(own.data).toEqual([{ id: user.id }]);
        expect(
          (await user.client.from("households").select("id")).data,
        ).toEqual([]);

        const writes = [
          user.client
            .from("profiles")
            .update({ is_admin: true })
            .eq("id", user.id),
          user.client
            .from("votes")
            .insert({ voting_type: "PUBLIC", created_by_profile_id: user.id }),
          user.client.from("audit_events").delete().gte("id", 0),
        ];
        for (const result of await Promise.all(writes)) {
          expect(result.error?.code).toBe(PERMISSION_DENIED);
        }

        for (const table of [
          "open_responses",
          "closed_tallies",
          "rwa_settings",
          "rate_limit_buckets",
        ]) {
          const result = await user.client.from(table).select("*").limit(1);
          expect(result.error?.code, table).toBe(PERMISSION_DENIED);
        }
        const creator = await user.client
          .from("votes")
          .select("created_by_profile_id");
        expect(creator.error?.code).toBe(PERMISSION_DENIED);

        const rpc = await user.client.rpc("provision_profile", {
          p_auth_user_id: user.id,
          p_representative_name: "Mallory",
          p_is_admin: true,
        });
        expect(rpc.error).not.toBeNull();
      },
    );

    it("does not treat user-editable Auth metadata as authorization", async () => {
      if (!hasSql) {
        return;
      }
      const user = await signIn(admin, { isAdmin: false, household: true });
      await user.client.auth.updateUser({
        data: { is_admin: true, role: "admin" },
      });

      expect((await requireAccount(user.client)).account.isAdmin).toBe(false);
      expect((await apiError(requireAdmin(user.client))).code).toBe(
        "FORBIDDEN",
      );
    });
  });

  describe.skipIf(!hasSql)(
    "current profile overrides a still-valid session",
    () => {
      it("applies suspension and role changes immediately without a new token", async () => {
        const user = await signIn(admin, { isAdmin: false, household: true });
        const setProfile = (sql: string) =>
          withSql((client) => client.query(sql, [user.id]));

        expect(await loadEnabledAccount(user.client, user.id)).toMatchObject({
          isAdmin: false,
        });

        await setProfile(
          "update public.profiles set status = 'SUSPENDED' where id = $1",
        );
        expect(await getVerifiedUserId(user.client)).toBe(user.id); // the JWT itself is still valid
        expect(await loadEnabledAccount(user.client, user.id)).toBeNull();
        expect((await apiError(requireAccount(user.client))).code).toBe(
          "FORBIDDEN",
        );
        expect((await user.client.from("votes").select("id")).data).toEqual([]);

        await setProfile(
          "update public.profiles set status = 'ENABLED' where id = $1",
        );
        expect((await requireAccount(user.client)).account.isAdmin).toBe(false);

        await setProfile(
          "update public.profiles set is_admin = true where id = $1",
        );
        expect((await requireAdmin(user.client)).account.isAdmin).toBe(true);
        await setProfile(
          "update public.profiles set is_admin = false where id = $1",
        );
        expect((await apiError(requireAdmin(user.client))).code).toBe(
          "FORBIDDEN",
        );
      });

      it("recorded audit events for provisioning and enabling", async () => {
        const user = await signIn(admin);
        const events = await withSql((client) =>
          client.query<{ action: string }>(
            "select action from public.audit_events where target_id = $1 order by id",
            [user.id],
          ),
        );
        expect(events.rows.map((row) => row.action)).toEqual([
          "PROFILE_PROVISIONED",
          "PROFILE_STATUS_CHANGED",
        ]);
      });
    },
  );

  describe("supplemental rate limiting over the real API", () => {
    it("meters digests passed as bytea arrays and reports a whole-second retry", async () => {
      // Fixed one-minute windows: avoid straddling a boundary.
      const second = new Date().getUTCSeconds();
      if (second >= 52) {
        await new Promise((resolve) =>
          setTimeout(resolve, (61 - second) * 1000),
        );
      }
      const policy = { scope: "live.test", limit: 2, windowSeconds: 60 };
      const subject = liveEmail();

      await enforceRateLimit(admin, policy, "email", subject);
      await enforceRateLimit(admin, policy, "email", subject);
      const limited = await apiError(
        enforceRateLimit(admin, policy, "email", subject),
      );

      expect(limited.code).toBe("RATE_LIMITED");
      expect(limited.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(limited.retryAfterSeconds).toBeLessThanOrEqual(60);
    });
  });
});
