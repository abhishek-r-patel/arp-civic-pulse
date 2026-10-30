// URL-backed audit filters using the shared responsive table popover.
"use client";

import {
  createContext,
  useContext,
  useId,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatInstant, formatLocalInstant } from "@/components/admin/format";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { TableFilterPopover } from "@/components/ui/table-filter-popover";
import { instantToLocalInput, zonedLocalToInstant } from "@/shared/time/zoned";

const subscribe = () => () => {};
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverTimezone = () => null;
const AuditDisplaySettingsContext = createContext<{
  targetIdsVisible: boolean;
  setTargetIdsVisible: (visible: boolean) => void;
  effectiveTimesVisible: boolean;
  setEffectiveTimesVisible: (visible: boolean) => void;
  processedTimesVisible: boolean;
  setProcessedTimesVisible: (visible: boolean) => void;
} | null>(null);

function useAuditDisplaySettings() {
  const context = useContext(AuditDisplaySettingsContext);
  if (!context) {
    throw new Error(
      "Audit display controls must be rendered inside their provider.",
    );
  }
  return context;
}

export function AuditTargetIdProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [targetIdsVisible, setTargetIdsVisible] = useState(false);
  const [effectiveTimesVisible, setEffectiveTimesVisible] = useState(false);
  const [processedTimesVisible, setProcessedTimesVisible] = useState(false);
  return (
    <AuditDisplaySettingsContext.Provider
      value={{
        targetIdsVisible,
        setTargetIdsVisible,
        effectiveTimesVisible,
        setEffectiveTimesVisible,
        processedTimesVisible,
        setProcessedTimesVisible,
      }}
    >
      {children}
    </AuditDisplaySettingsContext.Provider>
  );
}

export function AuditTargetId({ value }: Readonly<{ value: string }>) {
  const { targetIdsVisible } = useAuditDisplaySettings();
  return targetIdsVisible ? (
    <span className="block text-caption break-all text-muted">{value}</span>
  ) : null;
}

export function AuditDetailTime({
  kind,
  children,
}: Readonly<{ kind: "effective" | "processed"; children: ReactNode }>) {
  const { effectiveTimesVisible, processedTimesVisible } =
    useAuditDisplaySettings();
  const visible =
    kind === "effective" ? effectiveTimesVisible : processedTimesVisible;
  return visible ? children : null;
}

type AuditFilterField =
  "action" | "targetType" | "from" | "to" | "who" | "details";
type AuditFilterColumn = "when" | "who" | "action" | "target" | "details";
type AuditTableParams = Readonly<
  Record<"limit" | AuditFilterField, string | undefined>
>;
type AuditFilterOption = Readonly<{ value: string; label: string }>;

export type AuditTableState = Readonly<{
  params: AuditTableParams;
  actions: readonly AuditFilterOption[];
  targetTypes: readonly AuditFilterOption[];
}>;

const fields: Record<AuditFilterColumn, readonly AuditFilterField[]> = {
  when: ["from", "to"],
  who: ["who"],
  action: ["action"],
  target: ["targetType"],
  details: ["details"],
};
const allFields: readonly AuditFilterField[] = [
  "action",
  "targetType",
  "from",
  "to",
  "who",
  "details",
];

export function auditTableClearFiltersHref(params: AuditTableParams): string {
  const search = new URLSearchParams();
  if (params.limit) search.set("limit", params.limit);
  return `/admin/audit?${search}`;
}

function AuditFilterForm({
  state,
  column,
  all = false,
}: Readonly<{
  state: AuditTableState;
  column?: AuditFilterColumn;
  all?: boolean;
}>) {
  const id = useId();
  const router = useRouter();
  const timezone = useSyncExternalStore(
    subscribe,
    browserTimezone,
    serverTimezone,
  );
  const [error, setError] = useState("");
  const included = new Set(all ? allFields : column ? fields[column] : []);
  const includes = (field: AuditFilterField) => included.has(field);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);

    for (const field of ["from", "to"] as const) {
      const input = form.elements.namedItem(field);
      if (
        !(input instanceof HTMLInputElement) ||
        input.type !== "datetime-local" ||
        !input.value
      ) {
        continue;
      }
      const converted = zonedLocalToInstant(input.value, timezone ?? "UTC");
      if (!converted.ok) {
        setError(
          "Enter a valid, unambiguous date and time in your local time zone.",
        );
        return;
      }
      data.set(field, converted.instant);
    }

    const from = data.get("from");
    const to = data.get("to");
    if (
      typeof from === "string" &&
      from &&
      typeof to === "string" &&
      to &&
      Date.parse(from) >= Date.parse(to)
    ) {
      setError("Before must be later than From.");
      return;
    }

    const search = new URLSearchParams();
    data.forEach((value, key) => {
      if (typeof value === "string" && value) search.set(key, value);
    });
    router.push(`/admin/audit?${search}`);
  }

  return (
    <form
      method="get"
      action="/admin/audit"
      onSubmit={submit}
      className="grid gap-3"
    >
      <input type="hidden" name="limit" value={state.params.limit ?? "25"} />
      {allFields
        .filter((field) => !includes(field) && state.params[field])
        .map((field) => (
          <input
            key={field}
            type="hidden"
            name={field}
            value={state.params[field]}
          />
        ))}
      {includes("action") ? (
        <SelectField
          menuInFlow
          inline={false}
          showOptional={false}
          hideLabel={!all}
          id={`${id}-action`}
          name="action"
          label="Action"
          defaultValue={state.params.action ?? ""}
        >
          <option value="">Any action</option>
          {state.actions.map((action) => (
            <option key={action.value} value={action.value}>
              {action.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      {includes("targetType") ? (
        <SelectField
          menuInFlow
          inline={false}
          showOptional={false}
          hideLabel={!all}
          id={`${id}-target`}
          name="targetType"
          label="Target"
          defaultValue={state.params.targetType ?? ""}
        >
          <option value="">Any target</option>
          {state.targetTypes.map((target) => (
            <option key={target.value} value={target.value}>
              {target.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      {(["who", "details"] as const).filter(includes).map((field) => {
        const label = field === "who" ? "Who" : "Details";
        return (
          <TextField
            key={field}
            inline={false}
            showOptional={false}
            hideLabel={!all}
            id={`${id}-${field}`}
            name={field}
            label={label}
            maxLength={100}
            placeholder={
              field === "details"
                ? "Contains reason or detail..."
                : "Contains..."
            }
            defaultValue={state.params[field] ?? ""}
          />
        );
      })}
      {includes("from") || includes("to") ? (
        <>
          <p className="text-caption text-muted">
            Times use your browser&apos;s time zone
            {timezone ? ` (${timezone})` : " (UTC until local time loads)"}.
            Before is exclusive.
          </p>
          {includes("from") ? (
            <TextField
              inline={false}
              showOptional={false}
              id={`${id}-from`}
              key={`${id}-from-${timezone ?? "server"}`}
              name="from"
              label="From (local time)"
              type="datetime-local"
              defaultValue={instantToLocalInput(
                state.params.from ?? null,
                timezone ?? "UTC",
              )}
            />
          ) : null}
          {includes("to") ? (
            <TextField
              inline={false}
              showOptional={false}
              id={`${id}-to`}
              key={`${id}-to-${timezone ?? "server"}`}
              name="to"
              label="Before (local time)"
              type="datetime-local"
              defaultValue={instantToLocalInput(
                state.params.to ?? null,
                timezone ?? "UTC",
              )}
            />
          ) : null}
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

export function AuditTimestamp({ value }: Readonly<{ value: string }>) {
  const timezone = useSyncExternalStore(
    subscribe,
    browserTimezone,
    serverTimezone,
  );
  return (
    <time
      dateTime={value}
      title={
        timezone
          ? `Your time zone: ${timezone}`
          : "UTC (before local display loads)"
      }
    >
      {timezone ? formatLocalInstant(value, timezone) : formatInstant(value)}
    </time>
  );
}

export function AuditColumnFilter({
  state,
  column,
  title,
}: Readonly<{
  state: AuditTableState;
  column: AuditFilterColumn;
  title: string;
}>) {
  const active = fields[column].some((field) => Boolean(state.params[field]));
  return (
    <div className="flex items-center">
      <span className="inline-flex min-h-12 items-center whitespace-nowrap">
        {title}
      </span>
      <TableFilterPopover label={`Filter ${title}`} active={active}>
        <AuditFilterForm
          key={JSON.stringify(state.params)}
          state={state}
          column={column}
        />
      </TableFilterPopover>
    </div>
  );
}

export function AuditTableToolbar({
  state,
}: Readonly<{ state: AuditTableState }>) {
  const {
    targetIdsVisible,
    setTargetIdsVisible,
    effectiveTimesVisible,
    setEffectiveTimesVisible,
    processedTimesVisible,
    setProcessedTimesVisible,
  } = useAuditDisplaySettings();
  const active = allFields.some((field) => Boolean(state.params[field]));
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <label className="flex min-h-12 cursor-pointer items-center gap-2 text-caption text-primary">
        <input
          type="checkbox"
          checked={targetIdsVisible}
          onChange={(event) => setTargetIdsVisible(event.currentTarget.checked)}
          className="size-4 accent-accent"
        />
        Show Target IDs
      </label>
      <label className="flex min-h-12 cursor-pointer items-center gap-2 text-caption text-primary">
        <input
          type="checkbox"
          checked={effectiveTimesVisible}
          onChange={(event) =>
            setEffectiveTimesVisible(event.currentTarget.checked)
          }
          className="size-4 accent-accent"
        />
        Show Effective Time
      </label>
      <label className="flex min-h-12 cursor-pointer items-center gap-2 text-caption text-primary">
        <input
          type="checkbox"
          checked={processedTimesVisible}
          onChange={(event) =>
            setProcessedTimesVisible(event.currentTarget.checked)
          }
          className="size-4 accent-accent"
        />
        Show Processed Time
      </label>
      <div className="flex items-center md:hidden">
        <span className="text-caption">Filter</span>
        <TableFilterPopover label="Filter Audit History" active={active}>
          {/* Remount on URL changes (for example Clear filters) so the
              uncontrolled fields never keep and re-apply stale filters. */}
          <AuditFilterForm
            key={JSON.stringify(state.params)}
            state={state}
            all
          />
        </TableFilterPopover>
      </div>
      {active ? (
        <Link
          href={auditTableClearFiltersHref(state.params)}
          className="inline-flex touch-target items-center font-semibold text-accent underline"
        >
          Clear filters
        </Link>
      ) : null}
    </div>
  );
}
