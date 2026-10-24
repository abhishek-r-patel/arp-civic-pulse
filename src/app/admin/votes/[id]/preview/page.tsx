import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { firstValues } from "@/components/admin/format";
import { ActivateVote } from "@/components/admin/lifecycle-actions";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { BallotPreview } from "@/components/votes/ballot-preview";
import { ApiError } from "@/server/http/errors";
import { adminPageContext } from "@/server/register/page-context";
import { getVote, previewDraft } from "@/server/votes/drafts";
import type { BlockerSection } from "@/shared/contracts/drafts";
import { idParamsSchema } from "@/shared/contracts/register";
import { revision as revisionSchema } from "@/shared/validation/primitives";

export const metadata = { title: "Preview ballot" };

// Where each blocker is fixed in the editor.
const SECTION_ANCHORS: Record<BlockerSection, string | null> = {
  type: "type-heading",
  details: "details-heading",
  ballot: "ballot-heading",
  electorate: "electorate-heading",
  deadline: "deadline-heading",
  settings: null,
};

export default async function PreviewPage({
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
  const { id } = parsed.data;
  const deps = await adminPageContext();
  const raw = firstValues(await searchParams);

  // The previewed revision is explicit; without one, preview what is current now.
  const requested = revisionSchema.safeParse(Number(raw.revision));
  let revision = requested.success ? requested.data : undefined;

  let preview;
  let stale = false;
  try {
    if (revision === undefined) {
      const current = await getVote(deps, id);
      if (current.status !== "DRAFT") {
        redirect(`/admin/votes/${id}`);
      }
      revision = current.draftRevision;
    }
    preview = await previewDraft(deps, id, revision);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    if (error.code === "NOT_FOUND") {
      notFound();
    }
    if (error.code === "LIFECYCLE_CONFLICT") {
      redirect(`/admin/votes/${id}`);
    }
    if (error.code !== "STALE_REVISION") {
      throw error;
    }
    stale = true;
  }

  const back = (
    <Link
      href={`/admin/votes/${id}`}
      className="inline-flex touch-target w-fit items-center gap-1 font-semibold text-accent underline underline-offset-2"
    >
      <ChevronLeft aria-hidden="true" className="size-5" />
      Back to editing
    </Link>
  );

  if (stale || !preview) {
    return (
      <div className="grid gap-8">
        {back}
        <PageHeader title="Preview ballot" />
        <Notice tone="warning" heading="This preview is out of date">
          <p>
            The draft changed after this preview was opened, so it is not shown
            as if it were current. Review the latest version before relying on
            it.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <LinkButton href={`/admin/votes/${id}/preview`}>
              Preview the latest version
            </LinkButton>
            <LinkButton href={`/admin/votes/${id}`} variant="secondary">
              Back to editing
            </LinkButton>
          </div>
        </Notice>
      </div>
    );
  }

  const { blockers, readyToActivate, electorate, vote } = preview;

  return (
    <div className="grid gap-8">
      {back}
      <PageHeader
        title="Preview ballot"
        description={`You are previewing version ${preview.revision} of this draft, exactly as residents will see it. Previewing changes nothing and is not saved.`}
      />

      {readyToActivate ? (
        <Notice tone="success" heading="No problems found in this version">
          <p>
            This is a check, not a guarantee: eligibility, approvals and the
            deadline are checked again at the moment of activation.
          </p>
        </Notice>
      ) : (
        <Notice
          tone="warning"
          heading={`Fix ${blockers.length} ${blockers.length === 1 ? "thing" : "things"} before this vote can be activated`}
        >
          <ul className="list-disc pl-5">
            {blockers.map((blocker) => {
              const anchor = SECTION_ANCHORS[blocker.section];
              return (
                <li key={blocker.code}>
                  {blocker.message}{" "}
                  {anchor ? (
                    <Link
                      href={`/admin/votes/${id}#${anchor}`}
                      aria-label={`Fix this: ${blocker.message}`}
                      className="inline-flex touch-target items-center font-semibold text-accent underline underline-offset-2"
                    >
                      Fix this
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Notice>
      )}

      <section aria-labelledby="electorate-summary" className="grid gap-2">
        <h2 id="electorate-summary" className="text-section font-semibold">
          Electorate
        </h2>
        <p className="text-body">
          {electorate.selected}{" "}
          {electorate.selected === 1 ? "household" : "households"} selected;{" "}
          {electorate.eligibleWithEnabledRepresentative} currently{" "}
          {electorate.eligibleWithEnabledRepresentative === 1 ? "has" : "have"}{" "}
          an eligible register entry and an enabled representative.
        </p>
      </section>

      <Notice tone="info" heading="What freezes when the vote is activated">
        <p>
          The voting type, ballot content, electorate, each household&apos;s
          representative and the deadline cannot be changed afterwards.
        </p>
      </Notice>

      <section aria-labelledby="resident-view" className="grid gap-3">
        <h2 id="resident-view" className="text-section font-semibold">
          What residents will see
        </h2>
        <p className="text-body text-muted">
          This is read-only. Nothing on it can be selected or submitted.
        </p>
        <BallotPreview vote={vote} />
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <LinkButton href={`/admin/votes/${id}`} variant="secondary">
          Back to editing
        </LinkButton>
      </div>

      {readyToActivate ? (
        <ActivateVote
          csrfToken={deps.csrfToken}
          voteId={id}
          revision={preview.revision}
        />
      ) : null}
    </div>
  );
}
