import "server-only";
import { z } from "zod";
import { VOTE_RATE_LIMITS, enforceRateLimit } from "@/server/auth/rate-limit";
import { buildKnownPage, decodeCursor } from "@/server/http/cursor";
import { ApiError } from "@/server/http/errors";
import {
  callRoutine,
  mapLimit,
  type RegisterDeps,
} from "@/server/register/shared";
import { reconcileOverdue } from "@/server/votes/lifecycle";
import { availableExportFormats } from "@/server/exports/formats";
import type { PageInfo } from "@/shared/contracts/pagination";
import {
  memberVoteDetailSchema,
  memberVoteListQuerySchema,
  memberVoteListSchema,
  memberVoteSummarySchema,
  type MemberVoteDetailResponse,
  type MemberVoteSummary,
} from "@/shared/contracts/member-votes";
import {
  projectResults,
  rawResultsSchema,
  type RawResults,
  type VoteResults,
} from "@/shared/contracts/results";
import { uuid } from "@/shared/validation/primitives";

/*
 * Member discovery, ballot and completed results. Every read runs under the
 * member's OWN session; the routines derive identity from the verified JWT and
 * entitlement from the frozen electorate, so nothing here widens access. A
 * vote past its deadline that Cron has not yet finalised is finalised first
 * (the database clock decides), so a resident never sees a stale "Active".
 */
const ENDPOINT = "/api/votes";

const positionSchema = z.object({
  rank: z.enum(["0", "1"]),
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
): Promise<{ data: MemberVoteSummary[]; page: PageInfo }> {
  await enforceReadLimit(deps);
  const binding = {
    endpoint: ENDPOINT,
    filters: { status: query.status, votingType: query.votingType },
  };
  const after = query.cursor
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
  return { ...vote, exportFormats, privacyNotice: vote.votingType };
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
 * The authoritative completed result. Totals always describe ALL responses;
 * `limit`/`cursor` only page the named OPEN list.
 */
export async function getResults(
  deps: RegisterDeps,
  id: string,
  query: { limit: number; cursor?: string | undefined },
): Promise<{ data: VoteResults; page: PageInfo | null }> {
  await enforceReadLimit(deps);
  const binding = { endpoint: `${ENDPOINT}/results`, parentId: id };
  const after = query.cursor
    ? decodeCursor(query.cursor, binding, namedPositionSchema)
    : undefined;
  const raw = await fetchResultsReconciling(deps, id, {
    limit: query.limit,
    ...(after ? { after: { key: after.key, householdId: after.id } } : {}),
  });

  const data = projectResults(raw);
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
  return { data, page };
}

/** The complete result, including every named response, for the CSV export. */
export async function getCompleteResults(
  deps: RegisterDeps,
  id: string,
): Promise<VoteResults> {
  return projectResults(await fetchResultsReconciling(deps, id));
}
