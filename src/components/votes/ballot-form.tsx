"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { Notice } from "@/components/ui/notice";
import {
  FinalSubmissionNotice,
  PRIVACY_COPY,
  PrivacyNotice,
} from "@/components/votes/privacy-notice";
import type { MemberVoteDetail } from "@/shared/contracts/member-votes";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";

/*
 * The resident ballot (docs/DESIGN_SYSTEM.md section 11). Selections live ONLY
 * in this component's memory: never in the URL, storage, cookies or any log,
 * and they are cleared the moment the vote is accepted, refused, or access
 * ends. Choices start unselected, a CLOSED office always offers Abstain, and
 * nothing is submitted without a review step. An unclear outcome (network drop,
 * timeout, server fault) is never treated as "not voted": the committed status
 * is checked first, and an unreadable status stays "unknown".
 */
type BallotVoteProps = Pick<
  MemberVoteDetail,
  "id" | "votingType" | "title" | "options" | "offices"
>;

const ABSTAIN = "ABSTAIN";

type Step =
  | "choose"
  | "review"
  | "submitting"
  | "checking"
  | "accepted"
  | "closed"
  | "access"
  | "unconfirmed"
  | "unknown";

// Anything that is not a definite answer from the server about THIS request.
const UNCERTAIN = new Set([
  "NETWORK_ERROR",
  "INVALID_RESPONSE",
  "DEPENDENCY_UNAVAILABLE",
  "INTERNAL_ERROR",
  "UNKNOWN_ERROR",
]);
const ACCESS_ENDED = new Set([
  "AUTH_REQUIRED",
  "SESSION_EXPIRED",
  "FORBIDDEN",
  "NOT_FOUND",
]);

interface ParticipationStatus {
  voteId: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  submitted: boolean;
}

export function BallotForm({
  vote,
  csrfToken,
  initialSubmitted,
}: Readonly<{
  vote: BallotVoteProps;
  csrfToken: string | undefined;
  initialSubmitted: boolean;
}>) {
  const [step, setStep] = useState<Step>(
    initialSubmitted ? "accepted" : "choose",
  );
  const [optionId, setOptionId] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Move focus to the new step's heading so keyboard and screen-reader users follow the flow.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  function clearChoices() {
    setOptionId(null);
    setPicks({});
    setMissing([]);
  }

  function finish(next: Step) {
    clearChoices();
    setFailure(null);
    setStep(next);
  }

  // Choices are read from the form itself, so a radio ticked before the page finished
  // loading (slow phone) still counts: it is in the DOM even if not yet in React state.
  function goToReview(form: FormData) {
    const chosenOption = String(form.get("option") ?? "");
    const chosen: Record<string, string> = {};
    for (const office of vote.offices) {
      const value = String(form.get(office.id) ?? "");
      if (value) {
        chosen[office.id] = value;
      }
    }
    setOptionId(chosenOption || null);
    setPicks(chosen);

    const absent =
      vote.votingType === "OPEN"
        ? chosenOption === ""
          ? ["option"]
          : []
        : vote.offices.filter((office) => !chosen[office.id]).map((o) => o.id);
    setMissing(absent);
    if (absent.length > 0) {
      return;
    }
    setFailure(null);
    setStep("review");
  }

  async function checkStatus() {
    setStep("checking");
    const result = await apiRequest<ParticipationStatus>(
      `/api/votes/${vote.id}/participation`,
    );
    if (result.ok) {
      if (result.data.submitted) {
        return finish("accepted");
      }
      return result.data.status === "ACTIVE"
        ? setStep("unconfirmed")
        : finish("closed");
    }
    if (ACCESS_ENDED.has(result.code)) {
      return finish("access");
    }
    // The status cannot be read, so it stays unknown: no retry is offered.
    setFailure(result);
    setStep("unknown");
  }

  async function submit() {
    // A second click while a request is in flight must never send another.
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setFailure(null);
    setStep("submitting");

    const body =
      vote.votingType === "OPEN"
        ? { confirmed: true, optionId }
        : {
            confirmed: true,
            selections: vote.offices.map((office) => ({
              officeId: office.id,
              candidateId:
                picks[office.id] === ABSTAIN
                  ? null
                  : (picks[office.id] ?? null),
            })),
          };

    try {
      const result = await apiRequest<{ voteId: string; submitted: true }>(
        `/api/votes/${vote.id}/submission`,
        { method: "POST", body, csrfToken },
      );

      if (result.ok || result.code === "ALREADY_SUBMITTED") {
        return finish("accepted");
      }
      if (result.code === "VOTING_CLOSED") {
        return finish("closed");
      }
      if (ACCESS_ENDED.has(result.code)) {
        return finish("access");
      }
      if (UNCERTAIN.has(result.code)) {
        return await checkStatus();
      }
      // Validation, CSRF and rate-limit answers are definite: nothing was recorded.
      setFailure(result);
      setStep(result.code === "VALIDATION_FAILED" ? "choose" : "review");
    } finally {
      inFlight.current = false;
    }
  }

  const heading_ = "text-section font-semibold focus:outline-none";

  if (step === "accepted") {
    return (
      <section aria-labelledby="ballot-state" className="grid gap-4">
        <h2 id="ballot-state" ref={heading} tabIndex={-1} className={heading_}>
          Vote submitted.
        </h2>
        <Notice tone="success" heading="Your household has voted">
          <p>{PRIVACY_COPY.FINAL}</p>
        </Notice>
        <div>
          <BackToVotes />
        </div>
      </section>
    );
  }

  if (step === "closed") {
    return (
      <section aria-labelledby="ballot-state" className="grid gap-4">
        <h2 id="ballot-state" ref={heading} tabIndex={-1} className={heading_}>
          Voting is closed
        </h2>
        <Notice tone="warning" heading="Your response was not recorded">
          <p>
            The vote ended before your submission was accepted, so it was not
            recorded. Nothing you selected has been kept.
          </p>
        </Notice>
        <div>
          <BackToVotes />
        </div>
      </section>
    );
  }

  if (step === "access") {
    return (
      <section aria-labelledby="ballot-state" className="grid gap-4">
        <h2 id="ballot-state" ref={heading} tabIndex={-1} className={heading_}>
          You can no longer vote here
        </h2>
        <Notice tone="error" heading="Your access has ended">
          <p>
            Your session has ended or your access to this vote was removed.
            Nothing you selected has been kept. Sign in again, or contact the
            RWA administrator if you think this is a mistake.
          </p>
        </Notice>
        <div>
          <Link
            href="/sign-in"
            className="inline-flex touch-target items-center font-semibold text-accent underline underline-offset-2"
          >
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  if (step === "checking") {
    return (
      <section aria-labelledby="ballot-state" className="grid gap-4">
        <h2 id="ballot-state" ref={heading} tabIndex={-1} className={heading_}>
          Checking your submission
        </h2>
        <div role="status">
          <p className="text-body">
            We are checking whether your vote was recorded. Please do not submit
            again yet.
          </p>
        </div>
      </section>
    );
  }

  if (step === "unknown") {
    return (
      <section aria-labelledby="ballot-state" className="grid gap-4">
        <h2 id="ballot-state" ref={heading} tabIndex={-1} className={heading_}>
          We could not confirm your submission
        </h2>
        <ErrorSummary failure={failure} />
        <Notice
          tone="warning"
          heading="Do not assume it was or was not recorded"
        >
          <p>
            Your vote may have been recorded. Check again, and only try to vote
            again if the check says it was not recorded.
          </p>
        </Notice>
        <div>
          <Button onClick={() => void checkStatus()}>Check again</Button>
        </div>
      </section>
    );
  }

  if (step === "unconfirmed") {
    return (
      <section aria-labelledby="ballot-state" className="grid gap-4">
        <h2 id="ballot-state" ref={heading} tabIndex={-1} className={heading_}>
          Your vote has not been recorded yet
        </h2>
        <Notice tone="warning" heading="Nothing was recorded">
          <p>
            The connection failed before your vote was confirmed, and it is not
            recorded as of now. Your selections are still on this page, so you
            can try again.
          </p>
        </Notice>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => setStep("review")}>
            Review and try again
          </Button>
          <Button variant="secondary" onClick={() => void checkStatus()}>
            Check again
          </Button>
        </div>
      </section>
    );
  }

  if (step === "review" || step === "submitting") {
    const submitting = step === "submitting";
    return (
      <section aria-labelledby="ballot-state" className="grid gap-4">
        <h2 id="ballot-state" ref={heading} tabIndex={-1} className={heading_}>
          Review your selections
        </h2>
        <ErrorSummary failure={failure} />
        <dl className="grid max-w-ballot gap-3 rounded-card border border-border bg-surface p-4">
          {vote.votingType === "OPEN" ? (
            <div className="grid gap-0.5">
              <dt className="text-caption font-semibold text-muted">
                {vote.title}
              </dt>
              <dd className="text-body font-semibold">
                {vote.options.find((o) => o.id === optionId)?.label}
              </dd>
            </div>
          ) : (
            vote.offices.map((office) => (
              <div key={office.id} className="grid gap-0.5">
                <dt className="text-caption font-semibold text-muted">
                  {office.name}
                </dt>
                <dd className="text-body font-semibold">
                  {picks[office.id] === ABSTAIN
                    ? "Abstain"
                    : office.candidates.find((c) => c.id === picks[office.id])
                        ?.name}
                </dd>
              </div>
            ))
          )}
        </dl>
        <PrivacyNotice type={vote.votingType} />
        <FinalSubmissionNotice />
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <Button
            variant="secondary"
            disabled={submitting}
            onClick={() => {
              setFailure(null);
              setStep("choose");
            }}
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
            Back
          </Button>
          <Button loading={submitting} onClick={() => void submit()}>
            <CircleCheck aria-hidden="true" className="size-5" />
            Submit vote
          </Button>
        </div>
        {submitting ? (
          <p role="status" className="text-body text-muted">
            Submitting your vote…
          </p>
        ) : null}
      </section>
    );
  }

  const problem = (id: string) =>
    missing.includes(id) ? `${id}-problem` : undefined;

  return (
    <section aria-labelledby="ballot-state" className="grid gap-6">
      <h2 id="ballot-state" ref={heading} tabIndex={-1} className={heading_}>
        {vote.votingType === "OPEN"
          ? "Choose one option"
          : "Choose for each office"}
      </h2>
      <ErrorSummary failure={failure} />
      {missing.length > 0 ? (
        <div
          role="alert"
          className="rounded-card border border-error/40 bg-error/10 p-4"
        >
          <p className="text-card-heading font-semibold text-error">
            Make a choice before reviewing
          </p>
          <ul className="list-disc pl-5 text-body text-primary">
            {missing.map((id) => (
              <li key={id}>
                <a
                  href={`#${id === "option" ? "option-group" : `office-${id}`}`}
                  className="font-semibold underline underline-offset-2"
                >
                  {id === "option"
                    ? vote.title
                    : vote.offices.find((o) => o.id === id)?.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form
        noValidate
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          goToReview(new FormData(event.currentTarget));
        }}
      >
        {vote.votingType === "OPEN" ? (
          <Group
            id="option-group"
            legend={vote.title}
            describedBy={problem("option")}
            error={
              missing.includes("option") ? "Choose one option." : undefined
            }
          >
            {vote.options.map((option) => (
              <Radio
                key={option.id}
                name="option"
                value={option.id}
                label={option.label}
                checked={optionId === option.id}
                onSelect={() => setMissing([])}
              />
            ))}
          </Group>
        ) : (
          vote.offices.map((office) => (
            <Group
              key={office.id}
              id={`office-${office.id}`}
              legend={office.name}
              describedBy={problem(office.id)}
              error={
                missing.includes(office.id)
                  ? "Choose a candidate or Abstain."
                  : undefined
              }
            >
              {office.candidates.map((candidate) => (
                <Radio
                  key={candidate.id}
                  name={office.id}
                  value={candidate.id}
                  label={candidate.name}
                  checked={picks[office.id] === candidate.id}
                  onSelect={() =>
                    setMissing((current) =>
                      current.filter((id) => id !== office.id),
                    )
                  }
                />
              ))}
              <Radio
                name={office.id}
                value={ABSTAIN}
                label="Abstain"
                muted
                checked={picks[office.id] === ABSTAIN}
                onSelect={() =>
                  setMissing((current) =>
                    current.filter((id) => id !== office.id),
                  )
                }
              />
            </Group>
          ))
        )}

        <PrivacyNotice type={vote.votingType} />
        <FinalSubmissionNotice />
        <div>
          <Button type="submit">
            Review selections
            <ArrowRight aria-hidden="true" className="size-5" />
          </Button>
        </div>
      </form>
    </section>
  );
}

function BackToVotes() {
  return (
    <Link
      href="/"
      className="inline-flex touch-target items-center font-semibold text-accent underline underline-offset-2"
    >
      Back to all votes
    </Link>
  );
}

function Group({
  id,
  legend,
  error,
  describedBy,
  children,
}: Readonly<{
  id: string;
  legend: string;
  error: string | undefined;
  describedBy: string | undefined;
  children: React.ReactNode;
}>) {
  return (
    <fieldset
      id={id}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      className="grid max-w-ballot gap-2"
    >
      <legend className="pb-2 text-card-heading font-semibold">{legend}</legend>
      {children}
      {error ? (
        <p id={describedBy} className="text-caption font-semibold text-error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function Radio({
  name,
  value,
  label,
  checked,
  muted = false,
  onSelect,
}: Readonly<{
  name: string;
  value: string;
  label: string;
  checked: boolean;
  muted?: boolean;
  onSelect: () => void;
}>) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-border bg-surface px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent/5">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={checked}
        onChange={onSelect}
        className="size-5 shrink-0"
      />
      <span className={`text-body text-primary ${muted ? "italic" : ""}`}>
        {label}
      </span>
    </label>
  );
}
