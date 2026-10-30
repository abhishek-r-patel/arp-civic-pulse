// Guarded vote setup, revision-aware draft editing, cancellation and deletion.
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Eye,
  GripVertical,
  ListPlus,
  Plus,
  Save,
  Trash2,
  Vote,
} from "lucide-react";
import {
  buildPatch,
  describeFieldPath,
  fieldIdForPath,
  isDirty,
  mergeOnto,
  stateFromDetail,
  type DraftState,
  type OfficeDraft,
  type OptionDraft,
} from "@/components/admin/draft-model";
import { Button, LinkButton } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorSummary } from "@/components/ui/error-summary";
import {
  CheckboxField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import {
  COLLECTION_LIMITS,
  normalizedKey,
} from "@/shared/contracts/admin-votes";
import type {
  AdminVoteDetail,
  SelectableHousehold,
} from "@/shared/contracts/drafts";
import { VOTING_TYPE_LABELS, type VotingType } from "@/shared/contracts/voting";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import { fieldErrorFor } from "@/shared/http/messages";
import {
  defaultDraftClosingLocal,
  formatInZone,
  instantToLocalInput,
  zonedLocalToInstant,
} from "@/shared/time/zoned";

const DEADLINE_MESSAGES = {
  INVALID: "Enter a valid date and time.",
  NONEXISTENT:
    "That time does not exist on the day the clocks change. Choose a different time.",
  AMBIGUOUS:
    "That time happens twice on the day the clocks change. Choose a different time.",
  WINDOW: "Voting must open before it closes.",
} as const;

function typeDescriptions(
  terms: ReturnType<typeof useHouseholdTerms>,
): Record<VotingType, { summary: string; example: string; privacy: string }> {
  return {
    PUBLIC: {
      summary: "A community poll with options.",
      example:
        "“Should we repaint the clubhouse?” - Yes or No. Some polls allow more than one choice.",
      privacy: `While open, eligible voters, RWA Admins, and read-only RWA observers see totals only. Voters can change their choice until closing. After closing, authorized results may show each voter's name, ${terms.identifierLabel.toLowerCase()}, and final choices.`,
    },
    PRIVATE: {
      summary: "An election to choose people for RWA roles.",
      example:
        "“Who should be chair?” For each role, choose a candidate or “None of the Above” (NOTA).",
      privacy:
        "While open, Civic Pulse shows only how many people voted. After closing, results show totals, never an individual's choices.",
    },
  };
}

type NewDraftProps = Readonly<{ csrfToken: string | undefined }>;

export function NewDraftForm({ csrfToken }: NewDraftProps) {
  const router = useRouter();
  const terms = useHouseholdTerms();
  const [type, setType] = useState<VotingType | "">("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setFailure(null);
    if (type === "") {
      setMissing(true);
      return;
    }
    setMissing(false);
    setPending(true);
    const result = await apiRequest<AdminVoteDetail>("/api/admin/votes", {
      method: "POST",
      body: { votingType: type },
      csrfToken,
    });
    setPending(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    router.push(`/admin/votes/${result.data.id}?notice=draft-created&new=1`);
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid max-w-ballot gap-6 form-panel"
    >
      <ErrorSummary failure={failure} />

      <fieldset
        aria-describedby={missing ? "type-error" : undefined}
        className="grid gap-3"
      >
        <legend className="pb-1 text-card-heading font-semibold">
          Voting type
          <span aria-hidden="true" className="text-error">
            {" "}
            *
          </span>
          <span className="sr-only"> (required)</span>
        </legend>
        <p className="text-body text-muted">
          The type decides what residents see and how choices are kept. It
          cannot be changed once the vote is activated.
        </p>
        {(["PUBLIC", "PRIVATE"] as const).map((value) => (
          <label
            key={value}
            htmlFor={`type-${value}`}
            className="flex cursor-pointer items-start gap-3 rounded-card border border-control-border bg-surface p-4 has-[:checked]:border-accent has-[:checked]:bg-accent/5"
          >
            <input
              id={`type-${value}`}
              type="radio"
              name="votingType"
              value={value}
              checked={type === value}
              onChange={() => {
                setType(value);
                setMissing(false);
              }}
              className="mt-1 size-5 shrink-0 accent-accent"
            />
            <span className="grid gap-1">
              <span className="text-card-heading font-semibold">
                {VOTING_TYPE_LABELS[value]}
              </span>
              <span className="text-body">
                {typeDescriptions(terms)[value].summary}
              </span>
              <span className="text-body">
                Example: {typeDescriptions(terms)[value].example}
              </span>
              <span className="text-body text-muted">
                Privacy and results: {typeDescriptions(terms)[value].privacy}
              </span>
            </span>
          </label>
        ))}
        {missing ? (
          <p id="type-error" className="text-caption font-semibold text-error">
            Choose PUBLIC or PRIVATE voting to continue.
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" loading={pending}>
          <Vote aria-hidden="true" className="size-5" />
          Create Draft
        </Button>
        <LinkButton href="/admin/votes" variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}

function ReorderControls({
  label,
  index,
  count,
  group,
  onMove,
  onRemove,
}: Readonly<{
  label: string;
  index: number;
  count: number;
  group: string;
  onMove: (index: number) => void;
  onRemove: () => void;
}>) {
  return (
    <div className="flex shrink-0 gap-1">
      <ReorderHandle
        label={label}
        index={index}
        count={count}
        group={group}
        onMove={onMove}
      />
      <RemoveItemButton label={label} onRemove={onRemove} />
    </div>
  );
}

function ReorderHandle({
  label,
  index,
  count,
  group,
  onMove,
}: Readonly<{
  label: string;
  index: number;
  count: number;
  group: string;
  onMove: (index: number) => void;
}>) {
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const pointerId = useRef<number | null>(null);
  const dropIndex = useRef(index);
  const startIndex = useRef(index);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }
    event.preventDefault();
    pointerId.current = event.pointerId;
    startIndex.current = index;
    dropIndex.current = index;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (pointerId.current !== event.pointerId) {
      return;
    }
    let item = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-sortable-item]");
    while (item && item.dataset.sortableGroup !== group) {
      item =
        item.parentElement?.closest<HTMLElement>("[data-sortable-item]") ??
        null;
    }
    const target = Number(item?.dataset.sortableIndex);
    if (item && Number.isInteger(target) && target !== dropIndex.current) {
      dropIndex.current = target;
      setAnnouncement(`Release to move ${label} to position ${target + 1}.`);
    }
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>, drop: boolean) {
    if (pointerId.current !== event.pointerId) {
      return;
    }
    pointerId.current = null;
    setDragging(false);
    const target = dropIndex.current;
    if (drop && target !== startIndex.current) {
      onMove(target);
      setAnnouncement(`Moved ${label} to position ${target + 1}.`);
    } else {
      setAnnouncement("");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (
      !event.altKey ||
      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    ) {
      return;
    }
    const target = index + (event.key === "ArrowUp" ? -1 : 1);
    if (target < 0 || target >= count) {
      return;
    }
    event.preventDefault();
    onMove(target);
    setAnnouncement(`Moved ${label} to position ${target + 1}.`);
  }

  return (
    <Button
      variant="secondary"
      className="h-12 !w-12 shrink-0 cursor-grab touch-none border-0 px-0 py-0 select-none data-[dragging=true]:cursor-grabbing"
      title={`Drag to reorder ${label}. Press Alt+Arrow Up or Alt+Arrow Down to move with the keyboard.`}
      aria-label={`Reorder ${label}`}
      aria-description="Drag this handle to reorder, or press Alt+ArrowUp or Alt+ArrowDown."
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      data-dragging={dragging}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
      onLostPointerCapture={(event) => endDrag(event, false)}
    >
      <GripVertical
        aria-hidden="true"
        className={dragging ? "size-6 cursor-grabbing" : "size-6 cursor-grab"}
      />
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </Button>
  );
}

function RemoveItemButton({
  label,
  onRemove,
}: Readonly<{ label: string; onRemove: () => void }>) {
  return (
    <Button
      variant="secondary"
      className="h-12 !w-12 shrink-0 border-0 px-0 py-0"
      title={`Remove ${label}`}
      onClick={onRemove}
      aria-label={`Remove ${label}`}
    >
      <Trash2 aria-hidden="true" className="size-6" />
    </Button>
  );
}

function moved<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) {
    return [...items];
  }
  next.splice(to, 0, item);
  return next;
}

type EditorProps = Readonly<{
  isNewDraft: boolean;
  csrfToken: string | undefined;
  identifierLabel: string;
  initial: AdminVoteDetail;
  households: readonly SelectableHousehold[];
  /** RWA positions from Settings, suggested as PRIVATE office names. */
  positions?: readonly string[];
  flash?: string | undefined;
}>;

function localDeadline(detail: AdminVoteDetail): string {
  const timezone = detail.timezone;
  if (detail.closesAt) {
    return instantToLocalInput(detail.closesAt, timezone ?? "UTC", true);
  }
  return timezone ? defaultDraftClosingLocal(detail.createdAt, timezone) : "";
}

function savedLocalDeadline(detail: AdminVoteDetail): string {
  return instantToLocalInput(detail.closesAt, detail.timezone ?? "UTC", true);
}

export function DraftEditor({
  isNewDraft,
  csrfToken,
  identifierLabel,
  initial,
  households,
  positions = [],
  flash,
}: EditorProps) {
  const router = useRouter();
  const terms = useHouseholdTerms();
  const timezone = initial.timezone;
  const counter = useRef(0);
  const nextKey = () => {
    counter.current += 1;
    return `new-${counter.current}`;
  };

  const [server, setServer] = useState(initial);
  const [baseline, setBaseline] = useState(() =>
    stateFromDetail(initial, savedLocalDeadline(initial)),
  );
  const [state, setState] = useState(() =>
    stateFromDetail(initial, localDeadline(initial)),
  );
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [deadlineIssue, setDeadlineIssue] = useState<string | null>(null);
  const [openingIssue, setOpeningIssue] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(flash ?? null);
  const [unchanged, setUnchanged] = useState(false);
  const [pending, setPending] = useState(false);
  const [exitAction, setExitAction] = useState<
    "discard" | "delete" | "rollback" | null
  >(null);
  const [stale, setStale] = useState(false);
  const [mergeNotes, setMergeNotes] = useState<string[] | null>(null);
  const [filter, setFilter] = useState("");

  const dirty = useMemo(
    () => isDirty(baseline, state, timezone),
    [baseline, state, timezone],
  );

  // Leaving with unsaved edits is the one place a draft can be lost silently.
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const patch = (changes: Partial<DraftState>) => {
    setState((current) => ({ ...current, ...changes }));
    setSaved(null);
    setUnchanged(false);
  };

  function adopt(detail: AdminVoteDetail) {
    const saved = stateFromDetail(detail, savedLocalDeadline(detail));
    const suggested = stateFromDetail(detail, localDeadline(detail));
    setServer(detail);
    setBaseline(saved);
    setState(suggested);
  }

  // Resolves to the saved (or already-current) draft, or null when nothing was saved.
  async function save(): Promise<AdminVoteDetail | null> {
    if (pending) {
      return null;
    }
    setFailure(null);
    setDeadlineIssue(null);
    setOpeningIssue(null);
    setSaved(null);
    setUnchanged(false);
    setStale(false);

    const result = buildPatch(baseline, state, timezone);
    if (!result.ok) {
      const message = DEADLINE_MESSAGES[result.deadline];
      if (result.field === "opensLocal") {
        setOpeningIssue(message);
      } else {
        setDeadlineIssue(message);
      }
      document.getElementById(result.field)?.focus();
      return null;
    }
    if (result.changed.length === 0) {
      setUnchanged(true);
      return server;
    }

    setPending(true);
    const response = await apiRequest<AdminVoteDetail>(
      `/api/admin/votes/${server.id}`,
      {
        method: "PATCH",
        body: { expectedRevision: server.draftRevision, ...result.patch },
        csrfToken,
      },
    );
    setPending(false);

    if (!response.ok) {
      // Everything typed stays on screen; a stale save offers recovery.
      setFailure(response);
      setStale(response.code === "STALE_REVISION");
      return null;
    }
    setMergeNotes(null);
    adopt(response.data);
    setSaved(`Draft saved as version ${response.data.draftRevision}.`);
    return response.data;
  }

  async function saveAndPreview() {
    const detail = await save();
    if (detail) {
      router.push(
        `/admin/votes/${detail.id}/preview?revision=${detail.draftRevision}`,
      );
    }
  }

  async function fetchLatest(): Promise<AdminVoteDetail | null> {
    setPending(true);
    const response = await apiRequest<AdminVoteDetail>(
      `/api/admin/votes/${server.id}`,
    );
    setPending(false);
    if (!response.ok) {
      setFailure(response);
      return null;
    }
    return response.data;
  }

  async function keepMyChanges() {
    const latest = await fetchLatest();
    if (!latest) {
      return;
    }
    if (latest.status !== "DRAFT") {
      // Activated meanwhile: nothing can be saved any more.
      router.refresh();
      return;
    }
    const merged = mergeOnto(
      baseline,
      state,
      latest,
      savedLocalDeadline(latest),
      terms,
    );
    setServer(latest);
    setBaseline(merged.baseline);
    setState(merged.state);
    setMergeNotes(merged.notes);
    setFailure(null);
    setStale(false);
  }

  async function discardMine() {
    const latest = await fetchLatest();
    if (!latest) {
      return;
    }
    if (latest.status !== "DRAFT") {
      router.refresh();
      return;
    }
    adopt(latest);
    setMergeNotes(null);
    setFailure(null);
    setStale(false);
    setSaved(`Loaded the latest version (version ${latest.draftRevision}).`);
  }

  function cancelEditing() {
    if (isNewDraft && server.draftRevision === 1) {
      setExitAction("rollback");
    } else if (dirty) {
      setExitAction("discard");
    } else {
      router.push("/admin/votes");
    }
  }

  async function confirmExit() {
    if (!exitAction || pending) {
      return;
    }
    if (exitAction === "discard") {
      router.push("/admin/votes");
      return;
    }

    setPending(true);
    setFailure(null);
    setStale(false);
    const response = await apiRequest<boolean>(
      `/api/admin/votes/${server.id}`,
      {
        method: "DELETE",
        body: { expectedRevision: server.draftRevision, confirmed: true },
        csrfToken,
      },
    );
    setPending(false);
    if (!response.ok) {
      setExitAction(null);
      setFailure(response);
      setStale(response.code === "STALE_REVISION");
      return;
    }
    router.push("/admin/votes");
  }

  const updateOffice = (
    index: number,
    change: (office: OfficeDraft) => OfficeDraft,
  ) =>
    patch({
      offices: state.offices.map((office, i) =>
        i === index ? change(office) : office,
      ),
    });
  const updateOption = (
    index: number,
    change: (option: OptionDraft) => OptionDraft,
  ) =>
    patch({
      options: state.options.map((option, i) =>
        i === index ? change(option) : option,
      ),
    });

  const selected = useMemo(
    () => new Set(state.selectedHouseholdIds),
    [state.selectedHouseholdIds],
  );
  const eligibleCount = households.filter((h) => h.isEligible).length;
  const visibleHouseholds = households.filter((household) => {
    if (!household.isEligible && !selected.has(household.id)) {
      return false;
    }
    const needle = filter.trim().toLowerCase();
    return (
      needle === "" ||
      `${household.identifier} ${household.representativeName}`
        .toLowerCase()
        .includes(needle)
    );
  });

  function toggleHousehold(id: string, on: boolean) {
    patch({
      selectedHouseholdIds: on
        ? [...state.selectedHouseholdIds, id]
        : state.selectedHouseholdIds.filter((existing) => existing !== id),
    });
  }

  const summaryFailure: ApiFailure | null = failure && {
    ...failure,
    fieldErrors: failure.fieldErrors.map((error) => ({
      ...error,
      field: fieldIdForPath(error.field),
    })),
  };
  const summaryLabels = Object.fromEntries(
    (failure?.fieldErrors ?? []).map((error) => [
      fieldIdForPath(error.field),
      describeFieldPath(error.field, terms),
    ]),
  );
  const errorAt = (path: string) => fieldErrorFor(failure, path);

  const deadlineText = useMemo(() => {
    if (!timezone || state.closesLocal === "") {
      return null;
    }
    const converted = zonedLocalToInstant(state.closesLocal, timezone);
    return converted.ok ? formatInZone(converted.instant, timezone) : null;
  }, [state.closesLocal, timezone]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
      data-admin-draft
      className="grid max-w-ballot gap-8 form-panel"
    >
      {saved ? (
        <Notice tone="success" heading={saved}>
          {dirty
            ? "You have further unsaved changes."
            : "Preview the ballot to check what residents will see."}
        </Notice>
      ) : null}

      {stale ? (
        <Notice
          tone="warning"
          heading="Someone saved a newer version of this draft"
        >
          <p>
            Nothing you typed has been lost, and nothing was overwritten. Choose
            how to continue.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => void keepMyChanges()} loading={pending}>
              Review Latest and Keep My Changes
            </Button>
            <Button
              variant="secondary"
              onClick={() => void discardMine()}
              disabled={pending}
            >
              Discard My Changes and Load Latest
            </Button>
          </div>
        </Notice>
      ) : null}

      {mergeNotes ? (
        <Notice
          tone="info"
          heading={`Latest version loaded (version ${server.draftRevision})`}
        >
          <p>
            Your unsaved changes are kept on top of it. Review them, then save
            again.
          </p>
          {mergeNotes.length > 0 ? (
            <ul className="list-disc pt-2 pl-5">
              {mergeNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}

      <ErrorSummary
        failure={stale ? null : summaryFailure}
        fieldLabels={summaryLabels}
      />

      <fieldset disabled={pending} className="grid min-w-0 gap-8">
        <section aria-labelledby="details-heading" className="grid gap-4">
          <h2 id="details-heading" className="text-section font-semibold">
            1. Details
          </h2>
          <TextField
            id="title"
            name="title"
            label={state.votingType === "PUBLIC" ? "Question" : "Title"}
            inline={false}
            required
            maxLength={300}
            autoComplete="off"
            value={state.title}
            onChange={(event) => patch({ title: event.target.value })}
            error={errorAt("title")}
          />
          <TextAreaField
            id="instructions"
            name="instructions"
            label={
              state.votingType === "PUBLIC"
                ? "Background"
                : "Instructions for voters"
            }
            hint={
              state.votingType === "PRIVATE"
                ? "Required before activation; plain text."
                : undefined
            }
            required={state.votingType === "PRIVATE"}
            showOptional={state.votingType !== "PUBLIC"}
            maxLength={10000}
            value={state.instructions}
            onChange={(event) => patch({ instructions: event.target.value })}
            error={errorAt("instructions")}
          />
        </section>

        <section aria-labelledby="ballot-heading" className="grid gap-4">
          <h2 id="ballot-heading" className="text-section font-semibold">
            2. Ballot
          </h2>
          {state.votingType === "PUBLIC" ? (
            <>
              <fieldset className="grid gap-4 border-y border-border py-4">
                <legend className="px-1 text-card-heading font-semibold">
                  Choices per {terms.household}
                </legend>
                <p className="text-body text-muted">
                  Each {terms.household} submits one ballot. Choose whether that
                  ballot contains one option or several.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["SINGLE", "MULTIPLE"] as const).map((mode) => (
                    <label
                      key={mode}
                      className="flex min-h-12 min-w-0 cursor-pointer items-center gap-3 rounded-control border border-border px-3 has-[:checked]:border-accent has-[:checked]:bg-accent/5"
                    >
                      <input
                        type="radio"
                        name="openSelectionMode"
                        value={mode}
                        checked={state.openSelectionMode === mode}
                        onChange={() =>
                          patch(
                            mode === "SINGLE"
                              ? {
                                  openSelectionMode: "SINGLE",
                                  openSelectionLimit: 1,
                                }
                              : {
                                  openSelectionMode: "MULTIPLE",
                                  openSelectionLimit: null,
                                },
                          )
                        }
                        className="size-5 shrink-0 accent-accent"
                      />
                      <span className="text-body">
                        {mode === "SINGLE"
                          ? "Select exactly one option"
                          : "Select multiple options"}
                      </span>
                    </label>
                  ))}
                </div>
                {state.openSelectionMode === "MULTIPLE" ? (
                  <>
                    <CheckboxField
                      id="open-selection-unlimited"
                      label="Allow any number of options"
                      hint="Voters must select at least one."
                      checked={state.openSelectionLimit === null}
                      onChange={(event) =>
                        patch({
                          openSelectionLimit: event.target.checked ? null : 2,
                        })
                      }
                    />
                    {state.openSelectionLimit !== null ? (
                      <SelectField
                        id="open-selection-limit"
                        label={`Maximum options per ${terms.household}`}
                        hint="Maximum selections: 2–100."
                        value={String(state.openSelectionLimit)}
                        onChange={(value) =>
                          patch({
                            openSelectionLimit: Number(value),
                          })
                        }
                      >
                        {Array.from(
                          { length: 99 },
                          (_, index) => index + 2,
                        ).map((limit) => (
                          <option key={limit} value={limit}>
                            {limit}
                          </option>
                        ))}
                      </SelectField>
                    ) : null}
                  </>
                ) : null}
              </fieldset>
              <OptionsEditor
                options={state.options}
                errorAt={errorAt}
                onChange={(options) => patch({ options })}
                onAdd={() =>
                  patch({
                    options: [...state.options, { key: nextKey(), label: "" }],
                  })
                }
                onUpdate={updateOption}
              />
            </>
          ) : (
            <OfficesEditor
              offices={state.offices}
              positions={positions}
              errorAt={errorAt}
              nextKey={nextKey}
              onChange={(offices) => patch({ offices })}
              onUpdate={updateOffice}
            />
          )}
        </section>

        <section aria-labelledby="electorate-heading" className="grid gap-4">
          <h2 id="electorate-heading" className="text-section font-semibold">
            3. Who Can Vote
          </h2>
          <p className="text-body text-muted">
            Choose the {terms.households} that may vote. Each {terms.household}{" "}
            votes once, through its representative. The selection and each
            representative are frozen when the vote is activated.
          </p>
          {errorAt("eligibleHouseholdIds") ? (
            <p className="text-caption font-semibold text-error">
              {errorAt("eligibleHouseholdIds")}
            </p>
          ) : null}
          {eligibleCount === 0 && selected.size === 0 ? (
            <Notice
              tone="warning"
              heading={`No ${terms.Household} is eligible yet`}
            >
              <p>
                Mark {terms.households} as eligible in the{" "}
                <Link
                  href="/admin/residents"
                  className="font-semibold text-accent underline underline-offset-2"
                >
                  {terms.households} register
                </Link>{" "}
                before selecting them here.
              </p>
            </Notice>
          ) : (
            <>
              <TextField
                id="household-filter"
                label={`Find a ${terms.household}`}
                showOptional={false}
                hint={`Search by ${identifierLabel.toLowerCase()} or representative.`}
                autoComplete="off"
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  variant="secondary"
                  onClick={() =>
                    patch({
                      selectedHouseholdIds: households
                        .filter((h) => h.isEligible)
                        .map((h) => h.id),
                    })
                  }
                >
                  Select All {eligibleCount} Eligible
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => patch({ selectedHouseholdIds: [] })}
                  disabled={selected.size === 0}
                >
                  Clear Selection
                </Button>
                <p role="status" className="text-body font-semibold">
                  {selected.size} selected
                </p>
              </div>
              <fieldset className="grid gap-1 rounded-card border border-border bg-surface p-3">
                <legend className="px-1 text-body font-semibold">
                  Eligible {terms.Households}
                </legend>
                {visibleHouseholds.length === 0 ? (
                  <p className="p-2 text-body text-muted">
                    No {terms.Household} matches that search.
                  </p>
                ) : (
                  <div className="grid max-h-96 gap-1 overflow-y-auto p-1">
                    {visibleHouseholds.map((household) => (
                      <CheckboxField
                        key={household.id}
                        id={`household-${household.id}`}
                        label={`${household.identifier} — ${household.representativeName}`}
                        hint={
                          !household.isEligible
                            ? "No longer eligible. Deselect it before activation."
                            : undefined
                        }
                        lockHint={
                          !household.representativeEnabled
                            ? "The representative's account is not enabled yet."
                            : undefined
                        }
                        checked={selected.has(household.id)}
                        onChange={(event) =>
                          toggleHousehold(household.id, event.target.checked)
                        }
                      />
                    ))}
                  </div>
                )}
              </fieldset>
            </>
          )}
        </section>

        <section aria-labelledby="deadline-heading" className="grid gap-4">
          <h2 id="deadline-heading" className="text-section font-semibold">
            4. Deadline
          </h2>
          {timezone ? (
            <>
              <div className="grid gap-4">
                <DateTimePicker
                  id="opensLocal"
                  name="opensLocal"
                  label="Voting opens"
                  hint={`RWA time zone (${timezone});\nConfirm scheduling from Preview.`}
                  value={state.opensLocal}
                  timeZone={timezone}
                  onChange={(value) => {
                    setOpeningIssue(null);
                    setDeadlineIssue(null);
                    patch({ opensLocal: value });
                  }}
                  error={openingIssue ?? errorAt("opensAt")}
                />
                <DateTimePicker
                  id="closesLocal"
                  name="closesLocal"
                  label="Voting closes"
                  hint={`RWA time zone (${timezone});\nSubmissions stop at this time.`}
                  value={state.closesLocal}
                  timeZone={timezone}
                  onChange={(value) => {
                    setDeadlineIssue(null);
                    setOpeningIssue(null);
                    patch({ closesLocal: value });
                  }}
                  error={deadlineIssue ?? errorAt("closesAt")}
                />
              </div>
              <p role="status" className="text-body">
                {deadlineText
                  ? `Residents will see: ${deadlineText}.`
                  : "No deadline set yet."}
              </p>
            </>
          ) : (
            <Notice
              tone="warning"
              heading="The RWA time zone has not been set up"
            >
              <p>
                A deadline cannot be entered until the deployment owner sets the
                RWA name and time zone.
              </p>
            </Notice>
          )}
        </section>
      </fieldset>

      {unchanged ? (
        <Notice tone="info">There are no changes to save.</Notice>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" variant="secondary" loading={pending}>
            <Save aria-hidden="true" className="size-5" />
            Save Draft
          </Button>
          {/* The happy path continues to preview, so it carries the primary style. */}
          {dirty ? (
            <Button
              type="button"
              disabled={pending}
              onClick={() => void saveAndPreview()}
            >
              <Eye aria-hidden="true" className="size-5" />
              Save and Preview
            </Button>
          ) : (
            <LinkButton
              href={`/admin/votes/${server.id}/preview?revision=${server.draftRevision}`}
            >
              <Eye aria-hidden="true" className="size-5" />
              Preview Ballot
            </LinkButton>
          )}
          <Button
            variant="secondary"
            disabled={pending}
            onClick={cancelEditing}
          >
            Cancel Vote
          </Button>
        </div>
        {!isNewDraft || server.draftRevision > 1 ? (
          <Button
            variant="secondary"
            className="h-12 !w-12 shrink-0 self-end border-transparent bg-transparent !p-0 !text-error hover:bg-error/10 sm:ml-auto"
            aria-label="Delete saved draft"
            title="Delete saved draft"
            disabled={pending}
            onClick={() => setExitAction("delete")}
          >
            <Trash2 aria-hidden="true" className="size-6 shrink-0" />
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={exitAction !== null}
        title={
          exitAction === "delete"
            ? "Delete this saved draft?"
            : exitAction === "rollback"
              ? "Cancel this new vote?"
              : "Discard unsaved changes?"
        }
        confirmLabel={
          exitAction === "delete" || exitAction === "rollback"
            ? "Delete Draft"
            : "Discard Changes"
        }
        destructive={exitAction !== "discard"}
        busy={pending}
        onConfirm={() => void confirmExit()}
        onCancel={() => setExitAction(null)}
      >
        {exitAction === "delete" ? (
          <p>
            This permanently deletes the saved draft and its ballot and
            electorate setup. Any unsaved changes will also be lost. This cannot
            be undone.
          </p>
        ) : exitAction === "rollback" ? (
          <p>
            This new draft has not been saved as an edited draft. Canceling
            deletes it and all current edits. This cannot be undone.
          </p>
        ) : (
          <p>
            Your unsaved changes will be discarded. The last saved version will
            remain a draft.
          </p>
        )}
      </ConfirmDialog>
      {dirty ? (
        <p role="status" className="text-caption text-muted">
          You have unsaved changes. Save and Preview saves them first.
        </p>
      ) : null}
    </form>
  );
}

function OptionsEditor({
  options,
  errorAt,
  onChange,
  onAdd,
  onUpdate,
}: Readonly<{
  options: readonly OptionDraft[];
  errorAt: (path: string) => string | undefined;
  onChange: (options: OptionDraft[]) => void;
  onAdd: () => void;
  onUpdate: (
    index: number,
    change: (option: OptionDraft) => OptionDraft,
  ) => void;
}>) {
  return (
    <div className="grid gap-4">
      <p className="text-body text-muted">
        {options.length < 2
          ? "Add at least two different options."
          : "Drag options into the order residents should see."}
      </p>
      {options.length === 0 ? (
        <p className="text-body text-muted">No options yet.</p>
      ) : null}
      {options.map((option, index) => (
        <div
          key={option.key}
          data-sortable-item
          data-sortable-group="options"
          data-sortable-index={index}
          className="grid gap-2 rounded-card border border-border bg-surface p-3"
        >
          <TextField
            id={`option-${index}-label`}
            label={`Option ${index + 1}`}
            hideLabel
            inline={false}
            required
            maxLength={200}
            autoComplete="off"
            value={option.label}
            onChange={(event) =>
              onUpdate(index, (current) => ({
                ...current,
                label: event.target.value,
              }))
            }
            error={errorAt(`options[${index}].label`)}
            leading={
              <div className="flex shrink-0 items-center gap-2">
                <ReorderHandle
                  label={`option ${index + 1}`}
                  index={index}
                  count={options.length}
                  group="options"
                  onMove={(target) => onChange(moved(options, index, target))}
                />
                <span
                  aria-hidden="true"
                  className="shrink-0 text-body font-semibold"
                >
                  Opt {index + 1}
                </span>
              </div>
            }
            trailing={
              <RemoveItemButton
                label={`option ${index + 1}`}
                onRemove={() => onChange(options.filter((_, i) => i !== index))}
              />
            }
          />
        </div>
      ))}
      <div>
        <Button variant="secondary" onClick={onAdd}>
          <Plus aria-hidden="true" className="size-5" />
          Add Option
        </Button>
      </div>
    </div>
  );
}

function OfficesEditor({
  offices,
  positions,
  errorAt,
  nextKey,
  onChange,
  onUpdate,
}: Readonly<{
  offices: readonly OfficeDraft[];
  positions: readonly string[];
  errorAt: (path: string) => string | undefined;
  nextKey: () => string;
  onChange: (offices: OfficeDraft[]) => void;
  onUpdate: (
    index: number,
    change: (office: OfficeDraft) => OfficeDraft,
  ) => void;
}>) {
  const existing = new Set(
    offices.map((office) => normalizedKey(office.name.trim())),
  );
  const missing = positions.filter(
    (position) => !existing.has(normalizedKey(position)),
  );
  const room = COLLECTION_LIMITS.offices - offices.length;
  const blankWithoutCandidates = offices.filter(
    (office) => office.name.trim() === "" && office.candidates.length === 0,
  ).length;

  /*
   * Fills untouched blank offices first, then appends the remaining positions,
   * skipping any already used as an office name and stopping at the office limit.
   */
  function addAllPositions() {
    const queue = [...missing];
    const filled = offices.map((office) =>
      office.name.trim() === "" &&
      office.candidates.length === 0 &&
      queue.length > 0
        ? { ...office, name: queue.shift() as string }
        : office,
    );
    const appended = queue
      .slice(0, Math.max(0, COLLECTION_LIMITS.offices - filled.length))
      .map((name) => ({ key: nextKey(), name, candidates: [] }));
    onChange([...filled, ...appended]);
  }

  const canAddPositions =
    missing.length > 0 && (room > 0 || blankWithoutCandidates > 0);

  return (
    <div className="grid gap-4">
      <p className="text-body text-muted">
        Residents choose one candidate or NOTA (None of the Above) for each
        office. NOTA is added automatically; do not add it yourself. It is
        counted separately and cannot win; the candidate with the most votes
        among candidates is elected. Tied top candidate counts remain a tie; if
        no candidate receives a vote, no candidate is elected.
      </p>
      {positions.length > 0 ? (
        <datalist id="rwa-position-suggestions">
          {positions.map((position) => (
            <option key={position} value={position} />
          ))}
        </datalist>
      ) : null}
      {offices.length === 0 ? (
        <p className="text-body text-muted">No offices yet.</p>
      ) : null}
      {offices.map((office, officeIndex) => (
        <fieldset
          key={office.key}
          data-sortable-item
          data-sortable-group="offices"
          data-sortable-index={officeIndex}
          className="grid gap-4 border-y border-border py-5"
        >
          <legend className="px-1 text-card-heading font-semibold">
            Office {officeIndex + 1}
          </legend>
          <TextField
            id={`office-${officeIndex}-name`}
            label="Office name"
            hint={
              positions.length > 0
                ? "Type a name or pick one of your RWA positions."
                : "For example: Chairperson."
            }
            required
            maxLength={200}
            autoComplete="off"
            list={positions.length > 0 ? "rwa-position-suggestions" : undefined}
            value={office.name}
            onChange={(event) =>
              onUpdate(officeIndex, (current) => ({
                ...current,
                name: event.target.value,
              }))
            }
            error={errorAt(`offices[${officeIndex}].name`)}
            trailing={
              <ReorderControls
                label={`office ${officeIndex + 1}`}
                index={officeIndex}
                count={offices.length}
                group="offices"
                onMove={(target) =>
                  onChange(moved(offices, officeIndex, target))
                }
                onRemove={() =>
                  onChange(offices.filter((_, i) => i !== officeIndex))
                }
              />
            }
          />

          <div className="grid gap-3 border-t border-border pt-3">
            <h3 className="text-body font-semibold">
              Candidates for office {officeIndex + 1}
            </h3>
            {office.candidates.length === 0 ? (
              <p className="text-body text-muted">No candidates yet.</p>
            ) : null}
            {office.candidates.map((candidate, candidateIndex) => (
              <div
                key={candidate.key}
                data-sortable-item
                data-sortable-group={`candidates-${office.key}`}
                data-sortable-index={candidateIndex}
                className="grid gap-2"
              >
                <TextField
                  id={`office-${officeIndex}-candidate-${candidateIndex}-name`}
                  label={`Candidate ${candidateIndex + 1}`}
                  required
                  maxLength={200}
                  autoComplete="off"
                  value={candidate.name}
                  onChange={(event) =>
                    onUpdate(officeIndex, (current) => ({
                      ...current,
                      candidates: current.candidates.map((existing, i) =>
                        i === candidateIndex
                          ? { ...existing, name: event.target.value }
                          : existing,
                      ),
                    }))
                  }
                  error={errorAt(
                    `offices[${officeIndex}].candidates[${candidateIndex}].name`,
                  )}
                  trailing={
                    <ReorderControls
                      label={`candidate ${candidateIndex + 1} of office ${officeIndex + 1}`}
                      index={candidateIndex}
                      count={office.candidates.length}
                      group={`candidates-${office.key}`}
                      onMove={(target) =>
                        onUpdate(officeIndex, (current) => ({
                          ...current,
                          candidates: moved(
                            current.candidates,
                            candidateIndex,
                            target,
                          ),
                        }))
                      }
                      onRemove={() =>
                        onUpdate(officeIndex, (current) => ({
                          ...current,
                          candidates: current.candidates.filter(
                            (_, i) => i !== candidateIndex,
                          ),
                        }))
                      }
                    />
                  }
                />
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                onClick={() =>
                  onUpdate(officeIndex, (current) => ({
                    ...current,
                    candidates: [
                      ...current.candidates,
                      { key: nextKey(), name: "" },
                    ],
                  }))
                }
              >
                <Plus aria-hidden="true" className="size-5" />
                Add Candidate to Office {officeIndex + 1}
              </Button>
            </div>
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={() =>
            onChange([...offices, { key: nextKey(), name: "", candidates: [] }])
          }
        >
          <Plus aria-hidden="true" className="size-5" />
          Add Office
        </Button>
        {positions.length > 0 ? (
          <Button
            variant="secondary"
            disabled={!canAddPositions}
            onClick={addAllPositions}
          >
            <ListPlus aria-hidden="true" className="size-5" />
            Add All Positions
          </Button>
        ) : null}
      </div>
      {positions.length > 0 ? (
        <p className="text-caption text-muted" aria-live="polite">
          {missing.length === 0
            ? "Every RWA position is already an office."
            : canAddPositions
              ? `Add All Positions adds ${missing.length === 1 ? "the missing position" : `the ${missing.length} missing positions`} (${missing.join(", ")}) as offices.`
              : `The ${COLLECTION_LIMITS.offices}-office limit is reached; remove an office to add more positions.`}{" "}
          Positions come from Settings.
        </p>
      ) : null}
    </div>
  );
}
