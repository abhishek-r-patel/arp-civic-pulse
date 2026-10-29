// Real PostgreSQL verification of global table windows, filters and caller guards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  newAuthUser,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";

type Window = {
  ids: string[];
  totalCount: string;
  currentPage: number;
  totalPages: number;
};
describe.skipIf(!hasDatabase)("resident table windows", () => {
  let db: TestDatabase;
  let world: World;
  let observer: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    world = await seedWorld(db);
    observer = await db.asSuperuser((c) => newAuthUser(c));
    await db.asOwner((c) =>
      c.query(
        "insert into public.profiles(id, representative_name, status, is_readonly) values ($1, 'Observer', 'ENABLED', true)",
        [observer],
      ),
    );
  });
  afterAll(async () => {
    await db?.drop();
  });
  const window = (
    sub: string | null,
    sort = "household",
    direction = "asc",
    page = 1,
    limit = 2,
    filters = {},
  ) =>
    db.asRole(
      "authenticated",
      sub ? { sub } : {},
      async (c) =>
        (
          await c.query<{ value: Window }>(
            "select public.get_resident_table_page($1,$2,$3::jsonb,$4,$5) value",
            [page, limit, JSON.stringify(filters), sort, direction],
          )
        ).rows[0]?.value ??
        (() => {
          throw new Error("Missing table window");
        })(),
    );

  it("sorts the entire directory before paging, with exact totals", async () => {
    const first = await window(world.admin.id);
    const second = await window(world.admin.id, "household", "asc", 2);
    const last = await window(world.admin.id, "household", "asc", 999);
    expect(first).toMatchObject({
      ids: [world.alice.id, world.bob.id],
      totalCount: "6",
      currentPage: 1,
      totalPages: 3,
    });
    expect(second.ids).toEqual([world.carol.id, world.dave.id]);
    expect(last).toMatchObject({
      ids: [world.admin.id, observer],
      currentPage: 3,
    });
    expect((await window(world.admin.id, "household", "desc")).ids).toEqual([
      world.dave.id,
      world.carol.id,
    ]);
  });

  it.each(["representative", "status", "role", "eligibility", "updated"])(
    "keeps %s ordering consistent between full and paged reads",
    async (sort) => {
      for (const direction of ["asc", "desc"]) {
        const all = await window(world.admin.id, sort, direction, 1, 100);
        const pages = await Promise.all(
          [1, 2, 3].map((page) =>
            window(world.admin.id, sort, direction, page),
          ),
        );

        expect(pages.flatMap((item) => item.ids)).toEqual(all.ids);
        expect(new Set(all.ids).size).toBe(6);
      }
    },
  );

  it("uses the displayed values for name, status and role ordering", async () => {
    expect(
      (await window(observer, "representative", "asc", 1, 100)).ids,
    ).toEqual([
      world.alice.id,
      world.admin.id,
      world.bob.id,
      world.carol.id,
      world.dave.id,
      observer,
    ]);
    expect((await window(observer, "status", "desc", 1, 100)).ids[0]).toBe(
      world.carol.id,
    );
    expect(
      (await window(observer, "role", "asc", 1, 100)).ids.slice(0, 2),
    ).toEqual([world.admin.id, observer]);
    expect(
      (await window(observer, "eligibility", "asc", 1, 100)).ids.slice(-2),
    ).toEqual([world.admin.id, observer]);
  });

  it("combines name, role, status, identifier, eligibility and source filters globally", async () => {
    expect(
      await window(observer, "representative", "asc", 1, 25, {
        representative: "rAo",
        isAdmin: false,
        isReadonly: false,
        status: "ENABLED",
        identifier: " a-101 ",
        isEligible: true,
        selfRegistered: false,
      }),
    ).toMatchObject({ ids: [world.alice.id], totalCount: "1" });
    expect(
      (
        await window(observer, "household", "asc", 1, 25, {
          hasHousehold: false,
        })
      ).ids,
    ).toEqual([world.admin.id, observer]);
    expect(
      (await window(observer, "household", "asc", 1, 25, { isReadonly: true }))
        .ids,
    ).toEqual([observer]);
  });

  it("matches all requested name variants anywhere, ignoring case", async () => {
    await db.asSuperuser(async (client) => {
      await client.query("begin");
      try {
        const names = [
          "abhijin",
          "Abhishek",
          "ABHILASH",
          "Dhvabhi",
          "Unrelated",
        ];
        const ids: string[] = [];
        for (let index = 0; index < names.length; index += 1) {
          ids.push(await newAuthUser(client));
        }
        await client.query("set local role cp_owner");
        for (const [index, name] of names.entries()) {
          await client.query(
            "insert into public.profiles(id, representative_name, status) values ($1,$2,'SUSPENDED')",
            [ids[index], name],
          );
        }
        await client.query("set local role authenticated");
        await client.query(
          "select set_config('request.jwt.claims', $1, true)",
          [JSON.stringify({ role: "authenticated", sub: observer })],
        );
        const result = await client.query<{ value: Window }>(
          "select public.get_resident_table_page(1,25,$1::jsonb) value",
          [JSON.stringify({ representative: "AbHi" })],
        );
        expect(result.rows[0]?.value.totalCount).toBe("4");
        expect(new Set(result.rows[0]?.value.ids)).toEqual(
          new Set(ids.slice(0, 4)),
        );
      } finally {
        await client.query("rollback");
      }
    });
  });

  it("matches identifier substrings case-insensitively across pages without changing exact filters", async () => {
    expect(
      (
        await window(observer, "household", "asc", 1, 25, {
          identifierContains: " a-1 ",
        })
      ).ids,
    ).toEqual([world.alice.id]);
    const first = await window(observer, "household", "asc", 1, 2, {
      identifierContains: "0",
    });
    const second = await window(observer, "household", "asc", 2, 2, {
      identifierContains: "0",
    });
    expect(first).toMatchObject({
      totalCount: "4",
      totalPages: 2,
      ids: [world.alice.id, world.bob.id],
    });
    expect(second.ids).toEqual([world.carol.id, world.dave.id]);
    expect(
      (await window(observer, "household", "asc", 1, 25, { identifier: "a-1" }))
        .totalCount,
    ).toBe("0");
    for (const identifierContains of ["%", "_", "*", "x".repeat(101)]) {
      if (identifierContains.length > 100) {
        await expect(
          window(observer, "household", "asc", 1, 25, { identifierContains }),
        ).rejects.toBeDefined();
      } else {
        expect(
          (
            await window(observer, "household", "asc", 1, 25, {
              identifierContains,
            })
          ).totalCount,
        ).toBe("0");
      }
    }
    expect(
      (
        await window(observer, "household", "asc", 1, 25, {
          identifierContains: "a",
          representative: "rAo",
        })
      ).ids,
    ).toEqual([world.alice.id]);
  });

  it("treats name wildcards literally, handles empty sets, and filters timestamps as instants", async () => {
    expect(
      await window(observer, "representative", "asc", 999, 25, {
        representative: "%",
      }),
    ).toEqual({ ids: [], totalCount: "0", currentPage: 1, totalPages: 1 });
    const date = await db.asOwner(
      async (c) =>
        (
          await c.query<{ updated_at: Date }>(
            "select updated_at from public.profiles where id=$1",
            [world.alice.id],
          )
        ).rows[0]?.updated_at ??
        (() => {
          throw new Error("Missing fixture profile");
        })(),
    );
    expect(
      (
        await window(observer, "updated", "asc", 1, 25, {
          changedFrom: new Date(date.getTime() - 1).toISOString(),
          changedTo: new Date(date.getTime() + 1).toISOString(),
        })
      ).ids,
    ).toContain(world.alice.id);
    expect(
      (
        await window(observer, "updated", "asc", 1, 25, {
          changedFrom: "2100-01-01T00:00:00Z",
        })
      ).totalCount,
    ).toBe("0");
  });

  it("rejects member, suspended and anonymous access", async () => {
    for (const sub of [world.alice.id, world.carol.id, null]) {
      await expect(window(sub)).rejects.toBeDefined();
    }
    for (const role of ["anon", "service_role"] as const) {
      const result = await dbError(
        db.asRole(role, { sub: world.admin.id }, (c) =>
          c.query("select public.get_resident_table_page()"),
        ),
      );
      expect(result.code).toBe("42501");
    }
  });

  it("rejects invalid sorting, limits, filters and date ranges", async () => {
    for (const [sort, direction, page, limit, filters] of [
      ["id; drop table public.profiles", "asc", 1, 25, {}],
      ["household", "other", 1, 25, {}],
      ["household", "asc", 0, 25, {}],
      ["household", "asc", 1, 101, {}],
      ["household", "asc", 1, 25, { status: true }],
      ["household", "asc", 1, 25, { unknown: "x" }],
      [
        "household",
        "asc",
        1,
        25,
        { changedFrom: "2030-01-02T00:00Z", changedTo: "2030-01-01T00:00Z" },
      ],
    ] as const) {
      expect(
        (
          await dbError(
            window(world.admin.id, sort, direction, page, limit, filters),
          )
        ).message,
      ).toContain("VALIDATION_FAILED");
    }
  });
});
