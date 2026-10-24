import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type Person, type World } from "./support/fixtures";

const UNKNOWN = "00000000-0000-4000-8000-000000000099";
const PERMISSION_DENIED = "42501";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Detail {
  id: string;
  votingType: "OPEN" | "CLOSED";
  status: string;
  draftRevision: number;
  closesAt: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  completionMode: string | null;
  completionReason: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  rwaName: string | null;
  timezone: string | null;
}
interface Outcome {
  applied: boolean;
  reason?: string;
  vote: Detail;
}

describe.skipIf(!hasDatabase)("activation and lifecycle routines", () => {
  let db: TestDatabase;
  let world: World;

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
    await db.asDeployment(async (c) => {
      await c.query(
        "select app_private.deployment_initialize_settings('Lakeview RWA', 'Asia/Kolkata')",
      );
      for (const key of ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]) {
        await c.query(
          "select app_private.deployment_record_policy_approval($1, $2, now(), $3, 'Fixture committee', 'APPROVED')",
          [key, `v-${key}`, world.admin.id],
        );
      }
      await c.query(
        "select app_private.deployment_set_retention(365, 365, 365, 30, 90)",
      );
    });
  });
  afterAll(async () => {
    await db?.drop();
  });

  const admin = () => world.admin.id;
  const call = <T>(sub: string | null, sql: string, params: unknown[] = []) =>
    db
      .asRole(
        sub ? "authenticated" : "anon",
        sub ? { sub } : null,
        (c) => c.query<{ result: T }>(`select ${sql} as result`, params),
        { commit: true },
      )
      .then((r) => r.rows[0]?.result as T);

  const create = (type: "OPEN" | "CLOSED") =>
    call<Detail>(admin(), "public.create_draft($1)", [type]);
  const update = (id: string, revision: number, changes: unknown) =>
    call<Detail>(admin(), "public.update_draft($1, $2, $3::jsonb)", [
      id,
      revision,
      JSON.stringify(changes),
    ]);
  const read = (id: string) =>
    call<Detail>(admin(), "public.get_admin_vote($1)", [id]);
  const activate = (
    id: string,
    revision: number,
    confirmed = true,
    sub: string | null = admin(),
  ) =>
    call<Detail>(sub, "public.activate_vote($1, $2, $3)", [
      id,
      revision,
      confirmed,
    ]);
  const complete = (id: string, reason: string, confirmed = true) =>
    call<Outcome>(admin(), "public.complete_vote_early($1, $2, $3)", [
      id,
      confirmed,
      reason,
    ]);
  const cancel = (id: string, reason: string, confirmed = true) =>
    call<Outcome>(admin(), "public.cancel_vote($1, $2, $3)", [
      id,
      confirmed,
      reason,
    ]);
  const runCron = () =>
    db.asSuperuser(async (c) => {
      await c.query("begin");
      await c.query("set local role cp_scheduler");
      const result = await c.query<{
        r: { completed: number; blocked: number };
      }>("select public.complete_due_votes() as r");
      await c.query("commit");
      return result.rows[0]?.r as { completed: number; blocked: number };
    });

  const ids = (...people: Person[]) => people.map((p) => p.householdId);

  /** A complete draft that previews as ready. Returns the detail at its saved revision. */
  async function readyDraft(
    type: "OPEN" | "CLOSED" = "OPEN",
    options: { closesInMs?: number; people?: Person[] } = {},
  ): Promise<Detail> {
    const draft = await create(type);
    const closesAt = new Date(
      Date.now() + (options.closesInMs ?? 3_600_000),
    ).toISOString();
    const people = options.people ?? [world.alice, world.bob];
    return update(
      draft.id,
      1,
      type === "OPEN"
        ? {
            title: "Repaint?",
            closesAt,
            options: [
              { label: "Yes", position: 1 },
              { label: "No", position: 2 },
            ],
            eligibleHouseholdIds: ids(...people),
          }
        : {
            title: "Committee",
            instructions: "One per office.",
            closesAt,
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
            eligibleHouseholdIds: ids(...people),
          },
    );
  }

  const rows = async <T extends object>(sql: string, params: unknown[] = []) =>
    (await db.asSuperuser((c) => c.query<T>(sql, params))).rows;
  const audit = (id: string) =>
    rows<{
      action: string;
      actor_kind: string;
      reason: string | null;
      details: Record<string, unknown>;
    }>(
      "select action, actor_kind, reason, details from public.audit_events where target_id = $1 order by id",
      [id],
    );

  describe("authorization", () => {
    it("requires a current enabled administrator for every lifecycle routine", async () => {
      const draft = await readyDraft();
      for (const sub of [world.alice.id, world.carol.id, UNKNOWN]) {
        expect((await dbError(activate(draft.id, 2, true, sub))).message).toBe(
          "FORBIDDEN",
        );
        expect(
          (
            await dbError(
              call(sub, "public.complete_vote_early($1, true, 'x')", [
                draft.id,
              ]),
            )
          ).message,
        ).toBe("FORBIDDEN");
        expect(
          (
            await dbError(
              call(sub, "public.cancel_vote($1, true, 'x')", [draft.id]),
            )
          ).message,
        ).toBe("FORBIDDEN");
      }
      for (const attempt of [
        () => activate(draft.id, 2, true, null),
        () =>
          call(null, "public.complete_vote_early($1, true, 'x')", [draft.id]),
        () => call(null, "public.cancel_vote($1, true, 'x')", [draft.id]),
      ]) {
        expect((await dbError(attempt())).code).toBe(PERMISSION_DENIED);
      }
      expect((await read(draft.id)).status).toBe("DRAFT");
    });

    it("keeps maintenance away from every user and API role", async () => {
      for (const [role, claims] of [
        ["anon", null],
        ["authenticated", { sub: world.admin.id }],
        ["service_role", { role: "service_role" }],
      ] as const) {
        const error = await dbError(
          db.asRole(role, claims, (c) =>
            c.query("select public.complete_due_votes()"),
          ),
        );
        expect(error.code, role).toBe(PERMISSION_DENIED);
      }
    });

    it("gives the scheduling role nothing but the completion entry point", async () => {
      const denied = async (sql: string) =>
        dbError(
          db.asSuperuser(async (c) => {
            await c.query("begin");
            try {
              await c.query("set local role cp_scheduler");
              await c.query(sql);
            } finally {
              await c.query("rollback");
            }
          }),
        );
      for (const sql of [
        "select * from public.votes",
        "select * from public.participation",
        "select * from public.closed_tallies",
        "select public.activate_vote(gen_random_uuid(), 1, true)",
        "select public.reconcile_vote(gen_random_uuid())",
        "select app_private.complete_if_due(gen_random_uuid())",
      ]) {
        expect((await denied(sql)).code, sql).toBe(PERMISSION_DENIED);
      }
    });

    it("lets only the server's service role reconcile one vote", async () => {
      const draft = await readyDraft();
      const asService = await db.asRole(
        "service_role",
        { role: "service_role" },
        (c) =>
          c.query<{ r: { completed: boolean } }>(
            "select public.reconcile_vote($1) as r",
            [draft.id],
          ),
      );
      expect(asService.rows[0]?.r).toEqual({ completed: false });
      for (const [role, claims] of [
        ["anon", null],
        ["authenticated", { sub: world.admin.id }],
      ] as const) {
        const error = await dbError(
          db.asRole(role, claims, (c) =>
            c.query("select public.reconcile_vote($1)", [draft.id]),
          ),
        );
        expect(error.code).toBe(PERMISSION_DENIED);
      }
    });
  });

  describe("activation", () => {
    it("freezes an OPEN draft: snapshots, representatives, policy versions, audit", async () => {
      const draft = await readyDraft("OPEN");
      const active = await activate(draft.id, draft.draftRevision);

      expect(active).toMatchObject({
        status: "ACTIVE",
        draftRevision: draft.draftRevision,
        rwaName: "Lakeview RWA",
        timezone: "Asia/Kolkata",
        completedAt: null,
      });
      expect(new Date(active.activatedAt ?? "").getTime()).toBeLessThan(
        new Date(active.closesAt ?? "").getTime(),
      );

      const snapshot = await rows<{
        representative_name_snapshot: string;
        household_identifier_snapshot: string;
        representative_profile_id: string;
      }>(
        `select representative_name_snapshot, household_identifier_snapshot, representative_profile_id
         from public.electorate where vote_id = $1 order by household_identifier_snapshot`,
        [draft.id],
      );
      expect(snapshot).toEqual([
        {
          representative_name_snapshot: "Alice Rao",
          household_identifier_snapshot: "A-101",
          representative_profile_id: world.alice.id,
        },
        {
          representative_name_snapshot: "Bob Iyer",
          household_identifier_snapshot: "B-202",
          representative_profile_id: world.bob.id,
        },
      ]);

      const versions = await rows<{
        policy_versions_snapshot: Record<string, string>;
      }>("select policy_versions_snapshot from public.votes where id = $1", [
        draft.id,
      ]);
      expect(versions[0]?.policy_versions_snapshot).toEqual({
        A1: "v-A1",
        A2: "v-A2",
        A3: "v-A3",
        A4: "v-A4",
        A5: "v-A5",
        A6: "v-A6",
        A7: "v-A7",
      });
      expect(
        await rows("select 1 from public.closed_tallies where vote_id = $1", [
          draft.id,
        ]),
      ).toHaveLength(0);
      expect(await audit(draft.id)).toMatchObject([
        { action: "DRAFT_CREATED" },
        { action: "DRAFT_UPDATED" },
        {
          action: "VOTE_ACTIVATED",
          actor_kind: "PROFILE",
          details: { votingType: "OPEN", electorate: 2 },
        },
      ]);
    });

    it("initialises one zero counter per candidate plus one abstention per office for CLOSED", async () => {
      const draft = await readyDraft("CLOSED");
      await activate(draft.id, draft.draftRevision);
      const tallies = await rows<{
        office: string;
        candidate: string | null;
        accepted_count: string;
      }>(
        `select o.name as office, c.name as candidate, t.accepted_count::text
         from public.closed_tallies t
         join public.offices o on o.id = t.office_id
         left join public.candidates c on c.id = t.candidate_id
         where t.vote_id = $1 order by o.position, c.position nulls last`,
        [draft.id],
      );
      expect(tallies).toEqual([
        { office: "Chair", candidate: "Asha", accepted_count: "0" },
        { office: "Chair", candidate: "Ravi", accepted_count: "0" },
        { office: "Chair", candidate: null, accepted_count: "0" },
        { office: "Treasurer", candidate: "Meera", accepted_count: "0" },
        { office: "Treasurer", candidate: null, accepted_count: "0" },
      ]);
    });

    it("needs explicit confirmation and the exact previewed revision", async () => {
      const draft = await readyDraft();
      expect((await dbError(activate(draft.id, 2, false))).message).toBe(
        "VALIDATION_FAILED",
      );
      expect(
        (
          await dbError(
            call(admin(), "public.activate_vote($1, 2, null)", [draft.id]),
          )
        ).message,
      ).toBe("VALIDATION_FAILED");
      expect((await dbError(activate(draft.id, 0))).message).toBe(
        "VALIDATION_FAILED",
      );

      // A preview of revision 2 cannot authorise newer content.
      await update(draft.id, 2, { title: "Edited after preview" });
      expect((await dbError(activate(draft.id, 2))).message).toBe(
        "STALE_REVISION",
      );
      expect((await read(draft.id)).status).toBe("DRAFT");
    });

    it("blocks an incomplete draft and changes nothing", async () => {
      const draft = await create("CLOSED");
      const error = await dbError(activate(draft.id, 1));
      expect(error.message).toBe("ACTIVATION_BLOCKED");
      expect(await read(draft.id)).toMatchObject({
        status: "DRAFT",
        draftRevision: 1,
      });
      expect(
        await rows("select 1 from public.closed_tallies where vote_id = $1", [
          draft.id,
        ]),
      ).toHaveLength(0);
      expect(await audit(draft.id)).toHaveLength(1);
    });

    it("blocks when a selected representative stopped being enabled or eligible", async () => {
      const draft = await readyDraft();
      await db.asOwner((c) =>
        c.query(
          "update public.profiles set status = 'SUSPENDED' where id = $1",
          [world.bob.id],
        ),
      );
      expect((await dbError(activate(draft.id, 2))).message).toBe(
        "ACTIVATION_BLOCKED",
      );
      await db.asOwner((c) =>
        c.query("update public.profiles set status = 'ENABLED' where id = $1", [
          world.bob.id,
        ]),
      );
      expect((await activate(draft.id, 2)).status).toBe("ACTIVE");
    });

    it("blocks without current approvals, then works once they are recorded again", async () => {
      const draft = await readyDraft();
      await db.asDeployment((c) =>
        c.query(
          "select app_private.deployment_invalidate_policy_approval('A3', 'Reopened by the committee')",
        ),
      );
      expect((await dbError(activate(draft.id, 2))).message).toBe(
        "ACTIVATION_BLOCKED",
      );
      await db.asDeployment((c) =>
        c.query(
          "select app_private.deployment_record_policy_approval('A3', 'v-A3', now(), $1, 'Fixture committee', 'APPROVED')",
          [world.admin.id],
        ),
      );
      expect((await activate(draft.id, 2)).status).toBe("ACTIVE");
    });

    it("rechecks the deadline with the database clock at the moment of activation", async () => {
      const draft = await readyDraft("OPEN", { closesInMs: 1_500 });
      await sleep(1_800);
      expect((await dbError(activate(draft.id, 2))).message).toBe(
        "ACTIVATION_BLOCKED",
      );
      expect((await read(draft.id)).status).toBe("DRAFT");
    });

    it("cannot activate twice, and a repeat names the current state", async () => {
      const draft = await readyDraft();
      await activate(draft.id, 2);
      const again = await dbError(activate(draft.id, 2));
      expect(again).toMatchObject({
        message: "LIFECYCLE_CONFLICT",
        detail: "ACTIVE",
      });
    });

    it("lets exactly one of two concurrent activations win", async () => {
      const draft = await readyDraft();
      const results = await Promise.allSettled([
        activate(draft.id, 2),
        activate(draft.id, 2),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
          .reason.message,
      ).toBe("LIFECYCLE_CONFLICT");
      expect(
        await audit(draft.id).then((a) =>
          a.filter((e) => e.action === "VOTE_ACTIVATED"),
        ),
      ).toHaveLength(1);
    });

    it("serialises a concurrent draft edit and activation: one wins, the other is refused", async () => {
      const draft = await readyDraft();
      const [edit, go] = await Promise.allSettled([
        update(draft.id, 2, { title: "Racing edit" }),
        activate(draft.id, 2),
      ]);
      const winners = [edit, go].filter((r) => r.status === "fulfilled");
      expect(winners).toHaveLength(1);
      const loser = [edit, go].find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      expect(["VOTE_FROZEN", "STALE_REVISION"]).toContain(loser.reason.message);
      const final = await read(draft.id);
      expect(final.status).toBe(go.status === "fulfilled" ? "ACTIVE" : "DRAFT");
    });

    it("makes a register change wait for an in-flight activation, so the snapshot cannot tear", async () => {
      const draft = await readyDraft();
      const times: Record<string, number> = {};
      const activation = db
        .asRole(
          "authenticated",
          { sub: admin() },
          async (c) => {
            await c.query("select public.activate_vote($1, 2, true)", [
              draft.id,
            ]);
            times.activated = Date.now();
            await sleep(1_500);
          },
          { commit: true },
        )
        .then(() => {
          times.activationCommitted = Date.now();
        });

      await sleep(500);
      const rename = db
        .asOwner((c) =>
          c.query(
            "update public.profiles set representative_name = 'Alice Renamed' where id = $1",
            [world.alice.id],
          ),
        )
        .then(() => {
          times.renamed = Date.now();
        });
      await Promise.all([activation, rename]);

      // The register write could only finish after the activation committed...
      expect(times.renamed).toBeGreaterThanOrEqual(
        (times.activationCommitted ?? Infinity) - 50,
      );
      // ...and the frozen snapshot kept the name from the moment of activation.
      const [row] = await rows<{ representative_name_snapshot: string }>(
        `select representative_name_snapshot from public.electorate
         where vote_id = $1 and household_id = $2`,
        [draft.id, world.alice.householdId],
      );
      expect(row?.representative_name_snapshot).toBe("Alice Rao");
      await db.asOwner((c) =>
        c.query(
          "update public.profiles set representative_name = 'Alice Rao' where id = $1",
          [world.alice.id],
        ),
      );
    });

    it("refuses every edit and direct write once active", async () => {
      const draft = await readyDraft();
      await activate(draft.id, 2);
      for (const changes of [
        { title: "Changed" },
        { options: [] },
        { eligibleHouseholdIds: [] },
        { votingType: "CLOSED" },
        { closesAt: "2099-01-01T00:00:00Z" },
      ]) {
        expect((await dbError(update(draft.id, 2, changes))).message).toBe(
          "VOTE_FROZEN",
        );
      }
      expect(
        (
          await dbError(
            call(admin(), "public.preview_draft($1, 2)", [draft.id]),
          )
        ).message,
      ).toBe("LIFECYCLE_CONFLICT");
      const direct = await dbError(
        db.asRole("authenticated", { sub: admin() }, (c) =>
          c.query("update public.votes set closes_at = now() where id = $1", [
            draft.id,
          ]),
        ),
      );
      expect(direct.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("early completion and cancellation", () => {
    it("completes early with a recorded reason, strictly before the deadline", async () => {
      const draft = await readyDraft();
      await activate(draft.id, 2);
      const outcome = await complete(
        draft.id,
        "Everyone has voted.\nClosing now.",
      );
      expect(outcome.applied).toBe(true);
      expect(outcome.vote).toMatchObject({
        status: "COMPLETED",
        completionMode: "EARLY",
        completionReason: "Everyone has voted.\nClosing now.",
      });
      expect(new Date(outcome.vote.completedAt ?? "").getTime()).toBeLessThan(
        new Date(outcome.vote.closesAt ?? "").getTime(),
      );
      const events = (await audit(draft.id)).filter(
        (e) => e.action === "VOTE_COMPLETED",
      );
      expect(events).toMatchObject([
        {
          actor_kind: "PROFILE",
          reason: "Everyone has voted.\nClosing now.",
          details: { completionMode: "EARLY" },
        },
      ]);
    });

    it("cancels with a recorded reason", async () => {
      const draft = await readyDraft("CLOSED");
      await activate(draft.id, 2);
      const outcome = await cancel(draft.id, "Candidate list was wrong.");
      expect(outcome.applied).toBe(true);
      expect(outcome.vote).toMatchObject({
        status: "CANCELLED",
        cancellationReason: "Candidate list was wrong.",
        completedAt: null,
      });
      expect(
        (await audit(draft.id)).filter((e) => e.action === "VOTE_CANCELLED"),
      ).toMatchObject([{ reason: "Candidate list was wrong." }]);
    });

    it("requires confirmation and a clean, non-empty reason", async () => {
      const draft = await readyDraft();
      await activate(draft.id, 2);
      for (const attempt of [
        () => complete(draft.id, "ok", false),
        () => complete(draft.id, ""),
        () => complete(draft.id, "   "),
        () => complete(draft.id, "<b>markup</b>"),
        () => complete(draft.id, "x".repeat(2001)),
        () => cancel(draft.id, "ok", false),
        () => cancel(draft.id, ""),
      ]) {
        expect((await dbError(attempt())).message).toBe("VALIDATION_FAILED");
      }
      expect((await read(draft.id)).status).toBe("ACTIVE");
    });

    it("allows only the legal transitions and names the state on a repeat", async () => {
      const draft = await readyDraft();
      // A draft can be neither completed nor cancelled.
      expect(await dbError(complete(draft.id, "no"))).toMatchObject({
        message: "LIFECYCLE_CONFLICT",
        detail: "DRAFT",
      });
      expect((await dbError(cancel(draft.id, "no"))).message).toBe(
        "LIFECYCLE_CONFLICT",
      );

      await activate(draft.id, 2);
      await complete(draft.id, "Done");
      expect(await dbError(complete(draft.id, "again"))).toMatchObject({
        message: "LIFECYCLE_CONFLICT",
        detail: "COMPLETED",
      });
      expect(await dbError(cancel(draft.id, "too late"))).toMatchObject({
        message: "LIFECYCLE_CONFLICT",
        detail: "COMPLETED",
      });

      const other = await readyDraft();
      await activate(other.id, 2);
      await cancel(other.id, "Stop");
      expect(await dbError(complete(other.id, "x"))).toMatchObject({
        message: "LIFECYCLE_CONFLICT",
        detail: "CANCELLED",
      });
      expect((await dbError(activate(other.id, 2))).message).toBe(
        "LIFECYCLE_CONFLICT",
      );
    });

    it("has no way to reopen, extend, or hand-edit a finished vote", async () => {
      const draft = await readyDraft();
      await activate(draft.id, 2);
      await complete(draft.id, "Done");
      for (const sql of [
        "update public.votes set status = 'ACTIVE' where id = $1",
        "update public.votes set closes_at = closes_at + interval '1 day' where id = $1",
        "update public.votes set title = 'x' where id = $1",
        "delete from public.votes where id = $1",
      ]) {
        const error = await dbError(
          db.asOwner((c) => c.query(sql, [draft.id])),
        );
        expect(["LIFECYCLE_CONFLICT", "VOTE_FROZEN"]).toContain(error.message);
      }
    });
  });

  describe("overdue votes and scheduled completion", () => {
    // All short-lived votes are created together so the suite waits once.
    let due: Detail[];
    let notDue: Detail;

    beforeAll(async () => {
      due = [];
      for (let index = 0; index < 4; index += 1) {
        const draft = await readyDraft("OPEN", { closesInMs: 4_000 });
        due.push(await activate(draft.id, 2));
      }
      notDue = await activate((await readyDraft()).id, 2);
      await sleep(4_300);
    });

    it("completes an overdue vote at its deadline instead of letting it end early, and commits it", async () => {
      const [target] = due;
      const outcome = await complete(target?.id ?? "", "Too late to matter");
      expect(outcome.applied).toBe(false);
      expect(outcome.reason).toBe("DEADLINE_PASSED");
      expect(outcome.vote.status).toBe("COMPLETED");

      // The reconciliation persisted even though the action was refused.
      const stored = await read(target?.id ?? "");
      expect(stored).toMatchObject({
        status: "COMPLETED",
        completionMode: "DEADLINE",
        completionReason: null,
      });
      expect(stored.completedAt).toBe(stored.closesAt);
      expect(
        (await audit(target?.id ?? "")).filter(
          (e) => e.action === "VOTE_COMPLETED",
        ),
      ).toMatchObject([{ actor_kind: "SYSTEM", reason: null }]);
    });

    it("cannot cancel an overdue vote: it completes at its deadline instead", async () => {
      const target = due[1];
      const outcome = await cancel(target?.id ?? "", "Please cancel");
      expect(outcome).toMatchObject({
        applied: false,
        reason: "DEADLINE_PASSED",
      });
      expect((await read(target?.id ?? "")).status).toBe("COMPLETED");
      expect(
        (await audit(target?.id ?? "")).some(
          (e) => e.action === "VOTE_CANCELLED",
        ),
      ).toBe(false);
    });

    it("lets Cron complete every due vote once, using the deadline as the effective time", async () => {
      const first = await runCron();
      // Two of the four were already reconciled above.
      expect(first).toEqual({ completed: 2, blocked: 0 });

      for (const vote of due) {
        const stored = await read(vote.id);
        expect(stored.status).toBe("COMPLETED");
        expect(stored.completionMode).toBe("DEADLINE");
        expect(stored.completedAt).toBe(stored.closesAt);
        const events = (await audit(vote.id)).filter(
          (e) => e.action === "VOTE_COMPLETED",
        );
        expect(events).toHaveLength(1);
        // Effective time is the deadline; processing time is later and only audit context.
        expect(
          new Date(String(events[0]?.details.processedAt)).getTime(),
        ).toBeGreaterThan(
          new Date(String(events[0]?.details.effectiveAt)).getTime(),
        );
      }
    });

    it("is idempotent and leaves votes that are not due alone", async () => {
      expect(await runCron()).toEqual({ completed: 0, blocked: 0 });
      expect((await read(notDue.id)).status).toBe("ACTIVE");
      for (const vote of due) {
        expect(
          (await audit(vote.id)).filter((e) => e.action === "VOTE_COMPLETED"),
        ).toHaveLength(1);
      }
    });

    it("does not depend on the caller to enforce the deadline: a stale ACTIVE row is still refused", async () => {
      // A row that Cron has not reached yet is still past its deadline for every other path.
      const draft = await readyDraft("OPEN", { closesInMs: 1_500 });
      await activate(draft.id, 2);
      await sleep(1_800);
      const guarded = await dbError(
        db.asOwner(async (c) => {
          await c.query("select set_config('cp.submission', 'on', true)");
          await c.query(
            `insert into public.participation (vote_id, household_id)
             values ($1, $2)`,
            [draft.id, world.alice.householdId],
          );
        }),
      );
      expect(guarded.message).toBe("VOTING_CLOSED");
      expect(await runCron()).toEqual({ completed: 1, blocked: 0 });
    });
  });

  describe("invariants block completion", () => {
    it("does not complete a vote whose counts disagree, and keeps completing the rest", async () => {
      const broken = await readyDraft("OPEN", { closesInMs: 3_000 });
      await activate(broken.id, 2);
      const healthy = await readyDraft("OPEN", { closesInMs: 3_000 });
      await activate(healthy.id, 2);

      // Forge a participation row without its response, bypassing the deferred check
      // that normally makes this impossible (test-only, as superuser).
      await db.asSuperuser(async (c) => {
        await c.query("begin");
        await c.query(
          "alter table public.participation disable trigger participation_invariants",
        );
        await c.query("set local role cp_owner");
        await c.query("select set_config('cp.submission', 'on', true)");
        await c.query(
          "insert into public.participation (vote_id, household_id) values ($1, $2)",
          [broken.id, world.alice.householdId],
        );
        await c.query("reset role");
        await c.query(
          "alter table public.participation enable trigger participation_invariants",
        );
        await c.query("commit");
      });

      await sleep(3_300);
      const result = await runCron();
      expect(result).toEqual({ completed: 1, blocked: 1 });
      expect((await read(broken.id)).status).toBe("ACTIVE");
      expect((await read(healthy.id)).status).toBe("COMPLETED");

      // An administrator's action surfaces the failure instead of hiding it.
      const error = await dbError(complete(broken.id, "Try anyway"));
      expect(error.message).toBe("INVARIANT_VIOLATION");
      expect((await read(broken.id)).status).toBe("ACTIVE");
    });
  });
});
