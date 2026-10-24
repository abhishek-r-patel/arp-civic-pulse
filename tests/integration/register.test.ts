import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  newAuthUser,
  type TestDatabase,
} from "./support/database";
import { fixtureOpenVote, seedWorld, type World } from "./support/fixtures";

const UNKNOWN = "00000000-0000-4000-8000-000000000099";
const PERMISSION_DENIED = "42501";

describe.skipIf(!hasDatabase)("register administration routines", () => {
  let db: TestDatabase;
  let world: World;

  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
  });
  afterAll(async () => {
    await db?.drop();
  });

  const call = <T = Record<string, unknown>>(
    sub: string | null,
    sql: string,
    params: unknown[] = [],
  ) =>
    db
      .asRole(
        sub ? "authenticated" : "anon",
        sub ? { sub } : null,
        (c) => c.query<{ result: T }>(`select ${sql} as result`, params),
        { commit: true },
      )
      .then((r) => r.rows[0]?.result as T);

  const createHousehold = (
    sub: string | null,
    identifier: string,
    representative: string,
    eligible = true,
  ) =>
    call<{
      id: string;
      identifier: string;
      representativeAccountId: string;
      isEligible: boolean;
    }>(sub, "public.create_household($1, $2, $3)", [
      identifier,
      representative,
      eligible,
    ]);

  const updateHousehold = (sub: string, id: string, changes: unknown) =>
    call<Record<string, unknown>>(
      sub,
      "public.update_household($1, $2::jsonb)",
      [id, JSON.stringify(changes)],
    );

  const updateProfile = (sub: string, id: string, changes: unknown) =>
    call<{
      id: string;
      representativeName: string;
      status: string;
      isAdmin: boolean;
    }>(sub, "public.update_profile($1, $2::jsonb)", [
      id,
      JSON.stringify(changes),
    ]);

  const newProfile = async (
    name: string,
    status: "ENABLED" | "SUSPENDED" = "SUSPENDED",
    isAdmin = false,
  ): Promise<string> => {
    const id = await db.asSuperuser((c) => newAuthUser(c));
    await db.asOwner((c) =>
      c.query(
        "insert into public.profiles (id, representative_name, status, is_admin) values ($1, $2, $3, $4)",
        [id, name, status, isAdmin],
      ),
    );
    return id;
  };

  const auditFor = async (target: string) =>
    (
      await db.asSuperuser((c) =>
        c.query<{ action: string; actor_profile_id: string }>(
          "select action, actor_profile_id from public.audit_events where target_id = $1 order by id",
          [target],
        ),
      )
    ).rows;

  describe("authorization", () => {
    it("requires a current enabled administrator", async () => {
      const rep = await newProfile("Needs House");
      for (const sub of [world.alice.id, world.carol.id, UNKNOWN]) {
        expect((await dbError(createHousehold(sub, "Z-1", rep))).message).toBe(
          sub === UNKNOWN ? "FORBIDDEN" : "FORBIDDEN",
        );
      }
      expect((await dbError(createHousehold(null, "Z-1", rep))).code).toBe(
        PERMISSION_DENIED,
      );
      expect(
        (
          await dbError(
            updateProfile(world.alice.id, world.bob.id, { isAdmin: true }),
          )
        ).message,
      ).toBe("FORBIDDEN");
    });

    it("stops working the moment the administrator is suspended, with the same session", async () => {
      const second = await newProfile("Second Admin", "ENABLED", true);
      const rep = await newProfile("Another Rep");
      await createHousehold(second, "ADM-1", rep);

      await db.asOwner((c) =>
        c.query(
          "update public.profiles set status = 'SUSPENDED' where id = $1",
          [second],
        ),
      );
      const rep2 = await newProfile("Third Rep");
      expect(
        (await dbError(createHousehold(second, "ADM-2", rep2))).message,
      ).toBe("FORBIDDEN");
    });

    it("exposes the normalisation helper only to signed-in users", async () => {
      expect(
        await call(
          world.admin.id,
          "public.normalize_household_identifier($1)",
          ["  ＡＢ-12   c "],
        ),
      ).toBe("ab-12 c");
      expect(
        (
          await dbError(
            call(null, "public.normalize_household_identifier($1)", ["x"]),
          )
        ).code,
      ).toBe(PERMISSION_DENIED);
    });
  });

  describe("create_household", () => {
    it("creates a normalised household, audited by the acting administrator", async () => {
      const rep = await newProfile("Fatima Sheikh");
      const created = await createHousehold(
        world.admin.id,
        "  F-601  ",
        rep,
        false,
      );

      expect(created).toMatchObject({
        identifier: "F-601",
        representativeAccountId: rep,
        isEligible: false,
      });
      const row = await db.asSuperuser((c) =>
        c.query<{ identifier_normalized: string }>(
          "select identifier_normalized from public.households where id = $1",
          [created.id],
        ),
      );
      expect(row.rows[0]?.identifier_normalized).toBe("f-601");
      expect(await auditFor(created.id)).toEqual([
        { action: "HOUSEHOLD_CREATED", actor_profile_id: world.admin.id },
      ]);
    });

    it("allows a newly provisioned suspended profile without granting access", async () => {
      const rep = await newProfile("Gopal Menon", "SUSPENDED");
      await createHousehold(world.admin.id, "G-701", rep);
      const visible = await db.asRole("authenticated", { sub: rep }, (c) =>
        c.query("select id from public.profiles"),
      );
      expect(visible.rowCount).toBe(0);
    });

    it("rejects normalised duplicates and double assignment with specific reasons", async () => {
      const first = await newProfile("Hema Rao");
      await createHousehold(world.admin.id, "H-801", first);

      const other = await newProfile("Ishan Das");
      const duplicate = await dbError(
        createHousehold(world.admin.id, " h-801 ", other),
      );
      expect(duplicate).toMatchObject({
        message: "REGISTER_CONFLICT",
        detail: "DUPLICATE_IDENTIFIER",
      });

      const assigned = await dbError(
        createHousehold(world.admin.id, "H-802", first),
      );
      expect(assigned).toMatchObject({
        message: "REGISTER_CONFLICT",
        detail: "REPRESENTATIVE_ASSIGNED",
      });
    });

    it("never invents or merges accounts", async () => {
      expect(
        (await dbError(createHousehold(world.admin.id, "Q-1", UNKNOWN)))
          .message,
      ).toBe("NOT_FOUND");

      const gone = await newProfile("Gone Soon");
      await db.asOwner((c) =>
        c.query(
          "update public.profiles set status = 'DELETED', deleted_at = now() where id = $1",
          [gone],
        ),
      );
      expect(
        await dbError(createHousehold(world.admin.id, "Q-2", gone)),
      ).toMatchObject({
        message: "REGISTER_CONFLICT",
        detail: "REPRESENTATIVE_DELETED",
      });
      expect(
        (
          await dbError(
            createHousehold(world.admin.id, "Q-3", null as unknown as string),
          )
        ).message,
      ).toBe("VALIDATION_FAILED");
    });

    it("validates identifiers and leaves nothing behind on failure", async () => {
      const rep = await newProfile("Jaya Nair");
      const before = await db.asSuperuser((c) =>
        c.query<{ n: string }>("select count(*) as n from public.audit_events"),
      );
      for (const bad of ["", "   ", "x".repeat(101), "Bad\nLine", "<b>x</b>"]) {
        expect(
          (await dbError(createHousehold(world.admin.id, bad, rep))).message,
          bad,
        ).toBe("VALIDATION_FAILED");
      }
      const after = await db.asSuperuser((c) =>
        c.query<{ n: string }>("select count(*) as n from public.audit_events"),
      );
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });
  });

  describe("update_household", () => {
    it("changes only the supplied fields and audits which ones", async () => {
      const rep = await newProfile("Kiran Pal");
      const created = await createHousehold(
        world.admin.id,
        "K-901",
        rep,
        false,
      );

      const renamed = await updateHousehold(world.admin.id, created.id, {
        identifier: "K-901A",
      });
      expect(renamed).toMatchObject({
        identifier: "K-901A",
        isEligible: false,
        representativeAccountId: rep,
      });

      const eligible = await updateHousehold(world.admin.id, created.id, {
        isEligible: true,
      });
      expect(eligible).toMatchObject({
        identifier: "K-901A",
        isEligible: true,
      });

      const events = await db.asSuperuser((c) =>
        c.query<{ details: { fields: string[] } }>(
          "select details from public.audit_events where target_id = $1 and action = 'HOUSEHOLD_UPDATED' order by id",
          [created.id],
        ),
      );
      expect(events.rows.map((r) => r.details.fields)).toEqual([
        ["identifier"],
        ["isEligible"],
      ]);
    });

    it("rejects unknown, empty and mistyped changes", async () => {
      const rep = await newProfile("Lata Joshi");
      const { id } = await createHousehold(world.admin.id, "L-111", rep);
      for (const changes of [
        {},
        { isEligible: "yes" },
        { identifier: 5 },
        { representativeAccountId: "nope" },
        { extra: true },
        null,
      ]) {
        expect(
          (await dbError(updateHousehold(world.admin.id, id, changes))).message,
        ).toBe("VALIDATION_FAILED");
      }
      expect(
        (
          await dbError(
            updateHousehold(world.admin.id, UNKNOWN, { isEligible: true }),
          )
        ).message,
      ).toBe("NOT_FOUND");
    });

    it("reports normalised and assignment conflicts", async () => {
      const a = await newProfile("Mohan A");
      const b = await newProfile("Nisha B");
      const first = await createHousehold(world.admin.id, "M-222", a);
      const second = await createHousehold(world.admin.id, "N-333", b);

      expect(
        await dbError(
          updateHousehold(world.admin.id, second.id, { identifier: " m-222 " }),
        ),
      ).toMatchObject({
        message: "REGISTER_CONFLICT",
        detail: "DUPLICATE_IDENTIFIER",
      });
      expect(
        await dbError(
          updateHousehold(world.admin.id, second.id, {
            representativeAccountId: a,
          }),
        ),
      ).toMatchObject({
        message: "REGISTER_CONFLICT",
        detail: "REPRESENTATIVE_ASSIGNED",
      });
      // A conflicting edit changed nothing.
      const row = await db.asSuperuser((c) =>
        c.query("select identifier from public.households where id = $1", [
          second.id,
        ]),
      );
      expect(row.rows[0]).toEqual({ identifier: "N-333" });
      expect(first.id).not.toBe(second.id);
    });

    it("reassigns to an existing account and never rewrites a frozen electorate", async () => {
      const vote = await fixtureOpenVote(db, world, [world.bob]);
      const snapshot = () =>
        db.asSuperuser((c) =>
          c.query(
            `select representative_profile_id, representative_name_snapshot, household_identifier_snapshot
               from public.electorate where vote_id = $1`,
            [vote.id],
          ),
        );
      const before = (await snapshot()).rows;

      const newRep = await newProfile("Bob's Successor", "ENABLED");
      await updateHousehold(world.admin.id, world.bob.householdId ?? "", {
        identifier: "B-202 (renumbered)",
        representativeAccountId: newRep,
        isEligible: false,
      });

      expect((await snapshot()).rows).toEqual(before);
      const bobSees = await db.asRole(
        "authenticated",
        { sub: world.bob.id },
        (c) => c.query("select id from public.votes where id = $1", [vote.id]),
      );
      const successorSees = await db.asRole(
        "authenticated",
        { sub: newRep },
        (c) => c.query("select id from public.votes where id = $1", [vote.id]),
      );
      expect(bobSees.rowCount).toBe(1);
      expect(successorSees.rowCount).toBe(0);
    });
  });

  describe("update_profile", () => {
    it("changes name, role and status with one audit event per concern", async () => {
      const id = await newProfile("Om Prakash", "ENABLED", false);
      await updateProfile(world.admin.id, id, {
        representativeName: "  Om P. Kumar  ",
        isAdmin: true,
      });
      const result = await updateProfile(world.admin.id, id, {
        status: "SUSPENDED",
      });

      expect(result).toMatchObject({
        representativeName: "Om P. Kumar",
        isAdmin: true,
        status: "SUSPENDED",
      });
      expect((await auditFor(id)).map((e) => e.action)).toEqual([
        "PROFILE_UPDATED",
        "PROFILE_ROLE_CHANGED",
        "PROFILE_STATUS_CHANGED",
      ]);
    });

    it("keeps residents suspended until a household is assigned, but not administrators", async () => {
      const resident = await newProfile("No House Yet");
      expect(
        (
          await dbError(
            updateProfile(world.admin.id, resident, { status: "ENABLED" }),
          )
        ).message,
      ).toBe("PROVISIONING_INCOMPLETE");

      await createHousehold(world.admin.id, "R-444", resident);
      expect(
        await updateProfile(world.admin.id, resident, { status: "ENABLED" }),
      ).toMatchObject({ status: "ENABLED" });

      const adminOnly = await newProfile("Admin Without House");
      expect(
        await updateProfile(world.admin.id, adminOnly, {
          isAdmin: true,
          status: "ENABLED",
        }),
      ).toMatchObject({
        status: "ENABLED",
      });
    });

    it("soft-deletes irreversibly and keeps the historical identity", async () => {
      const id = await newProfile("To Delete", "ENABLED");
      const deleted = await updateProfile(world.admin.id, id, {
        status: "DELETED",
      });
      expect(deleted.status).toBe("DELETED");

      const row = await db.asSuperuser((c) =>
        c.query<{ deleted_at: Date | null }>(
          "select deleted_at from public.profiles where id = $1",
          [id],
        ),
      );
      expect(row.rows[0]?.deleted_at).not.toBeNull();
      expect(
        await dbError(updateProfile(world.admin.id, id, { status: "ENABLED" })),
      ).toMatchObject({
        message: "LIFECYCLE_CONFLICT",
      });
    });

    it("rejects invalid input", async () => {
      const id = await newProfile("Validate Me");
      for (const changes of [
        {},
        { status: "ACTIVE" },
        { isAdmin: "true" },
        { representativeName: "" },
        { representativeName: "<i>x</i>" },
        { email: "a@b.test" },
      ]) {
        expect(
          (await dbError(updateProfile(world.admin.id, id, changes))).message,
        ).toBe("VALIDATION_FAILED");
      }
      expect(
        (
          await dbError(
            updateProfile(world.admin.id, UNKNOWN, { status: "SUSPENDED" }),
          )
        ).message,
      ).toBe("NOT_FOUND");
    });
  });

  describe("administrator safety", () => {
    it("never removes the last enabled administrator", async () => {
      const ops = await createTestDatabase();
      try {
        const only = await ops.asSuperuser((c) => newAuthUser(c));
        await ops.asOwner((c) =>
          c.query(
            "insert into public.profiles (id, representative_name, status, is_admin) values ($1, 'Only Admin', 'ENABLED', true)",
            [only],
          ),
        );
        const attempt = (changes: unknown) =>
          dbError(
            ops.asRole("authenticated", { sub: only }, (c) =>
              c.query("select public.update_profile($1, $2::jsonb)", [
                only,
                JSON.stringify(changes),
              ]),
            ),
          );

        expect(await attempt({ isAdmin: false })).toMatchObject({
          message: "LIFECYCLE_CONFLICT",
          detail: "LAST_ADMIN",
        });
        expect(await attempt({ status: "SUSPENDED" })).toMatchObject({
          message: "LIFECYCLE_CONFLICT",
          detail: "LAST_ADMIN",
        });
        expect(await attempt({ status: "DELETED" })).toMatchObject({
          message: "LIFECYCLE_CONFLICT",
          detail: "LAST_ADMIN",
        });
      } finally {
        await ops.drop();
      }
    });

    it("serialises concurrent changes so two administrators cannot remove each other", async () => {
      const ops = await createTestDatabase();
      try {
        const [a, b] = await ops.asSuperuser(
          async (c) => [await newAuthUser(c), await newAuthUser(c)] as const,
        );
        await ops.asOwner(async (c) => {
          for (const [id, name] of [
            [a, "Admin A"],
            [b, "Admin B"],
          ] as const) {
            await c.query(
              "insert into public.profiles (id, representative_name, status, is_admin) values ($1, $2, 'ENABLED', true)",
              [id, name],
            );
          }
        });
        const demote = (actor: string, target: string) =>
          ops.asRole(
            "authenticated",
            { sub: actor },
            (c) =>
              c.query(
                "select public.update_profile($1, '{\"isAdmin\": false}'::jsonb)",
                [target],
              ),
            { commit: true },
          );

        const results = await Promise.allSettled([demote(a, b), demote(b, a)]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

        const remaining = await ops.asSuperuser((c) =>
          c.query(
            "select id from public.profiles where status = 'ENABLED' and is_admin",
          ),
        );
        expect(remaining.rowCount).toBe(1);
      } finally {
        await ops.drop();
      }
    });
  });
});
