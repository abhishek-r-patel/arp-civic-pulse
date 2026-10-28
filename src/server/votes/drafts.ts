// Administrator draft editing and frozen vote discovery under the caller's session.
import "server-only";
import { z } from "zod";
import { ApiError } from "@/server/http/errors";
import { buildPage, decodeCursor } from "@/server/http/cursor";
import { numberedPage } from "@/server/http/numbered-page";
import {
  assertCurrentAdmin,
  assertOk,
  callRoutine,
  postgrestQuote,
  type RegisterDeps,
} from "@/server/register/shared";
import { reconcileOverdue } from "@/server/votes/lifecycle";
import {
  adminVoteDetailSchema,
  draftPreviewSchema,
  rwaDisplaySchema,
  type AdminVoteDetail,
  type AdminVoteSummary,
  type DraftPreview,
  type RwaDisplay,
  type SelectableHousehold,
} from "@/shared/contracts/drafts";
import {
  voteListQuerySchema,
  type DraftPatch,
} from "@/shared/contracts/admin-votes";
import type { PageInfo } from "@/shared/contracts/pagination";
import type { VotingType } from "@/shared/contracts/voting";
import { uuid } from "@/shared/validation/primitives";

/*
 * Administrative draft management. Reads follow RLS under the administrator's
 * own session; every change goes through a guarded routine that re-checks the
 * caller, the revision and the draft state, and audits in the same
 * transaction. Routine output is validated before it leaves this module.
 */
const ENDPOINT = "/api/admin/votes";
const SUMMARY_COLUMNS =
  "id, voting_type, status, title, closes_at, opens_at, draft_revision, updated_at, timezone_snapshot";
// Selecting a household for a draft is bounded by the collection limit.
const HOUSEHOLD_SCAN_LIMIT = 1_001;

interface SummaryRow {
  id: string;
  voting_type: VotingType;
  status: AdminVoteSummary["status"];
  title: string;
  closes_at: string | null;
  opens_at?: string | null;
  draft_revision: number;
  updated_at: string;
  timezone_snapshot: string | null;
}

const positionSchema = z.object({ key: z.string().max(64), id: uuid });

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

export async function getRwaDisplay(deps: RegisterDeps): Promise<RwaDisplay> {
  return parse(
    rwaDisplaySchema,
    await callRoutine(deps.client, "get_rwa_display", {}),
  );
}

export async function listVotes(
  deps: RegisterDeps,
  query: z.output<typeof voteListQuerySchema>,
  requestedPage?: number,
): Promise<{ data: AdminVoteSummary[]; page: PageInfo }> {
  const binding = {
    endpoint: ENDPOINT,
    filters: { status: query.status, votingType: query.votingType },
  };
  const window =
    requestedPage === undefined
      ? undefined
      : await numberedPage(
          deps,
          "admin-votes",
          requestedPage,
          query.limit,
          binding,
        );
  if (window) query = { ...query, cursor: window.cursor };

  let request = deps.client
    .from("votes")
    .select(SUMMARY_COLUMNS)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(query.limit + 1);
  if (query.status) {
    request = request.eq("status", query.status);
  }
  if (query.votingType) {
    request = request.eq("voting_type", query.votingType);
  }
  if (query.cursor) {
    const { key, id } = decodeCursor(query.cursor, binding, positionSchema);
    request = request.or(
      `updated_at.lt.${postgrestQuote(key)},and(updated_at.eq.${postgrestQuote(key)},id.lt.${id})`,
    );
  }

  const { data, error, status } = await request.returns<SummaryRow[]>();
  assertOk(error, status);

  const { rows, page } = buildPage(data ?? [], query.limit, binding, (row) => ({
    key: row.updated_at,
    id: row.id,
  }));
  if (window) page.numbered = window.numbered;
  const current = rows.some((row) => row.timezone_snapshot === null)
    ? await getRwaDisplay(deps)
    : { name: null, timezone: null };

  return {
    data: rows.map((row) => ({
      id: row.id,
      votingType: row.voting_type,
      status: row.status,
      title: row.title,
      closesAt: row.closes_at ? new Date(row.closes_at).toISOString() : null,
      opensAt: row.opens_at ? new Date(row.opens_at).toISOString() : null,
      draftRevision: row.draft_revision,
      updatedAt: new Date(row.updated_at).toISOString(),
      timezone: row.timezone_snapshot ?? current.timezone,
    })),
    page,
  };
}

export async function getVote(
  deps: RegisterDeps,
  id: string,
): Promise<AdminVoteDetail> {
  const fetch = async () =>
    parse(
      adminVoteDetailSchema,
      await callRoutine(deps.client, "get_admin_vote", { p_vote_id: id }),
    );
  const vote = await fetch();

  // Past its deadline but not yet finalised by Cron: finalise it now (the
  // database clock decides) so an administrator never sees a stale "Active".
  if (
    vote.status === "ACTIVE" &&
    vote.closesAt !== null &&
    new Date(vote.closesAt).getTime() <= Date.now() &&
    (await reconcileOverdue(deps, id))
  ) {
    return fetch();
  }
  return vote;
}

export async function createDraft(
  deps: RegisterDeps,
  votingType: VotingType,
): Promise<AdminVoteDetail> {
  await assertCurrentAdmin(deps);
  return parse(
    adminVoteDetailSchema,
    await callRoutine(deps.client, "create_draft", {
      p_voting_type: votingType,
    }),
  );
}

export async function updateDraft(
  deps: RegisterDeps,
  id: string,
  patch: DraftPatch,
): Promise<AdminVoteDetail> {
  await assertCurrentAdmin(deps);
  const { expectedRevision, ...changes } = patch;
  // Omitted fields stay unchanged; supplied ones (including null) are sent as is.
  const defined = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  );
  return parse(
    adminVoteDetailSchema,
    await callRoutine(deps.client, "update_draft", {
      p_vote_id: id,
      p_expected_revision: expectedRevision,
      p_changes: defined,
    }),
  );
}

export async function previewDraft(
  deps: RegisterDeps,
  id: string,
  expectedRevision: number,
): Promise<DraftPreview> {
  return parse(
    draftPreviewSchema,
    await callRoutine(deps.client, "preview_draft", {
      p_vote_id: id,
      p_expected_revision: expectedRevision,
    }),
  );
}

interface HouseholdRow {
  id: string;
  identifier: string;
  is_eligible: boolean;
  profiles: { representative_name: string; status: string } | null;
}

/**
 * Households offered for an electorate, in a stable order. The register is
 * bounded by the electorate collection limit; a larger register is refused
 * rather than silently truncated.
 */
export async function listSelectableHouseholds(
  deps: RegisterDeps,
): Promise<SelectableHousehold[]> {
  const { data, error, status } = await deps.client
    .from("households")
    .select(
      "id, identifier, is_eligible, profiles(representative_name, status)",
    )
    .order("identifier_normalized", { ascending: true })
    .order("id", { ascending: true })
    .limit(HOUSEHOLD_SCAN_LIMIT)
    .returns<HouseholdRow[]>();
  assertOk(error, status);

  const rows = data ?? [];
  if (rows.length >= HOUSEHOLD_SCAN_LIMIT) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE");
  }
  return rows.map((row) => ({
    id: row.id,
    identifier: row.identifier,
    isEligible: row.is_eligible,
    representativeName: row.profiles?.representative_name ?? "",
    representativeEnabled: row.profiles?.status === "ENABLED",
  }));
}
