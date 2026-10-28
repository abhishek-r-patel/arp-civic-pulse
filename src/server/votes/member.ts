// Authorized resident vote discovery, results and export projections.
import "server-only";
import { z } from "zod";
import { VOTE_RATE_LIMITS, enforceRateLimit } from "@/server/auth/rate-limit";
import { buildKnownPage, decodeCursor } from "@/server/http/cursor";
import { numberedPage } from "@/server/http/numbered-page";
import { ApiError } from "@/server/http/errors";
import {
  callRoutine,
  assertOk,
  mapLimit,
  type RegisterDeps,
} from "@/server/register/shared";
import { reconcileOverdue } from "@/server/votes/lifecycle";
import { getRwaBranding } from "@/server/settings/rwa-profile";
import { availableExportFormats } from "@/server/exports/formats";
import type { PageInfo } from "@/shared/contracts/pagination";
import {
  memberVoteDetailSchema,
  memberVoteListQuerySchema,
  memberVoteListSchema,
  memberVoteSummarySchema,
  type MemberVoteDetailResponse,
  type MemberVoteSummary,
  type MemberVoteOverview,
  type VoteCardTurnout,
} from "@/shared/contracts/member-votes";
import {
  projectResults,
  rawResultsSchema,
  type RawResults,
  type VoteResults,
} from "@/shared/contracts/results";
import { uuid } from "@/shared/validation/primitives";
import { percentage } from "@/shared/validation/numbers";
import { log } from "@/server/observability/logger";

/*
 * Member discovery, ballot and authorized result reads. Every read runs under
 * the member's OWN session; the routines derive identity from the verified JWT and
 * entitlement from the frozen electorate, so nothing here widens access. A
 * vote past its deadline that Cron has not yet finalised is finalised first
 * (the database clock decides), so a resident never sees a stale "Active".
 */
const ENDPOINT = "/api/votes";

const positionSchema = z.object({
  rank: z.enum(["0", "1", "2"]),
  key: z.string().regex(/^-?\d{1,20}$/u),
  id: uuid,
});

function parse<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    // A routine returning something unexpected is a server fault, never a client one.
    throw new ApiError("INTERNAL_ERROR");
  }
  return result.data;
}

export async function enforceReadLimit(deps: RegisterDeps): Promise<void> {
  await enforceRateLimit(
    deps.admin,
    VOTE_RATE_LIMITS.readByProfile,
    "profile",
    deps.actor.id,
    "DEPENDENCY_UNAVAILABLE",
  );
}

const isOverdue = (vote: { status: string; closesAt: string }) =>
  vote.status === "ACTIVE" && new Date(vote.closesAt).getTime() <= Date.now();

export async function listMemberVotes(
  deps: RegisterDeps,
  query: z.output<typeof memberVoteListQuerySchema>,
  requestedPage?: number,
): Promise<{ data: MemberVoteSummary[]; page: PageInfo }> {
  await enforceReadLimit(deps);
  const binding = {
    endpoint: ENDPOINT,
    filters: { status: query.status, votingType: query.votingType },
  };
  let window =
    requestedPage === undefined
      ? undefined
      : await numberedPage(
          deps,
          "member-votes",
          requestedPage,
          query.limit,
          binding,
        );
  if (window) query = { ...query, cursor: window.cursor };
  let after = query.cursor
    ? decodeCursor(query.cursor, binding, positionSchema)
    : null;

  const fetch = async () =>
    parse(
      memberVoteListSchema,
      await callRoutine(deps.client, "list_member_votes", {
        p_status: query.status ?? null,
        p_voting_type: query.votingType ?? null,
        p_limit: query.limit,
        p_after_rank: after ? Number(after.rank) : null,
        p_after_key: after?.key ?? null,
        p_after_id: after?.id ?? null,
      }),
    );

  let list = await fetch();
  const overdue = list.rows.filter(isOverdue);
  if (overdue.length > 0) {
    const results = await mapLimit(overdue, 4, (row) =>
      reconcileOverdue(deps, row.id),
    );
    if (results.some(Boolean)) {
      if (requestedPage !== undefined) {
        window = await numberedPage(
          deps,
          "member-votes",
          requestedPage,
          query.limit,
          binding,
        );
        after = window.cursor
          ? decodeCursor(window.cursor, binding, positionSchema)
          : null;
      }
      list = await fetch();
    }
  }

  const { rows, page } = buildKnownPage(
    list.rows,
    list.hasMore,
    query.limit,
    binding,
    (row) => ({
      rank: String(row.cursor.rank),
      key: row.cursor.key,
      id: row.cursor.id,
    }),
  );
  if (window) page.numbered = window.numbered;
  return {
    data: rows.map((row) => memberVoteSummarySchema.parse(row)),
    page,
  };
}

export async function getMemberVote(
  deps: RegisterDeps,
  id: string,
): Promise<MemberVoteDetailResponse> {
  await enforceReadLimit(deps);
  const fetch = async () =>
    parse(
      memberVoteDetailSchema,
      await callRoutine(deps.client, "get_member_vote", { p_vote_id: id }),
    );

  let vote = await fetch();
  if (isOverdue(vote) && (await reconcileOverdue(deps, id))) {
    vote = await fetch();
  }
  // The database says whether a completed result can be downloaded; this deployment says in which formats.
  const exportFormats =
    vote.exportFormats.length > 0 ? availableExportFormats() : [];
  return {
    ...vote,
    rwaName: await currentRwaName(deps),
    exportFormats,
    privacyNotice: vote.votingType,
  };
}

export async function getMemberVoteOverview(
  deps: RegisterDeps,
): Promise<MemberVoteOverview> {
  await enforceReadLimit(deps);
  async function count(
    status: "ACTIVE" | "SCHEDULED",
    participated = false,
  ): Promise<number> {
    const result = await deps.client
      .from("electorate")
      .select(
        participated
          ? "votes!inner(status),participation!inner(vote_id)"
          : "votes!inner(status)",
        { count: "exact", head: true },
      )
      .eq("representative_profile_id", deps.actor.id)
      .eq("votes.status", status);
    assertOk(result.error, result.status);
    return parse(z.number().int().nonnegative(), result.count);
  }
  const [active, scheduled, responded] = await Promise.all([
    count("ACTIVE"),
    count("SCHEDULED"),
    count("ACTIVE", true),
  ]);
  return { active, scheduled, responded };
}

export async function getVoteCardTurnouts(
  deps: RegisterDeps,
  votes: readonly MemberVoteSummary[],
): Promise<Map<string, VoteCardTurnout | null>> {
  const active = votes.filter((vote) => vote.status === "ACTIVE");
  const rows = await mapLimit(active, 4, async (vote) => {
    try {
      await enforceReadLimit(deps);
      const results = await fetchResultsReconciling(deps, vote.id, {
        limit: 1,
      });
      return [
        vote.id,
        {
          eligibleCount: results.eligibleCount,
          submittedCount: results.submittedCount,
          percent: percentage(results.submittedCount, results.eligibleCount),
        },
      ] as const;
    } catch (error) {
      log("warn", "votes.card_turnout_unavailable", {
        errorCode: error instanceof ApiError ? error.code : "UNKNOWN",
      });
      return [vote.id, null] as const;
    }
  });
  return new Map(rows);
}

// Screens and exports show the RWA's current official name; the vote's saved snapshot stays an internal record.
async function currentRwaName(deps: RegisterDeps): Promise<string> {
  return (await getRwaBranding(deps.client)).fullName;
}

function withCurrentName(raw: RawResults, rwaName: string): RawResults {
  return { ...raw, vote: { ...raw.vote, rwaName } };
}

async function fetchResults(
  deps: RegisterDeps,
  id: string,
  page?: { limit: number; after?: { key: string; householdId: string } },
): Promise<RawResults> {
  return parse(
    rawResultsSchema,
    await callRoutine(deps.client, "get_vote_results", {
      p_vote_id: id,
      p_limit: page?.limit ?? null,
      p_after_key: page?.after?.key ?? null,
      p_after_household: page?.after?.householdId ?? null,
    }),
  );
}

// Past the deadline but not yet finalised: finalise, then try once more.
async function fetchResultsReconciling(
  deps: RegisterDeps,
  id: string,
  page?: Parameters<typeof fetchResults>[2],
): Promise<RawResults> {
  try {
    return await fetchResults(deps, id, page);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === "RESULTS_UNAVAILABLE" &&
      error.context?.reason === "ACTIVE" &&
      (await reconcileOverdue(deps, id))
    ) {
      return fetchResults(deps, id, page);
    }
    throw error;
  }
}

const namedPositionSchema = z.object({ key: z.string().max(100), id: uuid });

/**
 * Authorized results. Active votes expose only their permitted aggregates;
 * completed totals describe all responses and page the named PUBLIC list.
 */
export async function getResults(
  deps: RegisterDeps,
  id: string,
  query: { limit: number; cursor?: string | undefined },
  requestedPage?: number,
): Promise<{ data: VoteResults; page: PageInfo | null }> {
  await enforceReadLimit(deps);
  const binding = { endpoint: `${ENDPOINT}/results`, parentId: id };
  // Authorize through the existing guarded projection before requesting named-list metadata.
  const initial =
    requestedPage === undefined
      ? undefined
      : await fetchResultsReconciling(deps, id, { limit: query.limit });
  if (initial && (!initial.namedPage || !initial.namedResponses)) {
    return {
      data: projectResults(
        withCurrentName(initial, await currentRwaName(deps)),
      ),
      page: null,
    };
  }
  const window =
    requestedPage === undefined
      ? undefined
      : await numberedPage(
          deps,
          "responses",
          requestedPage,
          query.limit,
          binding,
        );
  if (window) query = { ...query, cursor: window.cursor };
  const after = query.cursor
    ? decodeCursor(query.cursor, binding, namedPositionSchema)
    : undefined;
  const raw = await fetchResultsReconciling(deps, id, {
    limit: query.limit,
    ...(after ? { after: { key: after.key, householdId: after.id } } : {}),
  });

  const data = projectResults(withCurrentName(raw, await currentRwaName(deps)));
  if (!raw.namedPage || !raw.namedResponses) {
    return { data, page: null };
  }
  const { page } = buildKnownPage(
    raw.namedResponses,
    raw.namedPage.hasMore,
    query.limit,
    binding,
    (row) => ({ key: row.cursor.key, id: row.cursor.householdId }),
  );
  if (window) page.numbered = window.numbered;
  return { data, page };
}

/** The complete result, including every named response, for the CSV export. */
export async function getCompleteResults(
  deps: RegisterDeps,
  id: string,
): Promise<VoteResults> {
  return projectResults(
    withCurrentName(
      await fetchResultsReconciling(deps, id),
      await currentRwaName(deps),
    ),
  );
}
