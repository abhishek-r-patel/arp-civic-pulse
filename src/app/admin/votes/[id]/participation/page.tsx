// Protected participation overview without disclosure of active choice totals.
import { cache, type ReactNode } from "react";
import type { Metadata } from "next";
import { privateMetadata, privateRecordMetadata } from "@/shared/metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { firstValues } from "@/components/admin/format";
import { ParticipationFilter } from "@/components/admin/participation-filter";
import { ParticipationBadge, VoteStatusBadge } from "@/components/ui/badges";
import { LinkButton } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/server/http/errors";
import { readPageNumber } from "@/server/http/numbered-page";
import { adminPageContext } from "@/server/register/page-context";
import { loadHouseholdTerms } from "@/server/settings/rwa-profile";
import { getVote } from "@/server/votes/drafts";
import {
  getParticipationReport,
  type ParticipationReport,
} from "@/server/votes/monitoring";
import { participationQuerySchema } from "@/shared/contracts/admin-votes";
import { idParamsSchema } from "@/shared/contracts/register";
import { percentage } from "@/shared/validation/numbers";

type VoteContext = Readonly<{
  title: string;
  instructions: string | null;
  votingType: "PUBLIC" | "PRIVATE";
}>;

// Shared by metadata and the page so the tab title and "About this vote" cost one read.
const loadVoteContext = cache(
  async (id: string): Promise<VoteContext | null> => {
    try {
      const vote = await getVote(await adminPageContext(), id);
      return {
        title: vote.title === "" ? "Untitled vote" : vote.title,
        instructions: vote.instructions?.trim() || null,
        votingType: vote.votingType,
      };
    } catch (error) {
      if (error instanceof ApiError) return null;
      throw error;
    }
  },
);

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>): Promise<Metadata> {
  const terms = await loadHouseholdTerms();
  const description = `Review ${terms.household} participation without revealing active voting choices.`;
  const base = await privateRecordMetadata(
    "Participation",
    description,
    "/admin/votes/[id]/participation",
  )({ params });
  const parsed = idParamsSchema.safeParse(await params);
  const vote = parsed.success ? await loadVoteContext(parsed.data.id) : null;
  return vote
    ? {
        ...base,
        ...privateMetadata(`Participation - ${vote.title}`, description),
      }
    : base;
}

function AboutVote({
  vote,
  children,
}: Readonly<{ vote: VoteContext; children?: ReactNode }>) {
  const isPublic = vote.votingType === "PUBLIC";
  return (
    <section
      aria-label="About this vote"
      className="grid gap-3 rounded-card border border-border bg-surface p-4 md:p-5"
    >
      <h2 className="text-card-heading font-semibold">
        <span className="text-muted">{isPublic ? "Question" : "Title"}:</span>{" "}
        {vote.title}
      </h2>
      {vote.instructions ? (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            <ChevronDown
              aria-hidden="true"
              className="size-5 transition-transform group-open:rotate-180"
            />
            {isPublic ? "Background" : "Instructions for voters"}
          </summary>
          <p className="mt-2 max-w-ballot text-body whitespace-pre-line text-muted">
            {vote.instructions}
          </p>
        </details>
      ) : null}
      {children ? (
        <div className="border-t border-border pt-3">{children}</div>
      ) : null}
    </section>
  );
}

type Row = ParticipationReport["rows"][number];

const columns = (identifierLabel: string): Column<Row>[] => [
  {
    key: "name",
    header: "Representative",
    cell: (row) => row.representativeName,
  },
  {
    key: "household",
    header: identifierLabel,
    cell: (row) => row.householdIdentifier,
  },
  {
    key: "state",
    header: "Status",
    cell: (row) => <ParticipationBadge submitted={row.submitted} />,
  },
];

export default async function ParticipationPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const parsedId = idParamsSchema.safeParse(await params);
  if (!parsedId.success) {
    notFound();
  }
  const { id } = parsedId.data;
  const deps = await adminPageContext();
  const raw = firstValues(await searchParams);
  const vote = await loadVoteContext(id);

  const parsed = participationQuerySchema.safeParse({
    limit: raw.limit,
    cursor: raw.cursor,
    submitted: raw.submitted,
  });
  const query = parsed.success
    ? parsed.data
    : participationQuerySchema.parse({});

  let result: Awaited<ReturnType<typeof getParticipationReport>> | null = null;
  let failure: ApiError | null = null;
  try {
    result = await getParticipationReport(
      deps,
      id,
      query,
      readPageNumber(raw.page),
    );
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    if (error.code === "NOT_FOUND") {
      notFound();
    }
    failure = error;
  }

  const percent = result
    ? percentage(result.data.submittedCount, result.data.eligibleCount)
    : null;
  const summary = result ? (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <VoteStatusBadge status={result.data.status} />
        <p className="text-body">
          <span className="font-semibold">
            {result.data.submittedCount} of {result.data.eligibleCount}
          </span>{" "}
          eligible {deps.terms.households} have submitted
          {percent === null ? "." : ` (${percent}%).`}
        </p>
      </div>
      {result.data.status === "ACTIVE" ? (
        <p className="text-caption text-muted">
          The {deps.terms.households} list is for administrator follow-up and is
          never shown to residents. Residents can see aggregate turnout only.
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="grid gap-8">
      <Link
        href={`/admin/votes/${id}`}
        className="inline-flex touch-target w-fit items-center gap-1 font-semibold text-accent underline underline-offset-2"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        Back to the vote
      </Link>
      <PageHeader
        title="Participation"
        description={`Which ${deps.terms.households} have submitted. During a live election, use this list for follow-up. It never shows what anyone chose, when they submitted, or their email.`}
      />
      {vote ? <AboutVote vote={vote}>{summary}</AboutVote> : summary}

      {failure ? (
        failure.code === "LIFECYCLE_CONFLICT" ? (
          <Notice tone="info" heading="Not available for a draft">
            <p>
              Participation is tracked once a vote has been activated and its
              electorate frozen.
            </p>
          </Notice>
        ) : (
          <Notice tone="error" heading="Participation could not be loaded">
            <p>
              Try again in a moment. If this keeps happening, quote this
              reference to support: {failure.code}.
            </p>
          </Notice>
        )
      ) : result ? (
        <>
          <div className="flex flex-wrap items-center gap-3 form-panel">
            <ParticipationFilter
              basePath={`/admin/votes/${id}/participation`}
              limit={query.limit}
              value={raw.submitted ?? ""}
              households={deps.terms.households}
            />
            {raw.submitted ? (
              <LinkButton
                href={`/admin/votes/${id}/participation`}
                variant="secondary"
              >
                Clear
              </LinkButton>
            ) : null}
          </div>

          {result.data.rows.length === 0 ? (
            <EmptyState title={`No ${deps.terms.households} match`}>
              <p>Try a different filter.</p>
            </EmptyState>
          ) : (
            <DataTable
              caption={`${deps.terms.Household} participation`}
              columns={columns(deps.identifierLabel)}
              rows={result.data.rows}
              rowKey={(row) => row.householdIdentifier}
            />
          )}
          <Pagination
            basePath={`/admin/votes/${id}/participation`}
            params={{ submitted: raw.submitted }}
            page={result.page}
          />
        </>
      ) : null}
    </div>
  );
}
