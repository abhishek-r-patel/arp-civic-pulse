import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { DraftEditor } from "@/components/admin/vote-forms";
import { LifecycleActions } from "@/components/admin/lifecycle-actions";
import { FLASH_NOTICES, firstValues } from "@/components/admin/format";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { BallotPreview } from "@/components/votes/ballot-preview";
import { LifecycleSummary } from "@/components/votes/lifecycle-summary";
import { ApiError } from "@/server/http/errors";
import { adminPageContext } from "@/server/register/page-context";
import { getVote, listSelectableHouseholds } from "@/server/votes/drafts";
import { idParamsSchema } from "@/shared/contracts/register";
import { VOTE_STATUS_LABELS } from "@/shared/contracts/voting";

export const metadata = { title: "Vote" };

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
  if (vote.status === "DRAFT") {
    try {
      households = await listSelectableHouseholds(deps);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      householdsError = error;
    }
  }

  return (
    <div className="grid gap-8">
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
            : `This vote is ${VOTE_STATUS_LABELS[vote.status].toLowerCase()}. Its ballot, type, electorate and deadline are frozen.`
        }
      />

      {vote.status === "DRAFT" ? (
        householdsError || households === null ? (
          <Notice
            tone="error"
            heading="The household register could not be loaded"
          >
            Try again in a moment. If this keeps happening, quote this reference
            to support: {householdsError?.code ?? "UNKNOWN"}.
          </Notice>
        ) : (
          <DraftEditor
            csrfToken={deps.csrfToken}
            initial={vote}
            households={households}
            flash={raw.notice ? FLASH_NOTICES[raw.notice] : undefined}
          />
        )
      ) : (
        <>
          {raw.notice && FLASH_NOTICES[raw.notice] ? (
            <Notice tone="success" heading={FLASH_NOTICES[raw.notice]}>
              <p>The change is recorded in the audit history.</p>
            </Notice>
          ) : null}
          <LifecycleSummary vote={vote} />
          {vote.status === "ACTIVE" ? (
            <LifecycleActions csrfToken={deps.csrfToken} voteId={vote.id} />
          ) : null}
          <section aria-labelledby="frozen-ballot" className="grid gap-3">
            <h2 id="frozen-ballot" className="text-section font-semibold">
              Frozen ballot
            </h2>
            <p className="text-body text-muted">
              This is the ballot as it was activated. It can no longer be
              edited.
            </p>
            <BallotPreview vote={vote} />
          </section>
        </>
      )}
    </div>
  );
}
