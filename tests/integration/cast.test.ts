import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";
import { sleep, votingApi, type Detail } from "./support/votes";

const UNKNOWN = "00000000-0000-4000-8000-000000000099";
const PERMISSION_DENIED = "42501";

describe.skipIf(!hasDatabase)("cast_vote and participation status", () => {
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

  const runCron = () =>
    db.asSuperuser(async (c) => {
      await c.query("begin");
      await c.query("set local role cp_scheduler");
      const result = await c.query<{
        r: { completed: number; blocked: number };
      }>("select public.complete_due_votes() as r");
      await c.query("commit");
      return result.rows[0]?.r;
    });

  const status = async (voteId: string) =>
    (
      await api.rows<{
        status: string;
        completed_at: string;
        closes_at: string;
      }>(
        "select status, completed_at, closes_at from public.votes where id = $1",
        [voteId],
      )
    )[0];

  const chair = (vote: Detail) => vote.offices[0];
  const treasurer = (vote: Detail) => vote.offices[1];
  const closedBallot = (
    vote: Detail,
    pick: [number | null, number | null],
  ) => ({
    confirmed: true,
    selections: [
      {
        officeId: chair(vote)?.id,
        candidateId:
          pick[0] === null ? null : chair(vote)?.candidates[pick[0]]?.id,
      },
      {
        officeId: treasurer(vote)?.id,
        candidateId:
          pick[1] === null ? null : treasurer(vote)?.candidates[pick[1]]?.id,
      },
    ],
  });

  describe("authorization", () => {
    it("denies anonymous callers at the grant level", async () => {
      const vote = await api.activeVote();
      expect(
        (
          await dbError(
            api.cast(null, vote.id, {
              confirmed: true,
              optionId: vote.options[0]?.id,
            }),
          )
        ).code,
      ).toBe(PERMISSION_DENIED);
      expect((await dbError(api.participation(null, vote.id))).code).toBe(
        PERMISSION_DENIED,
      );
    });

    it("refuses a suspended profile and an unknown identity, even with a still-valid session", async () => {
      const vote = await api.activeVote("PUBLIC", {
        people: [world.alice, world.bob],
      });
      const body = { confirmed: true, optionId: vote.options[0]?.id };

      for (const sub of [world.carol.id, UNKNOWN]) {
        expect((await dbError(api.cast(sub, vote.id, body))).message).toBe(
          "FORBIDDEN",
        );
      }

      // Alice signed in and was entitled; her access is revoked afterwards.
      await db.asOwner((c) =>
        c.query(
          "update public.profiles set status = 'SUSPENDED' where id = $1",
          [alice()],
        ),
      );
      expect((await dbError(api.cast(alice(), vote.id, body))).message).toBe(
        "FORBIDDEN",
      );
      expect((await dbError(api.participation(alice(), vote.id))).message).toBe(
        "FORBIDDEN",
      );
      await db.asOwner((c) =>
        c.query("update public.profiles set status = 'ENABLED' where id = $1", [
          alice(),
        ]),
      );
      expect((await api.counts(vote.id)).participation).toBe(0);
    });

    it("answers not found, identically, for an administrator without an entitlement, a member outside the electorate, a draft and an unknown vote", async () => {
      const vote = await api.activeVote("PUBLIC", {
        people: [world.alice, world.bob],
      });
      const draft = await api.call<Detail>(
        api.admin(),
        "public.create_draft('PUBLIC')",
      );
      const body = { confirmed: true, optionId: vote.options[0]?.id };

      const attempts: [string, string][] = [
        [api.admin(), vote.id],
        [dave(), vote.id],
        [alice(), draft.id],
        [alice(), UNKNOWN],
      ];
      for (const [sub, id] of attempts) {
        expect((await dbError(api.cast(sub, id, body))).message).toBe(
          "NOT_FOUND",
        );
        expect((await dbError(api.participation(sub, id))).message).toBe(
          "NOT_FOUND",
        );
      }
      expect((await api.counts(vote.id)).participation).toBe(0);
    });

    it("is not blocked by a vote lock held for someone outside the electorate", async () => {
      // Probing a vote you are not entitled to must not queue behind its lock.
      const vote = await api.activeVote("PUBLIC", { people: [world.alice] });
      const started = Date.now();
      const holder = db.asOwner(async (c) => {
        await c.query("select 1 from public.votes where id = $1 for update", [
          vote.id,
        ]);
        await sleep(2_000);
      });
      await sleep(300);
      const error = await dbError(
        api.cast(dave(), vote.id, {
          confirmed: true,
          optionId: vote.options[0]?.id,
        }),
      );
      expect(error.message).toBe("NOT_FOUND");
      expect(Date.now() - started).toBeLessThan(1_800);
      await holder;
    });
  });

  describe("PUBLIC submissions", () => {
    it("records participation and exactly one owned response, and returns participation only", async () => {
      const vote = await api.activeVote("PUBLIC");
      const yes = vote.options[0]?.id;
      const result = await api.cast(alice(), vote.id, {
        confirmed: true,
        optionId: yes,
      });
      expect(result).toEqual({
        accepted: true,
        voteId: vote.id,
        submitted: true,
      });

      const counts = await api.counts(vote.id);
      expect(counts).toMatchObject({
        participation: 1,
        openResponses: 1,
        tallies: [],
      });
      const [row] = await api.rows<{ option_id: string; household_id: string }>(
        "select option_id, household_id from public.open_responses where vote_id = $1",
        [vote.id],
      );
      expect(row).toEqual({
        option_id: yes,
        household_id: world.alice.householdId,
      });
      expect(await api.participation(alice(), vote.id)).toEqual({
        voteId: vote.id,
        status: "ACTIVE",
        submitted: true,
      });
      expect(await api.participation(bob(), vote.id)).toMatchObject({
        submitted: false,
      });
    });

    it("replaces a PUBLIC choice without adding another participation record", async () => {
      const vote = await api.activeVote("PUBLIC");
      await api.cast(alice(), vote.id, {
        confirmed: true,
        optionId: vote.options[0]?.id,
      });
      const acknowledgement = await api.cast(alice(), vote.id, {
        confirmed: true,
        optionId: vote.options[1]?.id,
      });
      expect(acknowledgement).toMatchObject({
        accepted: true,
        submitted: true,
      });
      expect(await api.counts(vote.id)).toMatchObject({
        participation: 1,
        openResponses: 1,
      });
      const [response] = await api.rows<{ option_id: string }>(
        "select option_id from public.open_responses where vote_id = $1",
        [vote.id],
      );
      expect(response?.option_id).toBe(vote.options[1]?.id);
    });

    it("stores multiple selected options as one replaceable household ballot", async () => {
      const vote = await api.activeVote("PUBLIC", {
        openSelectionMode: "MULTIPLE",
        openSelectionLimit: 2,
        optionLabels: ["Monday", "Tuesday", "Saturday"],
      });
      const choices = [vote.options[0]?.id, vote.options[2]?.id];
      await expect(
        api.cast(alice(), vote.id, { confirmed: true, optionIds: choices }),
      ).resolves.toMatchObject({ accepted: true, submitted: true });
      expect(await api.counts(vote.id)).toMatchObject({
        participation: 1,
        openResponses: 2,
      });

      await api.cast(alice(), vote.id, {
        confirmed: true,
        optionIds: [vote.options[1]?.id],
      });
      expect(await api.counts(vote.id)).toMatchObject({
        participation: 1,
        openResponses: 1,
      });
      const selected = await api.rows<{ option_id: string }>(
        "select option_id from public.open_responses where vote_id = $1",
        [vote.id],
      );
      expect(selected.map((row) => row.option_id)).toEqual([
        vote.options[1]?.id,
      ]);
    });

    it("enforces at least one choice, unique owned options, and the configured cap", async () => {
      const vote = await api.activeVote("PUBLIC", {
        openSelectionMode: "MULTIPLE",
        openSelectionLimit: 2,
        optionLabels: ["Monday", "Tuesday", "Saturday"],
      });
      const [first, second, third] = vote.options.map((option) => option.id);
      for (const optionIds of [
        [],
        [first, first],
        [first, second, third],
        [first, UNKNOWN],
      ]) {
        expect(
          (
            await dbError(
              api.cast(alice(), vote.id, { confirmed: true, optionIds }),
            )
          ).message,
        ).toBe("VALIDATION_FAILED");
      }
      expect(await api.counts(vote.id)).toMatchObject({
        participation: 0,
        openResponses: 0,
      });
    });

    it("allows any number of distinct options when the PUBLIC poll has no cap", async () => {
      const vote = await api.activeVote("PUBLIC", {
        openSelectionMode: "MULTIPLE",
        openSelectionLimit: null,
        optionLabels: ["Monday", "Tuesday", "Saturday"],
      });
      await api.cast(alice(), vote.id, {
        confirmed: true,
        optionIds: vote.options.map((option) => option.id),
      });
      expect(await api.counts(vote.id)).toMatchObject({
        participation: 1,
        openResponses: 3,
      });
    });

    it("serializes concurrent PUBLIC choice changes without duplicating participation", async () => {
      const vote = await api.activeVote("PUBLIC");
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          api.cast(alice(), vote.id, {
            confirmed: true,
            optionId: vote.options[index % 2]?.id,
          }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(8);
      expect(await api.counts(vote.id)).toMatchObject({
        participation: 1,
        openResponses: 1,
      });
    });

    it("serializes concurrent multi-select replacement as one latest ballot", async () => {
      const vote = await api.activeVote("PUBLIC", {
        openSelectionMode: "MULTIPLE",
        openSelectionLimit: 2,
        optionLabels: ["Monday", "Tuesday", "Saturday"],
      });
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          api.cast(alice(), vote.id, {
            confirmed: true,
            optionIds:
              index % 2 === 0
                ? [vote.options[0]?.id, vote.options[1]?.id]
                : [vote.options[1]?.id, vote.options[2]?.id],
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(8);
      expect(await api.counts(vote.id)).toMatchObject({
        participation: 1,
        openResponses: 2,
      });
    });

    it("rejects any option that is not this vote's, and any malformed or mixed shape, writing nothing", async () => {
      const vote = await api.activeVote("PUBLIC");
      const other = await api.activeVote("PUBLIC");
      const good = vote.options[0]?.id;
      const bad: unknown[] = [
        { confirmed: true, optionId: other.options[0]?.id },
        { confirmed: true, optionId: UNKNOWN },
        { confirmed: true, optionId: "not-a-uuid" },
        { confirmed: true, optionId: null },
        { confirmed: true },
        { optionId: good },
        { confirmed: false, optionId: good },
        { confirmed: "true", optionId: good },
        { confirmed: 1, optionId: good },
        { confirmed: true, optionId: good, selections: [] },
        {
          confirmed: true,
          selections: [{ officeId: UNKNOWN, candidateId: null }],
        },
        { confirmed: true, optionId: [good] },
        [],
        "x",
        null,
      ];
      for (const body of bad) {
        expect((await dbError(api.cast(alice(), vote.id, body))).message).toBe(
          "VALIDATION_FAILED",
        );
      }
      expect(await api.counts(vote.id)).toMatchObject({
        participation: 0,
        openResponses: 0,
      });
    });

    it("never accepts identity, household, role, timestamp, count or idempotency fields", async () => {
      const vote = await api.activeVote("PUBLIC");
      const good = vote.options[0]?.id;
      for (const extra of [
        { householdId: world.bob.householdId },
        { profileId: bob() },
        { accountId: bob() },
        { actorRole: "ADMIN" },
        { acceptedAt: "2020-01-01T00:00:00Z" },
        { timestamp: 1 },
        { counts: { yes: 100 } },
        { idempotencyKey: "abc" },
        { id: UNKNOWN },
      ]) {
        const error = await dbError(
          api.cast(alice(), vote.id, {
            confirmed: true,
            optionId: good,
            ...extra,
          }),
        );
        expect(error.message, JSON.stringify(extra)).toBe("VALIDATION_FAILED");
      }
      expect((await api.counts(vote.id)).participation).toBe(0);
    });
  });

  describe("PRIVATE submissions", () => {
    it("increments exactly the chosen counters, including explicit NOTA choices", async () => {
      const vote = await api.activeVote("PRIVATE");
      const first = await api.cast(
        alice(),
        vote.id,
        closedBallot(vote, [0, 0]),
      );
      const second = await api.cast(
        bob(),
        vote.id,
        closedBallot(vote, [0, null]),
      );
      const third = await api.cast(dave(), vote.id, closedBallot(vote, [1, 0]));
      for (const result of [first, second, third]) {
        // Participation only: no selection, counter or timestamp comes back.
        expect(result).toEqual({
          accepted: true,
          voteId: vote.id,
          submitted: true,
        });
      }

      const counts = await api.counts(vote.id);
      expect(counts.participation).toBe(3);
      expect(counts.openResponses).toBe(0);
      const value = (officeId?: string, candidateId: string | null = null) =>
        Number(
          counts.tallies.find(
            (t) => t.office_id === officeId && t.candidate_id === candidateId,
          )?.accepted_count,
        );
      expect(
        value(chair(vote)?.id, chair(vote)?.candidates[0]?.id ?? null),
      ).toBe(2);
      expect(
        value(chair(vote)?.id, chair(vote)?.candidates[1]?.id ?? null),
      ).toBe(1);
      expect(value(chair(vote)?.id)).toBe(0);
      expect(
        value(treasurer(vote)?.id, treasurer(vote)?.candidates[0]?.id ?? null),
      ).toBe(2);
      expect(value(treasurer(vote)?.id)).toBe(1);
      // Every office's counters add up to the number of ballots.
      expect(counts.totalTallied).toBe(3 * 2);
    });

    it("refuses a repeat without changing any counter", async () => {
      const vote = await api.activeVote("PRIVATE");
      await api.cast(alice(), vote.id, closedBallot(vote, [0, 0]));
      const before = await api.counts(vote.id);
      expect(
        (
          await dbError(
            api.cast(alice(), vote.id, closedBallot(vote, [1, null])),
          )
        ).message,
      ).toBe("ALREADY_SUBMITTED");
      expect(await api.counts(vote.id)).toEqual(before);
    });

    it("rejects every incomplete or inconsistent ballot and leaves no partial write", async () => {
      const vote = await api.activeVote("PRIVATE");
      const other = await api.activeVote("PRIVATE");
      const valid = closedBallot(vote, [0, 0]);
      const [selChair, selTreasurer] = valid.selections;

      const bad: [string, unknown][] = [
        ["missing office", { confirmed: true, selections: [selChair] }],
        ["empty selections", { confirmed: true, selections: [] }],
        [
          "repeated office",
          { confirmed: true, selections: [selChair, selChair] },
        ],
        [
          "an office of another vote",
          {
            confirmed: true,
            selections: [
              selChair,
              { officeId: treasurer(other)?.id, candidateId: null },
            ],
          },
        ],
        [
          "an unknown office",
          {
            confirmed: true,
            selections: [selChair, { officeId: UNKNOWN, candidateId: null }],
          },
        ],
        [
          "extra office",
          {
            confirmed: true,
            selections: [
              selChair,
              selTreasurer,
              { officeId: UNKNOWN, candidateId: null },
            ],
          },
        ],
        [
          "a candidate of a different office",
          {
            confirmed: true,
            selections: [
              {
                officeId: chair(vote)?.id,
                candidateId: treasurer(vote)?.candidates[0]?.id,
              },
              selTreasurer,
            ],
          },
        ],
        [
          "a candidate of another vote",
          {
            confirmed: true,
            selections: [
              {
                officeId: chair(vote)?.id,
                candidateId: chair(other)?.candidates[0]?.id,
              },
              selTreasurer,
            ],
          },
        ],
        [
          "a missing candidateId key (not an explicit NOTA choice)",
          {
            confirmed: true,
            selections: [{ officeId: chair(vote)?.id }, selTreasurer],
          },
        ],
        [
          "a non-uuid candidateId",
          {
            confirmed: true,
            selections: [
              { officeId: chair(vote)?.id, candidateId: "" },
              selTreasurer,
            ],
          },
        ],
        [
          "a numeric candidateId",
          {
            confirmed: true,
            selections: [
              { officeId: chair(vote)?.id, candidateId: 3 },
              selTreasurer,
            ],
          },
        ],
        [
          "an extra field on a selection",
          {
            confirmed: true,
            selections: [{ ...selChair, note: "x" }, selTreasurer],
          },
        ],
        [
          "selections that are not an array",
          { confirmed: true, selections: selChair },
        ],
        [
          "a PUBLIC option on a PRIVATE vote",
          { confirmed: true, optionId: UNKNOWN },
        ],
        ["both shapes at once", { ...valid, optionId: UNKNOWN }],
        ["no confirmation", { selections: valid.selections }],
        ["confirmation false", { ...valid, confirmed: false }],
      ];
      for (const [label, body] of bad) {
        expect(
          (await dbError(api.cast(alice(), vote.id, body))).message,
          label,
        ).toBe("VALIDATION_FAILED");
      }
      const counts = await api.counts(vote.id);
      expect(counts.participation).toBe(0);
      expect(counts.totalTallied).toBe(0);
    });

    it("is not blocked by another vote's counters or by another draft's empty office", async () => {
      // Regression: the activation guard once inspected every office in the database.
      const busy = await api.activeVote("PRIVATE");
      await api.cast(alice(), busy.id, closedBallot(busy, [0, 0]));
      const emptyDraft = await api.call<Detail>(
        api.admin(),
        "public.create_draft('PRIVATE')",
      );
      await api.call(api.admin(), "public.update_draft($1, 1, $2::jsonb)", [
        emptyDraft.id,
        JSON.stringify({
          offices: [{ name: "No candidates yet", position: 1, candidates: [] }],
        }),
      ]);
      expect((await api.activeVote("PRIVATE")).status).toBe("ACTIVE");
    });

    it("keeps no individual PRIVATE record: no choice, household or timestamp can be joined to a counter", async () => {
      const columns = async (table: string) =>
        (
          await api.rows<{ column_name: string }>(
            "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by column_name",
            [table],
          )
        ).map((r) => r.column_name);
      // A new column here would be a correlation risk and must be a deliberate decision.
      expect(await columns("closed_tallies")).toEqual([
        "accepted_count",
        "candidate_id",
        "id",
        "office_id",
        "vote_id",
      ]);
      expect(await columns("participation")).toEqual([
        "accepted_at",
        "household_id",
        "vote_id",
      ]);

      const vote = await api.activeVote("PRIVATE");
      await api.cast(alice(), vote.id, closedBallot(vote, [0, 0]));
      expect((await api.counts(vote.id)).openResponses).toBe(0);
      for (const table of ["closed_tallies", "open_responses"]) {
        for (const sub of [alice(), api.admin()]) {
          const error = await dbError(
            db.asRole("authenticated", { sub }, (c) =>
              c.query(`select * from public.${table}`),
            ),
          );
          expect(error.code, `${table} for ${sub}`).toBe(PERMISSION_DENIED);
        }
      }
      // No audit event mentions a submission or a choice.
      const audit = await api.rows<{ action: string; details: unknown }>(
        "select action, details from public.audit_events where target_id = $1",
        [vote.id],
      );
      expect(audit.map((e) => e.action).sort()).toEqual(
        ["DRAFT_CREATED", "DRAFT_UPDATED", "VOTE_ACTIVATED"].sort(),
      );
    });
  });

  describe("deadlines and lifecycle", () => {
    it("completes an overdue vote at its deadline, COMMITS that, and refuses the late submission", async () => {
      const vote = await api.activeVote("PUBLIC", { closesInMs: 2_500 });
      await sleep(3_000);
      const result = await api.cast(alice(), vote.id, {
        confirmed: true,
        optionId: vote.options[0]?.id,
      });
      expect(result).toEqual({ accepted: false, reason: "VOTING_CLOSED" });

      // The reconciliation persisted even though the submission was refused.
      const stored = await status(vote.id);
      expect(stored?.status).toBe("COMPLETED");
      expect(new Date(stored?.completed_at ?? "").getTime()).toBe(
        new Date(stored?.closes_at ?? "").getTime(),
      );
      expect(await api.counts(vote.id)).toMatchObject({
        participation: 0,
        openResponses: 0,
      });

      // Afterwards the vote is simply terminal.
      expect(
        (
          await dbError(
            api.cast(alice(), vote.id, {
              confirmed: true,
              optionId: vote.options[0]?.id,
            }),
          )
        ).message,
      ).toBe("VOTING_CLOSED");
    });

    it("refuses a request that WAITED past the cutoff for the vote lock, even though it was sent earlier", async () => {
      const vote = await api.activeVote("PUBLIC", { closesInMs: 3_000 });
      const holder = db.asOwner(async (c) => {
        await c.query("select 1 from public.votes where id = $1 for update", [
          vote.id,
        ]);
        await sleep(3_800);
      });
      await sleep(400);
      const result = await api.cast(alice(), vote.id, {
        confirmed: true,
        optionId: vote.options[0]?.id,
      });
      await holder;
      expect(result).toEqual({ accepted: false, reason: "VOTING_CLOSED" });
      expect((await status(vote.id))?.status).toBe("COMPLETED");
      expect((await api.counts(vote.id)).participation).toBe(0);
    });

    it("lets a transaction admitted before the deadline commit after it, and counts it", async () => {
      const vote = await api.activeVote("PUBLIC", { closesInMs: 3_000 });
      const body = { confirmed: true, optionId: vote.options[0]?.id };
      const admittedAt: number[] = [];

      const admitted = db.asRole(
        "authenticated",
        { sub: alice() },
        async (c) => {
          const result = await c.query<{ r: { accepted: boolean } }>(
            "select public.cast_vote($1, $2::jsonb) as r",
            [vote.id, JSON.stringify(body)],
          );
          admittedAt.push(Date.now());
          expect(result.rows[0]?.r.accepted).toBe(true);
          // Hold the transaction open until after the deadline, then commit.
          await sleep(3_600);
        },
        { commit: true },
      );

      // Bob arrives after the deadline while Alice's admitted transaction is still open.
      await sleep(3_300);
      const late = api.cast(bob(), vote.id, {
        confirmed: true,
        optionId: vote.options[1]?.id,
      });
      await admitted;
      expect(await late).toEqual({ accepted: false, reason: "VOTING_CLOSED" });

      expect(await api.counts(vote.id)).toMatchObject({
        participation: 1,
        openResponses: 1,
      });
      // Completion waited for the admitted transaction, then counted it.
      await runCron();
      expect((await status(vote.id))?.status).toBe("COMPLETED");
      expect(await api.counts(vote.id)).toMatchObject({
        participation: 1,
        openResponses: 1,
      });
    });

    it("refuses submissions to completed and cancelled votes", async () => {
      const done = await api.activeVote("PUBLIC");
      await api.call(
        api.admin(),
        "public.complete_vote_early($1, true, 'All voted')",
        [done.id],
      );
      const cancelled = await api.activeVote("PRIVATE");
      await api.call(
        api.admin(),
        "public.cancel_vote($1, true, 'Wrong list')",
        [cancelled.id],
      );

      expect(
        (
          await dbError(
            api.cast(alice(), done.id, {
              confirmed: true,
              optionId: done.options[0]?.id,
            }),
          )
        ).message,
      ).toBe("VOTING_CLOSED");
      expect(
        (
          await dbError(
            api.cast(alice(), cancelled.id, closedBallot(cancelled, [0, 0])),
          )
        ).message,
      ).toBe("VOTING_CLOSED");
      expect(await api.participation(alice(), done.id)).toMatchObject({
        status: "COMPLETED",
        submitted: false,
      });
      expect(await api.participation(alice(), cancelled.id)).toMatchObject({
        status: "CANCELLED",
      });
    });

    it("serialises a concurrent cancellation and submission into one consistent outcome", async () => {
      const vote = await api.activeVote("PUBLIC");
      const [cast, cancel] = await Promise.allSettled([
        api.cast(alice(), vote.id, {
          confirmed: true,
          optionId: vote.options[0]?.id,
        }),
        api.call(api.admin(), "public.cancel_vote($1, true, 'Racing')", [
          vote.id,
        ]),
      ]);
      expect(cancel.status).toBe("fulfilled");
      const counts = await api.counts(vote.id);
      // Participation and response always agree, whichever got the lock first.
      expect(counts.participation).toBe(counts.openResponses);
      if (cast.status === "rejected") {
        expect(cast.reason.message).toBe("VOTING_CLOSED");
        expect(counts.participation).toBe(0);
      } else {
        expect(counts.participation).toBe(1);
      }
    });
  });

  describe("failure handling", () => {
    it("rolls back everything when a fault strikes mid-submission", async () => {
      const vote = await api.activeVote("PRIVATE");
      await db.asSuperuser(async (c) => {
        await c.query(
          "create function public.cp_test_fail() returns trigger language plpgsql as $$ begin raise exception 'INJECTED_FAULT'; end $$",
        );
        // Fires on the SECOND counter update, after participation and the first counter changed.
        await c.query(
          `create trigger cp_test_fail before update on public.closed_tallies
             for each row when (new.office_id = '${treasurer(vote)?.id}')
             execute function public.cp_test_fail()`,
        );
      });
      try {
        const error = await dbError(
          api.cast(alice(), vote.id, closedBallot(vote, [0, 0])),
        );
        expect(error.message).toBe("INJECTED_FAULT");
        const counts = await api.counts(vote.id);
        expect(counts.participation).toBe(0);
        expect(counts.totalTallied).toBe(0);
      } finally {
        await db.asSuperuser(async (c) => {
          await c.query("drop trigger cp_test_fail on public.closed_tallies");
          await c.query("drop function public.cp_test_fail()");
        });
      }
      // The same member can still submit once the fault is gone: nothing was consumed.
      expect(
        await api.cast(alice(), vote.id, closedBallot(vote, [0, 0])),
      ).toMatchObject({
        accepted: true,
      });
      expect((await api.counts(vote.id)).totalTallied).toBe(2);
    });

    it("turns an unbounded lock wait into a retryable error instead of hanging", async () => {
      const vote = await api.activeVote("PUBLIC");
      const started = Date.now();
      const holder = db.asOwner(async (c) => {
        await c.query("select 1 from public.votes where id = $1 for update", [
          vote.id,
        ]);
        await sleep(7_500);
      });
      await sleep(300);
      const error = await dbError(
        api.cast(alice(), vote.id, {
          confirmed: true,
          optionId: vote.options[0]?.id,
        }),
      );
      const waited = Date.now() - started;
      await holder;
      expect(error.code).toBe("55P03");
      expect(waited).toBeGreaterThan(4_500);
      expect(waited).toBeLessThan(7_000);
      expect((await api.counts(vote.id)).participation).toBe(0);
    });

    it("reports a committed submission whose acknowledgement was lost", async () => {
      // PRIVATE ballots are final; PUBLIC retries are deliberate vote changes.
      const vote = await api.activeVote("PRIVATE");
      // The caller never reads the response (a dropped connection), yet it committed.
      void api.cast(alice(), vote.id, closedBallot(vote, [0, 0]));
      await sleep(1_000);
      expect(await api.participation(alice(), vote.id)).toMatchObject({
        submitted: true,
      });
      // A deliberate retry is safe and reports the existing participation.
      expect(
        (
          await dbError(
            api.cast(alice(), vote.id, closedBallot(vote, [1, null])),
          )
        ).message,
      ).toBe("ALREADY_SUBMITTED");
    });
  });
});
