/* Concept-aligned vote summary using authorized aggregate turnout only, never individual choices. */
import Link from "next/link";
import { ArrowRight, CircleCheck, Eye, Lock } from "lucide-react";
import { VoteStatusBadge } from "@/components/ui/badges";
import { DeadlineCountdown } from "@/components/votes/deadline-countdown";
import type {
  MemberVoteSummary,
  VoteCardTurnout,
} from "@/shared/contracts/member-votes";
import { formatInZone } from "@/shared/time/zoned";

export function VoteListCard({
  vote,
  turnout,
}: Readonly<{
  vote: MemberVoteSummary;
  turnout: VoteCardTurnout | null | undefined;
}>) {
  if (vote.status === "SCHEDULED" && vote.opensAt) {
    const opens = new Date(vote.opensAt);
    return (
      <li
        data-vote-card
        className="flex items-center gap-3 border-t border-border py-3"
      >
        <div
          aria-hidden="true"
          className="grid h-14 w-12 shrink-0 content-center justify-items-center rounded-control border border-border bg-surface"
        >
          <span className="text-xs text-muted uppercase">
            {new Intl.DateTimeFormat("en", {
              month: "short",
              timeZone: vote.timezone,
            }).format(opens)}
          </span>
          <span className="font-heading text-lg font-semibold">
            {new Intl.DateTimeFormat("en", {
              day: "numeric",
              timeZone: vote.timezone,
            }).format(opens)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-semibold">
            <Link
              href={`/votes/${vote.id}`}
              className="inline-flex min-h-12 items-center text-primary underline-offset-4 hover:text-accent hover:underline"
            >
              {vote.title}
            </Link>
          </h2>
          <p className="text-caption text-muted">
            Scheduled -{" "}
            <time dateTime={vote.opensAt}>
              Opens {formatInZone(vote.opensAt, vote.timezone)}
            </time>
          </p>
        </div>
        <span className="hidden text-caption text-muted sm:block">
          Coming up
        </span>
      </li>
    );
  }
  const active = vote.status === "ACTIVE";
  const completed = vote.status === "COMPLETED";
  const resultsLink = completed || (active && vote.submitted);
  const href = resultsLink ? `/votes/${vote.id}/results` : `/votes/${vote.id}`;
  const action = completed
    ? "View Results"
    : active && vote.submitted
      ? vote.votingType === "PUBLIC"
        ? "View Live Results"
        : "View Live Turnout"
      : active
        ? "Open Ballot"
        : "View Vote";
  const TypeIcon = vote.votingType === "PUBLIC" ? Eye : Lock;
  return (
    <li
      data-vote-card
      className={`grid gap-3 rounded-card border border-border bg-surface p-4 shadow-panel md:p-5 ${active ? "border-l-[3px] border-l-accent" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted uppercase">
            <TypeIcon aria-hidden="true" className="size-3.5" />
            {vote.votingType === "PUBLIC" ? "Public poll" : "Private election"}
          </span>
          {active ? (
            <span className="inline-flex items-center gap-1.5 rounded-control bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">
              <span
                aria-hidden="true"
                className="size-1 rounded-full bg-accent"
              />
              Active
            </span>
          ) : (
            <VoteStatusBadge status={vote.status} />
          )}
        </div>
        {active ? (
          <DeadlineCountdown deadline={vote.closesAt} compact />
        ) : vote.status === "SCHEDULED" && vote.opensAt ? (
          <DeadlineCountdown deadline={vote.opensAt} compact opening />
        ) : null}
      </div>
      <div>
        <h2 className="font-heading text-lg leading-snug font-semibold">
          <Link
            href={`/votes/${vote.id}`}
            className="inline-flex min-h-12 items-center text-primary underline-offset-4 hover:text-accent hover:underline"
          >
            {vote.title}
          </Link>
        </h2>
        <p className="text-body text-muted">
          {vote.status === "CANCELLED"
            ? "Cancelled; no valid results or exports."
            : vote.status === "SCHEDULED"
              ? "Voting opens at the scheduled time."
              : vote.votingType === "PUBLIC"
                ? "Your final response is named after completion."
                : "Candidate totals stay hidden until completion."}
        </p>
      </div>
      {active && turnout ? (
        <div
          aria-label="Aggregate turnout"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 text-caption text-muted"
        >
          <span className="font-semibold text-primary tabular-nums">
            {turnout.submittedCount} / {turnout.eligibleCount}
          </span>
          <div
            aria-hidden="true"
            className="h-1 min-w-16 flex-1 overflow-hidden rounded-sm bg-border"
          >
            <div
              className="h-full rounded-sm bg-accent"
              style={{ width: `${turnout.percent ?? "0"}%` }}
            />
          </div>
          <span className="tabular-nums">
            {turnout.percent === null
              ? "Turnout not applicable"
              : `${turnout.percent}% turnout`}
          </span>
        </div>
      ) : active && turnout === null ? (
        <p className="text-caption text-muted">
          Turnout temporarily unavailable
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <span
          className={`inline-flex items-center gap-1.5 text-caption ${vote.submitted ? "font-semibold text-accent" : "text-muted"}`}
        >
          {vote.submitted ? (
            <CircleCheck aria-hidden="true" className="size-4" />
          ) : null}
          {vote.status === "SCHEDULED"
            ? "Voting not open"
            : vote.status === "CANCELLED"
              ? "Results not valid"
              : vote.submitted
                ? "Response recorded"
                : active
                  ? "Not submitted"
                  : "Did not submit"}
        </span>
        <Link
          href={href}
          className={`inline-flex touch-target items-center justify-center gap-2 rounded-control text-caption font-semibold ${active && !vote.submitted ? "bg-accent px-3 text-on-accent hover:bg-accent-strong" : "px-0 text-accent underline-offset-4 hover:underline"}`}
        >
          {action}
          <ArrowRight aria-hidden="true" className="size-4" />
          <span className="sr-only">: {vote.title}</span>
        </Link>
      </div>
      <p className="sr-only">
        {vote.status === "SCHEDULED" && vote.opensAt
          ? `Opens ${formatInZone(vote.opensAt, vote.timezone)}`
          : `Closes ${formatInZone(vote.closesAt, vote.timezone)}`}
      </p>
    </li>
  );
}
