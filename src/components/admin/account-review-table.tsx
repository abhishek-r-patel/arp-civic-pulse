/* Page-scoped review with independent, confirmed account-access and flat-eligibility actions. */
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck, ChevronDown, UserCheck, UserRoundPen } from "lucide-react";
import { formatInstant, formatLocalInstant } from "@/components/admin/format";
import { ManagementFields } from "./management-fields";
import {
  ResidentTableToolbar,
  type ResidentTableState,
} from "./resident-table-controls";
import {
  AccountStatusBadge,
  EligibilityBadge,
  RegistrationSourceBadge,
  RoleBadge,
} from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Notice } from "@/components/ui/notice";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import {
  accountReviewTargets,
  canReviewAccount,
  type AccountReviewAction,
  type ReviewAccountProjection,
} from "@/shared/contracts/register";
import { apiRequest } from "@/shared/http/api-client";

const subscribe = () => () => {};
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverTimezone = () => null;
const RESIDENT_COLUMNS_STORAGE_KEY = "civic-pulse-resident-columns";
const RESIDENT_COLUMNS_EVENT = "civic-pulse:resident-columns";
const STORAGE_UNAVAILABLE = Symbol("storage-unavailable");
const COMPACT_TABLE_QUERY = "(max-width: 1023px)";
const FIXED_RESIDENT_COLUMNS = [
  "select",
  "name",
  "household",
  "status",
  "manage",
];
const OPTIONAL_RESIDENT_COLUMNS = [
  { key: "role", label: "Role" },
  { key: "eligibility", label: "Voting Eligibility" },
  { key: "updated", label: "Last Changed" },
  { key: "source", label: "Source" },
] as const;
type OptionalResidentColumn = (typeof OPTIONAL_RESIDENT_COLUMNS)[number]["key"];

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
  window.addEventListener(RESIDENT_COLUMNS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RESIDENT_COLUMNS_EVENT, onChange);
  };
}

function columnPreferenceSnapshot():
  string | null | typeof STORAGE_UNAVAILABLE {
  try {
    return window.localStorage.getItem(RESIDENT_COLUMNS_STORAGE_KEY);
  } catch {
    return STORAGE_UNAVAILABLE;
  }
}

function isOptionalResidentColumn(
  value: unknown,
): value is OptionalResidentColumn {
  return OPTIONAL_RESIDENT_COLUMNS.some((column) => column.key === value);
}

function isStoredResidentColumn(
  value: unknown,
): value is OptionalResidentColumn | "select" {
  return value === "select" || isOptionalResidentColumn(value);
}

function ResidentColumnChooser({
  selected,
  onToggle,
}: Readonly<{
  selected: ReadonlySet<OptionalResidentColumn>;
  onToggle: (column: OptionalResidentColumn, checked: boolean) => void;
}>) {
  return (
    <details className="relative flex shrink-0 items-center lg:hidden">
      <summary className="inline-flex min-h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-control border border-control-border bg-surface px-4 py-3 font-semibold text-primary hover:bg-primary/5 [&::-webkit-details-marker]:hidden">
        Columns
        <ChevronDown aria-hidden="true" className="size-4" />
      </summary>
      <fieldset className="absolute right-0 z-30 mt-2 grid max-h-[70dvh] w-64 max-w-[calc(100vw-2rem)] gap-1 overflow-y-auto rounded-card border border-border bg-surface p-3 text-primary shadow-panel">
        <legend className="px-1 pb-1 font-semibold">Show columns</legend>
        {OPTIONAL_RESIDENT_COLUMNS.map((column) => (
          <label
            key={column.key}
            className="inline-flex min-h-12 cursor-pointer items-center gap-3 px-2"
          >
            <input
              type="checkbox"
              className="size-5 accent-accent"
              checked={selected.has(column.key)}
              onChange={(event) => onToggle(column.key, event.target.checked)}
            />
            {column.label}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

export function AccountReviewTable({
  accounts: initial,
  csrfToken,
  tableState,
  canManage,
}: Readonly<{
  accounts: ReviewAccountProjection[];
  csrfToken: string | undefined;
  tableState: ResidentTableState;
  canManage: boolean;
}>) {
  const terms = useHouseholdTerms();
  const timezone = useSyncExternalStore(
    subscribe,
    browserTimezone,
    serverTimezone,
  );
  const compactTable = useSyncExternalStore(
    subscribeToCompactTable,
    compactTableSnapshot,
    () => false,
  );
  const savedColumnPreference = useSyncExternalStore(
    subscribeToColumnPreference,
    columnPreferenceSnapshot,
    () => null,
  );
  const router = useRouter();
  const [accounts, setAccounts] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [temporaryColumns, setTemporaryColumns] =
    useState<ReadonlySet<OptionalResidentColumn> | null>(null);
  const [columnWriteError, setColumnWriteError] = useState<string | null>(null);
  const parsedColumnPreference = useMemo(() => {
    if (savedColumnPreference === STORAGE_UNAVAILABLE)
      return {
        columns: new Set<OptionalResidentColumn>(),
        error:
          "Saved column choices could not be loaded. Current defaults are shown; changes may not be remembered on this device.",
      };
    if (savedColumnPreference === null)
      return { columns: new Set<OptionalResidentColumn>(), error: null };
    let parsed: unknown;
    try {
      parsed = JSON.parse(savedColumnPreference);
    } catch {
      return {
        columns: new Set<OptionalResidentColumn>(),
        error:
          "Saved column choices are invalid. Default columns are shown; choose columns to replace the saved preference.",
      };
    }
    if (!Array.isArray(parsed) || !parsed.every(isStoredResidentColumn)) {
      return {
        columns: new Set<OptionalResidentColumn>(),
        error:
          "Saved column choices are invalid. Default columns are shown; choose columns to replace the saved preference.",
      };
    }
    return {
      columns: new Set<OptionalResidentColumn>(
        parsed.filter(isOptionalResidentColumn),
      ),
      error: null,
    };
  }, [savedColumnPreference]);
  const optionalColumns = temporaryColumns ?? parsedColumnPreference.columns;
  const columnPreferenceError =
    columnWriteError ?? parsedColumnPreference.error;
  const [action, setAction] = useState<AccountReviewAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [completed, setCompleted] = useState(0);
  const mounted = useRef(true);
  const selectPage = useRef<HTMLInputElement>(null);
  const version = initial
    .map(
      (account) =>
        `${account.id}:${account.updatedAt}:${account.household?.id}:${account.household?.isEligible}`,
    )
    .join("|");
  const [seenVersion, setSeenVersion] = useState(version);
  if (seenVersion !== version) {
    setSeenVersion(version);
    setAccounts(initial);
    setSelected(
      (current) =>
        new Set(
          initial
            .filter(
              (account) =>
                current.has(account.id) &&
                (canReviewAccount(account, "enable") ||
                  canReviewAccount(account, "eligible")),
            )
            .map((account) => account.id),
        ),
    );
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectable = accounts.filter(
    (account) =>
      canReviewAccount(account, "enable") ||
      canReviewAccount(account, "eligible"),
  );
  const allSelected =
    selectable.length > 0 &&
    selectable.every((account) => selected.has(account.id));
  useEffect(() => {
    if (selectPage.current)
      selectPage.current.indeterminate = selected.size > 0 && !allSelected;
  }, [selected.size, allSelected]);
  const enable = accountReviewTargets(accounts, selected, "enable");
  const eligible = accountReviewTargets(accounts, selected, "eligible");
  const targets = action === "enable" ? enable : eligible;

  function toggleOptionalColumn(
    column: OptionalResidentColumn,
    checked: boolean,
  ) {
    const next = new Set(optionalColumns);
    if (checked) next.add(column);
    else next.delete(column);
    try {
      window.localStorage.setItem(
        RESIDENT_COLUMNS_STORAGE_KEY,
        JSON.stringify([...next]),
      );
      setTemporaryColumns(null);
      setColumnWriteError(null);
      window.dispatchEvent(new Event(RESIDENT_COLUMNS_EVENT));
    } catch {
      setTemporaryColumns(next);
      setColumnWriteError(
        "Column choices changed for this visit, but the browser could not save them on this device.",
      );
    }
  }

  async function run() {
    if (!action || busy) return;
    const operation = action;
    const pending = [...targets];
    setBusy(true);
    setProblem(null);
    setOutcomes([]);
    setCompleted(0);
    for (const account of pending) {
      if (!mounted.current) return;
      const path =
        operation === "enable"
          ? `/api/admin/accounts/${account.id}`
          : `/api/admin/households/${account.household?.id}`;
      const result = await apiRequest(path, {
        method: "PATCH",
        csrfToken,
        body:
          operation === "enable" ? { status: "ENABLED" } : { isEligible: true },
      });
      if (!mounted.current) return;
      if (!result.ok) {
        setProblem(
          `${account.representativeName}: ${result.message} Processing stopped; this account may be partly or fully updated. Completed rows are not rolled back. Refresh and review before retrying. ${result.requestId ? `Error ID: ${result.requestId}` : `Error code: ${result.code}`}.`,
        );
        break;
      }
      setAccounts((rows) =>
        rows.map((row) =>
          row.id !== account.id
            ? row
            : operation === "enable"
              ? { ...row, status: "ENABLED" }
              : {
                  ...row,
                  household: row.household
                    ? { ...row.household, isEligible: true }
                    : null,
                },
        ),
      );
      setCompleted((count) => count + 1);
      setOutcomes((rows) => [
        ...rows,
        `${account.representativeName}: ${operation === "enable" ? "Account enabled" : `${terms.Household} eligible for future votes`}.`,
      ]);
    }
    setBusy(false);
    setAction(null);
    setSelected(new Set());
    router.refresh();
  }

  const columns: Column<ReviewAccountProjection>[] = [
    {
      key: "select",
      header: "Select",
      cell: (account) => (
        <label className="inline-flex touch-target items-center gap-2">
          <input
            type="checkbox"
            aria-label={`Select ${account.representativeName}`}
            className="size-5 accent-accent"
            checked={selected.has(account.id)}
            disabled={
              !canManage ||
              busy ||
              (!canReviewAccount(account, "enable") &&
                !canReviewAccount(account, "eligible"))
            }
            onChange={(event) => {
              const checked = event.target.checked;
              setSelected((current) => {
                const next = new Set(current);
                if (checked) next.add(account.id);
                else next.delete(account.id);
                return next;
              });
            }}
          />
          <span className="sr-only">{account.representativeName}</span>
        </label>
      ),
    },
    {
      key: "name",
      header: "Representative",
      cell: (account) => (
        <span className="grid gap-1">
          <span className="font-semibold">{account.representativeName}</span>
          <span className="text-caption break-all text-muted">
            {account.email ?? "Email unavailable"}
            {account.email && !account.emailVerifiedAt ? " - not verified" : ""}
          </span>
        </span>
      ),
    },
    {
      key: "household",
      header: terms.Household,
      cell: (account) =>
        account.household?.identifier ??
        (account.isAppSupport
          ? "Not applicable (App Support)"
          : account.isAdmin || account.isReadonly
            ? "Not assigned"
            : "Assignment required before enabling"),
    },
    {
      key: "status",
      header: "Status",
      cell: (account) => (
        <AccountStatusBadge status={account.status} iconOnly />
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (account) => (
        <RoleBadge
          isAdmin={account.isAdmin}
          isReadonly={account.isReadonly}
          isAppSupport={account.isAppSupport}
        />
      ),
    },
    {
      key: "eligibility",
      header: "Voting Eligibility",
      cell: (account) =>
        account.household ? (
          <EligibilityBadge eligible={account.household.isEligible} />
        ) : (
          "Not assigned"
        ),
    },
    {
      key: "updated",
      header: "Last Changed",
      cell: (account) => (
        <time
          dateTime={account.updatedAt}
          title={
            timezone
              ? `Your time zone: ${timezone}`
              : "UTC (before local display loads)"
          }
        >
          {timezone
            ? formatLocalInstant(account.updatedAt, timezone)
            : formatInstant(account.updatedAt)}
        </time>
      ),
    },
    {
      key: "source",
      header: "Source",
      cell: (account) => (
        <RegistrationSourceBadge
          selfRegistered={account.selfRegistered === true}
        />
      ),
    },
    {
      key: "manage",
      header: "Actions",
      cell: (account) => (
        <Link
          href={`/admin/residents/${account.id}`}
          aria-label={`Manage ${account.representativeName}`}
          title={`Manage ${account.representativeName}`}
          className="inline-flex size-12 items-center justify-center rounded-control text-accent hover:bg-accent/10"
        >
          <UserRoundPen aria-hidden="true" className="size-5" />
        </Link>
      ),
    },
  ];
  const sortKeys: Readonly<Record<string, ResidentTableState["sort"]>> = {
    name: "representative",
    household: "household",
    status: "status",
    source: "source",
    role: "role",
    eligibility: "eligibility",
    updated: "updated",
  };
  const visibleColumns = compactTable
    ? columns.filter(
        (column) =>
          FIXED_RESIDENT_COLUMNS.includes(column.key) ||
          (isOptionalResidentColumn(column.key) &&
            optionalColumns.has(column.key)),
      )
    : columns;
  const tableColumns = visibleColumns.map(
    (column): Column<ReviewAccountProjection> => {
      const key = sortKeys[column.key];
      if (!key) return column;
      return {
        ...column,
        sortDirection:
          tableState.sort === key
            ? tableState.direction === "asc"
              ? "ascending"
              : "descending"
            : undefined,
      };
    },
  );
  return (
    <div data-account-review className="grid gap-5">
      <div
        data-resident-toolbar
        className="grid gap-3 border-b border-border pb-5"
      >
        {/* Wraps only when enlarged text would squeeze the scrolling controls
            below 8rem; the Columns menu then drops to its own line. The
            scroller is positioned so absolutely positioned descendants
            (screen-reader text, icon layers) are clipped with it instead of
            widening the page. */}
        <div
          role="group"
          aria-label="Resident selection and display controls"
          className="flex min-w-0 flex-wrap items-center gap-1"
        >
          <div
            tabIndex={0}
            className="relative flex min-w-0 flex-[1_1_8rem] flex-nowrap items-center gap-1 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <div className="shrink-0">
              <ManagementFields canManage={canManage}>
                <div className="flex items-center gap-3">
                  <label className="inline-flex touch-target items-center gap-2">
                    <input
                      ref={selectPage}
                      type="checkbox"
                      className="size-5 accent-accent"
                      checked={allSelected}
                      disabled={busy || !selectable.length}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? new Set(selectable.map((account) => account.id))
                            : new Set(),
                        )
                      }
                    />
                    Select All
                  </label>
                  <span
                    role="status"
                    className="font-semibold text-accent tabular-nums"
                  >
                    {selected.size} selected
                    {busy ? `; ${completed} completed` : ""}
                  </span>
                </div>
              </ManagementFields>
            </div>
            <ResidentTableToolbar state={tableState} />
            <div className="shrink-0">
              <ManagementFields canManage={canManage}>
                <div className="flex flex-nowrap items-center gap-2">
                  <Button
                    className="w-auto gap-1.5 px-3 py-2 text-caption whitespace-nowrap"
                    disabled={busy || !enable.length}
                    onClick={() => setAction("enable")}
                  >
                    <UserCheck aria-hidden="true" className="size-4" />
                    Enable Selected ({enable.length})
                  </Button>
                  <Button
                    className="w-auto gap-1.5 px-3 py-2 text-caption whitespace-nowrap"
                    variant="secondary"
                    disabled={busy || !eligible.length}
                    onClick={() => setAction("eligible")}
                  >
                    <CheckCheck aria-hidden="true" className="size-4" />
                    Make Eligible ({eligible.length})
                  </Button>
                </div>
              </ManagementFields>
            </div>
          </div>
          {compactTable ? (
            <ResidentColumnChooser
              selected={optionalColumns}
              onToggle={toggleOptionalColumn}
            />
          ) : null}
        </div>
      </div>
      {problem ? (
        <Notice tone="error" heading="Review before retrying">
          <p>{problem}</p>
        </Notice>
      ) : null}
      {outcomes.length ? (
        <Notice tone="success" heading={`${outcomes.length} completed`}>
          <ul className="list-disc pl-5">
            {outcomes.map((outcome, index) => (
              <li key={index}>{outcome}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {columnPreferenceError ? (
        <Notice tone="warning" heading="Column preferences">
          <p>{columnPreferenceError}</p>
        </Notice>
      ) : null}
      <DataTable
        caption="Account access and voting eligibility review"
        columns={tableColumns}
        rows={accounts}
        rowKey={(account) => account.id}
        stackOnMobile={false}
      />
      <ConfirmDialog
        open={action !== null}
        title={
          action === "enable"
            ? "Enable selected accounts?"
            : `Make selected ${terms.households} eligible?`
        }
        confirmLabel={action === "enable" ? "Enable Selected" : "Make Eligible"}
        busy={busy}
        onCancel={() => setAction(null)}
        onConfirm={() => void run()}
      >
        <p>
          {action === "enable"
            ? "This allows the listed accounts to sign in. It does not change voting eligibility or frozen electorates."
            : `This marks the listed ${terms.households} eligible for future votes. It does not enable accounts or add anyone to an existing scheduled or active vote.`}
        </p>
        {action === "enable" && targets.some((account) => account.isAdmin) ? (
          <Notice tone="warning" heading="Administrator access">
            <p>
              This selection includes administrators. Enabling them restores
              management access.
            </p>
          </Notice>
        ) : null}
        <ul className="max-h-60 overflow-y-auto">
          {targets.map((account) => (
            <li
              key={account.id}
              className="grid gap-1 border-b border-border py-2"
            >
              <span className="font-semibold">
                {account.representativeName}
              </span>
              <span className="text-caption break-all text-muted">
                {account.email ?? "Email unavailable"}
              </span>
              <span>
                {account.household?.identifier ?? "No assignment"}
                {account.isAdmin ? " - Administrator" : ""}
              </span>
            </li>
          ))}
        </ul>
        <p>
          {targets.length} changes, committed separately. A failure stops
          subsequent rows without undoing completed changes.
        </p>
      </ConfirmDialog>
    </div>
  );
}
