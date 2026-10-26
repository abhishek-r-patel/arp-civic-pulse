import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  type TestDatabase,
} from "./support/database";
import {
  activate,
  addOffice,
  addOptions,
  fixtureClosedVote,
  fixtureOpenVote,
  insertDraft,
  seedWorld,
  snapshotElectorate,
  type VoteFixture,
  type World,
} from "./support/fixtures";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

describe.skipIf(!hasDatabase)("guards, lifecycle and invariants", () => {
  let db: TestDatabase;
  let world: World;

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
  });
  afterAll(async () => {
    await db?.drop();
  });

  const submitOpen = (
    vote: VoteFixture,
    householdId: string | null,
    optionId: string,
  ) =>
    db.asOwner(async (c) => {
      await c.query("select set_config('cp.submission', 'on', true)");
      await c.query(
        "insert into public.participation (vote_id, household_id) values ($1, $2)",
        [vote.id, householdId],
      );
      await c.query(
        "insert into public.open_responses (vote_id, household_id, option_id) values ($1, $2, $3)",
        [vote.id, householdId, optionId],
      );
    });

  const bump = (
    client: import("pg").Client,
    officeId: string,
    candidateId: string | null,
    by = 1,
  ) =>
    client.query(
      `update public.closed_tallies set accepted_count = accepted_count + $3
        where office_id = $1 and candidate_id is not distinct from $2::uuid`,
      [officeId, candidateId, by],
    );

  describe("draft editing and activation readiness", () => {
    it("starts every vote as a revision-1 draft", async () => {
      const direct = await dbError(
        db.asOwner((c) =>
          c.query(
            `insert into public.votes (voting_type, status, created_by_profile_id)
             values ('PUBLIC', 'ACTIVE', $1)`,
            [world.admin.id],
          ),
        ),
      );
      expect(direct.message).toBe("LIFECYCLE_CONFLICT");
    });

    it("advances the draft revision by at most one", async () => {
      const id = await db.asOwner((c) =>
        insertDraft(c, world.admin.id, "PUBLIC"),
      );
      await db.asOwner((c) =>
        c.query("update public.votes set draft_revision = 2 where id = $1", [
          id,
        ]),
      );
      const skipped = await dbError(
        db.asOwner((c) =>
          c.query("update public.votes set draft_revision = 9 where id = $1", [
            id,
          ]),
        ),
      );
      expect(skipped.message).toBe("IMMUTABLE_RECORD");
    });

    it("rejects mixed ballot shapes while drafting", async () => {
      const open = await db.asOwner((c) =>
        insertDraft(c, world.admin.id, "PUBLIC"),
      );
      const closed = await db.asOwner((c) =>
        insertDraft(c, world.admin.id, "PRIVATE"),
      );

      const office = await dbError(
        db.asOwner((c) => addOffice(c, open, "President", 1, ["Priya"])),
      );
      const option = await dbError(
        db.asOwner((c) => addOptions(c, closed, ["Yes"])),
      );
      expect(office.message).toBe("BALLOT_TYPE_MISMATCH");
      expect(option.message).toBe("BALLOT_TYPE_MISMATCH");
    });

    const blockers: [
      string,
      (vote: string, c: import("pg").Client) => Promise<void>,
    ][] = [
      [
        "an empty title",
        async (vote, c) => {
          await c.query("update public.votes set title = '' where id = $1", [
            vote,
          ]);
        },
      ],
      [
        "fewer than two distinct options",
        async (vote, c) => {
          await c.query(
            "delete from public.poll_options where vote_id = $1 and position = 2",
            [vote],
          );
        },
      ],
      [
        "an empty electorate",
        async (vote, c) => {
          await c.query("delete from public.electorate where vote_id = $1", [
            vote,
          ]);
        },
      ],
    ];

    it.each(blockers)("blocks activation with %s", async (_label, breakIt) => {
      const result = await dbError(
        db.asOwner(async (c) => {
          const id = await insertDraft(c, world.admin.id, "PUBLIC");
          await addOptions(c, id, ["Yes", "No"]);
          await snapshotElectorate(c, id, [world.alice]);
          await breakIt(id, c);
          await activate(c, id);
        }),
      );
      expect(result.message).toBe("ACTIVATION_BLOCKED");
    });

    it("blocks activation for a deadline that is not in the future", async () => {
      const result = await dbError(
        db.asOwner(async (c) => {
          const id = await insertDraft(c, world.admin.id, "PUBLIC");
          await addOptions(c, id, ["Yes", "No"]);
          await snapshotElectorate(c, id, [world.alice]);
          await activate(c, id, { closesInSeconds: -5 });
        }),
      );
      expect(result.message).toBe("ACTIVATION_BLOCKED");
    });

    it("blocks PRIVATE activation without candidates or without initialised counters", async () => {
      const noCandidates = await dbError(
        db.asOwner(async (c) => {
          const id = await insertDraft(c, world.admin.id, "PRIVATE");
          await addOffice(c, id, "President", 1, []);
          await snapshotElectorate(c, id, [world.alice]);
          await activate(c, id);
        }),
      );
      expect(noCandidates.message).toBe("ACTIVATION_BLOCKED");

      const noCounters = await dbError(
        db.asOwner(async (c) => {
          const id = await insertDraft(c, world.admin.id, "PRIVATE");
          await addOffice(c, id, "President", 1, ["Priya"]);
          await snapshotElectorate(c, id, [world.alice]);
          await c.query(
            `update public.votes set closes_at = now() + interval '1 hour', status = 'ACTIVE',
               activated_at = now() - interval '1 second', rwa_name_snapshot = 'RWA',
               timezone_snapshot = 'Asia/Kolkata',
               policy_versions_snapshot = '{"A1":"1","A2":"1","A3":"1","A4":"1","A5":"1","A6":"1","A7":"1"}'
             where id = $1`,
            [id],
          );
        }),
      );
      expect(noCounters.message).toBe("ACTIVATION_BLOCKED");
    });

    it("refuses snapshots that do not match an eligible household with an enabled representative", async () => {
      const ineligible = await dbError(
        db.asOwner(async (c) => {
          const id = await insertDraft(c, world.admin.id, "PUBLIC");
          await snapshotElectorate(c, id, [world.carol]); // suspended representative
        }),
      );
      expect(ineligible.message).toBe("ACTIVATION_BLOCKED");

      const forged = await dbError(
        db.asOwner(async (c) => {
          const id = await insertDraft(c, world.admin.id, "PUBLIC");
          await c.query(
            "insert into public.electorate (vote_id, household_id) values ($1, $2)",
            [id, world.alice.householdId],
          );
          await c.query(
            `update public.electorate set representative_profile_id = $3,
               representative_name_snapshot = 'Someone Else', household_identifier_snapshot = 'A-101'
             where vote_id = $1 and household_id = $2`,
            [id, world.alice.householdId, world.alice.id],
          );
        }),
      );
      expect(forged.message).toBe("ACTIVATION_BLOCKED");
    });
  });

  describe("frozen votes", () => {
    let vote: VoteFixture;
    beforeAll(async () => {
      vote = await fixtureOpenVote(db, world);
    });

    it("rejects any configuration edit after activation", async () => {
      const edits = [
        "update public.votes set title = 'Changed' where id = $1",
        "update public.votes set closes_at = closes_at + interval '1 day' where id = $1",
        "update public.votes set voting_type = 'PRIVATE' where id = $1",
        "update public.votes set draft_revision = draft_revision + 1 where id = $1",
        "update public.poll_options set label = 'Changed' where vote_id = $1",
        "delete from public.poll_options where vote_id = $1",
        "delete from public.electorate where vote_id = $1",
        "update public.electorate set representative_name_snapshot = 'X' where vote_id = $1",
        "delete from public.votes where id = $1",
      ];
      for (const sql of edits) {
        const error = await dbError(db.asOwner((c) => c.query(sql, [vote.id])));
        expect(error.message, sql).toBe("VOTE_FROZEN");
      }
      await expect(
        dbError(db.asOwner((c) => addOptions(c, vote.id, ["Late option"]))),
      ).resolves.toMatchObject({ message: "VOTE_FROZEN" });
    });

    it("allows only the documented lifecycle transitions", async () => {
      const illegal = [
        "update public.votes set status = 'DRAFT', activated_at = null, rwa_name_snapshot = null, timezone_snapshot = null, policy_versions_snapshot = null where id = $1",
      ];
      for (const sql of illegal) {
        const error = await dbError(db.asOwner((c) => c.query(sql, [vote.id])));
        expect(error.message).toBe("LIFECYCLE_CONFLICT");
      }
    });
  });

  describe("completion, cancellation and terminal votes", () => {
    it("completes early with a reason, then never changes again", async () => {
      const vote = await fixtureOpenVote(db, world);
      await db.asOwner((c) =>
        c.query(
          `update public.votes set status = 'COMPLETED', completion_mode = 'EARLY',
             completion_reason = 'Quorum reached', completed_at = clock_timestamp() where id = $1`,
          [vote.id],
        ),
      );
      for (const sql of [
        "update public.votes set status = 'ACTIVE', completed_at = null, completion_mode = null, completion_reason = null where id = $1",
        "update public.votes set title = 'x' where id = $1",
        "update public.votes set status = 'CANCELLED' where id = $1",
        "delete from public.votes where id = $1",
      ]) {
        const error = await dbError(db.asOwner((c) => c.query(sql, [vote.id])));
        expect(["LIFECYCLE_CONFLICT", "VOTE_FROZEN"], sql).toContain(
          error.message,
        );
      }
    });

    it("requires a reason for early completion and cancellation", async () => {
      const early = await fixtureOpenVote(db, world);
      const noReason = await dbError(
        db.asOwner((c) =>
          c.query(
            `update public.votes set status = 'COMPLETED', completion_mode = 'EARLY',
               completed_at = clock_timestamp() where id = $1`,
            [early.id],
          ),
        ),
      );
      expect(noReason.code).toBe(CHECK_VIOLATION);

      const cancel = await fixtureOpenVote(db, world);
      const blankReason = await dbError(
        db.asOwner((c) =>
          c.query(
            `update public.votes set status = 'CANCELLED', cancelled_at = clock_timestamp(),
               cancellation_reason = '' where id = $1`,
            [cancel.id],
          ),
        ),
      );
      expect(blankReason.code).toBe(CHECK_VIOLATION);

      await db.asOwner((c) =>
        c.query(
          `update public.votes set status = 'CANCELLED', cancelled_at = clock_timestamp(),
             cancellation_reason = 'Withdrawn by RWA' where id = $1`,
          [cancel.id],
        ),
      );
    });

    it("records deadline completion at exactly the frozen deadline", async () => {
      const vote = await fixtureOpenVote(db, world, undefined, {
        closesInSeconds: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 1300));

      const wrongInstant = await dbError(
        db.asOwner((c) =>
          c.query(
            `update public.votes set status = 'COMPLETED', completion_mode = 'DEADLINE',
               completed_at = clock_timestamp() where id = $1`,
            [vote.id],
          ),
        ),
      );
      expect(wrongInstant.code).toBe(CHECK_VIOLATION);

      await db.asOwner((c) =>
        c.query(
          `update public.votes set status = 'COMPLETED', completion_mode = 'DEADLINE',
             completed_at = closes_at where id = $1`,
          [vote.id],
        ),
      );
    });
  });

  describe("PUBLIC submission integrity", () => {
    it("rejects participation and responses written outside the submission routine", async () => {
      const vote = await fixtureOpenVote(db, world);
      const participation = await dbError(
        db.asOwner((c) =>
          c.query(
            "insert into public.participation (vote_id, household_id) values ($1, $2)",
            [vote.id, world.alice.householdId],
          ),
        ),
      );
      expect(participation.message).toBe("FORBIDDEN");

      const response = await dbError(
        db.asOwner((c) =>
          c.query(
            "insert into public.open_responses (vote_id, household_id, option_id) values ($1, $2, $3)",
            [vote.id, world.alice.householdId, vote.optionIds[0]],
          ),
        ),
      );
      expect(response.message).toBe("FORBIDDEN");
    });

    it("accepts one participation and one response atomically, once per household", async () => {
      const vote = await fixtureOpenVote(db, world);
      await submitOpen(vote, world.alice.householdId, vote.optionIds[0] ?? "");

      const counts = await db.asOwner((c) =>
        c.query<{ participation: string; responses: string }>(
          `select (select count(*) from public.participation where vote_id = $1) as participation,
                  (select count(*) from public.open_responses where vote_id = $1) as responses`,
          [vote.id],
        ),
      );
      expect(counts.rows[0]).toEqual({ participation: "1", responses: "1" });

      const duplicate = await dbError(
        submitOpen(vote, world.alice.householdId, vote.optionIds[1] ?? ""),
      );
      expect(duplicate.code).toBe(UNIQUE_VIOLATION);
    });

    it("rejects households outside the frozen electorate", async () => {
      const vote = await fixtureOpenVote(db, world, [world.alice]);
      const error = await dbError(
        submitOpen(vote, world.bob.householdId, vote.optionIds[0] ?? ""),
      );
      expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
    });

    it("rejects a choice that belongs to another vote", async () => {
      const vote = await fixtureOpenVote(db, world);
      const other = await fixtureOpenVote(db, world);
      const error = await dbError(
        submitOpen(vote, world.alice.householdId, other.optionIds[0] ?? ""),
      );
      expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
    });

    it("rejects admission at or after the deadline", async () => {
      const vote = await fixtureOpenVote(db, world, undefined, {
        closesInSeconds: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 1300));
      const error = await dbError(
        submitOpen(vote, world.alice.householdId, vote.optionIds[0] ?? ""),
      );
      expect(error.message).toBe("VOTING_CLOSED");
    });

    it("rejects admission to cancelled votes", async () => {
      const vote = await fixtureOpenVote(db, world);
      await db.asOwner((c) =>
        c.query(
          `update public.votes set status = 'CANCELLED', cancelled_at = clock_timestamp(),
             cancellation_reason = 'Cancelled' where id = $1`,
          [vote.id],
        ),
      );
      const error = await dbError(
        submitOpen(vote, world.alice.householdId, vote.optionIds[0] ?? ""),
      );
      expect(error.message).toBe("VOTING_CLOSED");
    });

    it("never edits or removes accepted records", async () => {
      const vote = await fixtureOpenVote(db, world);
      await submitOpen(vote, world.alice.householdId, vote.optionIds[0] ?? "");
      for (const sql of [
        "update public.participation set accepted_at = now()",
        "delete from public.participation",
        "update public.open_responses set option_id = option_id",
        "delete from public.open_responses",
        "truncate public.participation, public.open_responses cascade",
      ]) {
        const error = await dbError(
          db.asOwner(async (c) => {
            await c.query("select set_config('cp.submission', 'on', true)");
            await c.query(sql);
          }),
        );
        expect(error.message, sql).toBe("IMMUTABLE_RECORD");
      }
    });

    it("fails the whole transaction when a participation has no matching response", async () => {
      const vote = await fixtureOpenVote(db, world);
      const error = await dbError(
        db.asOwner(async (c) => {
          await c.query("select set_config('cp.submission', 'on', true)");
          await c.query(
            "insert into public.participation (vote_id, household_id) values ($1, $2)",
            [vote.id, world.alice.householdId],
          );
        }),
      );
      expect(error.message).toBe("INVARIANT_VIOLATION");

      const left = await db.asOwner((c) =>
        c.query("select 1 from public.participation where vote_id = $1", [
          vote.id,
        ]),
      );
      expect(left.rowCount).toBe(0);
    });
  });

  describe("PRIVATE aggregate integrity", () => {
    let vote: VoteFixture;
    beforeAll(async () => {
      vote = await fixtureClosedVote(db, world);
    });

    const ballot = (client: import("pg").Client, householdId: string | null) =>
      client
        .query("select set_config('cp.submission', 'on', true)")
        .then(() =>
          client.query(
            "insert into public.participation (vote_id, household_id) values ($1, $2)",
            [vote.id, householdId],
          ),
        );

    it("initialises exactly one counter per candidate plus one NOTA counter per office", async () => {
      const rows = await db.asOwner((c) =>
        c.query<{
          office_id: string;
          counters: string;
          nota: string;
          total: string;
        }>(
          `select office_id, count(*) as counters,
                  count(*) filter (where candidate_id is null) as nota,
                  sum(accepted_count) as total
             from public.closed_tallies where vote_id = $1 group by office_id`,
          [vote.id],
        ),
      );
      expect(rows.rowCount).toBe(2);
      const byOffice = new Map(rows.rows.map((r) => [r.office_id, r]));
      expect(byOffice.get(vote.offices[0]?.id ?? "")).toMatchObject({
        counters: "3",
        nota: "1",
        total: "0",
      });
      expect(byOffice.get(vote.offices[1]?.id ?? "")).toMatchObject({
        counters: "2",
        nota: "1",
        total: "0",
      });
    });

    it("rejects counter changes outside the submission routine", async () => {
      const office = vote.offices[0];
      const error = await dbError(
        db.asOwner((c) =>
          bump(c, office?.id ?? "", office?.candidateIds[0] ?? null),
        ),
      );
      expect(error.message).toBe("FORBIDDEN");
    });

    it("rejects tampered increments, deletions and late counter creation", async () => {
      const office = vote.offices[0];
      const jump = await dbError(
        db.asOwner(async (c) => {
          await c.query("select set_config('cp.submission', 'on', true)");
          await bump(c, office?.id ?? "", office?.candidateIds[0] ?? null, 5);
        }),
      );
      expect(jump.message).toBe("FORBIDDEN");

      const drop = await dbError(
        db.asOwner((c) =>
          c.query("delete from public.closed_tallies where vote_id = $1", [
            vote.id,
          ]),
        ),
      );
      expect(drop.message).toBe("VOTE_FROZEN");

      const extra = await dbError(
        db.asOwner(async (c) => {
          await c.query("select set_config('cp.activation', 'on', true)");
          await c.query(
            "insert into public.closed_tallies (vote_id, office_id, candidate_id) values ($1, $2, null)",
            [vote.id, office?.id],
          );
        }),
      );
      expect(extra.message).toBe("FORBIDDEN");
    });

    it("accepts a ballot that increments every office exactly once", async () => {
      const [president, treasurer] = vote.offices;
      await db.asOwner(async (c) => {
        await ballot(c, world.alice.householdId);
        await bump(c, president?.id ?? "", president?.candidateIds[0] ?? null);
        await bump(c, treasurer?.id ?? "", null); // explicit NOTA choice
      });
      const totals = await db.asOwner((c) =>
        c.query<{ total: string }>(
          "select sum(accepted_count) as total from public.closed_tallies where vote_id = $1",
          [vote.id],
        ),
      );
      expect(totals.rows[0]?.total).toBe("2");
    });

    it("rolls back a ballot that leaves an office uncounted", async () => {
      const president = vote.offices[0];
      const error = await dbError(
        db.asOwner(async (c) => {
          await ballot(c, world.bob.householdId);
          await bump(
            c,
            president?.id ?? "",
            president?.candidateIds[1] ?? null,
          );
        }),
      );
      expect(error.message).toBe("INVARIANT_VIOLATION");

      const participation = await db.asOwner((c) =>
        c.query(
          "select 1 from public.participation where vote_id = $1 and household_id = $2",
          [vote.id, world.bob.householdId],
        ),
      );
      expect(participation.rowCount).toBe(0);
    });

    it("stores no identity, timestamp or choice linkage next to counters or participation", async () => {
      const columns = async (table: string) =>
        (
          await db.asSuperuser((c) =>
            c.query<{ column_name: string }>(
              `select column_name from information_schema.columns
                where table_schema = 'public' and table_name = $1 order by ordinal_position`,
              [table],
            ),
          )
        ).rows.map((row) => row.column_name);

      expect(await columns("closed_tallies")).toEqual([
        "id",
        "vote_id",
        "office_id",
        "candidate_id",
        "accepted_count",
      ]);
      expect(await columns("participation")).toEqual([
        "vote_id",
        "household_id",
        "accepted_at",
      ]);
      expect(await columns("open_responses")).toEqual([
        "vote_id",
        "household_id",
        "option_id",
      ]);
    });
  });

  describe("audit, profiles and data constraints", () => {
    it("keeps audit events append-only even for the owner", async () => {
      await db
        .asDeployment((c) =>
          c.query(
            "select app_private.deployment_initialize_settings('RWA', 'Asia/Kolkata')",
          ),
        )
        .catch(() => undefined);
      const id = await db.asSuperuser(async (c) => {
        const existing = await c.query<{ id: string }>(
          "select id from public.audit_events limit 1",
        );
        return existing.rows[0]?.id;
      });
      expect(id).toBeDefined();
      for (const sql of [
        "update public.audit_events set reason = 'edited'",
        "delete from public.audit_events",
        "truncate public.audit_events",
      ]) {
        const error = await dbError(db.asOwner((c) => c.query(sql)));
        expect(error.message, sql).toBe("IMMUTABLE_RECORD");
      }
    });

    it("keeps soft-deleted profiles deleted and profile identity stable", async () => {
      await db.asOwner((c) =>
        c.query(
          "update public.profiles set status = 'DELETED', deleted_at = now() where id = $1",
          [world.dave.id],
        ),
      );
      const restore = await dbError(
        db.asOwner((c) =>
          c.query(
            "update public.profiles set status = 'ENABLED', deleted_at = null where id = $1",
            [world.dave.id],
          ),
        ),
      );
      expect(restore.message).toBe("LIFECYCLE_CONFLICT");

      const rename = await dbError(
        db.asOwner((c) =>
          c.query(
            "update public.profiles set id = gen_random_uuid() where id = $1",
            [world.alice.id],
          ),
        ),
      );
      expect(rename.message).toBe("IMMUTABLE_IDENTITY");
    });

    it("rejects duplicate normalised households and inconsistent keys", async () => {
      const duplicate = await dbError(
        db.asOwner((c) =>
          c.query(
            `insert into public.households (identifier, identifier_normalized, representative_profile_id)
             values ('a-101', app_private.normalize_key('a-101'), $1)`,
            [world.admin.id],
          ),
        ),
      );
      expect(duplicate.code).toBe(UNIQUE_VIOLATION);

      const wrongKey = await dbError(
        db.asOwner((c) =>
          c.query(
            `insert into public.households (identifier, identifier_normalized, representative_profile_id)
             values ('Z-900', 'not-the-key', $1)`,
            [world.admin.id],
          ),
        ),
      );
      expect(wrongKey.code).toBe(CHECK_VIOLATION);
    });

    it("rejects control characters, markup, untrimmed and oversized text", async () => {
      const attempts = [
        "Bad\nName",
        "<b>Name</b>",
        " Padded",
        "x".repeat(201),
        "",
      ];
      for (const name of attempts) {
        const error = await dbError(
          db.asOwner((c) =>
            c.query(
              "insert into public.poll_options (vote_id, label, position) select id, $1, 9 from public.votes limit 1",
              [name],
            ),
          ),
        );
        expect([CHECK_VIOLATION, "P0001"]).toContain(error.code);
      }
    });

    it("rejects unknown settings approval keys and unsupported audit actions", async () => {
      const key = await dbError(
        db.asDeployment((c) =>
          c.query(
            "update public.rwa_settings set policy_approvals = '{\"A9\":{}}'::jsonb",
          ),
        ),
      );
      expect(key.code).toBe(CHECK_VIOLATION);

      const action = await dbError(
        db.asOwner((c) =>
          c.query(
            "insert into public.audit_events (actor_kind, action, target_type, target_id) values ('SYSTEM', 'ANYTHING', 'VOTE', '1')",
          ),
        ),
      );
      expect(action.code).toBe(CHECK_VIOLATION);
    });
  });

  describe("indexes", () => {
    it("creates the query-driven indexes from the schema design", async () => {
      const result = await db.asSuperuser((c) =>
        c.query<{ indexname: string }>(
          "select indexname from pg_indexes where schemaname = 'public'",
        ),
      );
      const names = new Set(result.rows.map((row) => row.indexname));
      for (const expected of [
        "electorate_representative_vote_idx",
        "electorate_household_vote_idx",
        "open_responses_option_idx",
        "votes_created_idx",
        "votes_creator_idx",
        "votes_due_idx",
        "audit_events_occurred_idx",
        "audit_events_actor_idx",
        "rate_limit_buckets_expiry_idx",
        "closed_tallies_candidate_key",
        "closed_tallies_abstention_key",
        "closed_tallies_vote_office_idx",
      ]) {
        expect(names.has(expected), expected).toBe(true);
      }
    });
  });
});
