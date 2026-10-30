// Responsive Manage Votes table with browser-local optional-column preferences.
"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { formatInstant } from "@/components/admin/format";
import { VoteTableToolbar, type VoteTableState } from "./vote-table-controls";
import { VoteStatusBadge, VotingTypeBadge } from "@/components/ui/badges";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DeadlineCountdown } from "@/components/votes/deadline-countdown";
import type { AdminVoteTableSummary } from "@/shared/contracts/drafts";
import { formatInZone } from "@/shared/time/zoned";

const VOTE_COLUMNS_STORAGE_KEY = "civic-pulse-vote-columns";
const VOTE_COLUMNS_EVENT = "civic-pulse:vote-columns";
const COMPACT_TABLE_QUERY = "(max-width: 1023px)";
const STORAGE_UNAVAILABLE = Symbol("storage-unavailable");
const FIXED_VOTE_COLUMNS = ["title", "status", "turnout"] as const;
export const OPTIONAL_VOTE_COLUMNS = [
  { key: "type", label: "Type" },
  { key: "deadline", label: "Deadline" },
  { key: "updated", label: "Last Changed" },
] as const;
const ALL_VOTE_COLUMNS = [
  "title",
  "type",
  "status",
  "deadline",
  "updated",
  "turnout",
] as const;

export type OptionalVoteColumn = (typeof OPTIONAL_VOTE_COLUMNS)[number]["key"];
type VoteColumnKey = (typeof ALL_VOTE_COLUMNS)[number];
type VoteSortKey = VoteTableState["sort"];
const FIXED_VOTE_COLUMN_SET: ReadonlySet<VoteColumnKey> = new Set(
  FIXED_VOTE_COLUMNS,
);

function isOptionalVoteColumn(value: unknown): value is OptionalVoteColumn {
  return OPTIONAL_VOTE_COLUMNS.some((column) => column.key === value);
}

export function visibleVoteColumnKeys(
  compact: boolean,
  selected: ReadonlySet<OptionalVoteColumn>,
): VoteColumnKey[] {
  if (!compact) return [...ALL_VOTE_COLUMNS];
  return ALL_VOTE_COLUMNS.filter(
    (key) =>
      FIXED_VOTE_COLUMN_SET.has(key) ||
      (isOptionalVoteColumn(key) && selected.has(key)),
  );
}

function subscribeToCompactTable(onChange: () => void) {
  const media = window.matchMedia(COMPACT_TABLE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function compactTableSnapshot() {
  return window.matchMedia(COMPACT_TABLE_QUERY).matches;
}

function subscribeToColumnPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(VOTE_COLUMNS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(VOTE_COLUMNS_EVENT, onChange);
  };
}

function columnPreferenceSnapshot():
  string | null | typeof STORAGE_UNAVAILABLE {
  try {
    return window.localStorage.getItem(VOTE_COLUMNS_STORAGE_KEY);
  } catch {
    return STORAGE_UNAVAILABLE;
  }
}

function VoteColumnChooser({
  selected,
  onToggle,
}: Readonly<{
  selected: ReadonlySet<OptionalVoteColumn>;
  onToggle: (column: OptionalVoteColumn, checked: boolean) => void;
}>) {
  return (
    <details
      data-vote-columns
      className="relative flex shrink-0 items-center lg:hidden"
    >
      <summary className="inline-flex min-h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-control border border-control-border bg-surface px-4 py-3 font-semibold text-primary hover:bg-primary/5 [&::-webkit-details-marker]:hidden">
        Columns
        <ChevronDown aria-hidden="true" className="size-4" />
      </summary>
      <fieldset className="absolute right-0 z-30 mt-2 grid max-h-[70dvh] w-64 max-w-[calc(100vw-2rem)] gap-1 overflow-y-auto rounded-card border border-border bg-surface p-3 text-primary shadow-panel">
        <legend className="px-1 pb-1 font-semibold">Show columns</legend>
        {OPTIONAL_VOTE_COLUMNS.map((column) => (
          <label
            key={column.key}
            className="inline-flex min-h-12 cursor-pointer items-center gap-3 px-2"
          >
            <input
              type="checkbox"
              className="size-5 accent-accent"
              checked={selected.has(column.key)}
              onChange={(event) =>
                onToggle(column.key, event.currentTarget.checked)
              }
            />
            {column.label}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

function voteColumns(state: VoteTableState): Column<AdminVoteTableSummary>[] {
  const sortDirection = (key: VoteSortKey) =>
    state.sort === key
      ? state.direction === "asc"
        ? "ascending"
        : "descending"
      : undefined;
  return [
    {
      key: "title",
      header: "Vote",
      sortDirection: sortDirection("title"),
      cell: (vote) => (
        <Link
          href={`/admin/votes/${vote.id}`}
          className="inline-flex touch-target items-center font-semibold text-accent underline underline-offset-2"
        >
          {vote.title === "" ? "Untitled draft" : vote.title}
          <span className="sr-only"> (open)</span>
        </Link>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortDirection: sortDirection("type"),
      cell: (vote) => <VotingTypeBadge type={vote.votingType} />,
    },
    {
      key: "status",
      header: "Status",
      sortDirection: sortDirection("status"),
      cell: (vote) => <VoteStatusBadge status={vote.status} />,
    },
    {
      key: "deadline",
      header: "Deadline",
      sortDirection: sortDirection("deadline"),
      cell: (vote) => (
        <div className="grid gap-1">
          {vote.status === "SCHEDULED" && vote.opensAt ? (
            <>
              <span>
                Opens {formatInZone(vote.opensAt, vote.timezone ?? "UTC")}
              </span>
              <DeadlineCountdown deadline={vote.opensAt} opening />
            </>
          ) : null}
          <span>
            {vote.closesAt
              ? vote.timezone
                ? formatInZone(vote.closesAt, vote.timezone)
                : formatInstant(vote.closesAt)
              : "Not set"}
          </span>
          {vote.status === "ACTIVE" && vote.closesAt ? (
            <DeadlineCountdown deadline={vote.closesAt} />
          ) : null}
        </div>
      ),
    },
    {
      key: "updated",
      header: "Last Changed",
      sortDirection: sortDirection("updated"),
      cell: (vote) =>
        vote.timezone
          ? formatInZone(vote.updatedAt, vote.timezone)
          : formatInstant(vote.updatedAt),
    },
    {
      key: "turnout",
      header: "Turnout",
      cell: (vote) => {
        if (vote.status === "DRAFT" || vote.status === "SCHEDULED") {
          return "Not open";
        }
        if (vote.status === "CANCELLED") return "Not available";
        if (!vote.turnout) return "Turnout unavailable";

        const { eligibleCount, submittedCount, percent } = vote.turnout;
        return (
          <span
            className="tabular-nums"
            aria-label={`${submittedCount} of ${eligibleCount} eligible; ${percent}% turnout`}
          >
            {submittedCount} / {eligibleCount} ({percent}%)
          </span>
        );
      },
    },
  ];
}

export function VoteTableView({
  state,
  votes,
}: Readonly<{
  state: VoteTableState;
  votes: readonly AdminVoteTableSummary[];
}>) {
  const compact = useSyncExternalStore(
    subscribeToCompactTable,
    compactTableSnapshot,
    () => false,
  );
  const savedPreference = useSyncExternalStore(
    subscribeToColumnPreference,
    columnPreferenceSnapshot,
    () => null,
  );
  const [temporaryColumns, setTemporaryColumns] =
    useState<ReadonlySet<OptionalVoteColumn> | null>(null);
  const [columnWriteError, setColumnWriteError] = useState<string | null>(null);
  const parsedPreference = useMemo(() => {
    if (savedPreference === STORAGE_UNAVAILABLE) {
      return {
        columns: new Set<OptionalVoteColumn>(),
        error:
          "Saved column choices could not be loaded. Default columns are shown; changes may not be remembered on this device.",
      };
    }
    if (savedPreference === null) {
      return { columns: new Set<OptionalVoteColumn>(), error: null };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(savedPreference);
    } catch {
      return {
        columns: new Set<OptionalVoteColumn>(),
        error:
          "Saved column choices are invalid. Default columns are shown; choose columns to replace the saved preference.",
      };
    }
    if (!Array.isArray(parsed) || !parsed.every(isOptionalVoteColumn)) {
      return {
        columns: new Set<OptionalVoteColumn>(),
        error:
          "Saved column choices are invalid. Default columns are shown; choose columns to replace the saved preference.",
      };
    }
    return { columns: new Set<OptionalVoteColumn>(parsed), error: null };
  }, [savedPreference]);
  const selectedColumns = temporaryColumns ?? parsedPreference.columns;
  const preferenceError = columnWriteError ?? parsedPreference.error;

  function toggleColumn(column: OptionalVoteColumn, checked: boolean) {
    const next = new Set(selectedColumns);
    if (checked) next.add(column);
    else next.delete(column);
    try {
      window.localStorage.setItem(
        VOTE_COLUMNS_STORAGE_KEY,
        JSON.stringify([...next]),
      );
      setTemporaryColumns(null);
      setColumnWriteError(null);
      window.dispatchEvent(new Event(VOTE_COLUMNS_EVENT));
    } catch {
      setTemporaryColumns(next);
      setColumnWriteError(
        "Column choices changed for this visit, but the browser could not save them on this device.",
      );
    }
  }

  const visibleKeys: ReadonlySet<string> = new Set(
    visibleVoteColumnKeys(compact, selectedColumns),
  );
  const columns = voteColumns(state).filter((column) =>
    visibleKeys.has(column.key),
  );

  return (
    <div data-vote-table-view className="grid min-w-0 gap-3">
      <div className="flex min-w-0 items-center justify-end gap-2">
        <VoteTableToolbar state={state} />
        {compact ? (
          <VoteColumnChooser
            selected={selectedColumns}
            onToggle={toggleColumn}
          />
        ) : null}
      </div>
      {preferenceError ? (
        <p role="status" className="text-caption text-warning">
          {preferenceError}
        </p>
      ) : null}
      <DataTable
        caption="Votes"
        columns={columns}
        rows={votes}
        rowKey={(vote) => vote.id}
      />
    </div>
  );
}
