"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CirclePlay, CircleStop, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorSummary } from "@/components/ui/error-summary";
import { TextAreaField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { AdminVoteDetail } from "@/shared/contracts/drafts";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";

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
    <section aria-labelledby="activate-heading" className="grid gap-4">
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
        Activating freezes the voting type, ballot content, electorate, each
        household&apos;s representative and the deadline. It cannot be undone.
      </p>
      <div>
        <Button onClick={() => setOpen(true)} disabled={pending}>
          <CirclePlay aria-hidden="true" className="size-5" />
          Activate vote
        </Button>
      </div>

      <ConfirmDialog
        open={open}
        title="Activate this vote?"
        confirmLabel="Activate vote"
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
            The voting type, ballot, electorate, representatives and deadline
            are frozen. They cannot be edited, and the deadline cannot be
            extended.
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

const COPY: Record<
  Kind,
  { title: string; confirm: string; body: string; label: string }
> = {
  complete: {
    title: "Complete this vote early?",
    confirm: "Complete vote early",
    label: "Why is it being completed early?",
    body: "Voting stops now and the results become final. Households that have not voted will not get another chance. This cannot be undone, and the reason is recorded.",
  },
  cancel: {
    title: "Cancel this vote?",
    confirm: "Cancel vote",
    label: "Why is it being cancelled?",
    body: "The vote is cancelled and shown as “Cancelled; results not valid.” No choices are published and nothing can be exported. This cannot be undone, and the reason is recorded.",
  },
};

export function LifecycleActions({ csrfToken, voteId }: ActionProps) {
  const router = useRouter();
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
    <section aria-labelledby="lifecycle-heading" className="grid gap-4">
      <h2 id="lifecycle-heading" className="text-section font-semibold">
        End this vote
      </h2>
      <ErrorSummary failure={failure} />
      <p className="max-w-ballot text-body text-muted">
        Both actions are final and need a reason. There is no way to reopen a
        vote, extend its deadline, or edit it afterwards.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="secondary" onClick={() => setKind("complete")}>
          <CircleStop aria-hidden="true" className="size-5" />
          Complete vote early
        </Button>
        <Button variant="destructive" onClick={() => setKind("cancel")}>
          <Ban aria-hidden="true" className="size-5" />
          Cancel vote
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
