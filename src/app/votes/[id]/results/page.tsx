// Protected completed-result projection and authorised downloads.
import { privateRecordMetadata } from "@/shared/metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { firstValues } from "@/components/admin/format";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { ResultsView } from "@/components/votes/results-view";
import { ApiError } from "@/server/http/errors";
import { memberPageContext } from "@/server/register/page-context";
import { availableExportFormats } from "@/server/exports/formats";
import { getResults } from "@/server/votes/member";
import { listQuerySchema } from "@/shared/contracts/pagination";
import { idParamsSchema } from "@/shared/contracts/register";

export const generateMetadata = privateRecordMetadata(
  "Results",
  "View completed voting results and authorised CSV or PDF downloads.",
  "/votes/[id]/results",
);

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
              Results are published only after voting has ended. Nothing is
              shown while a vote is still open.
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
      <PageHeader
        title={`Results: ${data.vote.title}`}
        description={`Held by ${data.vote.rwaName}.`}
      />
      <ResultsView
        results={data}
        page={page}
        hasCursor={Boolean(raw.cursor)}
        basePath={`/votes/${id}/results`}
        formats={availableExportFormats()}
      />
    </div>
  );
}
