// Protected member vote list; never indexed or included in public discovery.
import Link from "next/link";
import { History, ListFilter } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { WelcomeMessage } from "@/components/ui/rwa-branding";
import { Pagination } from "@/components/ui/pagination";
import { VoteListCard } from "@/components/votes/vote-list-card";
import { ApiError } from "@/server/http/errors";
import { readPageNumber } from "@/server/http/numbered-page";
import { memberPageContext } from "@/server/register/page-context";
import { loadHouseholdTerms } from "@/server/settings/rwa-profile";
import {
  getMemberVoteOverview,
  getVoteCardTurnouts,
  listMemberVotes,
} from "@/server/votes/member";
import {
  memberVoteListQuerySchema,
  type MemberVoteOverview,
  type VoteCardTurnout,
} from "@/shared/contracts/member-votes";
import {
  VOTE_STATUS_LABELS,
  VOTING_TYPE_LABELS,
  VOTING_TYPES,
} from "@/shared/contracts/voting";
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

const STATUS_FILTERS = [
  "ACTIVE",
  "SCHEDULED",
  "COMPLETED",
  "CANCELLED",
] as const;

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
    result = await listMemberVotes(deps, query, readPageNumber(raw.page));
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    loadError = error;
  }

  const filtersActive =
    query.status !== undefined || query.votingType !== undefined;
  let overview: MemberVoteOverview | null = null;
  let turnouts = new Map<string, VoteCardTurnout | null>();
  if (result) {
    [overview, turnouts] = await Promise.all([
      getMemberVoteOverview(deps).catch((error: unknown) => {
        if (!(error instanceof ApiError)) throw error;
        return null;
      }),
      getVoteCardTurnouts(deps, result.data),
    ]);
  }
  function filterHref(status?: (typeof STATUS_FILTERS)[number]) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (query.votingType) params.set("votingType", query.votingType);
    if (query.limit !== 25) params.set("limit", String(query.limit));
    return params.size ? `/?${params}` : "/";
  }

  return (
    <div data-votes-dashboard className="mx-auto grid max-w-4xl gap-5 md:gap-6">
      <header className="grid gap-2">
        <p className="text-xs font-semibold text-muted uppercase">
          {deps.branding.alias} / Community decisions
        </p>
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-heading text-page-title font-semibold md:text-page-title-lg">
            Votes
          </h1>
          <Link
            href={filterHref("COMPLETED")}
            aria-label="Vote history"
            title="Vote history"
            className="inline-flex touch-target shrink-0 items-center justify-center rounded-control border border-border bg-surface px-3 text-primary hover:bg-primary/5"
          >
            <History aria-hidden="true" className="size-5" />
          </Link>
        </div>
        <p className="text-body text-muted">
          Review the decisions open to your {deps.terms.household}.
        </p>
      </header>
      <WelcomeMessage message={deps.branding.welcomeMessage} />

      {result ? (
        <section
          aria-label="Your vote overview"
          className="border-y border-border py-4 md:py-5"
        >
          <dl className="grid grid-cols-3 gap-3">
            {[
              {
                key: "active",
                label: "Active votes",
                hint: "Open for participation",
              },
              { key: "scheduled", label: "Scheduled", hint: "Opening ahead" },
              {
                key: "responded",
                label: "Your responses",
                hint: "In active votes",
              },
            ].map((item, index) => (
              <div
                key={item.key}
                className={`flex min-w-0 flex-col gap-1 ${index ? "border-l border-border pl-3 md:pl-6" : ""}`}
              >
                <dt className="order-2 text-caption font-semibold text-primary">
                  {item.label}
                </dt>
                <dd className="order-1 font-heading text-page-title font-medium tabular-nums">
                  {overview
                    ? String(
                        overview[item.key as keyof MemberVoteOverview],
                      ).padStart(2, "0")
                    : "—"}
                </dd>
                <dd className="order-3 text-caption text-muted">
                  {overview ? item.hint : "Unavailable"}
                </dd>
              </div>
            ))}
          </dl>
          <p className="sr-only">
            Counts cover your frozen entitlements across pages and voting-type
            filters, not all association votes. Responses count active votes
            only.
          </p>
        </section>
      ) : null}

      {account.isAdmin || account.isReadonly ? (
        <details className="border-b border-border pb-3">
          <summary className="touch-target cursor-pointer py-3 text-caption font-semibold text-muted">
            {account.isReadonly ? "Committee view" : "RWA Admin tools"}
          </summary>
          <p>
            {account.isReadonly ? "View" : "Maintain"} the{" "}
            {deps.terms.households} register, accounts and votes. Management
            access does not make you eligible to vote; eligibility comes from
            the {deps.terms.households} register.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <LinkButton href="/admin/votes" variant="secondary">
              Manage Votes
            </LinkButton>
            <LinkButton href="/admin/residents" variant="secondary">
              Residents
            </LinkButton>
          </div>
        </details>
      ) : null}

      {filtersInvalid ? (
        <Notice tone="warning" heading="Some filters were not valid">
          They were ignored. Choose filters below to try again.
        </Notice>
      ) : null}

      <div className="flex min-w-0 items-start gap-2 border-b border-border">
        <nav
          aria-label="Vote status"
          className="flex min-w-0 flex-1 flex-wrap gap-x-3"
        >
          {[
            { value: undefined, label: "All" },
            ...STATUS_FILTERS.filter(
              (status) =>
                status !== "CANCELLED" || query.status === "CANCELLED",
            ).map((status) => ({
              value: status,
              label: VOTE_STATUS_LABELS[status],
            })),
          ].map((item) => (
            <Link
              key={item.value ?? "all"}
              href={filterHref(item.value)}
              aria-current={query.status === item.value ? "page" : undefined}
              className={`inline-flex min-h-12 shrink-0 items-center border-b-2 text-caption font-semibold ${query.status === item.value ? "border-accent text-accent" : "border-transparent text-muted hover:text-primary"}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <details className="relative shrink-0">
          <summary
            aria-label="Voting type filter"
            title="Voting type filter"
            className="inline-flex touch-target cursor-pointer list-none items-center justify-center rounded-control px-3 text-muted hover:bg-primary/5 [&::-webkit-details-marker]:hidden"
          >
            <ListFilter aria-hidden="true" className="size-5" />
            <span className="sr-only">Voting type filter</span>
          </summary>
          <form
            method="get"
            className="absolute top-full right-0 z-30 mt-2 grid w-64 gap-3 rounded-card border border-border bg-surface p-4 shadow-panel"
          >
            {query.status ? (
              <input type="hidden" name="status" value={query.status} />
            ) : null}
            <input type="hidden" name="limit" value={query.limit} />
            <label htmlFor="votingType" className="text-caption font-semibold">
              Voting type
            </label>
            <select
              id="votingType"
              name="votingType"
              defaultValue={query.votingType ?? ""}
              className="touch-target max-w-full rounded-control border border-control-border bg-surface px-3 text-body text-primary"
            >
              <option value="">Any type</option>
              {VOTING_TYPES.map((type) => (
                <option key={type} value={type}>
                  {VOTING_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <Button type="submit">Apply Filters</Button>
            <Link
              href={filterHref("CANCELLED")}
              className="inline-flex touch-target items-center font-semibold text-accent underline"
            >
              Cancelled Votes
            </Link>
            {filtersActive ? (
              <Link
                href="/"
                className="inline-flex touch-target items-center font-semibold text-accent underline"
              >
                Clear Filters
              </Link>
            ) : null}
          </form>
        </details>
      </div>

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
              <VoteListCard
                key={vote.id}
                vote={vote}
                turnout={turnouts.get(vote.id)}
              />
            ))}
          </ul>
          <Pagination
            basePath="/"
            params={{ status: raw.status, votingType: raw.votingType }}
            page={result.page}
          />
        </>
      ) : null}
      {result && result.data.length === 0 ? (
        <Pagination
          basePath="/"
          params={{ status: raw.status, votingType: raw.votingType }}
          page={result.page}
        />
      ) : null}
    </div>
  );
}
