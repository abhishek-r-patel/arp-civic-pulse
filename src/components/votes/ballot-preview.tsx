import { Clock } from "lucide-react";
import { VoteStatusBadge, VotingTypeBadge } from "@/components/ui/badges";
import {
  FinalSubmissionNotice,
  PrivacyNotice,
} from "@/components/votes/privacy-notice";
import type { AdminVoteDetail } from "@/shared/contracts/drafts";
import { formatInZone } from "@/shared/time/zoned";

// The fields the ballot needs; administrator and member projections both provide them.
export type BallotVote = Pick<
  AdminVoteDetail,
  | "votingType"
  | "status"
  | "title"
  | "instructions"
  | "closesAt"
  | "timezone"
  | "options"
  | "offices"
>;

/*
 * Read-only rendering of the resident ballot (docs/DESIGN_SYSTEM.md section
 * 11): title, type and status shown separately, privacy notice, deadline with
 * its time zone, instructions, then the choices. Choices are native, unselected
 * and disabled, and every election office carries the built-in Abstain choice
 * that is never stored as ballot configuration.
 */
function Deadline({ vote }: Readonly<{ vote: BallotVote }>) {
  if (!vote.closesAt) {
    return <span>No deadline set</span>;
  }
  if (!vote.timezone) {
    return <span>Deadline set, time zone not available</span>;
  }
  return (
    <span>
      Voting closes{" "}
      <time dateTime={vote.closesAt} className="font-semibold">
        {formatInZone(vote.closesAt, vote.timezone)}
      </time>
    </span>
  );
}

function Choice({
  group,
  label,
  muted = false,
}: Readonly<{ group: string; label: string; muted?: boolean }>) {
  const id = `${group}-${label}`.replace(/[^a-zA-Z0-9_-]/gu, "-");
  return (
    <div className="flex items-start gap-3 rounded-control border border-border bg-surface px-3">
      <input
        type="radio"
        name={group}
        id={id}
        disabled
        checked={false}
        readOnly
        className="mt-3.5 size-5 shrink-0"
      />
      <label
        htmlFor={id}
        className={`flex min-h-12 items-center py-2 text-body ${muted ? "italic" : ""} text-primary`}
      >
        {label}
      </label>
    </div>
  );
}

export function BallotPreview({ vote }: Readonly<{ vote: BallotVote }>) {
  return (
    <article
      aria-labelledby="ballot-title"
      className="grid gap-6 rounded-card border border-border bg-surface p-4 md:p-6"
    >
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <VotingTypeBadge type={vote.votingType} />
          <VoteStatusBadge status={vote.status} />
        </div>
        <h2 id="ballot-title" className="text-section font-semibold">
          {vote.title === "" ? "Untitled vote" : vote.title}
        </h2>
        <p className="flex items-center gap-2 text-body text-muted">
          <Clock aria-hidden="true" className="size-5 shrink-0" />
          <Deadline vote={vote} />
        </p>
      </header>

      <PrivacyNotice type={vote.votingType} />

      {vote.instructions ? (
        <section aria-labelledby="ballot-instructions" className="grid gap-2">
          <h3
            id="ballot-instructions"
            className="text-card-heading font-semibold"
          >
            Instructions
          </h3>
          <p className="max-w-ballot text-body whitespace-pre-line">
            {vote.instructions}
          </p>
        </section>
      ) : null}

      {vote.votingType === "OPEN" ? (
        <fieldset className="grid max-w-ballot gap-2">
          <legend className="pb-2 text-card-heading font-semibold">
            {vote.title === "" ? "Choose one option" : vote.title}
          </legend>
          {vote.options.length === 0 ? (
            <p className="text-body text-muted">No options added yet.</p>
          ) : (
            vote.options.map((option) => (
              <Choice key={option.id} group="option" label={option.label} />
            ))
          )}
        </fieldset>
      ) : vote.offices.length === 0 ? (
        <p className="text-body text-muted">No offices added yet.</p>
      ) : (
        vote.offices.map((office) => (
          <fieldset key={office.id} className="grid max-w-ballot gap-2">
            <legend className="pb-2 text-card-heading font-semibold">
              {office.name}
            </legend>
            {office.candidates.map((candidate) => (
              <Choice
                key={candidate.id}
                group={office.id}
                label={candidate.name}
              />
            ))}
            <Choice group={office.id} label="Abstain" muted />
          </fieldset>
        ))
      )}

      <FinalSubmissionNotice />
    </article>
  );
}
