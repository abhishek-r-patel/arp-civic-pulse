// Confirmed administrator lifecycle controls, with RWA-zone dates and server-side rechecks.
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CirclePlay, CircleStop, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorSummary } from "@/components/ui/error-summary";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import {
  DEADLINE_CHANGE_MIN_LEAD_MINUTES,
  describeDeadlineShift,
} from "@/shared/contracts/admin-votes";
import type { AdminVoteDetail } from "@/shared/contracts/drafts";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import {
  formatInZone,
  instantToLocalInput,
  zonedLocalToInstant,
} from "@/shared/time/zoned";

export function ScheduleVote({
  csrfToken,
  voteId,
  revision,
  timezone,
  closesAt,
}: Readonly<{
  csrfToken: string | undefined;
  voteId: string;
  revision: number;
  timezone: string;
  closesAt: string;
}>) {
  const router = useRouter();
  const [local, setLocal] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [error, setError] = useState<string>();
  const converted = zonedLocalToInstant(local, timezone);

  function review() {
    if (
      !converted.ok ||
      new Date(converted.instant).getTime() <= Date.now() ||
      converted.instant >= closesAt
    ) {
      setError(
        "Choose a future opening time before the closing deadline. Ambiguous or nonexistent local times are not accepted.",
      );
      return;
    }
    setError(undefined);
    setOpen(true);
  }
  async function schedule() {
    if (!converted.ok) return;
    setPending(true);
    setFailure(null);
    const result = await apiRequest<AdminVoteDetail>(
      `/api/admin/votes/${voteId}/schedule`,
      {
        method: "POST",
        csrfToken,
        body: {
          expectedRevision: revision,
          confirmed: true,
          opensAt: converted.instant,
        },
      },
    );
    setPending(false);
    setOpen(false);
    if (!result.ok) {
      setFailure(result);
      router.refresh();
      return;
    }
    router.push(`/admin/votes/${voteId}?notice=vote-scheduled`);
    router.refresh();
  }
  return (
    <section
      className="grid max-w-ballot gap-4 form-panel"
      aria-labelledby="schedule-heading"
    >
      <h2 id="schedule-heading" className="text-section font-semibold">
        Schedule Opening
      </h2>
      <ErrorSummary failure={failure} />
      <TextField
        id="scheduled-opening"
        label="Voting opens at"
        type="datetime-local"
        hint={`RWA time zone (${timezone}); closes ${formatInZone(closesAt, timezone)}.`}
        value={local}
        onChange={(event) => {
          setLocal(event.target.value);
          setError(undefined);
        }}
        error={error}
        disabled={pending}
      />
      <div>
        <Button variant="secondary" onClick={review} disabled={pending}>
          <CalendarClock className="size-5" aria-hidden="true" />
          Schedule Vote
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        title="Schedule this vote?"
        confirmLabel="Freeze and Schedule"
        busy={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => void schedule()}
      >
        <p>
          Freeze version {revision}, its ballot, electorate and representatives
          now. Voting opens{" "}
          {converted.ok ? formatInZone(converted.instant, timezone) : ""} and
          closes {formatInZone(closesAt, timezone)}.
        </p>
        <p>
          Residents see only the summary and opening countdown until voting
          starts. Before opening, an administrator can return this vote to draft
          with a recorded reason.
        </p>
      </ConfirmDialog>
    </section>
  );
}

export function WithdrawVoteSchedule({
  csrfToken,
  voteId,
}: Readonly<{ csrfToken: string | undefined; voteId: string }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [error, setError] = useState<string>();
  async function withdraw() {
    if (!reason.trim()) {
      setError("Enter a reason for returning to draft.");
      return;
    }
    setPending(true);
    setFailure(null);
    const result = await apiRequest<AdminVoteDetail>(
      `/api/admin/votes/${voteId}/schedule/withdraw`,
      {
        method: "POST",
        csrfToken,
        body: { confirmed: true, reason },
      },
    );
    setPending(false);
    setOpen(false);
    if (!result.ok) {
      setFailure(result);
      router.refresh();
      return;
    }
    router.push(`/admin/votes/${voteId}?notice=schedule-withdrawn`);
    router.refresh();
  }
  return (
    <section
      className="grid gap-4 form-panel"
      aria-labelledby="withdraw-schedule-heading"
    >
      <h2 id="withdraw-schedule-heading" className="text-section font-semibold">
        Return to Draft
      </h2>
      <ErrorSummary failure={failure} />
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            setReason("");
            setError(undefined);
            setOpen(true);
          }}
          disabled={pending}
        >
          <CalendarClock className="size-5" aria-hidden="true" />
          Return to Draft
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        title="Withdraw the scheduled opening?"
        confirmLabel="Return to Draft"
        busy={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => void withdraw()}
      >
        <p>
          The scheduled opening is removed and the vote becomes editable and
          hidden from residents. Review and preview it again before scheduling
          or activating. This is refused at or after the opening time.
        </p>
        <TextAreaField
          id="withdraw-schedule-reason"
          label="Reason"
          required
          maxLength={2000}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setError(undefined);
          }}
          error={error}
        />
      </ConfirmDialog>
    </section>
  );
}

type ActionProps = Readonly<{
  csrfToken: string | undefined;
  voteId: string;
}>;

// A conflict means the page is showing an old state: reload the truth.
const STATE_CONFLICTS = new Set([
  "LIFECYCLE_CONFLICT",
  "STALE_REVISION",
  "VOTE_FROZEN",
]);

export function ActivateVote({
  csrfToken,
  voteId,
  revision,
}: ActionProps & Readonly<{ revision: number }>) {
  const router = useRouter();
  const terms = useHouseholdTerms();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function activate() {
    setPending(true);
    setFailure(null);
    const result = await apiRequest<AdminVoteDetail>(
      `/api/admin/votes/${voteId}/activate`,
      {
        method: "POST",
        body: { expectedRevision: revision, confirmed: true },
        csrfToken,
      },
    );
    setPending(false);
    setOpen(false);

    if (!result.ok) {
      setFailure(result);
      if (STATE_CONFLICTS.has(result.code)) {
        router.refresh();
      }
      return;
    }
    router.push(`/admin/votes/${voteId}?notice=vote-activated`);
  }

  return (
    <section
      aria-labelledby="activate-heading"
      className="grid gap-4 form-panel"
    >
      <h2 id="activate-heading" className="text-section font-semibold">
        Activate this vote
      </h2>
      <ErrorSummary failure={failure} />
      {failure?.code === "ACTIVATION_BLOCKED" ? (
        <Notice tone="warning" heading="Something changed since this preview">
          <p>
            The register, approvals or deadline no longer allow activation.
            Reload this page to preview the current state and see what to fix.
          </p>
        </Notice>
      ) : null}
      <p className="max-w-ballot text-body text-muted">
        Activating freezes the voting type, ballot content, electorate and each{" "}
        {terms.household}&apos;s representative. It cannot be undone. The
        deadline can still be moved while voting is open.
      </p>
      <div>
        <Button onClick={() => setOpen(true)} disabled={pending}>
          <CirclePlay aria-hidden="true" className="size-5" />
          Activate Vote
        </Button>
      </div>

      <ConfirmDialog
        open={open}
        title="Activate this vote?"
        confirmLabel="Activate Vote"
        busy={pending}
        onConfirm={() => void activate()}
        onCancel={() => setOpen(false)}
      >
        <p>
          You are activating version {revision} of this draft, exactly as
          previewed. From then on:
        </p>
        <ul className="list-disc pl-5">
          <li>
            The voting type, ballot, electorate and representatives are frozen
            and cannot be edited. Only the deadline can still be moved, with a
            recorded reason, while voting is open.
          </li>
          <li>
            The vote cannot be reopened. It ends at the deadline, or earlier if
            you complete or cancel it.
          </li>
        </ul>
        <p>
          Activation is checked again at this moment, so it can still be refused
          if something changed since the preview.
        </p>
      </ConfirmDialog>
    </section>
  );
}

type Kind = "complete" | "cancel";

const DEADLINE_INPUT_MESSAGES = {
  INVALID: "Enter a valid date and time.",
  NONEXISTENT:
    "That time does not exist on the day the clocks change. Choose a different time.",
  AMBIGUOUS:
    "That time happens twice on the day the clocks change. Choose a different time.",
  UNCHANGED: "Choose a deadline different from the current one.",
  TOO_SOON: `Choose a time at least ${DEADLINE_CHANGE_MIN_LEAD_MINUTES} minutes from now. To stop voting now, complete the vote early instead.`,
} as const;

/**
 * Moves an ACTIVE vote's deadline, later or earlier. The new time is typed in
 * the RWA's time zone; the reason goes only to the audit history. Residents
 * are not notified: their pages simply show the new deadline and countdown.
 */
export function ChangeDeadline({
  csrfToken,
  voteId,
  closesAt,
  timezone,
}: ActionProps & Readonly<{ closesAt: string; timezone: string }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(() =>
    instantToLocalInput(closesAt, timezone),
  );
  const [reason, setReason] = useState("");
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const converted = useMemo(
    () => zonedLocalToInstant(local, timezone),
    [local, timezone],
  );
  // Evaluated on each render so the preview reflects the edited value.
  const shift = converted.ok
    ? describeDeadlineShift(closesAt, converted.instant)
    : null;

  function start() {
    setLocal(instantToLocalInput(closesAt, timezone));
    setReason("");
    setDeadlineError(null);
    setReasonError(null);
    setFailure(null);
    setOpen(true);
  }

  async function run() {
    if (!converted.ok) {
      setDeadlineError(DEADLINE_INPUT_MESSAGES[converted.reason]);
      return;
    }
    const check = describeDeadlineShift(closesAt, converted.instant);
    let invalid = false;
    if (!check.ok) {
      setDeadlineError(DEADLINE_INPUT_MESSAGES[check.problem]);
      invalid = true;
    }
    if (reason.trim() === "") {
      setReasonError("Enter a reason. It is recorded in the audit history.");
      invalid = true;
    }
    if (invalid) {
      return;
    }

    setPending(true);
    setFailure(null);
    const result = await apiRequest<AdminVoteDetail>(
      `/api/admin/votes/${voteId}/deadline`,
      {
        method: "POST",
        body: { confirmed: true, closesAt: converted.instant, reason },
        csrfToken,
      },
    );
    setPending(false);

    if (!result.ok) {
      const refused = result.context.reason;
      // The database clock disagreed with the browser: keep the dialog open.
      if (refused === "DEADLINE_TOO_SOON" || refused === "DEADLINE_UNCHANGED") {
        setDeadlineError(
          DEADLINE_INPUT_MESSAGES[
            refused === "DEADLINE_TOO_SOON" ? "TOO_SOON" : "UNCHANGED"
          ],
        );
        return;
      }
      setOpen(false);
      setFailure(result);
      if (STATE_CONFLICTS.has(result.code)) {
        router.refresh();
      }
      return;
    }
    setOpen(false);
    router.push(`/admin/votes/${voteId}?notice=deadline-changed`);
  }

  return (
    <section
      aria-labelledby="deadline-change-heading"
      className="grid gap-4 form-panel"
    >
      <h2 id="deadline-change-heading" className="text-section font-semibold">
        Change Deadline
      </h2>
      <ErrorSummary failure={failure} />
      <p className="max-w-ballot text-body text-muted">
        Voting closes {formatInZone(closesAt, timezone)}. While voting is open
        you can extend the deadline, for example after a low turnout, or bring
        it forward. The reason is recorded in the audit history and is not shown
        to residents.
      </p>
      <div>
        <Button variant="secondary" onClick={start}>
          <CalendarClock aria-hidden="true" className="size-5" />
          Change Deadline
        </Button>
      </div>

      <ConfirmDialog
        open={open}
        title="Change the deadline?"
        confirmLabel="Change Deadline"
        busy={pending}
        onConfirm={() => void run()}
        onCancel={() => setOpen(false)}
      >
        <p>Current deadline: {formatInZone(closesAt, timezone)}.</p>
        <TextField
          id="deadline-change-closes"
          type="datetime-local"
          label="New deadline"
          required
          hint={`Enter time in the RWA time zone (${timezone}).`}
          value={local}
          onChange={(event) => {
            setLocal(event.target.value);
            setDeadlineError(null);
          }}
          error={deadlineError ?? undefined}
        />
        <p role="status">
          {converted.ok && shift?.ok
            ? `Residents will see: ${formatInZone(converted.instant, timezone)} (${shift.direction === "EXTENDED" ? "extended" : "brought forward"} by ${shift.by}).`
            : null}
        </p>
        <TextAreaField
          id="deadline-change-reason"
          label="Why is the deadline changing?"
          required
          maxLength={2000}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setReasonError(null);
          }}
          error={reasonError ?? undefined}
        />
      </ConfirmDialog>
    </section>
  );
}

function lifecycleCopy(
  household: string,
): Record<
  Kind,
  { title: string; confirm: string; body: string; label: string }
> {
  return {
    complete: {
      title: "Complete this vote early?",
      confirm: "Complete Vote Early",
      label: "Why is it being completed early?",
      body: `Voting stops now and the results become final. ${household} that have not voted will not get another chance. This cannot be undone, and the reason is recorded.`,
    },
    cancel: {
      title: "Cancel this vote?",
      confirm: "Cancel Vote",
      label: "Why is it being cancelled?",
      body: "The vote is cancelled and shown as “Cancelled; results not valid.” No choices are published and nothing can be exported. This cannot be undone, and the reason is recorded.",
    },
  };
}

export function LifecycleActions({ csrfToken, voteId }: ActionProps) {
  const router = useRouter();
  const terms = useHouseholdTerms();
  const COPY = lifecycleCopy(terms.Households);
  const [kind, setKind] = useState<Kind | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  function close() {
    setKind(null);
    setReason("");
    setReasonError(null);
  }

  async function run() {
    if (!kind) {
      return;
    }
    if (reason.trim() === "") {
      setReasonError("Enter a reason. It is recorded with the vote.");
      return;
    }
    setPending(true);
    setFailure(null);
    const result = await apiRequest<AdminVoteDetail>(
      `/api/admin/votes/${voteId}/${kind}`,
      { method: "POST", body: { confirmed: true, reason }, csrfToken },
    );
    setPending(false);
    const done = kind;
    close();

    if (!result.ok) {
      setFailure(result);
      if (STATE_CONFLICTS.has(result.code)) {
        router.refresh();
      }
      return;
    }
    router.push(
      `/admin/votes/${voteId}?notice=${done === "complete" ? "vote-completed" : "vote-cancelled"}`,
    );
  }

  return (
    <section
      aria-labelledby="lifecycle-heading"
      className="grid gap-4 form-panel"
    >
      <h2 id="lifecycle-heading" className="text-section font-semibold">
        End this vote
      </h2>
      <ErrorSummary failure={failure} />
      <p className="max-w-ballot text-body text-muted">
        Both actions are final and need a reason. There is no way to reopen a
        vote or edit it afterwards.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="secondary" onClick={() => setKind("complete")}>
          <CircleStop aria-hidden="true" className="size-5" />
          Complete Vote Early
        </Button>
        <Button variant="destructive" onClick={() => setKind("cancel")}>
          <Ban aria-hidden="true" className="size-5" />
          Cancel Vote
        </Button>
      </div>

      <ConfirmDialog
        open={kind !== null}
        title={kind ? COPY[kind].title : ""}
        confirmLabel={kind ? COPY[kind].confirm : "Confirm"}
        destructive
        busy={pending}
        onConfirm={() => void run()}
        onCancel={close}
      >
        <p>{kind ? COPY[kind].body : null}</p>
        <TextAreaField
          id="lifecycle-reason"
          label={kind ? COPY[kind].label : "Reason"}
          required
          maxLength={2000}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setReasonError(null);
          }}
          error={reasonError ?? undefined}
        />
      </ConfirmDialog>
    </section>
  );
}
