// Protected administrator vote inventory.
import { Vote } from "lucide-react";
import { flashNotices, firstValues } from "@/components/admin/format";
import {
  VoteTableToolbar,
  type VoteTableState,
} from "@/components/admin/vote-table-controls";
import { VoteTableView } from "@/components/admin/vote-table-view";
import { voteTableClearFiltersHref } from "@/components/admin/vote-table-urls";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/server/http/errors";
import { readPageNumber } from "@/server/http/numbered-page";
import { adminPageContext } from "@/server/register/page-context";
import { listVoteTable } from "@/server/votes/drafts";
import { voteTableQuerySchema } from "@/shared/contracts/admin-votes";
export const metadata = {
  title: "Manage Votes",
  description:
    "Manage draft, scheduled, active, completed and cancelled association polls and elections.",
  alternates: { canonical: "/admin/votes" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function VotesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const deps = await adminPageContext();
  const raw = firstValues(await searchParams);
  const flash = raw.notice ? flashNotices(deps.terms)[raw.notice] : undefined;

  const parsed = voteTableQuerySchema.safeParse({
    limit: raw.limit,
    cursor: raw.cursor,
    status: raw.status,
    votingType: raw.votingType,
    titleContains: raw.titleContains,
    deadlineFrom: raw.deadlineFrom,
    deadlineTo: raw.deadlineTo,
    changedFrom: raw.changedFrom,
    changedTo: raw.changedTo,
    sort: raw.sort,
    direction: raw.direction,
  });
  const filtersInvalid = !parsed.success;
  const query = parsed.success ? parsed.data : voteTableQuerySchema.parse({});

  let result: Awaited<ReturnType<typeof listVoteTable>> | null = null;
  let loadError: ApiError | null = null;
  try {
    result = await listVoteTable(deps, query, readPageNumber(raw.page));
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    loadError = error;
  }

  const filtersActive = [
    query.titleContains,
    query.status,
    query.votingType,
    query.deadlineFrom,
    query.deadlineTo,
    query.changedFrom,
    query.changedTo,
  ].some(Boolean);
  const tableState: VoteTableState = {
    params: {
      limit: String(query.limit),
      titleContains: query.titleContains,
      status: query.status,
      votingType: query.votingType,
      deadlineFrom: query.deadlineFrom,
      deadlineTo: query.deadlineTo,
      changedFrom: query.changedFrom,
      changedTo: query.changedTo,
      sort: query.sort,
      direction: query.direction,
    },
    sort: query.sort,
    direction: query.direction,
  };
  const paginationParams = {
    titleContains: query.titleContains,
    status: query.status,
    votingType: query.votingType,
    deadlineFrom: query.deadlineFrom,
    deadlineTo: query.deadlineTo,
    changedFrom: query.changedFrom,
    changedTo: query.changedTo,
    sort: query.sort,
    direction: query.direction,
  };

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Manage Votes"
        description="Create drafts, preview ballots, activate now or schedule opening. Scheduling freezes the vote; it must return to draft before edits."
        actions={
          <LinkButton href="/admin/votes/new" disabled={!deps.actor.isAdmin}>
            <Vote aria-hidden="true" className="size-5" />
            New Vote
          </LinkButton>
        }
      />

      {flash ? (
        <Notice tone="success" heading={flash}>
          Your change was saved.
        </Notice>
      ) : null}
      {filtersInvalid ? (
        <Notice tone="warning" heading="Some filters were not valid">
          They were ignored. Choose filters in Sort &amp; Filter to try again.
        </Notice>
      ) : null}

      {loadError ? (
        <Notice tone="error" heading="Votes could not be loaded">
          Try again in a moment. If this keeps happening, quote this reference
          to support: {loadError.code}.
        </Notice>
      ) : result && result.data.length === 0 ? (
        <div className="grid gap-8">
          <VoteTableToolbar state={tableState} />
          {filtersActive ? (
            <EmptyState
              title="No votes match these filters"
              action={
                <LinkButton
                  href={voteTableClearFiltersHref(tableState.params)}
                  variant="secondary"
                >
                  Clear Filters
                </LinkButton>
              }
            >
              <p>Try different filter criteria.</p>
            </EmptyState>
          ) : (
            <EmptyState
              title="There are no votes yet"
              action={
                <LinkButton
                  href="/admin/votes/new"
                  disabled={!deps.actor.isAdmin}
                >
                  Create a Vote
                </LinkButton>
              }
            >
              <p>
                Start with a draft. Nothing is visible to residents until you
                activate it.
              </p>
            </EmptyState>
          )}
        </div>
      ) : result ? (
        <>
          <VoteTableView state={tableState} votes={result.data} />
          <Pagination
            basePath="/admin/votes"
            params={paginationParams}
            page={result.page}
          />
        </>
      ) : null}
      {result && result.data.length === 0 ? (
        <Pagination
          basePath="/admin/votes"
          params={paginationParams}
          page={result.page}
        />
      ) : null}
    </div>
  );
}
