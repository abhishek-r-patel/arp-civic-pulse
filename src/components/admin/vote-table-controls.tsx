// URL-backed sorting and filters for the administrator vote inventory.
"use client";

import { useId, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import {
  ClearFiltersIcon,
  SortFilterIcon,
  TableFilterPopover,
} from "@/components/ui/table-filter-popover";
import {
  VOTE_STATUSES,
  VOTE_STATUS_LABELS,
  VOTING_TYPES,
  VOTING_TYPE_LABELS,
} from "@/shared/contracts/voting";
import { instantToLocalInput, zonedLocalToInstant } from "@/shared/time/zoned";
import { VOTE_TABLE_SORT_KEYS } from "@/shared/contracts/admin-votes";
import {
  VOTE_FILTER_FIELDS as allFields,
  voteTableClearFiltersHref,
  type VoteFilterField,
} from "@/components/admin/vote-table-urls";

type VoteSortKey = (typeof VOTE_TABLE_SORT_KEYS)[number];
export type VoteTableState = Readonly<{
  params: Readonly<Record<string, string | undefined>>;
  sort: VoteSortKey;
  direction: "asc" | "desc";
}>;

const subscribe = () => () => {};
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;

function FilterForm({ state }: Readonly<{ state: VoteTableState }>) {
  const id = useId();
  const router = useRouter();
  const timezone = useSyncExternalStore(subscribe, localZone, serverZone);
  const [error, setError] = useState("");
  const keys = [...allFields, "sort", "direction"];
  const includes = (key: VoteFilterField) => allFields.includes(key);
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
    hideLabel: false,
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
      <SelectField
        menuInFlow
        {...common}
        id={`${id}-sort`}
        name="sort"
        label="Sort By"
        defaultValue={state.sort}
      >
        <option value="title">Vote</option>
        <option value="type">Type</option>
        <option value="status">Status</option>
        <option value="deadline">Deadline</option>
        <option value="updated">Last Changed</option>
      </SelectField>
      <SelectField
        menuInFlow
        {...common}
        id={`${id}-direction`}
        name="direction"
        label="Sort Direction"
        defaultValue={state.direction}
      >
        <option value="asc">Ascending</option>
        <option value="desc">Descending</option>
      </SelectField>
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      <Button type="submit">Apply Filters</Button>
    </form>
  );
}

export function VoteTableToolbar({
  state,
}: Readonly<{ state: VoteTableState }>) {
  const active = allFields.some((field) => Boolean(state.params[field]));
  return (
    <div className="flex min-w-0 items-center justify-end gap-1">
      <TableFilterPopover
        label="Sort & Filter"
        active={active}
        icon={<SortFilterIcon />}
      >
        <FilterForm state={state} />
      </TableFilterPopover>
      <Link
        href={voteTableClearFiltersHref(state.params)}
        aria-label="Clear filters"
        title="Clear filters"
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-control text-accent hover:bg-accent/10"
      >
        <ClearFiltersIcon />
      </Link>
    </div>
  );
}
