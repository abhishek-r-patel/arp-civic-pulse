import { Download } from "lucide-react";
import { VoteStatusBadge, VotingTypeBadge } from "@/components/ui/badges";
import { buttonClasses } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { PRIVACY_COPY } from "@/components/votes/privacy-notice";
import type { PageInfo } from "@/shared/contracts/pagination";
import type {
  ClosedResults,
  NamedResponse,
  OpenResults,
  VoteResults,
} from "@/shared/contracts/results";
import { formatInZone } from "@/shared/time/zoned";

/*
 * Completed results (docs/DESIGN_SYSTEM.md section 12). Every number comes
 * from the single authoritative results projection, so this screen, the API
 * and the CSV cannot disagree. Counts and percentages are shown together with
 * their explicit denominators; ties, abstentions and "no votes" are stated in
 * words, never implied by blanks or zeros.
 */
const percent = (value: string | null) => (value === null ? "—" : `${value}%`);

function Outcome({ results }: Readonly<{ results: OpenResults }>) {
  const leaders = results.options
    .filter((option) => results.leaderOptionIds.includes(option.id))
    .map((option) => option.label);

  if (results.outcome === "NO_VOTES") {
    return (
      <Notice tone="info" heading="No votes were submitted">
        <p>No household submitted a response, so no option leads.</p>
      </Notice>
    );
  }
  if (results.outcome === "TIE") {
    return (
      <Notice tone="warning" heading="Tie">
        <p>
          These options received the same highest count: {leaders.join(", ")}.
        </p>
      </Notice>
    );
  }
  return (
    <Notice tone="success" heading="Leading option">
      <p>{leaders[0]}</p>
    </Notice>
  );
}

function OpenSection({
  results,
  page,
  hasCursor,
  basePath,
}: Readonly<{
  results: OpenResults;
  page: PageInfo | null;
  hasCursor: boolean;
  basePath: string;
}>) {
  const optionColumns: Column<OpenResults["options"][number]>[] = [
    { key: "label", header: "Option", cell: (o) => o.label },
    { key: "count", header: "Votes", cell: (o) => o.count, numeric: true },
    {
      key: "percent",
      header: `Share of ${results.submittedCount} submitted`,
      cell: (o) => percent(o.percent),
      numeric: true,
    },
  ];
  const namedColumns: Column<NamedResponse>[] = [
    {
      key: "name",
      header: "Representative",
      cell: (n) => n.representativeName,
    },
    {
      key: "household",
      header: "Household",
      cell: (n) => n.householdIdentifier,
    },
    { key: "choice", header: "Choice", cell: (n) => n.optionLabel },
  ];

  return (
    <>
      <Outcome results={results} />
      <section aria-labelledby="totals" className="grid gap-3">
        <h2 id="totals" className="text-section font-semibold">
          Totals
        </h2>
        <DataTable
          caption="Votes for each option"
          columns={optionColumns}
          rows={results.options}
          rowKey={(o) => o.id}
        />
      </section>
      <section aria-labelledby="named" className="grid gap-3">
        <h2 id="named" className="text-section font-semibold">
          Who chose what
        </h2>
        <p className="max-w-ballot text-body text-muted">{PRIVACY_COPY.OPEN}</p>
        {results.namedResponses.length === 0 ? (
          <p className="text-body">No responses to list.</p>
        ) : (
          <DataTable
            caption="Named responses"
            columns={namedColumns}
            rows={results.namedResponses}
            rowKey={(n) => `${n.householdIdentifier}-${n.optionId}`}
          />
        )}
        {page ? (
          <Pagination
            basePath={basePath}
            params={{}}
            page={page}
            hasCursor={hasCursor}
          />
        ) : null}
      </section>
    </>
  );
}

function ClosedSection({ results }: Readonly<{ results: ClosedResults }>) {
  return (
    <>
      <Notice tone="info" heading="Totals only">
        <p>{PRIVACY_COPY.CLOSED}</p>
        <p className="pt-2">{PRIVACY_COPY.CLOSED_LIMITS}</p>
      </Notice>
      {results.offices.map((office) => {
        const leaders = office.candidates
          .filter((c) => office.leaderCandidateIds.includes(c.id))
          .map((c) => c.name);
        type Row = {
          id: string;
          label: string;
          count: string;
          percent: string | null;
        };
        const rows: Row[] = [
          ...office.candidates.map((c) => ({
            id: c.id,
            label: c.name,
            count: c.count,
            percent: c.percent,
          })),
          {
            id: "abstain",
            label: "Abstained",
            count: office.abstention.count,
            percent: office.abstention.percent,
          },
        ];
        const columns: Column<Row>[] = [
          { key: "label", header: "Candidate", cell: (r) => r.label },
          {
            key: "count",
            header: "Votes",
            cell: (r) => r.count,
            numeric: true,
          },
          {
            key: "percent",
            header: `Share of ${results.submittedCount} submitted`,
            cell: (r) => percent(r.percent),
            numeric: true,
          },
        ];
        return (
          <section
            key={office.id}
            aria-labelledby={`office-${office.id}`}
            className="grid gap-3"
          >
            <h2
              id={`office-${office.id}`}
              className="text-section font-semibold"
            >
              {office.name}
            </h2>
            {office.outcome === "LEADER" ? (
              <Notice tone="success" heading="Leading candidate">
                <p>{leaders[0]}</p>
              </Notice>
            ) : office.outcome === "TIE" ? (
              <Notice tone="warning" heading="Tie">
                <p>
                  These candidates received the same highest count:{" "}
                  {leaders.join(", ")}.
                </p>
              </Notice>
            ) : (
              <Notice tone="info" heading="No winner">
                <p>No candidate received a vote for this office.</p>
              </Notice>
            )}
            <DataTable
              caption={`Results for ${office.name}`}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
            />
          </section>
        );
      })}
    </>
  );
}

export function ResultsView({
  results,
  page,
  hasCursor,
  basePath,
  formats,
}: Readonly<{
  results: VoteResults;
  page: PageInfo | null;
  hasCursor: boolean;
  basePath: string;
  formats: readonly ("csv" | "pdf")[];
}>) {
  const { vote } = results;
  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center gap-2">
        <VotingTypeBadge type={vote.votingType} />
        <VoteStatusBadge status="COMPLETED" />
      </div>

      {vote.completionMode === "EARLY" ? (
        <Notice tone="warning" heading="Completed early by an administrator">
          <p className="whitespace-pre-line">
            Reason: {vote.completionReason ?? "Not recorded"}
          </p>
        </Notice>
      ) : null}

      <section aria-labelledby="turnout" className="grid gap-2">
        <h2 id="turnout" className="text-section font-semibold">
          Turnout
        </h2>
        <p className="text-body">
          <span className="font-semibold">
            {results.turnout.numerator} of {results.turnout.denominator}
          </span>{" "}
          eligible households submitted a response
          {results.turnout.percent === null
            ? " (no households were eligible)."
            : ` (${results.turnout.percent}%).`}
        </p>
        <p className="text-caption text-muted">
          Voting ended{" "}
          <time dateTime={vote.completedAt}>
            {formatInZone(vote.completedAt, vote.timezone)}
          </time>
          . Eligibility was fixed when the vote was activated.
        </p>
      </section>

      {results.votingType === "OPEN" ? (
        <OpenSection
          results={results}
          page={page}
          hasCursor={hasCursor}
          basePath={basePath}
        />
      ) : (
        <ClosedSection results={results} />
      )}

      <Notice tone="info" heading="About this record">
        <p>{results.disclaimer}</p>
      </Notice>

      <section aria-labelledby="download" className="grid gap-3">
        <h2 id="download" className="text-section font-semibold">
          Download
        </h2>
        <p className="max-w-ballot text-body text-muted">
          The downloads contain the same totals as this page
          {results.votingType === "OPEN"
            ? ", including every named response (not only this page)"
            : ""}
          . The PDF is a printable A4 copy. A downloaded or printed copy cannot
          be recalled or deleted by the RWA.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          {formats.map((format) => (
            <a
              key={format}
              href={`/api/votes/${vote.id}/exports/${format}`}
              download
              className={buttonClasses("secondary")}
            >
              <Download aria-hidden="true" className="size-5" />
              Download {format === "csv" ? "CSV" : "PDF"}
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
