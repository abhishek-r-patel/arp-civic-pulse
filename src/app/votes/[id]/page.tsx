// Protected resident ballot and participation state.
import { privateRecordMetadata } from "@/shared/metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock } from "lucide-react";
import {
  ParticipationBadge,
  VoteStatusBadge,
  VotingTypeBadge,
} from "@/components/ui/badges";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { BallotForm } from "@/components/votes/ballot-form";
import { BallotPreview } from "@/components/votes/ballot-preview";
import { DeadlineCountdown } from "@/components/votes/deadline-countdown";
import { LifecycleSummary } from "@/components/votes/lifecycle-summary";
import { ApiError } from "@/server/http/errors";
import { memberPageContext } from "@/server/register/page-context";
import { loadHouseholdTerms } from "@/server/settings/rwa-profile";
import { getMemberVote } from "@/server/votes/member";
import { idParamsSchema } from "@/shared/contracts/register";
import { formatInZone } from "@/shared/time/zoned";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const terms = await loadHouseholdTerms();
  return privateRecordMetadata(
    "Vote",
    `Review and submit your ${terms.household}'s eligible response to an association poll or election.`,
    "/votes/[id]",
  )({ params });
}

export default async function MemberVotePage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const parsed = idParamsSchema.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }
  const deps = await memberPageContext();

  let vote;
  try {
    vote = await getMemberVote(deps, parsed.data.id);
  } catch (error) {
    // Not found, not yours, and a draft are all the same plain answer.
    if (
      error instanceof ApiError &&
      (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
    ) {
      notFound();
    }
    throw error;
  }

  const open = vote.status === "ACTIVE";
  const voting = open && vote.entitled && (vote.canSubmit || vote.submitted);

  return (
    <div className="grid gap-8">
      <Link
        href="/"
        className="inline-flex touch-target w-fit items-center gap-1 font-semibold text-accent underline underline-offset-2"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        Votes
      </Link>

      <PageHeader
        title={vote.title}
        description={`Held by ${vote.rwaName}.`}
        actions={
          vote.status === "COMPLETED" || vote.status === "ACTIVE" ? (
            <LinkButton href={`/votes/${vote.id}/results`}>
              {vote.status === "COMPLETED"
                ? "View Results"
                : vote.votingType === "PUBLIC"
                  ? "View Live Results"
                  : "View Live Turnout"}
            </LinkButton>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <VotingTypeBadge type={vote.votingType} />
        <VoteStatusBadge status={vote.status} />
        {vote.entitled &&
        vote.status !== "CANCELLED" &&
        vote.status !== "SCHEDULED" ? (
          <ParticipationBadge submitted={vote.submitted === true} />
        ) : null}
      </div>

      {vote.status === "SCHEDULED" && vote.opensAt ? (
        <section className="grid gap-3" aria-label="Scheduled voting">
          <Notice tone="info" heading="Voting has not opened yet">
            Opens {formatInZone(vote.opensAt, vote.timezone)}. Closes{" "}
            {formatInZone(vote.closesAt, vote.timezone)}.
          </Notice>
          <DeadlineCountdown deadline={vote.opensAt} opening />
        </section>
      ) : null}

      {open ? (
        <div className="grid gap-2">
          <p className="flex items-center gap-2 text-body text-muted">
            <Clock aria-hidden="true" className="size-5 shrink-0" />
            <span>
              Voting closes{" "}
              <time dateTime={vote.closesAt} className="font-semibold">
                {formatInZone(vote.closesAt, vote.timezone)}
              </time>
            </span>
          </p>
          <DeadlineCountdown deadline={vote.closesAt} />
        </div>
      ) : null}

      {vote.instructions && (open || vote.status === "SCHEDULED") ? (
        <section aria-labelledby="instructions" className="grid gap-2">
          <h2 id="instructions" className="text-card-heading font-semibold">
            Instructions
          </h2>
          <p className="max-w-ballot text-body whitespace-pre-line">
            {vote.instructions}
          </p>
        </section>
      ) : null}

      {voting ? (
        <BallotForm
          // PRIVATE ballots remain final; PUBLIC voters may replace their choice.
          vote={
            vote.submitted && vote.votingType === "PRIVATE"
              ? { ...vote, options: [], offices: [] }
              : vote
          }
          csrfToken={deps.csrfToken}
          initialSubmitted={vote.submitted === true}
        />
      ) : null}

      {open && vote.entitled && !voting ? (
        <Notice tone="warning" heading="Voting has reached its deadline">
          <p>
            The deadline for this vote has passed, so it can no longer accept
            submissions. It is being finalised; check again in a moment.
          </p>
        </Notice>
      ) : null}

      {open && !vote.entitled ? (
        <>
          <Notice tone="info" heading="Viewing as an administrator">
            <p>
              Your {deps.terms.household} is not in this vote&apos;s electorate,
              so you cannot submit a response. This is the ballot residents see.
            </p>
          </Notice>
          <BallotPreview vote={vote} terms={deps.terms} />
        </>
      ) : null}

      {vote.status === "COMPLETED" ? (
        <>
          <Notice tone="success" heading="Voting has ended">
            <p>
              {vote.entitled && vote.submitted
                ? `Your ${deps.terms.household}'s response was recorded.`
                : vote.entitled
                  ? `Your ${deps.terms.household} did not submit a response.`
                  : "This vote has ended."}
            </p>
          </Notice>
          <LifecycleSummary vote={vote} audience="member" />
        </>
      ) : null}

      {vote.status === "CANCELLED" ? (
        <>
          <Notice tone="error" heading="Cancelled; results not valid.">
            <p>
              This vote was cancelled. No results are published and nothing can
              be downloaded.
            </p>
          </Notice>
          <LifecycleSummary vote={vote} audience="member" />
        </>
      ) : null}
    </div>
  );
}
