// Theme-consistent authorized result sections; active privacy and export projections are unchanged.
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Download, Trophy } from "lucide-react";
import { VoteStatusBadge, VotingTypeBadge } from "@/components/ui/badges";
import { buttonClasses } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Notice } from "@/components/ui/notice";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import { InfoTip } from "@/components/ui/info-tip";
import { DeadlineCountdown } from "@/components/votes/deadline-countdown";
import { Pagination } from "@/components/ui/pagination";
import { PrivateNotice, privacyCopy } from "@/components/votes/privacy-notice";
import { ResultBars, type ResultBarRow } from "@/components/votes/result-bars";
import type { PageInfo } from "@/shared/contracts/pagination";
import type {
  ActiveClosedResults,
  ClosedResults,
  NamedResponse,
  OpenResults,
  VoteResults,
} from "@/shared/contracts/results";
import { formatInZone } from "@/shared/time/zoned";

/*
 * Active polls show only the aggregates permitted for their voting type and
 * refresh automatically. Completed results use the shared API/export projection.
 * Each choice is shown as "count/eligible percent" above a bar; percentages
 * are shares of the frozen electorate. Outcomes are stated in words, never
 * implied by blanks, zeros or bar colour.
 */

function Outcome({
  results,
  terms,
}: Readonly<{
  results: OpenResults;
  terms: ReturnType<typeof useHouseholdTerms>;
}>) {
  const leaders = results.options
    .filter((option) => results.leaderOptionIds.includes(option.id))
    .map((option) => option.label);

  if (results.outcome === "NO_VOTES") {
    return (
      <Notice tone="info" heading="No votes were submitted">
        <p>No {terms.Household} submitted a response, so no option leads.</p>
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
  return <WinnerBanner label="Leading option" name={leaders[0] ?? ""} />;
}

/** Highlighted outcome card: trophy badge, small label and the winner's name. */
function WinnerBanner({
  label,
  name,
}: Readonly<{ label: string; name: string }>) {
  return (
    <div
      role="status"
      className="flex items-center gap-4 rounded-card border border-success/30 bg-success/5 p-4"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
        <Trophy aria-hidden="true" className="size-6" />
      </span>
      <div className="min-w-0">
        <p className="text-caption font-semibold tracking-wide text-success uppercase">
          {label}
        </p>
        <p className="text-card-heading font-semibold break-words text-primary">
          {name}
        </p>
      </div>
    </div>
  );
}

function OpenSection({
  results,
  page,
  basePath,
  identifierLabel,
  terms,
}: Readonly<{
  results: OpenResults;
  page: PageInfo | null;
  basePath: string;
  identifierLabel: string;
  terms: ReturnType<typeof useHouseholdTerms>;
}>) {
  const namedColumns: Column<NamedResponse>[] = [
    {
      key: "name",
      header: "Representative",
      cell: (n) => n.representativeName,
    },
    {
      key: "household",
      header: identifierLabel,
      cell: (n) => n.householdIdentifier,
    },
    {
      key: "choice",
      header: "Selections",
      cell: (n) => n.optionLabels.join(", "),
    },
  ];

  return (
    <>
      <Outcome results={results} terms={terms} />
      {results.vote.openSelectionMode === "MULTIPLE" ? (
        <Notice
          tone="info"
          heading={`${terms.Households} could select multiple options`}
        >
          <p>
            Option percentages are shares of eligible {terms.households} and can
            add up to more than 100%. Each {terms.household} is counted once in
            turnout.
          </p>
        </Notice>
      ) : null}
      <section aria-labelledby="totals" className="grid gap-3">
        <h2 id="totals" className="text-section font-semibold">
          Totals
        </h2>
        <ResultBars
          label="Votes for each option"
          total={results.eligibleCount}
          totalNoun={`eligible ${terms.households}`}
          rows={results.options.map((o) => {
            const leading =
              results.outcome !== "NO_VOTES" &&
              results.leaderOptionIds.includes(o.id);
            return {
              id: o.id,
              label: o.label,
              count: o.count,
              percent: o.eligiblePercent,
              tone: leading ? "leader" : "default",
              tag: leading
                ? results.outcome === "TIE"
                  ? "Tied"
                  : "Leading"
                : undefined,
            };
          })}
        />
      </section>
      {results.vote.status === "COMPLETED" ? (
        <section aria-labelledby="named" className="grid gap-3">
          <h2 id="named" className="text-section font-semibold">
            Who chose what
          </h2>
          <p className="max-w-ballot text-body text-muted">
            {privacyCopy(terms).PUBLIC}
          </p>
          {results.namedResponses.length === 0 ? (
            <p className="text-body">No responses to list.</p>
          ) : (
            <DataTable
              caption="Named responses"
              columns={namedColumns}
              rows={results.namedResponses}
              rowKey={(n) => n.householdIdentifier}
            />
          )}
          {page ? (
            <Pagination basePath={basePath} params={{}} page={page} />
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function ClosedSection({
  results,
  terms,
}: Readonly<{
  results: ClosedResults;
  terms: ReturnType<typeof useHouseholdTerms>;
}>) {
  return (
    <>
      <PrivateNotice tone="info" />
      <InfoTip
        heading={<p className="text-body font-semibold">How NOTA is counted</p>}
        label="About NOTA counting"
      >
        <p>
          NOTA is counted separately and cannot win. The candidate with the
          highest count among candidates is elected, even if NOTA receives more
          votes. No candidate is elected if no candidate receives a vote; tied
          candidate totals remain a tie.
        </p>
      </InfoTip>
      <div className="grid gap-4 md:grid-cols-2">
        {results.offices.map((office) => {
          const leaders = office.candidates
            .filter((c) => office.leaderCandidateIds.includes(c.id))
            .map((c) => c.name);
          const rows: ResultBarRow[] = [
            ...office.candidates.map((c) => {
              const leading =
                office.outcome !== "NO_WINNER" &&
                office.leaderCandidateIds.includes(c.id);
              return {
                id: c.id,
                label: c.name,
                count: c.count,
                percent: c.eligiblePercent,
                tone: leading ? ("leader" as const) : ("default" as const),
                tag: leading
                  ? office.outcome === "TIE"
                    ? "Tied"
                    : "Elected"
                  : undefined,
              };
            }),
            {
              id: "nota",
              label: "NOTA (None of the Above)",
              count: office.nota.count,
              percent: office.nota.eligiblePercent,
              tone: "muted",
            },
          ];
          return (
            <section
              key={office.id}
              aria-labelledby={`office-${office.id}`}
              className="grid content-start gap-3 rounded-card border border-border bg-surface p-4 md:p-5"
            >
              <h2
                id={`office-${office.id}`}
                className="text-section font-semibold"
              >
                {office.name}
              </h2>
              {office.outcome === "LEADER" ? (
                <WinnerBanner
                  label="Elected candidate"
                  name={leaders[0] ?? ""}
                />
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
              <ResultBars
                label={`Results for ${office.name}`}
                total={results.eligibleCount}
                totalNoun={`eligible ${terms.households}`}
                rows={rows}
              />
            </section>
          );
        })}
      </div>
    </>
  );
}

function ActiveClosedSection({
  results,
  terms,
}: Readonly<{
  results: ActiveClosedResults;
  terms: ReturnType<typeof useHouseholdTerms>;
}>) {
  return (
    <Notice tone="info" heading="Turnout only while voting is open">
      <p>
        This page shows only the aggregate number and percentage of{" "}
        {terms.households} that have voted. Candidate and NOTA totals stay
        hidden until the election ends. Administrators can use the separate
        participation list for {terms.household} follow-up; it never shows
        anyone&apos;s choices.
      </p>
      <p className="pt-2">
        {results.eligibleCount}{" "}
        {String(results.eligibleCount) === "1"
          ? `${terms.household} is`
          : `${terms.households} are`}{" "}
        eligible for this election.
      </p>
    </Notice>
  );
}

export function ResultsView({
  results,
  page,
  basePath,
  formats,
  identifierLabel,
}: Readonly<{
  results: VoteResults;
  page: PageInfo | null;
  basePath: string;
  formats: readonly ("csv" | "pdf")[];
  identifierLabel: string;
}>) {
  const router = useRouter();
  const terms = useHouseholdTerms();
  const { vote } = results;
  const active = vote.status === "ACTIVE";

  useEffect(() => {
    if (!active) {
      return;
    }
    const interval = window.setInterval(() => router.refresh(), 10_000);
    return () => window.clearInterval(interval);
  }, [active, router]);

  return (
    <div data-results-view className="grid gap-7 md:gap-8">
      <div className="flex flex-wrap items-center gap-2">
        <VotingTypeBadge type={vote.votingType} />
        <VoteStatusBadge status={vote.status} />
      </div>

      {vote.status === "COMPLETED" && vote.completionMode === "EARLY" ? (
        <Notice tone="warning" heading="Completed early by an administrator">
          <p className="whitespace-pre-line">
            Reason: {vote.completionReason ?? "Not recorded"}
          </p>
        </Notice>
      ) : null}

      <section
        aria-labelledby="turnout"
        className="grid gap-3 border-y border-border py-5"
      >
        <h2 id="turnout" className="text-section font-semibold">
          Turnout
        </h2>
        {results.turnout.percent === null ? (
          <p className="text-body">
            No {terms.households} were eligible for this vote.
          </p>
        ) : (
          <ResultBars
            label="Turnout"
            fullWidth
            total={results.turnout.denominator}
            totalNoun={`eligible ${terms.households} ${active ? "have " : ""}submitted ${results.votingType === "PRIVATE" ? "a ballot" : "a response"}`}
            rows={[
              {
                id: "turnout",
                label: `${terms.Households} that voted`,
                count: results.turnout.numerator,
                percent: results.turnout.percent,
                tone: "leader",
              },
            ]}
          />
        )}
        {vote.status === "COMPLETED" && vote.completedAt ? (
          <InfoTip
            heading={
              <p className="text-caption text-muted">
                Voting ended{" "}
                <time dateTime={vote.completedAt}>
                  {formatInZone(vote.completedAt, vote.timezone)}
                </time>
                .
              </p>
            }
            label="About eligibility"
          >
            <p>
              Eligibility was fixed when the vote was activated. Turnout counts
              only {terms.households} that were eligible at that time.
            </p>
          </InfoTip>
        ) : (
          <>
            <DeadlineCountdown deadline={vote.closesAt} />
            <p className="text-caption text-muted">
              Live aggregate turnout refreshes automatically every 10 seconds.
              {results.votingType === "PUBLIC"
                ? " Individual choices are not shown while voting is open."
                : " Candidate and NOTA totals remain hidden until the election ends."}
            </p>
          </>
        )}
      </section>

      {results.votingType === "PUBLIC" ? (
        <OpenSection
          results={results}
          terms={terms}
          page={page}
          basePath={basePath}
          identifierLabel={identifierLabel}
        />
      ) : results.status === "ACTIVE" ? (
        <ActiveClosedSection results={results} terms={terms} />
      ) : (
        <ClosedSection results={results} terms={terms} />
      )}

      {vote.status === "COMPLETED" ? (
        <section
          aria-labelledby="download"
          className="grid gap-3 border-t border-border pt-5"
        >
          <h2 id="download" className="text-section font-semibold">
            Download
          </h2>
          <p className="max-w-ballot text-body text-muted">
            Same results as this page
            {results.votingType === "PUBLIC"
              ? ", including every named response"
              : ""}
            . Once downloaded, copies can&apos;t be recalled.
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
      ) : null}
    </div>
  );
}
