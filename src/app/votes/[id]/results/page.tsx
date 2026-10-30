// Protected live aggregate and completed-result projection.
import { cache } from "react";
import type { Metadata } from "next";
import { privateMetadata, privateRecordMetadata } from "@/shared/metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { firstValues } from "@/components/admin/format";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { ResultsView } from "@/components/votes/results-view";
import { VoteInstructions } from "@/components/votes/vote-instructions";
import { ApiError } from "@/server/http/errors";
import { readPageNumber } from "@/server/http/numbered-page";
import { memberPageContext } from "@/server/register/page-context";
import { availableExportFormats } from "@/server/exports/formats";
import { getMemberVote, getResults } from "@/server/votes/member";
import { listQuerySchema } from "@/shared/contracts/pagination";
import { idParamsSchema } from "@/shared/contracts/register";

const DESCRIPTION =
  "View live poll aggregates, PRIVATE election turnout, or completed results.";

// Uses the member's own authorized vote read; unavailable votes keep the ID-based title.
const loadVoteTitle = cache(async (id: string): Promise<string | null> => {
  try {
    const vote = await getMemberVote(await memberPageContext(), id);
    return vote.title === "" ? "Untitled vote" : vote.title;
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
});

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>): Promise<Metadata> {
  const base = await privateRecordMetadata(
    "Results",
    DESCRIPTION,
    "/votes/[id]/results",
  )({ params });
  const parsed = idParamsSchema.safeParse(await params);
  const title = parsed.success ? await loadVoteTitle(parsed.data.id) : null;
  return title
    ? { ...base, ...privateMetadata(`Results - ${title}`, DESCRIPTION) }
    : base;
}

const querySchema = listQuerySchema({});

export default async function ResultsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const parsed = idParamsSchema.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }
  const { id } = parsed.data;
  const deps = await memberPageContext();
  const raw = firstValues(await searchParams);
  const query = querySchema.safeParse({ limit: raw.limit, cursor: raw.cursor });

  let result: Awaited<ReturnType<typeof getResults>> | null = null;
  let failure: ApiError | null = null;
  try {
    result = await getResults(
      deps,
      id,
      query.success ? query.data : querySchema.parse({}),
      readPageNumber(raw.page),
    );
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN") {
      notFound();
    }
    failure = error;
  }

  const back = (
    <Link
      href={`/votes/${id}`}
      className="inline-flex touch-target w-fit items-center gap-1 font-semibold text-accent underline underline-offset-2"
    >
      <ChevronLeft aria-hidden="true" className="size-5" />
      Back to the vote
    </Link>
  );

  if (!result) {
    const reason = failure?.context?.reason;
    return (
      <div className="grid gap-8">
        {back}
        <PageHeader title="Results" />
        {failure?.code === "RESULTS_UNAVAILABLE" && reason === "CANCELLED" ? (
          <Notice tone="error" heading="Cancelled; results not valid.">
            <p>This vote was cancelled, so no results are published.</p>
          </Notice>
        ) : failure?.code === "RESULTS_UNAVAILABLE" ? (
          <Notice tone="info" heading="Results are not available yet">
            <p>
              PUBLIC polls show aggregate results while voting is active. During
              a live PRIVATE election, only aggregate turnout is shown;
              candidate and NOTA totals are published after voting ends.
            </p>
          </Notice>
        ) : failure?.code === "RESULTS_INTEGRITY_ERROR" ? (
          <Notice tone="error" heading="Results are temporarily unavailable">
            <p>
              The recorded totals did not pass an integrity check, so they are
              withheld until the RWA administrator has reviewed them. Quote this
              reference if you contact them: {failure.code}.
            </p>
          </Notice>
        ) : (
          <Notice tone="error" heading="Results could not be loaded">
            <p>
              Try again in a moment. If this keeps happening, quote this
              reference to support: {failure?.code ?? "UNKNOWN"}.
            </p>
          </Notice>
        )}
      </div>
    );
  }

  const { data, page } = result;
  return (
    <div className="grid gap-8">
      {back}
      <PageHeader title={`Results: ${data.vote.title}`} />
      <VoteInstructions
        instructions={data.vote.instructions}
        votingType={data.vote.votingType}
      />
      <ResultsView
        results={data}
        page={page}
        basePath={`/votes/${id}/results`}
        formats={
          data.vote.status === "COMPLETED" ? availableExportFormats() : []
        }
        identifierLabel={deps.identifierLabel}
      />
    </div>
  );
}
