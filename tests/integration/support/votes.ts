import type { TestDatabase } from "./database";
import type { Person, World } from "./fixtures";

/*
 * Scenario helpers that drive votes through the REAL guarded routines (create,
 * edit, activate, cast), as the API roles do, rather than inserting rows.
 */
export interface Detail {
  id: string;
  votingType: "OPEN" | "CLOSED";
  status: string;
  draftRevision: number;
  closesAt: string | null;
  offices: {
    id: string;
    name: string;
    candidates: { id: string; name: string }[];
  }[];
  options: { id: string; label: string }[];
}

export function votingApi(db: TestDatabase, world: World) {
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

  async function setupPolicy(): Promise<void> {
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
  }

  const ids = (people: Person[]) => people.map((p) => p.householdId);

  /** Creates, completes and ACTIVATES a vote through the guarded routines. */
  async function activeVote(
    type: "OPEN" | "CLOSED" = "OPEN",
    options: { closesInMs?: number; people?: Person[] } = {},
  ): Promise<Detail> {
    const draft = await call<Detail>(admin(), "public.create_draft($1)", [
      type,
    ]);
    const closesAt = new Date(
      Date.now() + (options.closesInMs ?? 3_600_000),
    ).toISOString();
    const people = options.people ?? [world.alice, world.bob, world.dave];
    const changes =
      type === "OPEN"
        ? {
            title: "Repaint?",
            closesAt,
            options: [
              { label: "Yes", position: 1 },
              { label: "No", position: 2 },
            ],
            eligibleHouseholdIds: ids(people),
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
            eligibleHouseholdIds: ids(people),
          };
    await call<Detail>(admin(), "public.update_draft($1, 1, $2::jsonb)", [
      draft.id,
      JSON.stringify(changes),
    ]);
    return call<Detail>(admin(), "public.activate_vote($1, 2, true)", [
      draft.id,
    ]);
  }

  const cast = <
    T = { accepted: boolean; reason?: string; submitted?: boolean },
  >(
    sub: string | null,
    voteId: string,
    submission: unknown,
  ) =>
    call<T>(sub, "public.cast_vote($1, $2::jsonb)", [
      voteId,
      JSON.stringify(submission),
    ]);

  const participation = (sub: string | null, voteId: string) =>
    call<{ voteId: string; status: string; submitted: boolean }>(
      sub,
      "public.get_my_participation($1)",
      [voteId],
    );

  const rows = async <T extends object>(sql: string, params: unknown[] = []) =>
    (await db.asSuperuser((c) => c.query<T>(sql, params))).rows;

  return {
    call,
    admin,
    setupPolicy,
    activeVote,
    cast,
    participation,
    rows,
    /** All ballot facts for a vote, read as superuser for assertions only. */
    async counts(voteId: string) {
      const [p] = await rows<{ n: string }>(
        "select count(*)::text as n from public.participation where vote_id = $1",
        [voteId],
      );
      const [o] = await rows<{ n: string }>(
        "select count(*)::text as n from public.open_responses where vote_id = $1",
        [voteId],
      );
      const tallies = await rows<{
        office_id: string;
        candidate_id: string | null;
        accepted_count: string;
      }>(
        "select office_id, candidate_id, accepted_count::text from public.closed_tallies where vote_id = $1",
        [voteId],
      );
      return {
        participation: Number(p?.n),
        openResponses: Number(o?.n),
        tallies,
        totalTallied: tallies.reduce(
          (sum, t) => sum + Number(t.accepted_count),
          0,
        ),
      };
    },
  };
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
