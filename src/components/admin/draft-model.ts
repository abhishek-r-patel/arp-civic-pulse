import type { AdminVoteDetail } from "@/shared/contracts/drafts";
import {
  DEFAULT_HOUSEHOLD_TERMS,
  type HouseholdTerms,
} from "@/shared/contracts/household-terms";
import type { VotingType } from "@/shared/contracts/voting";
import { instantToLocalInput, zonedLocalToInstant } from "@/shared/time/zoned";

/*
 * The draft editor's working state and the rules for turning it into a PATCH.
 * Only the sections a person actually changed are sent. A collection that is
 * sent replaces the whole collection, with existing children carried by id so
 * they keep their identity; position is simply the order on screen.
 */
export interface CandidateDraft {
  key: string;
  id?: string;
  name: string;
}
export interface OfficeDraft {
  key: string;
  id?: string;
  name: string;
  candidates: CandidateDraft[];
}
export interface OptionDraft {
  key: string;
  id?: string;
  label: string;
}

export interface DraftState {
  votingType: VotingType;
  openSelectionMode: "SINGLE" | "MULTIPLE";
  openSelectionLimit: number | null;
  title: string;
  instructions: string;
  /** `YYYY-MM-DDTHH:mm:ss` in the RWA time zone, in 24-hour form. */
  opensLocal: string;
  /** `YYYY-MM-DDTHH:mm:ss` in the RWA time zone, in 24-hour form. */
  closesLocal: string;
  offices: OfficeDraft[];
  options: OptionDraft[];
  selectedHouseholdIds: string[];
}

interface OfficePayload {
  id?: string;
  name: string;
  position: number;
  candidates: { id?: string; name: string; position: number }[];
}
interface OptionPayload {
  id?: string;
  label: string;
  position: number;
}

export function stateFromDetail(
  detail: AdminVoteDetail,
  closesLocal: string,
): DraftState {
  return {
    votingType: detail.votingType,
    openSelectionMode: detail.openSelectionMode,
    openSelectionLimit: detail.openSelectionLimit,
    title: detail.title,
    instructions: detail.instructions ?? "",
    opensLocal: instantToLocalInput(
      detail.opensAt ?? null,
      detail.timezone ?? "UTC",
      true,
    ),
    closesLocal,
    offices: detail.offices.map((office) => ({
      key: office.id,
      id: office.id,
      name: office.name,
      candidates: office.candidates.map((candidate) => ({
        key: candidate.id,
        id: candidate.id,
        name: candidate.name,
      })),
    })),
    options: detail.options.map((option) => ({
      key: option.id,
      id: option.id,
      label: option.label,
    })),
    selectedHouseholdIds: [...detail.eligibleHouseholdIds],
  };
}

function officePayload(offices: readonly OfficeDraft[]): OfficePayload[] {
  return offices.map((office, officeIndex) => ({
    ...(office.id ? { id: office.id } : {}),
    name: office.name,
    position: officeIndex + 1,
    candidates: office.candidates.map((candidate, index) => ({
      ...(candidate.id ? { id: candidate.id } : {}),
      name: candidate.name,
      position: index + 1,
    })),
  }));
}

function optionPayload(options: readonly OptionDraft[]): OptionPayload[] {
  return options.map((option, index) => ({
    ...(option.id ? { id: option.id } : {}),
    label: option.label,
    position: index + 1,
  }));
}

const sameSet = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  [...left].sort().join("|") === [...right].sort().join("|");

export type DeadlineIssue = "INVALID" | "NONEXISTENT" | "AMBIGUOUS" | "WINDOW";

export type PatchResult =
  | { ok: true; patch: Record<string, unknown>; changed: string[] }
  | {
      ok: false;
      deadline: DeadlineIssue;
      field: "opensLocal" | "closesLocal";
    };

/**
 * The minimal patch from `baseline` (what the server last confirmed) to
 * `current`. An opening or closing time that cannot be converted unambiguously
 * blocks saving.
 */
export function buildPatch(
  baseline: DraftState,
  current: DraftState,
  timeZone: string | null,
): PatchResult {
  const patch: Record<string, unknown> = {};
  const changed: string[] = [];

  if (current.votingType !== baseline.votingType) {
    patch.votingType = current.votingType;
    changed.push("type");
  }
  if (
    current.votingType === "PUBLIC" &&
    (current.openSelectionMode !== baseline.openSelectionMode ||
      current.openSelectionLimit !== baseline.openSelectionLimit)
  ) {
    patch.openSelectionMode = current.openSelectionMode;
    patch.openSelectionLimit = current.openSelectionLimit;
    changed.push("selection");
  }
  if (current.title.trim() !== baseline.title.trim()) {
    patch.title = current.title;
    changed.push("title");
  }
  if (current.instructions.trim() !== baseline.instructions.trim()) {
    patch.instructions =
      current.instructions.trim() === "" ? null : current.instructions;
    changed.push("instructions");
  }
  if (current.opensLocal !== baseline.opensLocal) {
    if (current.opensLocal === "") {
      patch.opensAt = null;
    } else if (timeZone === null) {
      return { ok: false, deadline: "INVALID", field: "opensLocal" };
    } else {
      const converted = zonedLocalToInstant(current.opensLocal, timeZone);
      if (!converted.ok) {
        return {
          ok: false,
          deadline: converted.reason,
          field: "opensLocal",
        };
      }
      patch.opensAt = converted.instant;
    }
    changed.push("opening");
  }
  if (current.closesLocal !== baseline.closesLocal) {
    if (current.closesLocal === "") {
      patch.closesAt = null;
    } else if (timeZone === null) {
      return { ok: false, deadline: "INVALID", field: "closesLocal" };
    } else {
      const converted = zonedLocalToInstant(current.closesLocal, timeZone);
      if (!converted.ok) {
        return {
          ok: false,
          deadline: converted.reason,
          field: "closesLocal",
        };
      }
      patch.closesAt = converted.instant;
    }
    changed.push("deadline");
  }
  if (
    current.opensLocal !== "" &&
    current.closesLocal !== "" &&
    current.opensLocal >= current.closesLocal
  ) {
    return {
      ok: false,
      deadline: "WINDOW",
      field: "opensLocal",
    };
  }

  // A type change already removes the other shape on the server, so a
  // collection only needs sending when it differs for the resulting type.
  const typeChanged = current.votingType !== baseline.votingType;
  if (current.votingType === "PRIVATE") {
    const next = officePayload(current.offices);
    if (
      typeChanged
        ? next.length > 0
        : JSON.stringify(next) !==
          JSON.stringify(officePayload(baseline.offices))
    ) {
      patch.offices = next;
      changed.push("ballot");
    }
  } else {
    const next = optionPayload(current.options);
    if (
      typeChanged
        ? next.length > 0
        : JSON.stringify(next) !==
          JSON.stringify(optionPayload(baseline.options))
    ) {
      patch.options = next;
      changed.push("ballot");
    }
  }
  if (!sameSet(current.selectedHouseholdIds, baseline.selectedHouseholdIds)) {
    patch.eligibleHouseholdIds = [...current.selectedHouseholdIds];
    changed.push("electorate");
  }

  return { ok: true, patch, changed: [...new Set(changed)] };
}

export function isDirty(
  baseline: DraftState,
  current: DraftState,
  timeZone: string | null,
): boolean {
  const result = buildPatch(baseline, current, timeZone);
  return !result.ok || result.changed.length > 0;
}

/**
 * Keeps a person's unsaved edits when someone else saved a newer version:
 * existing children whose ids are gone from the latest version become new
 * ones, so the next save cannot reference something that no longer exists.
 */
export function rebaseOnto(
  mine: DraftState,
  latest: AdminVoteDetail,
): DraftState {
  const officeIds = new Set(latest.offices.map((office) => office.id));
  const candidateIdsByOffice = new Map(
    latest.offices.map((office) => [
      office.id,
      new Set(office.candidates.map((candidate) => candidate.id)),
    ]),
  );
  const optionIds = new Set(latest.options.map((option) => option.id));

  return {
    ...mine,
    offices: mine.offices.map((office) => {
      const officeKnown = office.id !== undefined && officeIds.has(office.id);
      const knownCandidates = candidateIdsByOffice.get(office.id ?? "");
      return {
        key: office.key,
        name: office.name,
        ...(officeKnown && office.id ? { id: office.id } : {}),
        candidates: office.candidates.map((candidate) => ({
          key: candidate.key,
          name: candidate.name,
          ...(officeKnown &&
          candidate.id !== undefined &&
          knownCandidates?.has(candidate.id)
            ? { id: candidate.id }
            : {}),
        })),
      };
    }),
    options: mine.options.map((option) => ({
      key: option.key,
      label: option.label,
      ...(option.id !== undefined && optionIds.has(option.id)
        ? { id: option.id }
        : {}),
    })),
  };
}

export interface MergeResult {
  state: DraftState;
  baseline: DraftState;
  /** Plain-language notes about anything the person should double-check. */
  notes: string[];
}

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

const sortedIds = (ids: readonly string[]) => [...ids].sort();

/**
 * Stale-edit recovery. `oldBaseline` is what the person last saw confirmed,
 * `mine` their unsaved edits and `latest` what the server holds now. A section
 * they did not touch simply takes the latest value, so another administrator's
 * work is never reverted; a section they did change keeps their version, and
 * the notes say where both sides changed the same section.
 */
export function mergeOnto(
  oldBaseline: DraftState,
  mine: DraftState,
  latest: AdminVoteDetail,
  latestLocal: string,
  terms: HouseholdTerms = DEFAULT_HOUSEHOLD_TERMS,
): MergeResult {
  const baseline = stateFromDetail(latest, latestLocal);
  const notes: string[] = [];
  const bothChanged = (
    name: string,
    mineValue: unknown,
    oldValue: unknown,
    latestValue: unknown,
  ) => {
    if (!same(mineValue, oldValue) && !same(latestValue, oldValue)) {
      notes.push(
        `You and someone else both changed the ${name}. Your version is kept.`,
      );
    }
  };

  const typeChanged = mine.votingType !== oldBaseline.votingType;
  const votingType = typeChanged ? mine.votingType : baseline.votingType;
  bothChanged(
    "voting type",
    mine.votingType,
    oldBaseline.votingType,
    baseline.votingType,
  );

  const title = same(mine.title, oldBaseline.title)
    ? baseline.title
    : mine.title;
  bothChanged("title", mine.title, oldBaseline.title, baseline.title);

  const instructions = same(mine.instructions, oldBaseline.instructions)
    ? baseline.instructions
    : mine.instructions;
  bothChanged(
    "instructions",
    mine.instructions,
    oldBaseline.instructions,
    baseline.instructions,
  );

  const opensLocal = same(mine.opensLocal, oldBaseline.opensLocal)
    ? baseline.opensLocal
    : mine.opensLocal;
  bothChanged(
    "opening time",
    mine.opensLocal,
    oldBaseline.opensLocal,
    baseline.opensLocal,
  );

  const closesLocal = same(mine.closesLocal, oldBaseline.closesLocal)
    ? baseline.closesLocal
    : mine.closesLocal;
  bothChanged(
    "deadline",
    mine.closesLocal,
    oldBaseline.closesLocal,
    baseline.closesLocal,
  );

  const selectionEdited =
    mine.openSelectionMode !== oldBaseline.openSelectionMode ||
    mine.openSelectionLimit !== oldBaseline.openSelectionLimit;
  const openSelectionMode =
    votingType === "PRIVATE"
      ? "SINGLE"
      : selectionEdited
        ? mine.openSelectionMode
        : baseline.openSelectionMode;
  const openSelectionLimit =
    votingType === "PRIVATE"
      ? 1
      : selectionEdited
        ? mine.openSelectionLimit
        : baseline.openSelectionLimit;
  bothChanged(
    "PUBLIC selection rule",
    [mine.openSelectionMode, mine.openSelectionLimit],
    [oldBaseline.openSelectionMode, oldBaseline.openSelectionLimit],
    [baseline.openSelectionMode, baseline.openSelectionLimit],
  );

  const rebased = rebaseOnto(mine, latest);
  const minePayload =
    votingType === "PRIVATE"
      ? officePayload(mine.offices)
      : optionPayload(mine.options);
  const oldPayload =
    votingType === "PRIVATE"
      ? officePayload(oldBaseline.offices)
      : optionPayload(oldBaseline.options);
  const latestPayload =
    votingType === "PRIVATE"
      ? officePayload(baseline.offices)
      : optionPayload(baseline.options);
  const ballotEdited = !same(minePayload, oldPayload);
  bothChanged("ballot", minePayload, oldPayload, latestPayload);

  const offices =
    votingType === "PRIVATE"
      ? ballotEdited
        ? rebased.offices
        : baseline.offices
      : [];
  const options =
    votingType === "PUBLIC"
      ? ballotEdited
        ? rebased.options
        : baseline.options
      : [];
  if (!typeChanged && votingType !== mine.votingType) {
    const mineOwn =
      mine.votingType === "PRIVATE"
        ? officePayload(mine.offices)
        : optionPayload(mine.options);
    const oldOwn =
      mine.votingType === "PRIVATE"
        ? officePayload(oldBaseline.offices)
        : optionPayload(oldBaseline.options);
    if (!same(mineOwn, oldOwn)) {
      notes.push(
        `The voting type was changed to ${votingType} in the latest version, so your ballot edits for the old type were not kept.`,
      );
    }
  }

  const selectedEdited = !same(
    sortedIds(mine.selectedHouseholdIds),
    sortedIds(oldBaseline.selectedHouseholdIds),
  );
  bothChanged(
    `${terms.household} selection`,
    sortedIds(mine.selectedHouseholdIds),
    sortedIds(oldBaseline.selectedHouseholdIds),
    sortedIds(baseline.selectedHouseholdIds),
  );

  return {
    baseline,
    notes,
    state: {
      votingType,
      openSelectionMode,
      openSelectionLimit,
      title,
      instructions,
      opensLocal,
      closesLocal,
      offices,
      options,
      selectedHouseholdIds: selectedEdited
        ? [...mine.selectedHouseholdIds]
        : [...baseline.selectedHouseholdIds],
    },
  };
}

/** Human wording for a server field path such as `offices[0].candidates[1].name`. */
export function describeFieldPath(
  path: string,
  terms: HouseholdTerms = DEFAULT_HOUSEHOLD_TERMS,
): string {
  const office =
    /^offices\[(\d+)\](?:\.candidates\[(\d+)\])?(?:\.(\w+))?$/u.exec(path);
  if (office) {
    const [, officeIndex, candidateIndex, field] = office;
    const where = `Office ${Number(officeIndex) + 1}`;
    if (candidateIndex !== undefined) {
      return `${where}, candidate ${Number(candidateIndex) + 1}${field ? ` ${field}` : ""}`;
    }
    return field ? `${where} ${field}` : where;
  }
  const option = /^options\[(\d+)\](?:\.(\w+))?$/u.exec(path);
  if (option) {
    return `Option ${Number(option[1]) + 1}${option[2] ? ` ${option[2]}` : ""}`;
  }
  const labels: Record<string, string> = {
    title: "Title",
    instructions: "Instructions",
    opensAt: "Voting opens",
    closesAt: "Deadline",
    eligibleHouseholdIds: `Eligible ${terms.Households}`,
    votingType: "Voting type",
    openSelectionMode: "PUBLIC selection mode",
    openSelectionLimit: "PUBLIC selection limit",
    offices: "Offices",
    options: "Options",
    expectedRevision: "Draft version",
  };
  return labels[path] ?? path;
}

/** The DOM id a field-path error should focus, when one exists. */
export function fieldIdForPath(path: string): string {
  const office = /^offices\[(\d+)\](?:\.candidates\[(\d+)\])?\.name$/u.exec(
    path,
  );
  if (office) {
    return office[2] === undefined
      ? `office-${office[1]}-name`
      : `office-${office[1]}-candidate-${office[2]}-name`;
  }
  const option = /^options\[(\d+)\]\.label$/u.exec(path);
  if (option) {
    return `option-${option[1]}-label`;
  }
  if (path === "opensAt") return "opensLocal";
  return path === "closesAt" ? "closesLocal" : path;
}
