/* Dashboard counts are scoped to frozen identity; turnout failures never become invented zeroes. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  getMemberVoteOverview,
  getVoteCardTurnouts,
} from "@/server/votes/member";
import type { RegisterDeps } from "@/server/register/shared";
import type { MemberVoteSummary } from "@/shared/contracts/member-votes";

vi.mock("@/server/auth/rate-limit", () => ({
  VOTE_RATE_LIMITS: { readByProfile: {} },
  enforceRateLimit: vi.fn(),
}));
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function world(counts: (number | null)[], error: object | null = null) {
  const queries: { columns: string; filters: [string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("electorate");
      const query = { columns: "", filters: [] as [string, unknown][] };
      const count = counts[queries.length];
      queries.push(query);
      const builder = {
        select(columns: string, options: object) {
          query.columns = columns;
          expect(options).toEqual({ count: "exact", head: true });
          return builder;
        },
        eq(name: string, value: unknown) {
          query.filters.push([name, value]);
          return builder;
        },
        then(resolve: (result: object) => unknown) {
          return Promise.resolve({
            count,
            error,
            status: error ? 503 : 200,
          }).then(resolve);
        },
      };
      return builder;
    },
    rpc: vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "RESULTS_UNAVAILABLE" },
      status: 409,
    }),
  };
  const deps: RegisterDeps = {
    client: client as unknown as SupabaseClient,
    admin: client as unknown as SupabaseClient,
    actor: { id: ACTOR, representativeName: "Example", isAdmin: true },
  };
  return { deps, queries, client };
}
describe("member dashboard", () => {
  it("counts all own frozen entitlements, even for an administrator, without reading names or choices", async () => {
    const state = world([12, 3, 5]);
    expect(await getMemberVoteOverview(state.deps)).toEqual({
      active: 12,
      scheduled: 3,
      responded: 5,
    });
    for (const query of state.queries)
      expect(query.filters).toContainEqual([
        "representative_profile_id",
        ACTOR,
      ]);
    expect(state.queries[2]?.columns).toBe(
      "votes!inner(status),participation!inner(vote_id)",
    );
  });
  it("rejects unavailable counts rather than reporting zero", async () => {
    await expect(
      getMemberVoteOverview(world([null, 0, 0]).deps),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });
  it("only asks for active turnout and returns unavailable on a refused read", async () => {
    const state = world([]);
    const vote: MemberVoteSummary = {
      id: ACTOR,
      votingType: "PRIVATE",
      status: "ACTIVE",
      title: "Example",
      closesAt: "2099-01-01T00:00:00.000Z",
      timezone: "UTC",
      activatedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      cancelledAt: null,
      submitted: false,
    };
    const result = await getVoteCardTurnouts(state.deps, [
      vote,
      {
        ...vote,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        status: "SCHEDULED",
      },
    ]);
    expect(result.get(vote.id)).toBeNull();
    expect(result.size).toBe(1);
    expect(state.client.rpc).toHaveBeenCalledTimes(1);
    expect(state.client.rpc).toHaveBeenCalledWith(
      "get_vote_results",
      expect.objectContaining({ p_limit: 1 }),
    );
  });
  it("projects only aggregate turnout from an authorized result", async () => {
    const state = world([]);
    const vote: MemberVoteSummary = {
      id: ACTOR,
      votingType: "PUBLIC",
      status: "ACTIVE",
      title: "Example",
      closesAt: "2099-01-01T00:00:00.000Z",
      timezone: "UTC",
      activatedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      cancelledAt: null,
      submitted: true,
    };
    state.client.rpc.mockResolvedValueOnce({
      error: null,
      status: 200,
      data: {
        vote: {
          ...vote,
          instructions: null,
          openSelectionMode: "SINGLE",
          openSelectionLimit: 1,
          rwaName: "Example RWA",
          policyVersions: {},
          completionMode: null,
          completionReason: null,
        },
        eligibleCount: "2",
        submittedCount: "1",
        options: [{ id: ACTOR, label: "Yes", position: 1, count: "1" }],
        offices: [],
        namedResponses: null,
        namedPage: null,
      },
    });
    const result = await getVoteCardTurnouts(state.deps, [vote]);
    expect(result.get(vote.id)).toEqual({
      eligibleCount: "2",
      submittedCount: "1",
      percent: "50",
    });
    expect(JSON.stringify([...result.values()])).not.toContain("options");
  });
});
