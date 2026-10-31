import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createDraft,
  listSelectableHouseholds,
  updateDraft,
} from "@/server/votes/drafts";
import { activateVote, completeVoteEarly } from "@/server/votes/lifecycle";
import { submitBallot } from "@/server/votes/submission";
import type { RegisterDeps } from "@/server/register/shared";
import {
  adminClient,
  hasLive,
  hasSql,
  publicClient,
  withSql,
} from "./support/live";
import { signIn, type SignedIn } from "./support/session";
import { testTenantContext } from "../fixtures/tenant-context";

/*
 * The authorization and privacy matrix on the REAL hosted project, through the
 * Data API exactly as a browser or script would call it (anonymous, member,
 * administrator, and a still-valid token of a suspended member), plus the
 * hosted catalog: default privileges applied by the platform must not have
 * granted anything the migrations revoked.
 */
const APP_TABLES = [
  "audit_events",
  "candidates",
  "closed_tallies",
  "electorate",
  "households",
  "offices",
  "open_responses",
  "participation",
  "poll_options",
  "profiles",
  "rate_limit_buckets",
  "rwa_settings",
  "votes",
];
// Tables that hold choices, secrets or settings: NO API role reads them directly, administrators included.
// (audit_events is readable by administrators only, and participation by its owner or an administrator,
// by design; both are checked separately below.)
const NEVER_READABLE = [
  "open_responses",
  "closed_tallies",
  "rate_limit_buckets",
  "rwa_settings",
];

const outcome = async (
  request: PromiseLike<{ data: unknown; error: { code?: string } | null }>,
) => {
  const { data, error } = await request;
  return {
    rows: Array.isArray(data) ? data.length : data === null ? 0 : 1,
    code: error?.code,
  };
};

describe.skipIf(!hasLive || !hasSql)(
  "live: direct Data API authorization matrix",
  () => {
    let admin: SupabaseClient;
    let adminUser: SignedIn;
    let member: SignedIn;
    let outsider: SignedIn;
    let suspended: SignedIn;
    let adminDeps: RegisterDeps;
    let memberDeps: RegisterDeps;
    let voteId: string;
    let optionId: string;
    const anon = publicClient();

    const deps = (user: SignedIn, isAdmin: boolean): RegisterDeps => ({
      tenant: testTenantContext,
      client: user.client,
      admin,
      actor: { id: user.id, representativeName: user.name, isAdmin },
    });

    beforeAll(async () => {
      admin = adminClient();
      adminUser = await signIn(admin);
      member = await signIn(admin, { isAdmin: false, household: true });
      outsider = await signIn(admin, { isAdmin: false, household: true });
      suspended = await signIn(admin, { isAdmin: false, household: true });
      adminDeps = deps(adminUser, true);
      memberDeps = deps(member, false);

      await withSql(async (sql) => {
        if (
          (await sql.query("select 1 from public.rwa_settings")).rowCount === 0
        ) {
          await sql.query(
            "select app_private.deployment_initialize_settings('Live RWA', 'Asia/Kolkata')",
          );
        }
        for (const key of ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]) {
          if (
            (
              await sql.query(
                "select 1 from public.rwa_settings where policy_approvals ? $1",
                [key],
              )
            ).rowCount === 0
          ) {
            await sql.query(
              "select app_private.deployment_record_policy_approval($1, 'fixture-v1', now(), $2, 'FIXTURE ONLY (disposable project)', 'APPROVED')",
              [key, adminUser.id],
            );
          }
        }
        await sql.query(
          `update public.rwa_settings
            set vote_retention_days = coalesce(vote_retention_days, 365), audit_retention_days = coalesce(audit_retention_days, 365),
                inactive_profile_retention_days = coalesce(inactive_profile_retention_days, 365),
                rate_limit_retention_days = coalesce(rate_limit_retention_days, 30), backup_retention_days = coalesce(backup_retention_days, 90)
          where id = 1`,
        );
      });

      const all = await listSelectableHouseholds(adminDeps);
      const households = [member, suspended].map(
        (u) =>
          all.find((h) => h.identifier === `L-${u.id.slice(0, 8)}`)?.id ?? "",
      );
      const draft = await createDraft(adminDeps, "PUBLIC");
      const ready = await updateDraft(adminDeps, draft.id, {
        expectedRevision: 1,
        title: "Matrix vote",
        closesAt: new Date(Date.now() + 3_600_000).toISOString(),
        options: [
          { label: "Yes", position: 1 },
          { label: "No", position: 2 },
        ],
        eligibleHouseholdIds: households,
      });
      const active = await activateVote(
        adminDeps,
        ready.id,
        ready.draftRevision,
      );
      voteId = active.id;
      optionId = active.options[0]?.id ?? "";
      await submitBallot(memberDeps, voteId, { confirmed: true, optionId });
    });

    it("denies every application table to anonymous callers", async () => {
      for (const table of APP_TABLES) {
        const result = await outcome(anon.from(table).select("*").limit(1));
        expect(result, table).toMatchObject({ rows: 0 });
        expect(
          result.code,
          `${table} should be denied, not merely empty`,
        ).toBeDefined();
      }
    });

    it("denies every routine to anonymous callers", async () => {
      const routines = await withSql((sql) =>
        sql.query<{ proname: string }>(
          "select distinct proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'",
        ),
      );
      expect(routines.rows.length).toBeGreaterThan(15);
      for (const { proname } of routines.rows) {
        const { error } = await anon.rpc(proname, {});
        // Either not executable (42501) or not even exposed with these arguments (PGRST202): never a result.
        expect(error, proname).not.toBeNull();
        expect(
          ["42501", "PGRST202", "PGRST203"],
          `${proname}: ${error?.code}`,
        ).toContain(error?.code);
      }
    });

    it("never lets any signed-in role read choices, counters, settings, rate buckets or the audit log directly", async () => {
      for (const [label, client] of [
        ["member", member.client],
        ["outsider", outsider.client],
        ["administrator", adminUser.client],
      ] as const) {
        for (const table of NEVER_READABLE) {
          const result = await outcome(client.from(table).select("*").limit(1));
          expect(result.rows, `${label} reading ${table}`).toBe(0);
          expect(result.code, `${label} reading ${table}`).toBe("42501");
        }
      }
    });

    it("limits a member's direct reads to their own entitlement, and shows nobody else's participation", async () => {
      const own = await member.client.from("votes").select("id, status");
      expect(own.error).toBeNull();
      expect(own.data?.map((v) => v.id)).toContain(voteId);
      expect(own.data?.every((v) => v.status !== "DRAFT")).toBe(true);

      const none = await outsider.client
        .from("votes")
        .select("id")
        .eq("id", voteId);
      expect(none.data).toEqual([]);

      const mine = await member.client
        .from("participation")
        .select("vote_id, household_id");
      expect(mine.error).toBeNull();
      const theirs = await outsider.client
        .from("participation")
        .select("vote_id")
        .eq("vote_id", voteId);
      expect(theirs.data).toEqual([]);
      // An administrator may read who participated (that is the monitoring feature), and the
      // table holds no choice: its only columns are the vote, the household and the acceptance time.
      const asAdmin = await adminUser.client
        .from("participation")
        .select("*")
        .eq("vote_id", voteId);
      expect(asAdmin.error).toBeNull();
      expect(asAdmin.data).toHaveLength(1);
      expect(Object.keys(asAdmin.data?.[0] ?? {}).sort()).toEqual([
        "accepted_at",
        "household_id",
        "vote_id",
      ]);

      // The audit log is administrator-only: members see no rows at all.
      for (const client of [member.client, outsider.client]) {
        const audit = await client.from("audit_events").select("id").limit(1);
        expect(audit.data ?? []).toEqual([]);
      }
      const adminAudit = await adminUser.client
        .from("audit_events")
        .select("id")
        .limit(1);
      expect(adminAudit.error).toBeNull();
      expect(adminAudit.data?.length).toBe(1);

      // Direct writes are impossible for every API role.
      for (const client of [anon, member.client, adminUser.client]) {
        for (const table of [
          "votes",
          "participation",
          "open_responses",
          "audit_events",
          "profiles",
        ]) {
          const result = await client.from(table).insert({}).select();
          expect(result.error, table).not.toBeNull();
        }
      }
    });

    it("keeps a still-valid token of a suspended member out of every vote path", async () => {
      await withSql(async (sql) => {
        await sql.query("begin");
        await sql.query("set local role cp_owner");
        await sql.query(
          "update public.profiles set status = 'SUSPENDED' where id = $1",
          [suspended.id],
        );
        await sql.query("commit");
      });
      const rpc = await suspended.client.rpc("get_member_vote", {
        p_vote_id: voteId,
      });
      expect(rpc.error?.message).toBe("FORBIDDEN");
      const cast = await suspended.client.rpc("cast_vote", {
        p_vote_id: voteId,
        p_submission: { confirmed: true, optionId },
      });
      expect(cast.error?.message).toBe("FORBIDDEN");
      const list = await suspended.client.rpc("list_member_votes", {});
      expect(list.error?.message).toBe("FORBIDDEN");
    });

    it("keeps the hosted privileges exactly as the migrations define them", async () => {
      const rows = await withSql(async (sql) => {
        const executable = async (role: string) =>
          (
            await sql.query<{ name: string }>(
              `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public','app_private') and has_function_privilege($1, p.oid, 'EXECUTE')
                and p.prokind = 'f' and p.proowner = (select oid from pg_roles where rolname = 'cp_owner')
              order by 1`,
              [role],
            )
          ).rows.map((r) => r.name);
        const tablePrivileges = await sql.query<{
          role: string;
          table_name: string;
          privilege: string;
        }>(
          `select r.role, t.table_name, p.privilege
           from unnest(array['anon','authenticated']) as r(role)
           cross join unnest($1::text[]) as t(table_name)
           cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(privilege)
          where has_table_privilege(r.role, 'public.' || t.table_name, p.privilege)`,
          [APP_TABLES],
        );
        const published = await sql.query(
          "select 1 from pg_publication_tables where schemaname = 'public'",
        );
        return {
          anon: await executable("anon"),
          service: await executable("service_role"),
          scheduler: await executable("cp_scheduler"),
          writes: tablePrivileges.rows,
          published: published.rowCount,
        };
      });
      expect(rows.anon).toEqual([]);
      expect(rows.service).toEqual([
        "consume_rate_limit",
        "enable_profile",
        "get_public_rwa_identity",
        "get_self_registration_households",
        "health_ping",
        "operational_status",
        "provision_profile",
        "provision_profile_with_household",
        "reconcile_vote",
        "self_register_resident",
        "set_app_support_access",
      ]);
      expect(rows.scheduler).toEqual(["complete_due_votes", "run_maintenance"]);
      // No write-class privilege on any application table for the API roles.
      expect(rows.writes).toEqual([]);
      // Nothing is published to Realtime / logical replication.
      expect(rows.published).toBe(0);
    });

    it("returns completed results only through the guarded routine, never the raw tables, to a member", async () => {
      await completeVoteEarly(adminDeps, voteId, "Matrix completion");
      const raw = await member.client.from("open_responses").select("*");
      expect(raw.error?.code).toBe("42501");
      const results = await member.client.rpc("get_vote_results", {
        p_vote_id: voteId,
        p_limit: 50,
      });
      expect(results.error).toBeNull();
      const text = JSON.stringify(results.data);
      // Names and household identifiers of a PUBLIC vote are public to the electorate; emails and ids of profiles never are.
      expect(text).not.toMatch(/@|profile_id|auth_user/iu);
    });
  },
);
