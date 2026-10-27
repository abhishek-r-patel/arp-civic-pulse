// Protected participation overview without disclosure of active choice totals.
import { privateRecordMetadata } from "@/shared/metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { firstValues } from "@/components/admin/format";
import { ParticipationBadge, VoteStatusBadge } from "@/components/ui/badges";
import { Button, LinkButton } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SelectField } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/server/http/errors";
import { adminPageContext } from "@/server/register/page-context";
import { loadHouseholdTerms } from "@/server/settings/rwa-profile";
import {
  getParticipationReport,
  type ParticipationReport,
} from "@/server/votes/monitoring";
import { participationQuerySchema } from "@/shared/contracts/admin-votes";
import { idParamsSchema } from "@/shared/contracts/register";
import { percentage } from "@/shared/validation/numbers";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const terms = await loadHouseholdTerms();
  return privateRecordMetadata(
    "Participation",
    `Review ${terms.household} participation without revealing active voting choices.`,
    "/admin/votes/[id]/participation",
  )({ params });
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
    result = await getParticipationReport(deps, id, query);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    if (error.code === "NOT_FOUND") {
      notFound();
    }
    failure = error;
  }

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
          <section aria-labelledby="summary" className="grid gap-2">
            <h2 id="summary" className="sr-only">
              Summary
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <VoteStatusBadge status={result.data.status} />
              <p className="text-body">
                <span className="font-semibold">
                  {result.data.submittedCount} of {result.data.eligibleCount}
                </span>{" "}
                eligible {deps.terms.households} have submitted
                {percentage(
                  result.data.submittedCount,
                  result.data.eligibleCount,
                ) === null
                  ? "."
                  : ` (${percentage(result.data.submittedCount, result.data.eligibleCount)}%).`}
              </p>
            </div>
            {result.data.status === "ACTIVE" ? (
              <p className="text-caption text-muted">
                The {deps.terms.households} list is for administrator follow-up
                and is never shown to residents. Residents can see aggregate
                turnout only.
              </p>
            ) : null}
          </section>

          <form
            method="get"
            className="grid gap-4 border-y border-border py-5 sm:grid-cols-[1fr_auto] sm:items-end"
          >
            <SelectField
              id="submitted"
              name="submitted"
              label="Show"
              defaultValue={raw.submitted ?? ""}
            >
              <option value="">All {deps.terms.households}</option>
              <option value="true">Submitted</option>
              <option value="false">Not submitted</option>
            </SelectField>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit">Apply Filter</Button>
              {raw.submitted ? (
                <LinkButton
                  href={`/admin/votes/${id}/participation`}
                  variant="secondary"
                >
                  Clear
                </LinkButton>
              ) : null}
            </div>
          </form>

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
            hasCursor={Boolean(raw.cursor)}
          />
        </>
      ) : null}
    </div>
  );
}
