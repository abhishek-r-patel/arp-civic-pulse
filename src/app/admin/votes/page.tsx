import Link from "next/link";
import { Vote } from "lucide-react";
import {
  FLASH_NOTICES,
  firstValues,
  formatInstant,
} from "@/components/admin/format";
import { VoteStatusBadge, VotingTypeBadge } from "@/components/ui/badges";
import { Button, LinkButton } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SelectField } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/server/http/errors";
import { adminPageContext } from "@/server/register/page-context";
import { listVotes } from "@/server/votes/drafts";
import { voteListQuerySchema } from "@/shared/contracts/admin-votes";
import type { AdminVoteSummary } from "@/shared/contracts/drafts";
import {
  VOTE_STATUS_LABELS,
  VOTING_TYPE_LABELS,
  VOTE_STATUSES,
  VOTING_TYPES,
} from "@/shared/contracts/voting";
import { formatInZone } from "@/shared/time/zoned";

export const metadata = { title: "Manage votes" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const columns: Column<AdminVoteSummary>[] = [
  {
    key: "title",
    header: "Vote",
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
    cell: (vote) => <VotingTypeBadge type={vote.votingType} />,
  },
  {
    key: "status",
    header: "Status",
    cell: (vote) => <VoteStatusBadge status={vote.status} />,
  },
  {
    key: "deadline",
    header: "Deadline",
    cell: (vote) =>
      vote.closesAt
        ? vote.timezone
          ? formatInZone(vote.closesAt, vote.timezone)
          : formatInstant(vote.closesAt)
        : "Not set",
  },
  {
    key: "updated",
    header: "Last changed",
    cell: (vote) =>
      vote.timezone
        ? formatInZone(vote.updatedAt, vote.timezone)
        : formatInstant(vote.updatedAt),
  },
];

export default async function VotesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const deps = await adminPageContext();
  const raw = firstValues(await searchParams);
  const flash = raw.notice ? FLASH_NOTICES[raw.notice] : undefined;

  const parsed = voteListQuerySchema.safeParse({
    limit: raw.limit,
    cursor: raw.cursor,
    status: raw.status,
    votingType: raw.votingType,
  });
  const filtersInvalid = !parsed.success;
  const query = parsed.success ? parsed.data : voteListQuerySchema.parse({});

  let result: Awaited<ReturnType<typeof listVotes>> | null = null;
  let loadError: ApiError | null = null;
  try {
    result = await listVotes(deps, query);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    loadError = error;
  }

  const filtersActive =
    query.status !== undefined || query.votingType !== undefined;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Manage votes"
        description="Create drafts, preview exactly what residents will see, and review every vote. Drafts can be edited until a vote is activated."
        actions={
          <LinkButton href="/admin/votes/new">
            <Vote aria-hidden="true" className="size-5" />
            New vote
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
          They were ignored. Choose filters below to try again.
        </Notice>
      ) : null}

      <form
        method="get"
        className="grid gap-4 rounded-card border border-border bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <SelectField
          id="status"
          name="status"
          label="Status"
          defaultValue={raw.status ?? ""}
        >
          <option value="">Any status</option>
          {VOTE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {VOTE_STATUS_LABELS[status]}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="votingType"
          name="votingType"
          label="Voting type"
          defaultValue={raw.votingType ?? ""}
        >
          <option value="">Any type</option>
          {VOTING_TYPES.map((type) => (
            <option key={type} value={type}>
              {VOTING_TYPE_LABELS[type]}
            </option>
          ))}
        </SelectField>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit">Apply filters</Button>
          {filtersActive ? (
            <LinkButton href="/admin/votes" variant="secondary">
              Clear
            </LinkButton>
          ) : null}
        </div>
      </form>

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
              <LinkButton href="/admin/votes" variant="secondary">
                Clear filters
              </LinkButton>
            }
          >
            <p>Try a different status or voting type.</p>
          </EmptyState>
        ) : (
          <EmptyState
            title="There are no votes yet"
            action={
              <LinkButton href="/admin/votes/new">Create a vote</LinkButton>
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
            columns={columns}
            rows={result.data}
            rowKey={(vote) => vote.id}
          />
          <Pagination
            basePath="/admin/votes"
            params={{ status: raw.status, votingType: raw.votingType }}
            page={result.page}
            hasCursor={Boolean(raw.cursor)}
          />
        </>
      ) : null}
    </div>
  );
}
