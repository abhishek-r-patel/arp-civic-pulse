// Protected administrator vote detail and lifecycle controls.
import { privateRecordMetadata } from "@/shared/metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { DraftEditor } from "@/components/admin/vote-forms";
import { ManagementFields } from "@/components/admin/management-fields";
import {
  ChangeDeadline,
  LifecycleActions,
  WithdrawVoteSchedule,
} from "@/components/admin/lifecycle-actions";
import { flashNotices, firstValues } from "@/components/admin/format";
import { PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { BallotPreview } from "@/components/votes/ballot-preview";
import { LifecycleSummary } from "@/components/votes/lifecycle-summary";
import { ApiError } from "@/server/http/errors";
import { adminPageContext } from "@/server/register/page-context";
import { getVote, listSelectableHouseholds } from "@/server/votes/drafts";
import { listRwaPositions } from "@/server/settings/rwa-profile";
import { idParamsSchema } from "@/shared/contracts/register";
import { VOTE_STATUS_LABELS } from "@/shared/contracts/voting";

export const generateMetadata = privateRecordMetadata(
  "Manage vote",
  "Review a vote's configuration and administer its permitted lifecycle actions.",
  "/admin/votes/[id]",
);

export default async function VotePage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const parsed = idParamsSchema.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }
  const deps = await adminPageContext();
  const raw = firstValues(await searchParams);
  const notices = flashNotices(deps.terms);

  let vote;
  try {
    vote = await getVote(deps, parsed.data.id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  let households: Awaited<ReturnType<typeof listSelectableHouseholds>> | null =
    null;
  let householdsError: ApiError | null = null;
  let positions: string[] = [];
  if (vote.status === "DRAFT") {
    try {
      households = await listSelectableHouseholds(deps);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      householdsError = error;
    }
    // Position suggestions are optional; the editor works without them.
    positions = await listRwaPositions(deps).catch(() => []);
  }

  return (
    <div data-form-page className="mx-auto grid w-full max-w-ballot gap-8">
      <Link
        href="/admin/votes"
        className="inline-flex touch-target w-fit items-center gap-1 font-semibold text-accent underline underline-offset-2"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        Votes
      </Link>
      <PageHeader
        title={vote.title === "" ? "Untitled draft" : vote.title}
        description={
          vote.status === "DRAFT"
            ? `Draft, version ${vote.draftRevision}. Nothing here is visible to residents until the vote is activated.`
            : `This vote is ${VOTE_STATUS_LABELS[vote.status].toLowerCase()}. Its ballot, type and electorate are frozen${vote.status === "ACTIVE" ? "; only the deadline can still be changed" : ", and so is its deadline"}.`
        }
      />

      {vote.status === "DRAFT" ? (
        householdsError || households === null ? (
          <Notice
            tone="error"
            heading={`The ${deps.terms.households} register could not be loaded`}
          >
            Try again in a moment. If this keeps happening, quote this reference
            to support: {householdsError?.code ?? "UNKNOWN"}.
          </Notice>
        ) : (
          <ManagementFields canManage={deps.actor.isAdmin}>
            <DraftEditor
              csrfToken={deps.csrfToken}
              isNewDraft={raw.new === "1"}
              identifierLabel={deps.identifierLabel}
              initial={vote}
              households={households}
              positions={positions}
              flash={raw.notice ? notices[raw.notice] : undefined}
            />
          </ManagementFields>
        )
      ) : (
        <>
          {raw.notice && notices[raw.notice] ? (
            <Notice tone="success" heading={notices[raw.notice]}>
              <p>The change is recorded in the audit history.</p>
            </Notice>
          ) : null}
          <LifecycleSummary vote={vote} />
          {vote.status === "SCHEDULED" ? (
            <ManagementFields canManage={deps.actor.isAdmin}>
              <WithdrawVoteSchedule
                csrfToken={deps.csrfToken}
                voteId={vote.id}
              />
            </ManagementFields>
          ) : null}
          <section aria-labelledby="follow-up" className="grid gap-3">
            <h2 id="follow-up" className="text-section font-semibold">
              Follow-up
            </h2>
            <div className="flex flex-col gap-3 sm:flex-row">
              <LinkButton
                href={`/admin/votes/${vote.id}/participation`}
                variant="secondary"
              >
                Participation
              </LinkButton>
              {vote.status === "COMPLETED" ? (
                <LinkButton
                  href={`/votes/${vote.id}/results`}
                  variant="secondary"
                >
                  Results and Download
                </LinkButton>
              ) : null}
            </div>
          </section>
          {vote.status === "ACTIVE" && vote.closesAt ? (
            <ManagementFields canManage={deps.actor.isAdmin}>
              <ChangeDeadline
                csrfToken={deps.csrfToken}
                voteId={vote.id}
                closesAt={vote.closesAt}
                timezone={vote.timezone ?? "UTC"}
              />
            </ManagementFields>
          ) : null}
          {vote.status === "ACTIVE" ? (
            <ManagementFields canManage={deps.actor.isAdmin}>
              <LifecycleActions csrfToken={deps.csrfToken} voteId={vote.id} />
            </ManagementFields>
          ) : null}
          <section aria-labelledby="frozen-ballot" className="grid gap-3">
            <h2 id="frozen-ballot" className="text-section font-semibold">
              Frozen ballot
            </h2>
            <p className="text-body text-muted">
              This is the frozen ballot. A scheduled vote must return to draft
              before editing; an active or finished ballot cannot be edited.
            </p>
            <BallotPreview vote={vote} terms={deps.terms} />
          </section>
        </>
      )}
    </div>
  );
}
