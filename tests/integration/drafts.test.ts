import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";

const UNKNOWN = "00000000-0000-4000-8000-000000000099";
const PERMISSION_DENIED = "42501";

interface Detail {
  id: string;
  votingType: "OPEN" | "CLOSED";
  status: string;
  title: string;
  instructions: string | null;
  closesAt: string | null;
  draftRevision: number;
  timezone: string | null;
  offices: {
    id: string;
    name: string;
    position: number;
    candidates: { id: string; name: string; position: number }[];
  }[];
  options: { id: string; label: string; position: number }[];
  eligibleHouseholdIds: string[];
}

interface Preview {
  revision: number;
  readyToActivate: boolean;
  blockers: { code: string; section: string; message: string }[];
  electorate: { selected: number; eligibleWithEnabledRepresentative: number };
  vote: Detail;
}

const FUTURE = "2099-01-01T12:00:00+05:30";

describe.skipIf(!hasDatabase)("draft routines", () => {
  let db: TestDatabase;
  let world: World;

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
    await db.asDeployment((c) =>
      c.query(
        "select app_private.deployment_initialize_settings('Lakeview RWA', 'Asia/Kolkata')",
      ),
    );
  });
  afterAll(async () => {
    await db?.drop();
  });

  const call = <T>(sub: string | null, sql: string, params: unknown[] = []) =>
    db
      .asRole(
        sub ? "authenticated" : "anon",
        sub ? { sub } : null,
        (c) => c.query<{ result: T }>(`select ${sql} as result`, params),
        { commit: true },
      )
      .then((r) => r.rows[0]?.result as T);

  const admin = () => world.admin.id;

  const create = (type: string, sub: string | null = admin()) =>
    call<Detail>(sub, "public.create_draft($1)", [type]);
  const update = (
    id: string,
    revision: number | null,
    changes: unknown,
    sub: string | null = admin(),
  ) =>
    call<Detail>(sub, "public.update_draft($1, $2, $3::jsonb)", [
      id,
      revision,
      JSON.stringify(changes),
    ]);
  const read = (id: string, sub: string | null = admin()) =>
    call<Detail>(sub, "public.get_admin_vote($1)", [id]);
  const preview = (id: string, revision: number, sub = admin()) =>
    call<Preview>(sub, "public.preview_draft($1, $2)", [id, revision]);

  const audit = async (id: string) =>
    (
      await db.asSuperuser((c) =>
        c.query<{ action: string; details: Record<string, unknown> }>(
          "select action, details from public.audit_events where target_id = $1 order by id",
          [id],
        ),
      )
    ).rows;

  const households = (...people: { householdId: string | null }[]) =>
    people.map((p) => p.householdId as string);

  describe("get_rwa_display", () => {
    it("shows enabled members only the name and time zone", async () => {
      for (const sub of [world.admin.id, world.alice.id]) {
        expect(await call(sub, "public.get_rwa_display()")).toEqual({
          name: "Lakeview RWA",
          timezone: "Asia/Kolkata",
        });
      }
    });

    it("refuses suspended, unknown and anonymous callers", async () => {
      for (const sub of [world.carol.id, UNKNOWN]) {
        expect(
          (await dbError(call(sub, "public.get_rwa_display()"))).message,
        ).toBe("FORBIDDEN");
      }
      expect((await dbError(call(null, "public.get_rwa_display()"))).code).toBe(
        PERMISSION_DENIED,
      );
    });

    it("does not widen access to the settings table itself", async () => {
      const error = await dbError(
        db.asRole("authenticated", { sub: world.admin.id }, (c) =>
          c.query("select policy_approvals from public.rwa_settings"),
        ),
      );
      expect(error.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("authorization", () => {
    it("requires a current enabled administrator for every routine", async () => {
      const draft = await create("OPEN");
      for (const sub of [world.alice.id, world.carol.id, UNKNOWN]) {
        expect((await dbError(create("OPEN", sub))).message).toBe("FORBIDDEN");
        expect(
          (await dbError(update(draft.id, 1, { title: "x" }, sub))).message,
        ).toBe("FORBIDDEN");
        expect((await dbError(read(draft.id, sub))).message).toBe("FORBIDDEN");
        expect((await dbError(preview(draft.id, 1, sub))).message).toBe(
          "FORBIDDEN",
        );
      }
    });

    it("denies anonymous callers at the grant level", async () => {
      const draft = await create("OPEN");
      for (const sql of [
        () => create("OPEN", null),
        () => update(draft.id, 1, { title: "x" }, null),
        () => read(draft.id, null),
        () => call(null, "public.preview_draft($1, 1)", [draft.id]),
      ]) {
        expect((await dbError(sql())).code).toBe(PERMISSION_DENIED);
      }
    });

    it("keeps the helpers out of reach of API roles", async () => {
      for (const role of ["anon", "authenticated"] as const) {
        const error = await dbError(
          db.asRole(
            role,
            role === "authenticated" ? { sub: world.admin.id } : null,
            (c) =>
              c.query(
                "select app_private.apply_options(gen_random_uuid(), '[]')",
              ),
          ),
        );
        expect(error.code).toBe(PERMISSION_DENIED);
      }
    });

    it("cannot be bypassed by writing the tables directly", async () => {
      const draft = await create("OPEN");
      const error = await dbError(
        db.asRole("authenticated", { sub: world.admin.id }, (c) =>
          c.query("update public.votes set title = 'x' where id = $1", [
            draft.id,
          ]),
        ),
      );
      expect(error.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("create_draft", () => {
    it("creates an incomplete revision-1 draft with the explicit type, and audits it", async () => {
      const open = await create("OPEN");
      expect(open).toMatchObject({
        votingType: "OPEN",
        status: "DRAFT",
        title: "",
        draftRevision: 1,
        closesAt: null,
        timezone: "Asia/Kolkata",
        offices: [],
        options: [],
        eligibleHouseholdIds: [],
      });
      const closed = await create("CLOSED");
      expect(closed.votingType).toBe("CLOSED");
      expect(await audit(open.id)).toMatchObject([
        { action: "DRAFT_CREATED", details: { votingType: "OPEN" } },
      ]);
    });

    it("rejects a missing or unknown type", async () => {
      for (const type of ["open", "BOTH", ""]) {
        expect((await dbError(create(type))).message).toBe("VALIDATION_FAILED");
      }
      expect(
        (
          await dbError(
            db.asRole("authenticated", { sub: world.admin.id }, (c) =>
              c.query("select public.create_draft(null)"),
            ),
          )
        ).message,
      ).toBe("VALIDATION_FAILED");
    });
  });

  describe("revision control", () => {
    it("increments the revision once per edit and audits the changed fields", async () => {
      const draft = await create("OPEN");
      const one = await update(draft.id, 1, {
        title: "  Park renovation?  ",
        instructions: "Pick one.\r\nThen review.",
      });
      expect(one).toMatchObject({
        draftRevision: 2,
        title: "Park renovation?",
        instructions: "Pick one.\nThen review.",
      });
      const two = await update(draft.id, 2, { closesAt: FUTURE });
      expect(two.draftRevision).toBe(3);
      expect(new Date(two.closesAt ?? "").toISOString()).toBe(
        "2099-01-01T06:30:00.000Z",
      );
      expect(await audit(draft.id)).toMatchObject([
        { action: "DRAFT_CREATED" },
        {
          action: "DRAFT_UPDATED",
          details: { fields: ["instructions", "title"], draftRevision: 2 },
        },
        {
          action: "DRAFT_UPDATED",
          details: { fields: ["closesAt"], draftRevision: 3 },
        },
      ]);
    });

    it("rejects a missing or malformed revision, and a stale one without changing anything", async () => {
      const draft = await create("OPEN");
      for (const revision of [null, 0, -1]) {
        expect(
          (await dbError(update(draft.id, revision, { title: "x" }))).message,
        ).toBe("VALIDATION_FAILED");
      }
      await update(draft.id, 1, { title: "Newest" });
      const stale = await dbError(update(draft.id, 1, { title: "Older" }));
      expect(stale.message).toBe("STALE_REVISION");
      expect(await read(draft.id)).toMatchObject({
        title: "Newest",
        draftRevision: 2,
      });
    });

    it("treats an empty change set as no edit", async () => {
      const draft = await create("OPEN");
      const same = await update(draft.id, 1, {});
      expect(same.draftRevision).toBe(1);
      expect(await audit(draft.id)).toHaveLength(1);
    });

    it("lets exactly one of two concurrent edits at the same revision win", async () => {
      const draft = await create("OPEN");
      const results = await Promise.allSettled([
        update(draft.id, 1, { title: "First" }),
        update(draft.id, 1, { title: "Second" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failure = results.find((r) => r.status === "rejected");
      expect((failure as PromiseRejectedResult).reason.message).toBe(
        "STALE_REVISION",
      );
      expect((await read(draft.id)).draftRevision).toBe(2);
    });

    it("answers unknown votes with not found and rejects unknown fields", async () => {
      expect((await dbError(update(UNKNOWN, 1, { title: "x" }))).message).toBe(
        "NOT_FOUND",
      );
      const draft = await create("OPEN");
      for (const changes of [
        { status: "ACTIVE" },
        { draftRevision: 9 },
        { createdBy: UNKNOWN },
        { title: 5 },
        { closesAt: "2099-01-01T12:00:00" },
        { closesAt: "tomorrow" },
        { instructions: "" },
      ]) {
        expect((await dbError(update(draft.id, 1, changes))).message).toBe(
          "VALIDATION_FAILED",
        );
      }
      expect((await read(draft.id)).draftRevision).toBe(1);
    });

    it("rejects markup and control characters", async () => {
      const draft = await create("OPEN");
      for (const title of ["<b>Hi</b>", "bad\u0007title"]) {
        expect((await dbError(update(draft.id, 1, { title }))).message).toBe(
          "VALIDATION_FAILED",
        );
      }
    });
  });

  describe("OPEN ballots", () => {
    it("replaces the options collection and keeps supplied ids stable", async () => {
      const draft = await create("OPEN");
      const first = await update(draft.id, 1, {
        options: [
          { label: "Yes", position: 1 },
          { label: "No", position: 2 },
        ],
      });
      const [yes, no] = first.options;
      expect(first.options.map((o) => o.label)).toEqual(["Yes", "No"]);

      const second = await update(draft.id, 2, {
        options: [
          { id: no?.id, label: "No", position: 1 },
          { id: yes?.id, label: "Yes, please", position: 2 },
          { label: "Abstain later", position: 3 },
        ],
      });
      expect(second.options.map((o) => [o.id, o.label, o.position])).toEqual([
        [no?.id, "No", 1],
        [yes?.id, "Yes, please", 2],
        [expect.any(String), "Abstain later", 3],
      ]);

      const third = await update(draft.id, 3, {
        options: [{ id: yes?.id, label: "Yes, please", position: 1 }],
      });
      expect(third.options).toHaveLength(1);
    });

    it("leaves collections alone when omitted and empties them when supplied empty", async () => {
      const draft = await create("OPEN");
      await update(draft.id, 1, {
        options: [
          { label: "A", position: 1 },
          { label: "B", position: 2 },
        ],
      });
      const titled = await update(draft.id, 2, { title: "Only the title" });
      expect(titled.options).toHaveLength(2);
      const emptied = await update(draft.id, 3, { options: [] });
      expect(emptied.options).toEqual([]);
    });

    it("rejects duplicate normalised labels, positions and ids, and foreign ids", async () => {
      const draft = await create("OPEN");
      const other = await create("OPEN");
      const theirs = await update(other.id, 1, {
        options: [{ label: "Theirs", position: 1 }],
      });
      const cases = [
        [
          { label: "Same", position: 1 },
          { label: "  ＳＡＭＥ ", position: 2 },
        ],
        [
          { label: "A", position: 1 },
          { label: "B", position: 1 },
        ],
        [{ label: "A", position: 0 }],
        [{ label: "A", position: 1.5 }],
        [{ label: "", position: 1 }],
        [{ label: "A", position: 1, extra: true }],
        [{ id: theirs.options[0]?.id, label: "Stolen", position: 1 }],
        [{ id: UNKNOWN, label: "Missing", position: 1 }],
      ];
      for (const options of cases) {
        expect((await dbError(update(draft.id, 1, { options }))).message).toBe(
          "VALIDATION_FAILED",
        );
      }
      // The other draft was never touched.
      expect((await read(other.id)).options).toHaveLength(1);
      expect((await read(draft.id)).draftRevision).toBe(1);
    });

    it("rejects offices on an OPEN vote and does not reinterpret options", async () => {
      const draft = await create("OPEN");
      const error = await dbError(
        update(draft.id, 1, {
          offices: [
            {
              name: "Chair",
              position: 1,
              candidates: [{ name: "A", position: 1 }],
            },
          ],
        }),
      );
      expect(error.message).toBe("VALIDATION_FAILED");
    });
  });

  describe("CLOSED ballots", () => {
    const ballot = {
      offices: [
        {
          name: "Chair",
          position: 1,
          candidates: [
            { name: "Asha", position: 1 },
            { name: "Ravi", position: 2 },
          ],
        },
        {
          name: "Treasurer",
          position: 2,
          candidates: [{ name: "Meera", position: 1 }],
        },
      ],
    };

    it("stores offices with candidates, in order, with no abstention rows", async () => {
      const draft = await create("CLOSED");
      const saved = await update(draft.id, 1, ballot);
      expect(
        saved.offices.map((o) => [o.name, o.candidates.map((c) => c.name)]),
      ).toEqual([
        ["Chair", ["Asha", "Ravi"]],
        ["Treasurer", ["Meera"]],
      ]);
      const tallies = await db.asSuperuser((c) =>
        c.query("select 1 from public.closed_tallies where vote_id = $1", [
          draft.id,
        ]),
      );
      expect(tallies.rowCount).toBe(0);
    });

    it("swaps office and candidate positions atomically", async () => {
      const draft = await create("CLOSED");
      const saved = await update(draft.id, 1, ballot);
      const [chair, treasurer] = saved.offices;
      const swapped = await update(draft.id, 2, {
        offices: [
          {
            id: treasurer?.id,
            name: "Treasurer",
            position: 1,
            candidates: treasurer?.candidates.map((c) => ({ ...c })),
          },
          {
            id: chair?.id,
            name: "Chair",
            position: 2,
            candidates: [
              { id: chair?.candidates[1]?.id, name: "Ravi", position: 1 },
              { id: chair?.candidates[0]?.id, name: "Asha", position: 2 },
            ],
          },
        ],
      });
      expect(swapped.offices.map((o) => o.name)).toEqual([
        "Treasurer",
        "Chair",
      ]);
      expect(swapped.offices[1]?.candidates.map((c) => c.name)).toEqual([
        "Ravi",
        "Asha",
      ]);
    });

    it("requires supplied candidate ids to belong to that very office", async () => {
      const draft = await create("CLOSED");
      const saved = await update(draft.id, 1, ballot);
      const [chair, treasurer] = saved.offices;
      const moved = await dbError(
        update(draft.id, 2, {
          offices: [
            {
              id: treasurer?.id,
              name: "Treasurer",
              position: 2,
              candidates: [
                // Ravi belongs to Chair, not to Treasurer.
                { id: chair?.candidates[1]?.id, name: "Ravi", position: 1 },
              ],
            },
          ],
        }),
      );
      expect(moved.message).toBe("VALIDATION_FAILED");

      const fresh = await dbError(
        update(draft.id, 2, {
          offices: [
            {
              name: "New office",
              position: 3,
              candidates: [
                { id: chair?.candidates[0]?.id, name: "Asha", position: 1 },
              ],
            },
          ],
        }),
      );
      expect(fresh.message).toBe("VALIDATION_FAILED");
      expect(await read(draft.id)).toMatchObject({ draftRevision: 2 });
    });

    it("rejects duplicate normalised names within an office and across offices", async () => {
      const draft = await create("CLOSED");
      const duplicateCandidate = {
        offices: [
          {
            name: "Chair",
            position: 1,
            candidates: [
              { name: "Asha Rao", position: 1 },
              { name: "asha   rao", position: 2 },
            ],
          },
        ],
      };
      const duplicateOffice = {
        offices: [
          { name: "Chair", position: 1, candidates: [] },
          { name: " CHAIR ", position: 2, candidates: [] },
        ],
      };
      for (const changes of [duplicateCandidate, duplicateOffice]) {
        expect((await dbError(update(draft.id, 1, changes))).message).toBe(
          "VALIDATION_FAILED",
        );
      }
    });

    it("allows the same candidate name in different offices", async () => {
      const draft = await create("CLOSED");
      const saved = await update(draft.id, 1, {
        offices: [
          {
            name: "Chair",
            position: 1,
            candidates: [{ name: "Asha", position: 1 }],
          },
          {
            name: "Secretary",
            position: 2,
            candidates: [{ name: "Asha", position: 1 }],
          },
        ],
      });
      expect(saved.offices).toHaveLength(2);
    });

    it("rejects options on a CLOSED vote", async () => {
      const draft = await create("CLOSED");
      expect(
        (
          await dbError(
            update(draft.id, 1, { options: [{ label: "Yes", position: 1 }] }),
          )
        ).message,
      ).toBe("VALIDATION_FAILED");
    });
  });

  describe("type changes", () => {
    it("atomically removes the incompatible children and never reinterprets them", async () => {
      const draft = await create("OPEN");
      await update(draft.id, 1, {
        options: [
          { label: "Yes", position: 1 },
          { label: "No", position: 2 },
        ],
      });
      const closed = await update(draft.id, 2, { votingType: "CLOSED" });
      expect(closed).toMatchObject({
        votingType: "CLOSED",
        options: [],
        offices: [],
        draftRevision: 3,
      });

      await update(draft.id, 3, {
        offices: [
          {
            name: "Chair",
            position: 1,
            candidates: [{ name: "Asha", position: 1 }],
          },
        ],
      });
      const open = await update(draft.id, 4, { votingType: "OPEN" });
      expect(open).toMatchObject({
        votingType: "OPEN",
        offices: [],
        options: [],
      });
      const leftovers = await db.asSuperuser((c) =>
        c.query(
          "select (select count(*) from public.offices where vote_id = $1) as o, (select count(*) from public.candidates c join public.offices o on o.id = c.office_id where o.vote_id = $1) as c",
          [draft.id],
        ),
      );
      expect(leftovers.rows[0]).toEqual({ o: "0", c: "0" });
    });

    it("accepts the new type's collection in the same edit", async () => {
      const draft = await create("OPEN");
      const saved = await update(draft.id, 1, {
        votingType: "CLOSED",
        offices: [
          {
            name: "Chair",
            position: 1,
            candidates: [{ name: "Asha", position: 1 }],
          },
        ],
      });
      expect(saved.votingType).toBe("CLOSED");
      expect(saved.offices).toHaveLength(1);
    });

    it("rejects a mixed shape in a single edit", async () => {
      const draft = await create("OPEN");
      const error = await dbError(
        update(draft.id, 1, {
          options: [{ label: "Yes", position: 1 }],
          offices: [
            {
              name: "Chair",
              position: 1,
              candidates: [{ name: "A", position: 1 }],
            },
          ],
        }),
      );
      expect(error.message).toBe("VALIDATION_FAILED");
    });
  });

  describe("electorate", () => {
    it("replaces the selected set and rejects duplicates and unknown households", async () => {
      const draft = await create("OPEN");
      const two = await update(draft.id, 1, {
        eligibleHouseholdIds: households(world.alice, world.bob),
      });
      expect(two.eligibleHouseholdIds.sort()).toEqual(
        households(world.alice, world.bob).sort(),
      );
      const one = await update(draft.id, 2, {
        eligibleHouseholdIds: households(world.bob),
      });
      expect(one.eligibleHouseholdIds).toEqual(households(world.bob));

      for (const ids of [
        [world.alice.householdId, world.alice.householdId],
        [UNKNOWN],
        ["not-a-uuid"],
      ]) {
        expect(
          (await dbError(update(draft.id, 3, { eligibleHouseholdIds: ids })))
            .message,
        ).toBe("VALIDATION_FAILED");
      }
      expect(
        (await update(draft.id, 3, { eligibleHouseholdIds: [] }))
          .eligibleHouseholdIds,
      ).toEqual([]);
    });

    it("refuses to add an ineligible household but keeps one that became ineligible", async () => {
      await db.asOwner((c) =>
        c.query(
          "update public.households set is_eligible = false where id = $1",
          [world.dave.householdId],
        ),
      );
      const draft = await create("OPEN");
      expect(
        (
          await dbError(
            update(draft.id, 1, {
              eligibleHouseholdIds: households(world.dave),
            }),
          )
        ).message,
      ).toBe("VALIDATION_FAILED");

      await db.asOwner((c) =>
        c.query(
          "update public.households set is_eligible = true where id = $1",
          [world.dave.householdId],
        ),
      );
      await update(draft.id, 1, {
        eligibleHouseholdIds: households(world.dave),
      });
      await db.asOwner((c) =>
        c.query(
          "update public.households set is_eligible = false where id = $1",
          [world.dave.householdId],
        ),
      );
      const kept = await update(draft.id, 2, {
        eligibleHouseholdIds: households(world.dave),
        title: "Still selected",
      });
      expect(kept.eligibleHouseholdIds).toEqual(households(world.dave));
      await db.asOwner((c) =>
        c.query(
          "update public.households set is_eligible = true where id = $1",
          [world.dave.householdId],
        ),
      );
    });

    it("writes no representative snapshot while drafting", async () => {
      const draft = await create("OPEN");
      await update(draft.id, 1, {
        eligibleHouseholdIds: households(world.alice),
      });
      const rows = await db.asSuperuser((c) =>
        c.query(
          "select representative_profile_id, representative_name_snapshot from public.electorate where vote_id = $1",
          [draft.id],
        ),
      );
      expect(rows.rows).toEqual([
        { representative_profile_id: null, representative_name_snapshot: null },
      ]);
    });
  });

  describe("frozen votes", () => {
    it("rejects edits with VOTE_FROZEN once the vote is no longer a draft", async () => {
      const draft = await create("OPEN");
      await update(draft.id, 1, {
        title: "Frozen",
        closesAt: FUTURE,
        options: [
          { label: "Yes", position: 1 },
          { label: "No", position: 2 },
        ],
        eligibleHouseholdIds: households(world.alice),
      });
      await db.asOwner(async (c) => {
        await c.query("select set_config('cp.activation', 'on', true)");
        await c.query(
          `update public.electorate e
             set representative_profile_id = h.representative_profile_id,
                 representative_name_snapshot = p.representative_name,
                 household_identifier_snapshot = h.identifier
           from public.households h join public.profiles p on p.id = h.representative_profile_id
           where e.vote_id = $1 and h.id = e.household_id`,
          [draft.id],
        );
        await c.query(
          `update public.votes
              set status = 'ACTIVE', activated_at = now(),
                  rwa_name_snapshot = 'RWA', timezone_snapshot = 'Asia/Kolkata',
                  policy_versions_snapshot = '{"A1":"1","A2":"1","A3":"1","A4":"1","A5":"1","A6":"1","A7":"1"}'
            where id = $1`,
          [draft.id],
        );
      });

      const detail = await read(draft.id);
      expect(detail.status).toBe("ACTIVE");
      for (const changes of [
        { title: "Changed" },
        { options: [] },
        { eligibleHouseholdIds: [] },
        { votingType: "CLOSED" },
      ]) {
        expect(
          (await dbError(update(draft.id, detail.draftRevision, changes)))
            .message,
        ).toBe("VOTE_FROZEN");
      }
      expect(
        (await dbError(preview(draft.id, detail.draftRevision))).message,
      ).toBe("LIFECYCLE_CONFLICT");
    });
  });

  describe("preview", () => {
    it("lists safe blockers for an incomplete draft without changing the revision", async () => {
      const draft = await create("CLOSED");
      const result = await preview(draft.id, 1);
      expect(result.readyToActivate).toBe(false);
      expect(result.revision).toBe(1);
      expect(result.blockers.map((b) => b.code)).toEqual(
        expect.arrayContaining([
          "TITLE_REQUIRED",
          "DEADLINE_REQUIRED",
          "ELECTORATE_EMPTY",
          "INSTRUCTIONS_REQUIRED",
          "OFFICES_REQUIRED",
          "POLICY_NOT_READY",
        ]),
      );
      expect((await read(draft.id)).draftRevision).toBe(1);
      expect(await audit(draft.id)).toHaveLength(1);
    });

    it("rejects a stale revision and reports the previewed revision exactly", async () => {
      const draft = await create("OPEN");
      await update(draft.id, 1, { title: "Revised" });
      expect((await dbError(preview(draft.id, 1))).message).toBe(
        "STALE_REVISION",
      );
      expect((await preview(draft.id, 2)).vote.title).toBe("Revised");
    });

    it("flags selected households that are no longer eligible or lack an enabled representative", async () => {
      const draft = await create("OPEN");
      await update(draft.id, 1, {
        eligibleHouseholdIds: households(world.alice, world.bob),
      });
      await db.asOwner((c) =>
        c.query(
          "update public.profiles set status = 'SUSPENDED' where id = $1",
          [world.bob.id],
        ),
      );
      const result = await preview(draft.id, 2);
      expect(result.electorate).toEqual({
        selected: 2,
        eligibleWithEnabledRepresentative: 1,
      });
      expect(result.blockers.map((b) => b.code)).toContain(
        "ELECTORATE_NOT_READY",
      );
      await db.asOwner((c) =>
        c.query("update public.profiles set status = 'ENABLED' where id = $1", [
          world.bob.id,
        ]),
      );
    });

    it("requires two distinct options for OPEN and a candidate in every office for CLOSED", async () => {
      const open = await create("OPEN");
      await update(open.id, 1, { options: [{ label: "Only", position: 1 }] });
      expect((await preview(open.id, 2)).blockers.map((b) => b.code)).toContain(
        "OPTIONS_REQUIRED",
      );

      const closed = await create("CLOSED");
      await update(closed.id, 1, {
        offices: [{ name: "Chair", position: 1, candidates: [] }],
      });
      expect(
        (await preview(closed.id, 2)).blockers.map((b) => b.code),
      ).toContain("CANDIDATES_REQUIRED");
    });

    it("reports a past deadline", async () => {
      const draft = await create("OPEN");
      await update(draft.id, 1, { closesAt: "2020-01-01T00:00:00Z" });
      expect(
        (await preview(draft.id, 2)).blockers.map((b) => b.code),
      ).toContain("DEADLINE_PAST");
    });

    it("is ready when everything required is present, including approvals and retention", async () => {
      await db.asDeployment(async (c) => {
        for (const key of ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]) {
          await c.query(
            "select app_private.deployment_record_policy_approval($1, '1', now(), $2, 'Fixture committee', 'APPROVED')",
            [key, world.admin.id],
          );
        }
        await c.query(
          "select app_private.deployment_set_retention(365, 365, 365, 30, 90)",
        );
      });
      const draft = await create("OPEN");
      await update(draft.id, 1, {
        title: "Ready?",
        closesAt: FUTURE,
        options: [
          { label: "Yes", position: 1 },
          { label: "No", position: 2 },
        ],
        eligibleHouseholdIds: households(world.alice, world.bob),
      });
      const result = await preview(draft.id, 2);
      expect(result.blockers).toEqual([]);
      expect(result.readyToActivate).toBe(true);
    });
  });
});
