// URL-backed sorting and column filters for the administrator vote inventory.
"use client";

import { useId, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { TableFilterPopover } from "@/components/ui/table-filter-popover";
import {
  VOTE_STATUSES,
  VOTE_STATUS_LABELS,
  VOTING_TYPES,
  VOTING_TYPE_LABELS,
} from "@/shared/contracts/voting";
import { instantToLocalInput, zonedLocalToInstant } from "@/shared/time/zoned";
import { VOTE_TABLE_SORT_KEYS } from "@/shared/contracts/admin-votes";

type VoteSortKey = (typeof VOTE_TABLE_SORT_KEYS)[number];
type VoteFilterColumn = VoteSortKey;
type VoteFilterField =
  | "titleContains"
  | "status"
  | "votingType"
  | "deadlineFrom"
  | "deadlineTo"
  | "changedFrom"
  | "changedTo";

export type VoteTableState = Readonly<{
  params: Readonly<Record<string, string | undefined>>;
  sort: VoteSortKey;
  direction: "asc" | "desc";
}>;

const fields: Record<VoteFilterColumn, readonly VoteFilterField[]> = {
  title: ["titleContains"],
  type: ["votingType"],
  status: ["status"],
  deadline: ["deadlineFrom", "deadlineTo"],
  updated: ["changedFrom", "changedTo"],
};
const allFields: readonly VoteFilterField[] = [
  "titleContains",
  "votingType",
  "status",
  "deadlineFrom",
  "deadlineTo",
  "changedFrom",
  "changedTo",
];
const subscribe = () => () => {};
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;
const clearFilterParams = Object.fromEntries(
  allFields.map((field) => [field, ""]),
);

export function voteTableHref(
  params: VoteTableState["params"],
  changes: Readonly<Record<string, string>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && !["page", "cursor", "notice"].includes(key)) {
      search.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value) search.set(key, value);
    else search.delete(key);
  }
  return `/admin/votes?${search}`;
}

export function voteTableClearFiltersHref(
  params: VoteTableState["params"],
): string {
  return voteTableHref(params, clearFilterParams);
}

function FilterForm({
  state,
  column,
  all = false,
}: Readonly<{
  state: VoteTableState;
  column?: VoteFilterColumn;
  all?: boolean;
}>) {
  const id = useId();
  const router = useRouter();
  const timezone = useSyncExternalStore(subscribe, localZone, serverZone);
  const [error, setError] = useState("");
  const keys = all ? allFields : column ? fields[column] : [];
  const includes = (key: VoteFilterField) =>
    all || (column !== undefined && fields[column].includes(key));
  const value = (key: string) => state.params[key] ?? "";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const zone = timezone ?? "UTC";
    for (const field of [
      "deadlineFrom",
      "deadlineTo",
      "changedFrom",
      "changedTo",
    ] as const) {
      const input = form.elements.namedItem(field);
      if (
        !(input instanceof HTMLInputElement) ||
        input.type !== "datetime-local" ||
        !input.value
      ) {
        continue;
      }
      const result = zonedLocalToInstant(input.value, zone);
      if (!result.ok) {
        setError("Choose a valid, unambiguous local date and time.");
        return;
      }
      data.set(field, result.instant);
    }
    for (const [fromKey, toKey, beforeLabel, fromLabel] of [
      ["deadlineFrom", "deadlineTo", "Closing Before", "Closing From"],
      ["changedFrom", "changedTo", "Changed Before", "Changed From"],
    ] as const) {
      const from = data.get(fromKey);
      const to = data.get(toKey);
      if (
        typeof from === "string" &&
        from &&
        typeof to === "string" &&
        to &&
        new Date(from) >= new Date(to)
      ) {
        setError(`${beforeLabel} must be after ${fromLabel}.`);
        return;
      }
    }
    const search = new URLSearchParams();
    data.forEach((entry, key) => {
      if (typeof entry === "string" && entry) search.set(key, entry);
    });
    router.push(`/admin/votes?${search}`);
  }
  const common = {
    inline: false,
    showOptional: false,
    hideLabel: !all && column !== "deadline" && column !== "updated",
  };
  return (
    <form
      method="get"
      action="/admin/votes"
      onSubmit={submit}
      className="grid gap-3"
    >
      {Object.entries(state.params)
        .filter(
          ([key, entry]) =>
            entry !== undefined &&
            !["page", "cursor", "notice", ...keys].includes(key),
        )
        .map(([key, entry]) => (
          <input key={key} type="hidden" name={key} value={entry} />
        ))}
      {includes("titleContains") ? (
        <TextField
          {...common}
          id={`${id}-title`}
          name="titleContains"
          label="Vote title"
          defaultValue={value("titleContains")}
          maxLength={100}
          placeholder="Contains..."
        />
      ) : null}
      {includes("votingType") ? (
        <SelectField
          menuInFlow
          {...common}
          id={`${id}-type`}
          name="votingType"
          label="Voting Type"
          defaultValue={value("votingType")}
        >
          <option value="">Any type</option>
          {VOTING_TYPES.map((type) => (
            <option key={type} value={type}>
              {VOTING_TYPE_LABELS[type]}
            </option>
          ))}
        </SelectField>
      ) : null}
      {includes("status") ? (
        <SelectField
          menuInFlow
          {...common}
          id={`${id}-status`}
          name="status"
          label="Status"
          defaultValue={value("status")}
        >
          <option value="">Any status</option>
          {VOTE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {VOTE_STATUS_LABELS[status]}
            </option>
          ))}
        </SelectField>
      ) : null}
      {includes("deadlineFrom") || includes("deadlineTo") ? (
        <>
          <p className="text-caption text-muted">
            Closing deadlines use {timezone ?? "UTC"}; the end is exclusive.
          </p>
          <TextField
            {...common}
            id={`${id}-deadline-from`}
            name="deadlineFrom"
            label="Closing From"
            type="datetime-local"
            defaultValue={instantToLocalInput(
              value("deadlineFrom") || null,
              timezone ?? "UTC",
            )}
            key={`deadline-from-${timezone}`}
          />
          <TextField
            {...common}
            id={`${id}-deadline-to`}
            name="deadlineTo"
            label="Closing Before"
            type="datetime-local"
            defaultValue={instantToLocalInput(
              value("deadlineTo") || null,
              timezone ?? "UTC",
            )}
            key={`deadline-to-${timezone}`}
          />
        </>
      ) : null}
      {includes("changedFrom") || includes("changedTo") ? (
        <>
          <p className="text-caption text-muted">
            Times in {timezone ?? "UTC"}; the end is exclusive.
          </p>
          <TextField
            {...common}
            id={`${id}-changed-from`}
            name="changedFrom"
            label="Changed From"
            type="datetime-local"
            defaultValue={instantToLocalInput(
              value("changedFrom") || null,
              timezone ?? "UTC",
            )}
            key={`changed-from-${timezone}`}
          />
          <TextField
            {...common}
            id={`${id}-changed-to`}
            name="changedTo"
            label="Changed Before"
            type="datetime-local"
            defaultValue={instantToLocalInput(
              value("changedTo") || null,
              timezone ?? "UTC",
            )}
            key={`changed-to-${timezone}`}
          />
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      <Button type="submit">{all ? "Apply Filters" : "Apply Filter"}</Button>
    </form>
  );
}

export function VoteColumnHeader({
  state,
  column,
  title,
}: Readonly<{
  state: VoteTableState;
  column: VoteFilterColumn;
  title: string;
}>) {
  const selected = state.sort === column;
  const direction = selected && state.direction === "asc" ? "desc" : "asc";
  const Icon = selected
    ? state.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  const active = fields[column].some((field) => Boolean(state.params[field]));
  return (
    <div className="flex items-center">
      <Link
        href={voteTableHref(state.params, { sort: column, direction })}
        aria-label={`Sort ${title} ${direction === "asc" ? "ascending" : "descending"}`}
        className="inline-flex min-h-12 items-center gap-1 wrap-normal text-primary"
      >
        {title}
        <Icon aria-hidden="true" className="size-4 shrink-0" />
      </Link>
      <TableFilterPopover label={`Filter ${title}`} active={active}>
        <FilterForm state={state} column={column} />
      </TableFilterPopover>
    </div>
  );
}

export function VoteTableToolbar({
  state,
}: Readonly<{ state: VoteTableState }>) {
  const active = allFields.some((field) => Boolean(state.params[field]));
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="flex items-center md:hidden">
        <span className="text-caption">Filter</span>
        <TableFilterPopover label="Filter Votes" active={active}>
          <FilterForm state={state} all />
        </TableFilterPopover>
      </div>
      {active ? (
        <Link
          href={voteTableClearFiltersHref(state.params)}
          className="inline-flex min-h-12 items-center font-semibold text-accent underline"
        >
          Clear filters
        </Link>
      ) : null}
    </div>
  );
}
