// Protected administrator preview: ballot beside a sticky readiness summary and start actions.
import { privateRecordMetadata } from "@/shared/metadata";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { firstValues } from "@/components/admin/format";
import {
  ActivateVote,
  ScheduleVote,
} from "@/components/admin/lifecycle-actions";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { BallotPreview } from "@/components/votes/ballot-preview";
import { ManagementFields } from "@/components/admin/management-fields";
import { ApiError } from "@/server/http/errors";
import { adminPageContext } from "@/server/register/page-context";
import { getRwaDisplay, getVote, previewDraft } from "@/server/votes/drafts";
import type { BlockerSection } from "@/shared/contracts/drafts";
import { idParamsSchema } from "@/shared/contracts/register";
import { revision as revisionSchema } from "@/shared/validation/primitives";
import { formatInZone } from "@/shared/time/zoned";

export const generateMetadata = privateRecordMetadata(
  "Preview Ballot",
  "Preview the resident ballot before activating an association poll or election.",
  "/admin/votes/[id]/preview",
);

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
      Back to Editing
    </Link>
  );

  if (stale || !preview) {
    return (
      <div data-form-page className="mx-auto grid w-full max-w-ballot gap-8">
        {back}
        <PageHeader title="Preview Ballot" />
        <Notice tone="warning" heading="This preview is out of date">
          <p>
            The draft changed after this preview was opened, so it is not shown
            as if it were current. Review the latest version before relying on
            it.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <LinkButton href={`/admin/votes/${id}/preview`}>
              Preview the Latest Version
            </LinkButton>
            <LinkButton href={`/admin/votes/${id}`} variant="secondary">
              Back to Editing
            </LinkButton>
          </div>
        </Notice>
      </div>
    );
  }

  const { blockers, readyToActivate, electorate, vote } = preview;
  // Settings problems are reported as blockers; they must not hide the preview.
  const display = await getRwaDisplay(deps).catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });
  const timezone = display?.timezone;
  const when = (instant: string | null | undefined, unset: string) =>
    instant && timezone ? formatInZone(instant, timezone) : unset;
  const householdWord =
    electorate.selected === 1 ? deps.terms.household : deps.terms.households;

  return (
    <div data-form-page className="mx-auto grid w-full max-w-6xl gap-6">
      {back}
      <PageHeader
        title="Preview Ballot"
        description={`You are previewing version ${preview.revision}, exactly as residents will see it. Previewing changes nothing.`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        {/* Below lg the panel's cards join the page grid so actions follow the ballot. */}
        <div
          role="complementary"
          aria-label="Preview summary and actions"
          className="max-lg:contents lg:sticky lg:top-6 lg:order-2 lg:grid lg:gap-4"
        >
          <section
            aria-labelledby="preview-summary"
            className="order-1 grid gap-4 form-panel"
          >
            <h2 id="preview-summary" className="text-section font-semibold">
              Summary
            </h2>
            {readyToActivate ? (
              <Notice
                tone="success"
                heading="No problems found in this version"
              >
                <p className="text-caption">
                  Eligibility, approvals and the deadline are checked again when
                  you activate or schedule.
                </p>
              </Notice>
            ) : (
              <Notice
                tone="warning"
                heading={`Fix ${blockers.length} ${blockers.length === 1 ? "thing" : "things"} before starting`}
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
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-body">
              <dt className="text-muted">Who can vote</dt>
              <dd>
                {electorate.selected} {householdWord} selected;{" "}
                {electorate.eligibleWithEnabledRepresentative} ready to vote
              </dd>
              <dt className="text-muted">Voting opens</dt>
              <dd>{when(vote.opensAt, "When activated")}</dd>
              <dt className="text-muted">Voting closes</dt>
              <dd>{when(vote.closesAt, "Not set")}</dd>
            </dl>
            <p className="text-caption text-muted">
              Activating or scheduling freezes the voting type, ballot,
              electorate and each {deps.terms.household}&apos;s representative.
              A scheduled vote can return to draft before opening; once active,
              only the deadline can move.
            </p>
          </section>

          {readyToActivate ? (
            <section
              aria-labelledby="start-heading"
              className="order-3 grid gap-4 form-panel"
            >
              <h2 id="start-heading" className="text-section font-semibold">
                Ready to start
              </h2>
              <p className="text-caption text-muted">
                Activate opens voting now. Schedule opens it automatically at
                the saved time.
              </p>
              <ManagementFields canManage={deps.actor.isAdmin}>
                <div className="flex flex-wrap items-start gap-3">
                  <ActivateVote
                    csrfToken={deps.csrfToken}
                    voteId={id}
                    revision={preview.revision}
                  />
                  {vote.closesAt && timezone ? (
                    <ScheduleVote
                      csrfToken={deps.csrfToken}
                      voteId={id}
                      revision={preview.revision}
                      timezone={timezone}
                      closesAt={vote.closesAt}
                      openingAt={vote.opensAt ?? null}
                    />
                  ) : null}
                </div>
              </ManagementFields>
            </section>
          ) : null}
        </div>

        <details
          open
          className="group order-2 grid gap-3 lg:order-1 [&[open]>summary]:mb-3"
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-control border border-border bg-surface px-4 py-2 hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            <span className="grid">
              <span className="text-section font-semibold">
                What residents will see
              </span>
              <span className="text-caption text-muted">
                Read-only. Nothing can be selected or submitted.
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-5 shrink-0 text-accent transition-transform group-open:rotate-180"
            />
          </summary>
          <BallotPreview vote={vote} terms={deps.terms} />
        </details>
      </div>
    </div>
  );
}
