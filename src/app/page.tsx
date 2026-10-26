// Protected member vote list; never indexed or included in public discovery.
import Link from "next/link";
import { Clock } from "lucide-react";
import {
  ParticipationBadge,
  VoteStatusBadge,
  VotingTypeBadge,
} from "@/components/ui/badges";
import { Button, LinkButton } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { WelcomeMessage } from "@/components/ui/rwa-branding";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/server/http/errors";
import { memberPageContext } from "@/server/register/page-context";
import { loadHouseholdTerms } from "@/server/settings/rwa-profile";
import { listMemberVotes } from "@/server/votes/member";
import {
  memberVoteListQuerySchema,
  type MemberVoteSummary,
} from "@/shared/contracts/member-votes";
import {
  VOTE_STATUS_LABELS,
  VOTING_TYPE_LABELS,
  VOTING_TYPES,
} from "@/shared/contracts/voting";
import { formatInZone } from "@/shared/time/zoned";
import { firstValues } from "@/components/admin/format";

export async function generateMetadata() {
  const terms = await loadHouseholdTerms();
  return {
    title: "Votes",
    description: `View the polls and elections available to your registered ${terms.household}, with status and participation filters.`,
    alternates: { canonical: "/" },
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_FILTERS = ["ACTIVE", "COMPLETED", "CANCELLED"] as const;

function When({ vote }: Readonly<{ vote: MemberVoteSummary }>) {
  if (vote.status === "CANCELLED" && vote.cancelledAt) {
    return (
      <>
        Cancelled{" "}
        <time dateTime={vote.cancelledAt}>
          {formatInZone(vote.cancelledAt, vote.timezone)}
        </time>
      </>
    );
  }
  if (vote.status === "COMPLETED" && vote.completedAt) {
    return (
      <>
        Ended{" "}
        <time dateTime={vote.completedAt}>
          {formatInZone(vote.completedAt, vote.timezone)}
        </time>
      </>
    );
  }
  return (
    <>
      Closes{" "}
      <time dateTime={vote.closesAt}>
        {formatInZone(vote.closesAt, vote.timezone)}
      </time>
    </>
  );
}

function VoteCard({ vote }: Readonly<{ vote: MemberVoteSummary }>) {
  return (
    <li className="grid gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <VotingTypeBadge type={vote.votingType} />
        <VoteStatusBadge status={vote.status} />
        {vote.status !== "CANCELLED" ? (
          <ParticipationBadge submitted={vote.submitted} />
        ) : null}
      </div>
      <h2 className="text-card-heading font-semibold">
        <Link
          href={`/votes/${vote.id}`}
          className="inline-flex min-h-12 items-center text-accent underline underline-offset-2"
        >
          {vote.title}
          <span className="sr-only">
            {vote.status === "ACTIVE" && !vote.submitted
              ? " (open to vote)"
              : " (view)"}
          </span>
        </Link>
      </h2>
      <p className="flex items-center gap-2 text-body text-muted">
        <Clock aria-hidden="true" className="size-5 shrink-0" />
        <span>
          <When vote={vote} />
        </span>
      </p>
    </li>
  );
}

export default async function HomePage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const deps = await memberPageContext();
  const raw = firstValues(await searchParams);
  const { actor: account } = deps;

  const parsed = memberVoteListQuerySchema.safeParse({
    limit: raw.limit,
    cursor: raw.cursor,
    status: raw.status,
    votingType: raw.votingType,
  });
  const filtersInvalid = !parsed.success;
  const query = parsed.success
    ? parsed.data
    : memberVoteListQuerySchema.parse({});

  let result: Awaited<ReturnType<typeof listMemberVotes>> | null = null;
  let loadError: ApiError | null = null;
  try {
    result = await listMemberVotes(deps, query);
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
        title="Votes"
        description={`${deps.branding.fullName}. Signed in as ${account.representativeName}. These are the votes your ${deps.terms.household} is eligible for.`}
      />
      <WelcomeMessage message={deps.branding.welcomeMessage} />

      {account.isAdmin ? (
        <Notice tone="info" heading="Administrator tools">
          <p>
            Maintain the {deps.terms.households} register, accounts and votes.
            Administrator access does not make you eligible to vote; eligibility
            comes from the {deps.terms.households} register.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <LinkButton href="/admin/votes" variant="secondary">
              Manage Votes
            </LinkButton>
            <LinkButton href="/admin/households" variant="secondary">
              {deps.terms.Households} Register
            </LinkButton>
            <LinkButton href="/admin/accounts" variant="secondary">
              Accounts
            </LinkButton>
          </div>
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
          {STATUS_FILTERS.map((status) => (
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
          <Button type="submit">Apply Filters</Button>
          {filtersActive ? (
            <LinkButton href="/" variant="secondary">
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
              <LinkButton href="/" variant="secondary">
                Clear Filters
              </LinkButton>
            }
          >
            <p>Try a different status or voting type.</p>
          </EmptyState>
        ) : (
          <EmptyState title="No votes yet">
            <p>
              There are no votes for you to take part in right now. When your
              RWA opens one that includes your {deps.terms.household}, it will
              be listed here with its deadline.
            </p>
          </EmptyState>
        )
      ) : result ? (
        <>
          <ul aria-label="Votes" className="grid gap-4">
            {result.data.map((vote) => (
              <VoteCard key={vote.id} vote={vote} />
            ))}
          </ul>
          <Pagination
            basePath="/"
            params={{ status: raw.status, votingType: raw.votingType }}
            page={result.page}
            hasCursor={Boolean(raw.cursor)}
          />
        </>
      ) : null}
    </div>
  );
}
