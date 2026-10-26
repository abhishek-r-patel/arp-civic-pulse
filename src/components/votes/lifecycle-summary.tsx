import { Clock } from "lucide-react";
import { Notice } from "@/components/ui/notice";
import { DeadlineCountdown } from "@/components/votes/deadline-countdown";
import type { AdminVoteDetail } from "@/shared/contracts/drafts";
import { formatInZone } from "@/shared/time/zoned";

export type LifecycleFields = Pick<
  AdminVoteDetail,
  | "status"
  | "timezone"
  | "activatedAt"
  | "closesAt"
  | "completedAt"
  | "completionMode"
  | "completionReason"
  | "cancelledAt"
  | "cancellationReason"
>;

/*
 * Lifecycle facts for a vote that has left the draft stage. Times are shown in
 * the RWA time zone that was frozen at activation. The recorded completion
 * time of a vote that ran to its deadline is the deadline itself, whenever the
 * system got round to finalising it.
 */
function Fact({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-caption font-semibold text-muted">{label}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}

export function LifecycleSummary({
  vote,
  audience = "admin",
}: Readonly<{ vote: LifecycleFields; audience?: "admin" | "member" }>) {
  const zone = vote.timezone ?? "UTC";
  const at = (instant: string | null) =>
    instant ? (
      <time dateTime={instant}>{formatInZone(instant, zone)}</time>
    ) : (
      "—"
    );

  return (
    <section aria-labelledby="lifecycle-summary" className="grid gap-4">
      <h2 id="lifecycle-summary" className="text-section font-semibold">
        Lifecycle
      </h2>

      {vote.status === "CANCELLED" ? (
        <Notice tone="error" heading="Cancelled; results not valid.">
          <p>
            No choices are published for a cancelled vote and nothing can be
            exported.
          </p>
        </Notice>
      ) : null}
      {vote.status === "ACTIVE" && audience === "admin" ? (
        <Notice tone="info" heading="Voting ends automatically at the deadline">
          <p>
            The vote is finalised at its deadline, normally within a minute. If
            the database is paused or delayed, this page can show it as Active a
            little longer, but the deadline itself is never extended and the
            recorded end time is always the deadline.
          </p>
        </Notice>
      ) : null}

      <dl className="grid max-w-ballot gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-2">
        <Fact label="Activated">{at(vote.activatedAt)}</Fact>
        <Fact label="Deadline">
          <div className="grid gap-2">
            <span className="inline-flex items-center gap-2">
              <Clock aria-hidden="true" className="size-4 shrink-0" />
              {at(vote.closesAt)}
            </span>
            {vote.status === "ACTIVE" && vote.closesAt ? (
              <DeadlineCountdown deadline={vote.closesAt} />
            ) : null}
          </div>
        </Fact>
        {vote.status === "COMPLETED" ? (
          <>
            <Fact label="Completed">{at(vote.completedAt)}</Fact>
            <Fact label="How it ended">
              {vote.completionMode === "EARLY"
                ? "Completed early by an administrator"
                : "Ran to its deadline"}
            </Fact>
          </>
        ) : null}
        {vote.status === "CANCELLED" ? (
          <Fact label="Cancelled">{at(vote.cancelledAt)}</Fact>
        ) : null}
        {vote.completionReason ? (
          <Fact label="Reason for early completion">
            <span className="whitespace-pre-line">{vote.completionReason}</span>
          </Fact>
        ) : null}
        {vote.cancellationReason ? (
          <Fact label="Reason for cancellation">
            <span className="whitespace-pre-line">
              {vote.cancellationReason}
            </span>
          </Fact>
        ) : null}
      </dl>
    </section>
  );
}
