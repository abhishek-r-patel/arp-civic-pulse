// Protected administrator vote inventory.
import Link from "next/link";
import { Vote } from "lucide-react";
import {
  flashNotices,
  firstValues,
  formatInstant,
} from "@/components/admin/format";
import {
  VoteColumnHeader,
  VoteTableToolbar,
  type VoteTableState,
  voteTableClearFiltersHref,
} from "@/components/admin/vote-table-controls";
import { VoteStatusBadge, VotingTypeBadge } from "@/components/ui/badges";
import { LinkButton } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { DeadlineCountdown } from "@/components/votes/deadline-countdown";
import { ApiError } from "@/server/http/errors";
import { readPageNumber } from "@/server/http/numbered-page";
import { adminPageContext } from "@/server/register/page-context";
import { listVoteTable } from "@/server/votes/drafts";
import { voteTableQuerySchema } from "@/shared/contracts/admin-votes";
import type { AdminVoteTableSummary } from "@/shared/contracts/drafts";
import { formatInZone } from "@/shared/time/zoned";

export const metadata = {
  title: "Manage Votes",
  description:
    "Manage draft, scheduled, active, completed and cancelled association polls and elections.",
  alternates: { canonical: "/admin/votes" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const columns = (state: VoteTableState): Column<AdminVoteTableSummary>[] => [
  {
    key: "title",
    header: "Vote",
    sortDirection:
      state.sort === "title"
        ? state.direction === "asc"
          ? "ascending"
          : "descending"
        : undefined,
    headerContent: (
      <VoteColumnHeader state={state} column="title" title="Vote" />
    ),
    cell: (vote) => (
      <Link
        href={`/admin/votes/${vote.id}`}
        className="inline-flex touch-target items-center font-semibold text-accent underline underline-offset-2"
      >
        {vote.title === "" ? "Untitled draft" : vote.title}
        <span className="sr-only"> (open)</span>
      </Link>
    ),
  },
  {
    key: "type",
    header: "Type",
    sortDirection:
      state.sort === "type"
        ? state.direction === "asc"
          ? "ascending"
          : "descending"
        : undefined,
    headerContent: (
      <VoteColumnHeader state={state} column="type" title="Type" />
    ),
    cell: (vote) => <VotingTypeBadge type={vote.votingType} />,
  },
  {
    key: "status",
    header: "Status",
    sortDirection:
      state.sort === "status"
        ? state.direction === "asc"
          ? "ascending"
          : "descending"
        : undefined,
    headerContent: (
      <VoteColumnHeader state={state} column="status" title="Status" />
    ),
    cell: (vote) => <VoteStatusBadge status={vote.status} />,
  },
  {
    key: "deadline",
    header: "Deadline",
    sortDirection:
      state.sort === "deadline"
        ? state.direction === "asc"
          ? "ascending"
          : "descending"
        : undefined,
    headerContent: (
      <VoteColumnHeader state={state} column="deadline" title="Deadline" />
    ),
    cell: (vote) => (
      <div className="grid gap-1">
        {vote.status === "SCHEDULED" && vote.opensAt ? (
          <>
            <span>
              Opens {formatInZone(vote.opensAt, vote.timezone ?? "UTC")}
            </span>
            <DeadlineCountdown deadline={vote.opensAt} opening />
          </>
        ) : null}
        <span>
          {vote.closesAt
            ? vote.timezone
              ? formatInZone(vote.closesAt, vote.timezone)
              : formatInstant(vote.closesAt)
            : "Not set"}
        </span>
        {vote.status === "ACTIVE" && vote.closesAt ? (
          <DeadlineCountdown deadline={vote.closesAt} />
        ) : null}
      </div>
    ),
  },
  {
    key: "updated",
    header: "Last Changed",
    sortDirection:
      state.sort === "updated"
        ? state.direction === "asc"
          ? "ascending"
          : "descending"
        : undefined,
    headerContent: (
      <VoteColumnHeader state={state} column="updated" title="Last Changed" />
    ),
    cell: (vote) =>
      vote.timezone
        ? formatInZone(vote.updatedAt, vote.timezone)
        : formatInstant(vote.updatedAt),
  },
  {
    key: "turnout",
    header: "Turnout",
    cell: (vote) => {
      if (vote.status === "DRAFT" || vote.status === "SCHEDULED") {
        return "Not open";
      }
      if (vote.status === "CANCELLED") return "Not available";
      if (!vote.turnout) return "Turnout unavailable";

      const { eligibleCount, submittedCount, percent } = vote.turnout;
      return (
        <span
          className="tabular-nums"
          aria-label={`${submittedCount} of ${eligibleCount} eligible; ${percent}% turnout`}
        >
          {submittedCount} / {eligibleCount} ({percent}%)
        </span>
      );
    },
  },
];

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
          They were ignored. Choose filters in the table headings to try again.
        </Notice>
      ) : null}

      <VoteTableToolbar state={tableState} />

      {loadError ? (
        <Notice tone="error" heading="Votes could not be loaded">
          Try again in a moment. If this keeps happening, quote this reference
          to support: {loadError.code}.
        </Notice>
      ) : result && result.data.length === 0 ? (
        filtersActive ? (
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
        )
      ) : result ? (
        <>
          <DataTable
            caption="Votes"
            columns={columns(tableState)}
            rows={result.data}
            rowKey={(vote) => vote.id}
          />
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
