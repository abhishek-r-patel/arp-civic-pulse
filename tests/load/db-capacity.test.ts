import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderResultsCsv } from "@/server/exports/csv";
import { renderResultsPdf } from "@/server/exports/pdf";
import { projectResults, rawResultsSchema } from "@/shared/contracts/results";
import {
  adminUrl,
  createTestDatabase,
  hasDatabase,
  newAuthUser,
  type TestDatabase,
} from "../integration/support/database";
import { seedWorld, type World } from "../integration/support/fixtures";
import { votingApi, type Detail } from "../integration/support/votes";

/*
 * Capacity evidence at the pilot size: 500 households and about 100 concurrent
 * users contending for ONE vote, through a small connection pool the way the
 * Data API reaches the database (docs/IMPLEMENTATION_PLAN.md phase 16, task 4).
 * Latency is measured from the moment a "request" is issued, so time spent
 * waiting for a pooled connection or a row lock counts. This is the DATABASE
 * half on a local PostgreSQL: there is no network and no hosting plan in it,
 * so it shows lock and query behaviour, not final production latency.
 */
const HOUSEHOLDS = 500;
const CONCURRENCY = 100;
const POOL_SIZE = 20;
// Provisional targets from the plan: p95 under 2 s for pages/APIs, acknowledgement under 3 s.
const P95_READ_MS = 2_000;
const P95_ACK_MS = 3_000;

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    ] ?? 0
  );
};

describe.skipIf(!hasDatabase)(
  "capacity: 500 households, 100 concurrent users",
  () => {
    let db: TestDatabase;
    let world: World;
    let api: ReturnType<typeof votingApi>;
    let pool: Pool;
    let people: { id: string; householdId: string }[] = [];
    const timings: Record<string, number[]> = {};

    const request = async <T>(
      label: string,
      sub: string,
      sql: string,
      params: unknown[] = [],
    ): Promise<T> => {
      const started = performance.now();
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local role authenticated");
        await client.query(
          "select set_config('request.jwt.claims', $1, true)",
          [JSON.stringify({ sub, role: "authenticated" })],
        );
        const result = await client.query<{ r: T }>(
          `select ${sql} as r`,
          params,
        );
        await client.query("commit");
        return result.rows[0]?.r as T;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
        (timings[label] ??= []).push(performance.now() - started);
      }
    };

    // Runs tasks with a fixed number in flight, like users arriving together.
    async function inFlight<T>(
      items: readonly T[],
      width: number,
      task: (item: T) => Promise<unknown>,
    ) {
      let next = 0;
      await Promise.all(
        Array.from({ length: width }, async () => {
          while (next < items.length) {
            const item = items[next++] as T;
            await task(item);
          }
        }),
      );
    }

    beforeAll(async () => {
      db = await createTestDatabase();
      world = await seedWorld(db);
      api = votingApi(db, world);
      await api.setupPolicy();

      const ids = await db.asSuperuser(async (c) => {
        const out: string[] = [];
        for (let i = 0; i < HOUSEHOLDS; i += 1) {
          out.push(await newAuthUser(c));
        }
        return out;
      });
      people = await db.asOwner(async (c) => {
        const out: { id: string; householdId: string }[] = [];
        for (const [index, id] of ids.entries()) {
          await c.query(
            "insert into public.profiles (id, representative_name, status) values ($1, $2, 'ENABLED')",
            [id, `Resident ${String(index).padStart(3, "0")}`],
          );
          const h = await c.query<{ id: string }>(
            `insert into public.households (identifier, identifier_normalized, representative_profile_id, is_eligible)
           values ($1, app_private.normalize_key($1), $2, true) returning id`,
            [`H-${String(index).padStart(4, "0")}`, id],
          );
          out.push({ id, householdId: h.rows[0]?.id as string });
        }
        return out;
      });

      const url = new URL(adminUrl as string);
      url.pathname = `/${db.name}`;
      pool = new Pool({
        connectionString: url.toString(),
        max: POOL_SIZE,
        user: "supabase_admin",
      });
    }, 300_000);

    afterAll(async () => {
      await pool?.end();
      await db?.drop();
    });

    const report = (labels: string[]) =>
      console.table(
        Object.fromEntries(
          labels.map((l) => [
            l,
            {
              n: timings[l]?.length ?? 0,
              "p50 ms": Math.round(percentile(timings[l] ?? [], 50)),
              "p95 ms": Math.round(percentile(timings[l] ?? [], 95)),
              "max ms": Math.round(Math.max(0, ...(timings[l] ?? []))),
            },
          ]),
        ),
      );

    it("accepts 500 PUBLIC ballots from 100 concurrent users on one vote, exactly once each, within the targets", async () => {
      const vote: Detail = await api.activeVote("PUBLIC", {
        people: people.map((p) => ({ id: p.id, householdId: p.householdId })),
      });
      const options = vote.options.map((o) => o.id);

      // Each user opens the list, the ballot, submits, then checks their status; an administrator watches throughout.
      let monitoring = true;
      const watcher = (async () => {
        while (monitoring) {
          await request(
            "admin participation",
            world.admin.id,
            "public.get_vote_participation($1, null, 50)",
            [vote.id],
          );
          await new Promise((r) => setTimeout(r, 50));
        }
      })();

      await inFlight(people, CONCURRENCY, async (person) => {
        await request("list votes", person.id, "public.list_member_votes()");
        await request("open ballot", person.id, "public.get_member_vote($1)", [
          vote.id,
        ]);
        const ack = await request<{ accepted: boolean }>(
          "cast ballot",
          person.id,
          "public.cast_vote($1, $2::jsonb)",
          [
            vote.id,
            JSON.stringify({
              confirmed: true,
              optionId: options[Math.floor(Math.random() * options.length)],
            }),
          ],
        );
        expect(ack.accepted).toBe(true);
        await request(
          "own status",
          person.id,
          "public.get_my_participation($1)",
          [vote.id],
        );
      });
      monitoring = false;
      await watcher;

      report([
        "list votes",
        "open ballot",
        "cast ballot",
        "own status",
        "admin participation",
      ]);
      const counts = await api.counts(vote.id);
      expect(counts.participation).toBe(HOUSEHOLDS);
      expect(counts.openResponses).toBe(HOUSEHOLDS);

      expect(percentile(timings["cast ballot"] ?? [], 95)).toBeLessThan(
        P95_ACK_MS,
      );
      for (const label of [
        "list votes",
        "open ballot",
        "own status",
        "admin participation",
      ]) {
        expect(percentile(timings[label] ?? [], 95), label).toBeLessThan(
          P95_READ_MS,
        );
      }

      // A second attempt by every user is refused, still under contention, and changes nothing.
      await inFlight(people.slice(0, 100), CONCURRENCY, async (person) => {
        const second = await request<{ accepted: boolean; reason?: string }>(
          "repeat ballot",
          person.id,
          "public.cast_vote($1, $2::jsonb)",
          [vote.id, JSON.stringify({ confirmed: true, optionId: options[0] })],
        ).catch((error: Error) => ({ accepted: false, reason: error.message }));
        expect(second.accepted).toBe(false);
      });
      expect((await api.counts(vote.id)).participation).toBe(HOUSEHOLDS);

      // Results, exports and monitoring after completion, with 100 requests in flight.
      await api.call(
        world.admin.id,
        "public.complete_vote_early($1, true, 'Load test')",
        [vote.id],
      );
      const viewers = people.slice(0, 300);
      await inFlight(viewers, CONCURRENCY, async (person) => {
        await request(
          "results page (50 named)",
          person.id,
          "public.get_vote_results($1, 50)",
          [vote.id],
        );
      });
      await inFlight(viewers.slice(0, 40), 20, async (person) => {
        await request(
          "results for export (all 500)",
          person.id,
          "public.get_vote_results($1, null)",
          [vote.id],
        );
      });
      report([
        "repeat ballot",
        "results page (50 named)",
        "results for export (all 500)",
      ]);
      expect(
        percentile(timings["results page (50 named)"] ?? [], 95),
      ).toBeLessThan(P95_READ_MS);
      expect(
        percentile(timings["results for export (all 500)"] ?? [], 95),
      ).toBeLessThan(P95_READ_MS);

      // The exports themselves, rendered from the full 500-name result.
      const raw = rawResultsSchema.parse(
        await api.call(world.admin.id, "public.get_vote_results($1, null)", [
          vote.id,
        ]),
      );
      const results = projectResults(raw);
      const csvTimes: number[] = [];
      const pdfTimes: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        let t = performance.now();
        renderResultsCsv(results, new Date());
        csvTimes.push(performance.now() - t);
        t = performance.now();
        await renderResultsPdf(results, new Date());
        pdfTimes.push(performance.now() - t);
      }
      console.table({
        "CSV render (500 names)": {
          "p50 ms": Math.round(percentile(csvTimes, 50)),
          "max ms": Math.round(Math.max(...csvTimes)),
        },
        "PDF render (500 names)": {
          "p50 ms": Math.round(percentile(pdfTimes, 50)),
          "max ms": Math.round(Math.max(...pdfTimes)),
        },
      });
      expect(Math.max(...csvTimes)).toBeLessThan(P95_READ_MS);
      expect(Math.max(...pdfTimes)).toBeLessThan(10_000);
      expect(raw.namedResponses).toHaveLength(HOUSEHOLDS);
    }, 600_000);

    it("accepts 500 PRIVATE ballots on shared counters under the same contention, with exact totals", async () => {
      // Several offices make every submission update the same counter rows (the hottest lock path).
      const draft = await api.call<Detail>(
        world.admin.id,
        "public.create_draft('PRIVATE')",
      );
      const offices = Array.from({ length: 5 }, (_, i) => ({
        name: `Office ${i + 1}`,
        position: i + 1,
        candidates: Array.from({ length: 4 }, (_, c) => ({
          name: `Candidate ${i + 1}.${c + 1}`,
          position: c + 1,
        })),
      }));
      await api.call(world.admin.id, "public.update_draft($1, 1, $2::jsonb)", [
        draft.id,
        JSON.stringify({
          title: "Load election",
          instructions: "One per office.",
          closesAt: new Date(Date.now() + 3_600_000).toISOString(),
          offices,
          eligibleHouseholdIds: people.map((p) => p.householdId),
        }),
      ]);
      const vote = await api.call<Detail>(
        world.admin.id,
        "public.activate_vote($1, 2, true)",
        [draft.id],
      );

      await inFlight(people, CONCURRENCY, async (person) => {
        const pick =
          (person.householdId.charCodeAt(0) +
            person.householdId.charCodeAt(5)) %
          5;
        const ack = await request<{ accepted: boolean }>(
          "cast PRIVATE ballot",
          person.id,
          "public.cast_vote($1, $2::jsonb)",
          [
            vote.id,
            JSON.stringify({
              confirmed: true,
              selections: vote.offices.map((o, index) => ({
                officeId: o.id,
                candidateId:
                  (pick + index) % 5 === 4
                    ? null
                    : (o.candidates[(pick + index) % 5]?.id ?? null),
              })),
            }),
          ],
        );
        expect(ack.accepted).toBe(true);
      });
      report(["cast PRIVATE ballot"]);
      expect(percentile(timings["cast PRIVATE ballot"] ?? [], 95)).toBeLessThan(
        P95_ACK_MS,
      );

      const counts = await api.counts(vote.id);
      expect(counts.participation).toBe(HOUSEHOLDS);
      // Every office's counters (candidates plus NOTA) add up to exactly the number of ballots.
      for (const office of vote.offices) {
        const total = counts.tallies
          .filter((t) => t.office_id === office.id)
          .reduce((sum, t) => sum + Number(t.accepted_count), 0);
        expect(total, office.id).toBe(HOUSEHOLDS);
      }
      await api.call(
        world.admin.id,
        "public.complete_vote_early($1, true, 'Load test')",
        [vote.id],
      );
      const raw = rawResultsSchema.parse(
        await api.call(world.admin.id, "public.get_vote_results($1, null)", [
          vote.id,
        ]),
      );
      expect(raw.submittedCount).toBe(String(HOUSEHOLDS));
    }, 600_000);
  },
);
