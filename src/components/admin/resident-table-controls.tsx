// URL-backed Residents sorting and filters in one responsive toolbar.
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
import { ResidentIdentifierFilter } from "./resident-identifier-filter";
import { instantToLocalInput, zonedLocalToInstant } from "@/shared/time/zoned";
import { RESIDENT_SORT_KEYS } from "@/shared/contracts/admin-votes";
import { useHouseholdTerms } from "@/components/ui/household-terms";

type SortKey = (typeof RESIDENT_SORT_KEYS)[number];
type FilterKey = SortKey;
export type ResidentTableState = Readonly<{
  params: Readonly<Record<string, string | undefined>>;
  identifiers: readonly string[];
  sort: SortKey;
  direction: "asc" | "desc";
}>;

const fields: Record<FilterKey, readonly string[]> = {
  representative: ["representative"],
  household: ["identifier"],
  status: ["status"],
  role: ["isAdmin"],
  eligibility: ["isEligible"],
  updated: ["changedFrom", "changedTo"],
  source: ["selfRegistered"],
};
const subscribe = () => () => {};
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;
const filterResetParams = Object.fromEntries(
  Object.values(fields)
    .flat()
    .map((key) => [key, ""]),
);

export function residentTableHref(
  params: ResidentTableState["params"],
  changes: Readonly<Record<string, string>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && !["page", "cursor", "notice"].includes(key))
      search.set(key, value);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value) search.set(key, value);
    else search.delete(key);
  }
  return `/admin/residents?${search}`;
}

export function residentTableClearFiltersHref(
  params: ResidentTableState["params"],
): string {
  return residentTableHref(params, filterResetParams);
}

function FilterForm({
  state,
  column,
  all = false,
}: Readonly<{
  state: ResidentTableState;
  column?: FilterKey;
  all?: boolean;
}>) {
  const id = useId();
  const terms = useHouseholdTerms();
  const router = useRouter();
  const timezone = useSyncExternalStore(subscribe, localZone, serverZone);
  const [error, setError] = useState("");
  const keys = all
    ? Object.values(fields).flat().concat("sort", "direction")
    : column
      ? fields[column]
      : [];
  const includes = (key: FilterKey) => all || column === key;
  const value = (key: string) => state.params[key] ?? "";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const from = form.elements.namedItem("changedFrom");
    const to = form.elements.namedItem("changedTo");
    for (const input of [from, to]) {
      if (
        !(input instanceof HTMLInputElement) ||
        input.type !== "datetime-local" ||
        !input.value
      )
        continue;
      const result = zonedLocalToInstant(input.value, timezone ?? "UTC");
      if (!result.ok) {
        setError("Choose a valid, unambiguous local date and time.");
        return;
      }
      data.set(input.name, result.instant);
    }
    const start = data.get("changedFrom");
    const end = data.get("changedTo");
    if (
      typeof start === "string" &&
      start &&
      typeof end === "string" &&
      end &&
      new Date(start) >= new Date(end)
    ) {
      setError("Changed Before must be after Changed From.");
      return;
    }
    const search = new URLSearchParams();
    data.forEach((value, key) => {
      if (typeof value === "string" && value) search.set(key, value);
    });
    router.push(`/admin/residents?${search}`);
  }
  const common = {
    inline: false,
    showOptional: false,
    hideLabel: !all && column !== "updated",
  };
  return (
    <form
      method="get"
      action="/admin/residents"
      onSubmit={submit}
      className="grid gap-3"
    >
      {Object.entries(state.params)
        .filter(
          ([key, val]) =>
            val !== undefined &&
            !["page", "cursor", "notice", ...keys].includes(key),
        )
        .map(([key, val]) => (
          <input key={key} type="hidden" name={key} value={val} />
        ))}
      {includes("representative") ? (
        <TextField
          {...common}
          id={`${id}-name`}
          name="representative"
          label="Representative"
          defaultValue={value("representative")}
          maxLength={200}
          placeholder="Contains..."
        />
      ) : null}
      {includes("household") ? (
        <ResidentIdentifierFilter
          id={`${id}-identifier`}
          label={terms.identifierLabel}
          hideLabel={!all}
          options={state.identifiers}
          defaultValue={value("identifier")}
        />
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
          <option value="ENABLED">Enabled</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DELETED">Deleted</option>
        </SelectField>
      ) : null}
      {includes("role") ? (
        <SelectField
          menuInFlow
          {...common}
          id={`${id}-role`}
          name="isAdmin"
          label="Role"
          defaultValue={value("isAdmin") || "false"}
        >
          <option value="all">All roles</option>
          <option value="true">RWA Admin</option>
          <option value="readonly">RWA ReadOnly</option>
          <option value="false">Voter</option>
        </SelectField>
      ) : null}
      {includes("eligibility") ? (
        <SelectField
          menuInFlow
          {...common}
          id={`${id}-eligibility`}
          name="isEligible"
          label="Voting Eligibility"
          defaultValue={value("isEligible")}
        >
          <option value="">Any eligibility</option>
          <option value="true">Eligible</option>
          <option value="false">Not eligible</option>
          <option value="unassigned">No {terms.household} assigned</option>
        </SelectField>
      ) : null}
      {includes("source") ? (
        <SelectField
          menuInFlow
          {...common}
          id={`${id}-source`}
          name="selfRegistered"
          label="Source"
          defaultValue={value("selfRegistered")}
        >
          <option value="">Any source</option>
          <option value="true">Self-registered</option>
          <option value="false">Admin-registered</option>
        </SelectField>
      ) : null}
      {includes("updated") ? (
        <>
          <p className="text-caption text-muted">
            Times in {timezone ?? "UTC"}; the end is exclusive.
          </p>
          <TextField
            {...common}
            id={`${id}-from`}
            name="changedFrom"
            label="Changed From"
            type="datetime-local"
            defaultValue={instantToLocalInput(
              value("changedFrom") || null,
              timezone ?? "UTC",
            )}
            key={`from-${timezone}`}
          />
          <TextField
            {...common}
            id={`${id}-to`}
            name="changedTo"
            label="Changed Before"
            type="datetime-local"
            defaultValue={instantToLocalInput(
              value("changedTo") || null,
              timezone ?? "UTC",
            )}
            key={`to-${timezone}`}
          />
        </>
      ) : null}
      {all ? (
        <>
          <SelectField
            menuInFlow
            {...common}
            id={`${id}-sort`}
            name="sort"
            label="Sort By"
            defaultValue={state.sort}
          >
            <option value="representative">Representative</option>
            <option value="household">{terms.Household}</option>
            <option value="status">Status</option>
            <option value="source">Source</option>
            <option value="role">Role</option>
            <option value="eligibility">Voting Eligibility</option>
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
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      <Button type="submit">Apply Filters</Button>
    </form>
  );
}

export function ResidentTableToolbar({
  state,
}: Readonly<{ state: ResidentTableState }>) {
  const active = Object.values(fields)
    .flat()
    .some(
      (key) =>
        Boolean(state.params[key]) &&
        !(key === "isAdmin" && state.params[key] === "all"),
    );
  return (
    <div className="flex shrink-0 items-center gap-1">
      <TableFilterPopover
        label="Sort & Filter"
        active={active}
        icon={<SortFilterIcon />}
      >
        {/* Remount on URL changes (for example Clear filters) so the
            uncontrolled fields never keep and re-apply stale filters. */}
        <FilterForm
          key={JSON.stringify([state.params, state.sort, state.direction])}
          state={state}
          all
        />
      </TableFilterPopover>
      <Link
        href={residentTableClearFiltersHref(state.params)}
        aria-label="Clear filters"
        title="Clear filters"
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-control text-accent hover:bg-accent/10"
      >
        <ClearFiltersIcon />
      </Link>
    </div>
  );
}
