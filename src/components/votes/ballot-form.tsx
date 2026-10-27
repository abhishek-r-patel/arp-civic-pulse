// Native ballot choices, deliberate review and honest recovery states; unsent choices stay in memory only.
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { Notice } from "@/components/ui/notice";
import { InfoTip } from "@/components/ui/info-tip";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import { NotaExplanation } from "@/components/votes/nota-explanation";
import {
  FinalSubmissionNotice,
  privacyCopy,
  PrivacyNotice,
} from "@/components/votes/privacy-notice";
import type { MemberVoteDetail } from "@/shared/contracts/member-votes";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";

/*
 * The resident ballot (docs/DESIGN_SYSTEM.md section 11). Selections live ONLY
 * in this component's memory: never in the URL, storage, cookies or any log,
 * and they are cleared the moment the vote is accepted, refused, or access
 * ends. Choices start unselected, a PRIVATE office always offers NOTA, and
 * nothing is submitted without a review step. An unclear outcome (network drop,
 * timeout, server fault) is never treated as "not voted": the committed status
 * is checked first, and an unreadable status stays "unknown".
 */
type BallotVoteProps = Pick<
  MemberVoteDetail,
  | "id"
  | "votingType"
  | "openSelectionMode"
  | "openSelectionLimit"
  | "title"
  | "options"
  | "offices"
>;

const NOTA = "NOTA";

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
  const terms = useHouseholdTerms();
  const [step, setStep] = useState<Step>(
    initialSubmitted && vote.votingType === "PRIVATE" ? "accepted" : "choose",
  );
  const [hasSubmitted, setHasSubmitted] = useState(initialSubmitted);
  const [openChangeUnknown, setOpenChangeUnknown] = useState(false);
  const [replacementStatus, setReplacementStatus] = useState<
    ParticipationStatus["status"] | null
  >(null);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
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
    setOptionIds([]);
    setPicks({});
    setMissing([]);
    setSelectionError(null);
  }

  function finish(next: Step) {
    clearChoices();
    setFailure(null);
    setOpenChangeUnknown(false);
    setReplacementStatus(null);
    setStep(next);
  }

  // Choices are read from the form itself, so a radio ticked before the page finished
  // loading (slow phone) still counts: it is in the DOM even if not yet in React state.
  function goToReview(form: FormData) {
    const chosenOptions = form.getAll("option").map(String);
    const chosen: Record<string, string> = {};
    for (const office of vote.offices) {
      const value = String(form.get(office.id) ?? "");
      if (value) {
        chosen[office.id] = value;
      }
    }
    setOptionIds(chosenOptions);
    setPicks(chosen);

    const choiceError =
      vote.votingType === "PUBLIC" &&
      vote.openSelectionLimit !== null &&
      chosenOptions.length > vote.openSelectionLimit
        ? `Select no more than ${vote.openSelectionLimit} options.`
        : null;
    setSelectionError(choiceError);
    const absent =
      vote.votingType === "PUBLIC"
        ? chosenOptions.length === 0
          ? ["option"]
          : []
        : vote.offices.filter((office) => !chosen[office.id]).map((o) => o.id);
    setMissing(absent);
    if (absent.length > 0 || choiceError !== null) {
      return;
    }
    setFailure(null);
    setStep("review");
  }

  async function checkStatus(forOpenChange = openChangeUnknown) {
    setStep("checking");
    const result = await apiRequest<ParticipationStatus>(
      `/api/votes/${vote.id}/participation`,
    );
    if (result.ok) {
      if (forOpenChange) {
        setHasSubmitted(true);
        setReplacementStatus(result.data.status);
        return setStep("unknown");
      }
      if (result.data.submitted) {
        setHasSubmitted(true);
        return finish("accepted");
      }
      return result.data.status === "ACTIVE"
        ? setStep("unconfirmed")
        : finish("closed");
    }
    if (ACCESS_ENDED.has(result.code)) {
      if (forOpenChange) {
        setFailure(result);
        return setStep("unknown");
      }
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
    const replacingOpenResponse = vote.votingType === "PUBLIC" && hasSubmitted;
    setFailure(null);
    setStep("submitting");

    const body =
      vote.votingType === "PUBLIC"
        ? vote.openSelectionMode === "MULTIPLE"
          ? { confirmed: true, optionIds }
          : { confirmed: true, optionId: optionIds[0] ?? "" }
        : {
            confirmed: true,
            selections: vote.offices.map((office) => ({
              officeId: office.id,
              candidateId:
                picks[office.id] === NOTA ? null : (picks[office.id] ?? null),
            })),
          };

    try {
      const result = await apiRequest<{ voteId: string; submitted: true }>(
        `/api/votes/${vote.id}/submission`,
        { method: "POST", body, csrfToken },
      );

      if (result.ok || result.code === "ALREADY_SUBMITTED") {
        setHasSubmitted(true);
        return finish("accepted");
      }
      if (result.code === "VOTING_CLOSED") {
        if (openChangeUnknown) {
          return await checkStatus(true);
        }
        return finish("closed");
      }
      if (ACCESS_ENDED.has(result.code)) {
        if (openChangeUnknown) {
          setFailure(result);
          return setStep("unknown");
        }
        return finish("access");
      }
      if (UNCERTAIN.has(result.code)) {
        if (replacingOpenResponse) {
          setOpenChangeUnknown(true);
        }
        return await checkStatus(replacingOpenResponse || openChangeUnknown);
      }
      // Validation, CSRF and rate-limit answers are definite: nothing was recorded.
      if (openChangeUnknown) {
        setFailure(result);
        return setStep("unknown");
      }
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
          {vote.votingType === "PUBLIC"
            ? "Your vote is recorded."
            : "Vote submitted."}
        </h2>
        <Notice
          tone="success"
          heading={
            vote.votingType === "PUBLIC"
              ? `Your ${terms.household}'s current choice is recorded`
              : `Your ${terms.household} has voted`
          }
        >
          <p>
            {vote.votingType === "PUBLIC"
              ? "You can change your selection while this poll remains open."
              : privacyCopy(terms).FINAL}
          </p>
        </Notice>
        <div>
          {vote.votingType === "PUBLIC" ? (
            <Button onClick={() => setStep("choose")}>Change Your Vote</Button>
          ) : (
            <BackToVotes />
          )}
        </div>
      </section>
    );
  }

  function CheckChoice({
    name,
    value,
    label,
    checked,
    onSelect,
  }: Readonly<{
    name: string;
    value: string;
    label: string;
    checked: boolean;
    onSelect: (checked: boolean) => void;
  }>) {
    return (
      <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-control border border-control-border bg-surface px-4 py-3 transition-colors hover:bg-primary/5 has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:shadow-[inset_3px_0_var(--color-accent)]">
        <input
          type="checkbox"
          name={name}
          value={value}
          checked={checked}
          onChange={(event) => onSelect(event.target.checked)}
          className="size-5 shrink-0"
        />
        <span className="text-body text-primary">{label}</span>
      </label>
    );
  }

  if (step === "closed") {
    return (
      <section aria-labelledby="ballot-state" className="grid gap-4">
        <h2 id="ballot-state" ref={heading} tabIndex={-1} className={heading_}>
          Voting is closed
        </h2>
        <Notice
          tone="warning"
          heading={
            hasSubmitted && vote.votingType === "PUBLIC"
              ? "No further changes can be made"
              : "Your response was not recorded"
          }
        >
          <p>
            {hasSubmitted && vote.votingType === "PUBLIC"
              ? "The poll closed before this change was accepted. Your previously recorded choice remains in effect."
              : "The vote ended before your submission was accepted, so it was not recorded. Nothing you selected has been kept."}
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
            {hasSubmitted && vote.votingType === "PUBLIC"
              ? "Your session has ended or your access to this vote was removed. Your previously recorded choice remains in effect; this change was not accepted."
              : "Your session has ended or your access to this vote was removed. Nothing you selected has been kept."}{" "}
            Sign in again, or contact the RWA administrator if you think this is
            a mistake.
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
    if (openChangeUnknown) {
      return (
        <section aria-labelledby="ballot-state" className="grid gap-4">
          <h2
            id="ballot-state"
            ref={heading}
            tabIndex={-1}
            className={heading_}
          >
            We could not confirm your vote change
          </h2>
          <ErrorSummary failure={failure} />
          <Notice
            tone="warning"
            heading="Your participation remains recorded, but the current choice is uncertain"
          >
            <p>
              The new choice may or may not have become current. The app does
              not reveal which choice is current while voting is open. If this
              poll is still open, you can safely send the same choice again; the
              server will reject it after the poll closes.
            </p>
          </Notice>
          {replacementStatus === "COMPLETED" ? (
            <Link
              href={`/votes/${vote.id}/results`}
              className="inline-flex touch-target items-center font-semibold text-accent underline underline-offset-2"
            >
              View final results
            </Link>
          ) : replacementStatus === "CANCELLED" ? (
            <BackToVotes />
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => void submit()}>
                Try This Choice Again
              </Button>
              <Button
                variant="secondary"
                onClick={() => void checkStatus(true)}
              >
                Check Poll Status
              </Button>
            </div>
          )}
        </section>
      );
    }
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
          <Button onClick={() => void checkStatus()}>Check Again</Button>
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
            Review and Try Again
          </Button>
          <Button variant="secondary" onClick={() => void checkStatus()}>
            Check Again
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
        <dl className="grid max-w-ballot gap-5 border-y border-border py-5">
          {vote.votingType === "PUBLIC" ? (
            <div className="grid gap-0.5">
              <dt className="text-caption font-semibold text-muted">
                {vote.title}
              </dt>
              <dd className="text-body font-semibold">
                {optionIds
                  .map(
                    (id) =>
                      vote.options.find((option) => option.id === id)?.label,
                  )
                  .filter((label): label is string => label !== undefined)
                  .join(", ")}
              </dd>
            </div>
          ) : (
            vote.offices.map((office) => (
              <div key={office.id} className="grid gap-0.5">
                <dt className="text-caption font-semibold text-muted">
                  {office.name}
                </dt>
                <dd className="text-body font-semibold">
                  {picks[office.id] === NOTA
                    ? "NOTA (None of the Above)"
                    : office.candidates.find((c) => c.id === picks[office.id])
                        ?.name}
                </dd>
              </div>
            ))
          )}
        </dl>
        <PrivacyNotice
          terms={terms}
          type={vote.votingType}
          openSelectionMode={vote.openSelectionMode}
        />
        {vote.votingType === "PRIVATE" ? <FinalSubmissionNotice /> : null}
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
            {hasSubmitted && vote.votingType === "PUBLIC"
              ? "Update Vote"
              : "Submit Vote"}
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
    missing.includes(id) || (id === "option" && selectionError !== null)
      ? `${id}-problem`
      : undefined;

  const stepHeading = (
    <h2 id="ballot-state" ref={heading} tabIndex={-1} className={heading_}>
      {vote.votingType === "PUBLIC"
        ? vote.openSelectionMode === "MULTIPLE"
          ? "Choose one or more options"
          : "Choose one option"
        : "Choose for each office"}
    </h2>
  );

  return (
    <section aria-labelledby="ballot-state" className="grid gap-6">
      {vote.votingType === "PRIVATE" ? (
        <InfoTip heading={stepHeading} label="About NOTA">
          <NotaExplanation />
        </InfoTip>
      ) : (
        stepHeading
      )}
      <ErrorSummary failure={failure} />
      {hasSubmitted && vote.votingType === "PUBLIC" ? (
        <Notice tone="info" heading="Your current vote is recorded">
          <p>
            Choose your updated selection and submit it to replace your current
            response. Only the latest response is counted.
          </p>
        </Notice>
      ) : null}
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
        {vote.votingType === "PUBLIC" ? (
          <Group
            id="option-group"
            legend={vote.title}
            describedBy={problem("option")}
            error={
              selectionError ??
              (missing.includes("option")
                ? vote.openSelectionMode === "MULTIPLE"
                  ? "Choose at least one option."
                  : "Choose one option."
                : undefined)
            }
          >
            {vote.options.map((option) =>
              vote.openSelectionMode === "MULTIPLE" ? (
                <CheckChoice
                  key={option.id}
                  name="option"
                  value={option.id}
                  label={option.label}
                  checked={optionIds.includes(option.id)}
                  onSelect={(checked) => {
                    setOptionIds((current) =>
                      checked
                        ? [...current, option.id]
                        : current.filter((id) => id !== option.id),
                    );
                    setSelectionError(null);
                    setMissing([]);
                  }}
                />
              ) : (
                <Radio
                  key={option.id}
                  name="option"
                  value={option.id}
                  label={option.label}
                  checked={optionIds[0] === option.id}
                  onSelect={() => {
                    setOptionIds([option.id]);
                    setSelectionError(null);
                    setMissing([]);
                  }}
                />
              ),
            )}
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
                  ? "Choose a candidate or NOTA."
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
                value={NOTA}
                label="NOTA (None of the Above)"
                checked={picks[office.id] === NOTA}
                onSelect={() =>
                  setMissing((current) =>
                    current.filter((id) => id !== office.id),
                  )
                }
              />
            </Group>
          ))
        )}

        <PrivacyNotice
          terms={terms}
          type={vote.votingType}
          openSelectionMode={vote.openSelectionMode}
        />
        {vote.votingType === "PRIVATE" ? <FinalSubmissionNotice /> : null}
        <div>
          <Button type="submit">
            Review Selections
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
      className="grid max-w-ballot gap-3 border-b border-border pb-6"
    >
      <legend className="pb-3 font-heading text-card-heading font-semibold">
        {legend}
      </legend>
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
    <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-control border border-control-border bg-surface px-4 py-3 transition-colors hover:bg-primary/5 has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:shadow-[inset_3px_0_var(--color-accent)]">
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
