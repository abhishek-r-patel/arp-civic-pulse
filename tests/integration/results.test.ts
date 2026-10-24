import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderResultsCsv } from "@/server/exports/csv";
import { projectResults, rawResultsSchema } from "@/shared/contracts/results";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  newAuthUser,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";
import { votingApi, type Detail } from "./support/votes";

const UNKNOWN = "00000000-0000-4000-8000-000000000099";
const PERMISSION_DENIED = "42501";

interface Named {
  representativeName: string;
  householdIdentifier: string;
  optionLabel: string;
  cursor: { key: string; householdId: string };
}
interface Results {
  eligibleCount: string;
  submittedCount: string;
  vote: Record<string, unknown>;
  options: { id: string; label: string; count: string }[];
  offices: {
    id: string;
    name: string;
    abstentionCount: string;
    candidates: { id: string; name: string; count: string }[];
  }[];
  namedResponses: Named[] | null;
  namedPage: { hasMore: boolean } | null;
}
interface Listing {
  rows: {
    id: string;
    status: string;
    submitted: boolean;
    cursor: { rank: number; key: string; id: string };
  }[];
  hasMore: boolean;
}

describe.skipIf(!hasDatabase)(
  "member votes, results, monitoring, audit",
  () => {
    let db: TestDatabase;
    let world: World;
    let api: ReturnType<typeof votingApi>;

    beforeAll(async () => {
      db = await createTestDatabase();
      world = await seedWorld(db);
      api = votingApi(db, world);
      await api.setupPolicy();
    });
    afterAll(async () => {
      await db?.drop();
    });

    const alice = () => world.alice.id;
    const bob = () => world.bob.id;
    const dave = () => world.dave.id;
    const admin = () => world.admin.id;

    const finish = (voteId: string) =>
      api.call(
        admin(),
        "public.complete_vote_early($1, true, 'Quorum reached')",
        [voteId],
      );
    const results = (sub: string | null, voteId: string) =>
      api.call<Results>(sub, "public.get_vote_results($1)", [voteId]);
    const choose = (vote: Detail, index: number) => ({
      confirmed: true,
      optionId: vote.options[index]?.id,
    });
    const closedBallot = (
      vote: Detail,
      picks: [number | null, number | null],
    ) => ({
      confirmed: true,
      selections: vote.offices.map((office, i) => ({
        officeId: office.id,
        candidateId:
          picks[i] === null ? null : office.candidates[picks[i] as number]?.id,
      })),
    });

    describe("completed results", () => {
      it("returns exact totals and the frozen named list for a completed open poll", async () => {
        const vote = await api.activeVote("OPEN");
        await api.cast(alice(), vote.id, choose(vote, 0));
        await api.cast(bob(), vote.id, choose(vote, 1));
        await finish(vote.id);

        const r = await results(alice(), vote.id);
        expect(r.eligibleCount).toBe("3");
        expect(r.submittedCount).toBe("2");
        expect(r.options.map((o) => [o.label, o.count])).toEqual([
          ["Yes", "1"],
          ["No", "1"],
        ]);
        expect(
          r.namedResponses?.map((n) => [n.householdIdentifier, n.optionLabel]),
        ).toEqual([
          ["A-101", "Yes"],
          ["B-202", "No"],
        ]);
        // Never an email, an id of the profile, or a timestamp.
        expect(JSON.stringify(r)).not.toMatch(/@|accepted_at|profile/iu);
        expect(r.offices).toEqual([]);
      });

      it("returns aggregates only, with no identities, for a completed closed vote", async () => {
        const vote = await api.activeVote("CLOSED");
        await api.cast(alice(), vote.id, closedBallot(vote, [0, 0]));
        await api.cast(bob(), vote.id, closedBallot(vote, [1, null]));
        await api.cast(dave(), vote.id, closedBallot(vote, [null, null]));
        await finish(vote.id);

        const r = await results(admin(), vote.id);
        expect(r.submittedCount).toBe("3");
        expect(r.namedResponses).toBeNull();
        expect(r.namedPage).toBeNull();
        const [chair, treasurer] = r.offices;
        expect(chair?.candidates.map((c) => c.count)).toEqual(["1", "1"]);
        expect(chair?.abstentionCount).toBe("1");
        expect(treasurer?.candidates.map((c) => c.count)).toEqual(["1"]);
        expect(treasurer?.abstentionCount).toBe("2");
        const text = JSON.stringify(r);
        for (const name of [
          "Alice",
          "Bob",
          "Dave",
          "A-101",
          "B-202",
          "D-404",
        ]) {
          expect(text).not.toContain(name);
        }
      });

      it("keeps frozen identities after the register is edited, and counts a later-suspended household", async () => {
        const vote = await api.activeVote("OPEN");
        await api.cast(alice(), vote.id, choose(vote, 0));
        await finish(vote.id);
        await db.asOwner(async (c) => {
          await c.query(
            "update public.profiles set representative_name = 'Renamed Person' where id = $1",
            [alice()],
          );
          await c.query(
            "update public.households set identifier = 'Z-999', identifier_normalized = 'z-999' where id = $1",
            [world.alice.householdId],
          );
          await c.query(
            "update public.profiles set status = 'SUSPENDED' where id = $1",
            [dave()],
          );
        });

        const r = await results(bob(), vote.id);
        expect(r.eligibleCount).toBe("3");
        expect(r.namedResponses?.[0]).toMatchObject({
          representativeName: "Alice Rao",
          householdIdentifier: "A-101",
        });

        // Restore for later tests.
        await db.asOwner(async (c) => {
          await c.query(
            "update public.profiles set representative_name = 'Alice Rao' where id = $1",
            [alice()],
          );
          await c.query(
            "update public.households set identifier = 'A-101', identifier_normalized = 'a-101' where id = $1",
            [world.alice.householdId],
          );
          await c.query(
            "update public.profiles set status = 'ENABLED' where id = $1",
            [dave()],
          );
        });
      });

      it("reports a zero-turnout poll without inventing a winner", async () => {
        const vote = await api.activeVote("OPEN");
        await finish(vote.id);
        const r = await results(alice(), vote.id);
        expect(r.submittedCount).toBe("0");
        expect(r.options.map((o) => o.count)).toEqual(["0", "0"]);
        expect(r.namedResponses).toEqual([]);
      });

      it("pages the named list without changing any total", async () => {
        const vote = await api.activeVote("OPEN");
        await api.cast(alice(), vote.id, choose(vote, 0));
        await api.cast(bob(), vote.id, choose(vote, 0));
        await api.cast(dave(), vote.id, choose(vote, 1));
        await finish(vote.id);

        const first = await api.call<Results>(
          alice(),
          "public.get_vote_results($1, 2)",
          [vote.id],
        );
        expect(first.namedResponses).toHaveLength(2);
        expect(first.namedPage?.hasMore).toBe(true);
        const last = first.namedResponses?.[1] as Named;
        const second = await api.call<Results>(
          alice(),
          "public.get_vote_results($1, 2, $2, $3::uuid)",
          [vote.id, last.cursor.key, last.cursor.householdId],
        );
        expect(
          second.namedResponses?.map((n) => n.householdIdentifier),
        ).toEqual(["D-404"]);
        expect(second.namedPage?.hasMore).toBe(false);
        for (const page of [first, second]) {
          expect(page.submittedCount).toBe("3");
          expect(page.options.map((o) => o.count)).toEqual(["2", "1"]);
        }
        // The export reads the whole list in one call.
        const all = await results(admin(), vote.id);
        expect(all.namedResponses).toHaveLength(3);
      });
    });

    describe("withholding", () => {
      it("refuses results until a vote is completed, even for an administrator", async () => {
        const vote = await api.activeVote("OPEN");
        await api.cast(alice(), vote.id, choose(vote, 0));
        for (const sub of [alice(), bob(), admin()]) {
          const error = await dbError(results(sub, vote.id));
          expect(error.message).toBe("RESULTS_UNAVAILABLE");
          expect(error.detail).toBe("ACTIVE");
        }
        await api.call(
          admin(),
          "public.cancel_vote($1, true, 'Wrong electorate')",
          [vote.id],
        );
        expect((await dbError(results(alice(), vote.id))).detail).toBe(
          "CANCELLED",
        );
      });

      it("answers not found for a draft, an unknown vote and a member outside the electorate", async () => {
        const draft = await api.call<Detail>(
          admin(),
          "public.create_draft('OPEN')",
        );
        const vote = await api.activeVote("OPEN", {
          people: [world.alice, world.bob],
        });
        await finish(vote.id);

        for (const [sub, id] of [
          [admin(), draft.id],
          [alice(), UNKNOWN],
          [dave(), vote.id],
        ] as const) {
          expect((await dbError(results(sub, id))).message).toBe("NOT_FOUND");
        }
        // An administrator without an entitlement may read a completed result.
        expect((await results(admin(), vote.id)).eligibleCount).toBe("2");
      });

      it("refuses anonymous, suspended and unknown callers", async () => {
        const vote = await api.activeVote("OPEN");
        await finish(vote.id);
        expect((await dbError(results(null, vote.id))).code).toBe(
          PERMISSION_DENIED,
        );
        for (const sub of [world.carol.id, UNKNOWN]) {
          expect((await dbError(results(sub, vote.id))).message).toBe(
            "FORBIDDEN",
          );
        }
      });

      it("blocks publication when counters and participation disagree", async () => {
        const vote = await api.activeVote("CLOSED");
        await api.cast(alice(), vote.id, closedBallot(vote, [0, 0]));
        await finish(vote.id);
        await db.asSuperuser(async (c) => {
          await c.query("begin");
          await c.query("set local session_replication_role = replica");
          await c.query(
            "update public.closed_tallies set accepted_count = accepted_count + 1 where vote_id = $1 and candidate_id is not null",
            [vote.id],
          );
          await c.query("commit");
        });
        expect((await dbError(results(alice(), vote.id))).message).toBe(
          "RESULTS_INTEGRITY_ERROR",
        );
      });

      it("validates paging arguments", async () => {
        const vote = await api.activeVote("OPEN");
        await finish(vote.id);
        for (const sql of [
          "public.get_vote_results($1, 0)",
          "public.get_vote_results($1, 1001)",
          "public.get_vote_results($1, 5, 'A-1', null)",
        ]) {
          expect(
            (await dbError(api.call(alice(), sql, [vote.id]))).message,
          ).toBe("VALIDATION_FAILED");
        }
      });
    });

    describe("member discovery", () => {
      it("lists only the caller's own non-draft votes, with only their own submission flag", async () => {
        await api.call(admin(), "public.create_draft('OPEN')");
        const mine = await api.activeVote("OPEN", { people: [world.alice] });
        const others = await api.activeVote("OPEN", { people: [world.bob] });
        await api.cast(alice(), mine.id, choose(mine, 0));

        const alices = await api.call<Listing>(
          alice(),
          "public.list_member_votes()",
        );
        const ids = alices.rows.map((r) => r.id);
        expect(ids).toContain(mine.id);
        expect(ids).not.toContain(others.id);
        expect(alices.rows.every((r) => r.status !== "DRAFT")).toBe(true);
        expect(alices.rows.find((r) => r.id === mine.id)?.submitted).toBe(true);

        const bobs = await api.call<Listing>(
          bob(),
          "public.list_member_votes()",
        );
        expect(bobs.rows.find((r) => r.id === mine.id)).toBeUndefined();
        expect(bobs.rows.find((r) => r.id === others.id)?.submitted).toBe(
          false,
        );

        const none = await api
          .call<Listing>(world.carol.id, "public.list_member_votes()")
          .catch((e: Error) => e.message);
        expect(none).toBe("FORBIDDEN");
      });

      it("lists active votes before finished ones and pages without gaps or repeats", async () => {
        const people = [world.dave];
        const a = await api.activeVote("OPEN", {
          people,
          closesInMs: 7_200_000,
        });
        const b = await api.activeVote("OPEN", {
          people,
          closesInMs: 3_600_000,
        });
        const c = await api.activeVote("OPEN", { people });
        await finish(c.id);

        const seen: string[] = [];
        let cursor: Listing["rows"][number]["cursor"] | null = null;
        for (let guard = 0; guard < 50; guard += 1) {
          const page: Listing = cursor
            ? await api.call<Listing>(
                dave(),
                "public.list_member_votes(null, null, 2, $1, $2::bigint, $3::uuid)",
                [cursor.rank, cursor.key, cursor.id],
              )
            : await api.call<Listing>(
                dave(),
                "public.list_member_votes(null, null, 2)",
              );
          seen.push(...page.rows.map((r) => r.id));
          if (!page.hasMore) {
            break;
          }
          cursor = page.rows[page.rows.length - 1]?.cursor ?? null;
        }
        expect(new Set(seen).size).toBe(seen.length);
        const rank = (id: string) => seen.indexOf(id);
        expect(rank(b.id)).toBeLessThan(rank(a.id));
        expect(rank(a.id)).toBeLessThan(rank(c.id));

        const completed = await api.call<Listing>(
          dave(),
          "public.list_member_votes('COMPLETED')",
        );
        expect(completed.rows.every((r) => r.status === "COMPLETED")).toBe(
          true,
        );
      });

      it("rejects malformed filters and a half cursor", async () => {
        for (const sql of [
          "public.list_member_votes('DRAFT')",
          "public.list_member_votes(null, 'OTHER')",
          "public.list_member_votes(null, null, 0)",
          "public.list_member_votes(null, null, 101)",
          "public.list_member_votes(null, null, 5, 0)",
        ]) {
          expect((await dbError(api.call(alice(), sql))).message).toBe(
            "VALIDATION_FAILED",
          );
        }
      });
    });

    describe("member vote detail", () => {
      it("shows the ballot and own state, and stops offering submission after the vote is cast", async () => {
        const vote = await api.activeVote("CLOSED", {
          people: [world.alice, world.bob],
        });
        const before = await api.call<Record<string, unknown>>(
          alice(),
          "public.get_member_vote($1)",
          [vote.id],
        );
        expect(before).toMatchObject({
          entitled: true,
          submitted: false,
          canSubmit: true,
        });
        expect(before.exportFormats).toEqual([]);
        expect(before.rwaName).toBe("Lakeview RWA");

        await api.cast(alice(), vote.id, closedBallot(vote, [0, 0]));
        const after = await api.call<Record<string, unknown>>(
          alice(),
          "public.get_member_vote($1)",
          [vote.id],
        );
        expect(after).toMatchObject({ submitted: true, canSubmit: false });

        // No electorate, counters or other households are projected.
        const keys = Object.keys(after).join(" ");
        expect(keys).not.toMatch(
          /electorate|tally|count|participation|household/iu,
        );

        await finish(vote.id);
        const done = await api.call<Record<string, unknown>>(
          bob(),
          "public.get_member_vote($1)",
          [vote.id],
        );
        expect(done).toMatchObject({
          status: "COMPLETED",
          canSubmit: false,
          exportFormats: ["csv"],
        });
      });

      it("answers not found for outsiders, drafts and unknown votes; an administrator gets no submission state", async () => {
        const draft = await api.call<Detail>(
          admin(),
          "public.create_draft('OPEN')",
        );
        const vote = await api.activeVote("OPEN", { people: [world.alice] });
        for (const [sub, id] of [
          [bob(), vote.id],
          [admin(), draft.id],
          [alice(), UNKNOWN],
        ] as const) {
          expect(
            (await dbError(api.call(sub, "public.get_member_vote($1)", [id])))
              .message,
          ).toBe("NOT_FOUND");
        }
        const asAdmin = await api.call<Record<string, unknown>>(
          admin(),
          "public.get_member_vote($1)",
          [vote.id],
        );
        expect(asAdmin).toMatchObject({
          entitled: false,
          submitted: null,
          canSubmit: false,
        });
      });

      it("does not offer submission after the deadline even before Cron completes the vote", async () => {
        const vote = await api.activeVote("OPEN", {
          people: [world.alice],
          closesInMs: 1_500,
        });
        await new Promise((resolve) => setTimeout(resolve, 1_800));
        const detail = await api.call<Record<string, unknown>>(
          alice(),
          "public.get_member_vote($1)",
          [vote.id],
        );
        expect(detail).toMatchObject({ status: "ACTIVE", canSubmit: false });
      });
    });

    describe("administrator participation monitoring", () => {
      it("lists frozen names and identifiers with a submitted flag, and never choices or times", async () => {
        const vote = await api.activeVote("OPEN");
        await api.cast(alice(), vote.id, choose(vote, 0));

        const all = await api.call<{
          eligibleCount: string;
          submittedCount: string;
          rows: { householdIdentifier: string; submitted: boolean }[];
          hasMore: boolean;
        }>(admin(), "public.get_vote_participation($1)", [vote.id]);
        expect(all.eligibleCount).toBe("3");
        expect(all.submittedCount).toBe("1");
        expect(
          all.rows.map((r) => [r.householdIdentifier, r.submitted]),
        ).toEqual([
          ["A-101", true],
          ["B-202", false],
          ["D-404", false],
        ]);
        expect(JSON.stringify(all)).not.toMatch(/optionId|accepted|@|choice/iu);

        const pending = await api.call<typeof all>(
          admin(),
          "public.get_vote_participation($1, false, 1)",
          [vote.id],
        );
        expect(pending.rows).toHaveLength(1);
        expect(pending.hasMore).toBe(true);
      });

      it("refuses members, anonymous callers and drafts", async () => {
        const draft = await api.call<Detail>(
          admin(),
          "public.create_draft('OPEN')",
        );
        const vote = await api.activeVote("OPEN");
        expect(
          (
            await dbError(
              api.call(alice(), "public.get_vote_participation($1)", [vote.id]),
            )
          ).message,
        ).toBe("FORBIDDEN");
        expect(
          (
            await dbError(
              api.call(null, "public.get_vote_participation($1)", [vote.id]),
            )
          ).code,
        ).toBe(PERMISSION_DENIED);
        expect(
          (
            await dbError(
              api.call(admin(), "public.get_vote_participation($1)", [
                draft.id,
              ]),
            )
          ).message,
        ).toBe("LIFECYCLE_CONFLICT");
        expect(
          (
            await dbError(
              api.call(admin(), "public.get_vote_participation($1)", [UNKNOWN]),
            )
          ).message,
        ).toBe("NOT_FOUND");
      });
    });

    describe("audit history", () => {
      it("is administrator-only and pages newest first", async () => {
        expect(
          (await dbError(api.call(alice(), "public.list_audit_events()")))
            .message,
        ).toBe("FORBIDDEN");
        expect(
          (await dbError(api.call(null, "public.list_audit_events()"))).code,
        ).toBe(PERMISSION_DENIED);

        const first = await api.call<{
          rows: { id: string; action: string }[];
          hasMore: boolean;
        }>(admin(), "public.list_audit_events(3)");
        expect(first.rows).toHaveLength(3);
        expect(first.hasMore).toBe(true);
        const ids = first.rows.map((r) => BigInt(r.id));
        expect(ids).toEqual([...ids].sort((x, y) => (x > y ? -1 : 1)));

        const next = await api.call<typeof first>(
          admin(),
          "public.list_audit_events(3, $1::bigint)",
          [first.rows[2]?.id],
        );
        expect(BigInt(next.rows[0]?.id ?? 0)).toBeLessThan(ids[2] as bigint);
      });

      it("filters, and exposes only allowlisted detail keys", async () => {
        await db.asOwner((c) =>
          c.query(
            `select app_private.append_audit('DEPLOYMENT', null, 'SETTINGS_INITIALIZED', 'SETTINGS', '1', null,
             '{"timezone":"Asia/Kolkata","otp":"123456","ballot":"x","delta":3}'::jsonb)`,
          ),
        );
        const filtered = await api.call<{
          rows: {
            action: string;
            details: Record<string, unknown>;
            actorName: string | null;
          }[];
        }>(
          admin(),
          "public.list_audit_events(100, null, 'SETTINGS_INITIALIZED', 'SETTINGS')",
        );
        expect(filtered.rows.length).toBeGreaterThan(0);
        expect(
          filtered.rows.every((r) => r.action === "SETTINGS_INITIALIZED"),
        ).toBe(true);
        const text = JSON.stringify(filtered);
        expect(text).toContain("Asia/Kolkata");
        expect(text).not.toMatch(/123456|ballot|delta|otp/u);

        const profile = await api.call<{
          rows: { actorName: string | null }[];
        }>(admin(), "public.list_audit_events(100, null, 'VOTE_ACTIVATED')");
        expect(profile.rows[0]?.actorName).toBe("Asha Admin");
      });

      it("rejects an inverted time range and an oversized page", async () => {
        for (const sql of [
          "public.list_audit_events(0)",
          "public.list_audit_events(101)",
          "public.list_audit_events(10, null, null, null, now(), now() - interval '1 day')",
        ]) {
          expect((await dbError(api.call(admin(), sql))).message).toBe(
            "VALIDATION_FAILED",
          );
        }
      });
    });

    describe("export at pilot scale", () => {
      it("renders a complete, rectangular CSV for 500 households, with every named response", async () => {
        const HOUSEHOLDS = 500;
        const people = await db.asSuperuser(async (c) => {
          const ids: string[] = [];
          for (let i = 0; i < HOUSEHOLDS; i += 1) {
            ids.push(await newAuthUser(c));
          }
          return ids;
        });
        const world500 = await db.asOwner(async (c) => {
          const out: { id: string; householdId: string }[] = [];
          for (const [index, id] of people.entries()) {
            await c.query(
              "insert into public.profiles (id, representative_name, status) values ($1, $2, 'ENABLED')",
              [id, `=Resident ${String(index).padStart(3, "0")}, "Quoted"`],
            );
            const household = await c.query<{ id: string }>(
              `insert into public.households (identifier, identifier_normalized, representative_profile_id, is_eligible)
             values ($1, app_private.normalize_key($1), $2, true) returning id`,
              [`H-${String(index).padStart(4, "0")}`, id],
            );
            out.push({ id, householdId: household.rows[0]?.id as string });
          }
          return out;
        });

        const vote = await api.activeVote("OPEN", { people: world500 });
        // Submit in parallel batches, as many households would near a deadline.
        for (let start = 0; start < world500.length; start += 5) {
          await Promise.all(
            world500
              .slice(start, start + 5)
              .map((person, offset) =>
                api.cast(
                  person.id,
                  vote.id,
                  choose(vote, (start + offset) % 2),
                ),
              ),
          );
        }
        await finish(vote.id);

        const started = Date.now();
        const raw = rawResultsSchema.parse(
          await api.call(admin(), "public.get_vote_results($1, null)", [
            vote.id,
          ]),
        );
        const results = projectResults(raw);
        const csv = renderResultsCsv(results, new Date());
        const elapsed = Date.now() - started;

        expect(raw.namedResponses).toHaveLength(HOUSEHOLDS);
        expect(results.turnout).toEqual({
          numerator: "500",
          denominator: "500",
          percent: "100.00",
        });
        expect(
          results.votingType === "OPEN" && results.options.map((o) => o.count),
        ).toEqual(["250", "250"]);

        const rows = csv.replace(/^\uFEFF/u, "").split("\r\n");
        // Every named response sits on its own physical line, so the file is easy to audit.
        expect(
          rows.filter((r) => r.startsWith("NAMED_RESPONSE,")),
        ).toHaveLength(HOUSEHOLDS);
        // The hostile name is quoted, escaped and defused in the spreadsheet.
        expect(csv).toContain(`"'=Resident 000, ""Quoted"""`);
        expect(Buffer.byteLength(csv, "utf8")).toBeLessThan(1_000_000);
        expect(elapsed).toBeLessThan(10_000);
      }, 240_000);
    });

    describe("storage boundary", () => {
      it("keeps choice storage unreadable by every API role", async () => {
        const vote = await api.activeVote("OPEN");
        await api.cast(alice(), vote.id, choose(vote, 0));
        for (const sub of [admin(), alice()]) {
          for (const table of ["open_responses", "closed_tallies"]) {
            expect(
              (
                await dbError(
                  db.asRole("authenticated", { sub }, (c) =>
                    c.query(`select * from public.${table}`),
                  ),
                )
              ).code,
            ).toBe(PERMISSION_DENIED);
          }
        }
      });
    });
  },
);
