// Protected administrative audit history with server-side filters.
import { ChevronDown } from "lucide-react";
import { firstValues } from "@/components/admin/format";
import {
  AuditColumnFilter,
  AuditDetailTime,
  AuditTargetId,
  AuditTargetIdProvider,
  AuditTimestamp,
  AuditTableToolbar,
  type AuditTableState,
} from "@/components/admin/audit-table-controls";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/server/http/errors";
import { readPageNumber } from "@/server/http/numbered-page";
import { adminPageContext } from "@/server/register/page-context";
import { listAuditEvents } from "@/server/votes/monitoring";
import { auditQuerySchema } from "@/shared/contracts/admin-votes";
import type { HouseholdTerms } from "@/shared/contracts/household-terms";
import type { AuditEvent } from "@/shared/contracts/member-votes";

export const metadata = {
  title: "Audit History",
  description:
    "Review authorised administrative changes and voting lifecycle audit events.",
  alternates: { canonical: "/admin/audit" },
};

const ACTIONS = [
  "BOOTSTRAP_ADMIN",
  "SETTINGS_INITIALIZED",
  "POLICY_APPROVAL_RECORDED",
  "RETENTION_UPDATED",
  "RWA_IDENTIFIER_LABEL_UPDATED",
  "RWA_PROFILE_UPDATED",
  "PROFILE_PROVISIONED",
  "PROFILE_SELF_REGISTERED",
  "PROFILE_UPDATED",
  "PROFILE_STATUS_CHANGED",
  "PROFILE_ROLE_CHANGED",
  "APP_SUPPORT_ACCESS_ENABLED",
  "APP_SUPPORT_ACCESS_DISABLED",
  "HOUSEHOLD_CREATED",
  "HOUSEHOLD_UPDATED",
  "DRAFT_CREATED",
  "DRAFT_UPDATED",
  "DRAFT_DELETED",
  "VOTE_ACTIVATED",
  "VOTE_COMPLETED",
  "VOTE_CANCELLED",
  "VOTE_DEADLINE_CHANGED",
  "RETENTION_DELETED",
] as const;
const TARGET_TYPES = [
  "VOTE",
  "HOUSEHOLD",
  "PROFILE",
  "SETTINGS",
  "RETENTION",
] as const;

const label = (value: string, terms: HouseholdTerms) => {
  if (value === "HOUSEHOLD") {
    return terms.Household;
  }
  if (value.startsWith("HOUSEHOLD_")) {
    return `${terms.Household} ${value.slice("HOUSEHOLD_".length).toLowerCase().replace(/_/gu, " ")}`;
  }
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/gu, " ");
};

// Audit history is append-only, so events recorded before the rename still
// store the old voting-type codes; show them with the current names.
const LEGACY_VOTING_TYPES: Record<string, string> = {
  OPEN: "PUBLIC",
  CLOSED: "PRIVATE",
};

function detailLabel(key: string, terms: HouseholdTerms): string {
  if (key === "reason") {
    return "Reason";
  }
  if (key === "effectiveAt") {
    return "Effective time";
  }
  if (key === "processedAt") {
    return "Processed time";
  }
  if (key === "householdIdentifier") {
    return terms.identifierLabel;
  }
  if (key.startsWith("household")) {
    const suffix = key
      .slice("household".length)
      .replace(/([a-z])([A-Z])/gu, "$1 $2");
    return `${terms.Household} ${suffix}`.trim();
  }
  return key;
}

function detailValue(key: string, value: unknown) {
  if (typeof value !== "string") {
    return JSON.stringify(value);
  }
  if (
    (key === "effectiveAt" || key === "processedAt") &&
    Number.isFinite(Date.parse(value))
  ) {
    return <AuditTimestamp value={value} />;
  }
  return key === "votingType" ? (LEGACY_VOTING_TYPES[value] ?? value) : value;
}

function Details({
  reason,
  details,
  terms,
}: Readonly<{
  reason: string | null;
  details: AuditEvent["details"];
  terms: HouseholdTerms;
}>) {
  const entries: [string, unknown][] = [
    ...(reason ? [["reason", reason] as [string, unknown]] : []),
    ...Object.entries(details),
  ];
  if (entries.length === 0) {
    return <span className="text-muted">—</span>;
  }
  return (
    <dl className="grid gap-0.5 text-caption">
      {entries.map(([key, value]) => {
        // Each group must be a direct <div> child of the <dl>; an extra
        // wrapper breaks the definition-list structure for assistive tech.
        const entry = (
          <div key={key} className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-muted">
              {detailLabel(key, terms)}:
            </dt>
            <dd className="min-w-0 break-words">{detailValue(key, value)}</dd>
          </div>
        );
        const timeKind =
          key === "effectiveAt"
            ? "effective"
            : key === "processedAt"
              ? "processed"
              : null;
        return timeKind ? (
          <AuditDetailTime key={key} kind={timeKind}>
            {entry}
          </AuditDetailTime>
        ) : (
          entry
        );
      })}
    </dl>
  );
}

const columns = (
  terms: HouseholdTerms,
  state: AuditTableState,
): Column<AuditEvent>[] => [
  {
    key: "when",
    header: "When",
    headerContent: (
      <AuditColumnFilter state={state} column="when" title="When" />
    ),
    cell: (event) => <AuditTimestamp value={event.occurredAt} />,
  },
  {
    key: "actor",
    header: "Who",
    headerContent: <AuditColumnFilter state={state} column="who" title="Who" />,
    cell: (event) =>
      event.actorKind === "PROFILE"
        ? (event.actorName ?? "Former account")
        : label(event.actorKind, terms),
  },
  {
    key: "target",
    header: "Target",
    headerContent: (
      <AuditColumnFilter state={state} column="target" title="Target" />
    ),
    cell: (event) => (
      <span>
        {label(event.targetType, terms)}
        <AuditTargetId value={event.targetId} />
      </span>
    ),
  },
  {
    key: "action",
    header: "Action",
    headerContent: (
      <AuditColumnFilter state={state} column="action" title="Action" />
    ),
    cell: (event) => label(event.action, terms),
  },
  {
    key: "details",
    header: "Details",
    headerContent: (
      <AuditColumnFilter state={state} column="details" title="Details" />
    ),
    cell: (event) => (
      <Details reason={event.reason} details={event.details} terms={terms} />
    ),
  },
];

export default async function AuditPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const deps = await adminPageContext();
  const raw = firstValues(await searchParams);

  const parsed = auditQuerySchema.safeParse({
    limit: raw.limit,
    cursor: raw.cursor,
    action: raw.action,
    targetType: raw.targetType,
    from: raw.from,
    to: raw.to,
    who: raw.who,
    details: raw.details ?? raw.reason,
  });
  const query = parsed.success ? parsed.data : auditQuerySchema.parse({});

  let result: Awaited<ReturnType<typeof listAuditEvents>> | null = null;
  let loadError: ApiError | null = null;
  try {
    result = await listAuditEvents(deps, query, readPageNumber(raw.page));
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    loadError = error;
  }

  const filtersActive =
    query.action !== undefined ||
    query.targetType !== undefined ||
    query.from !== undefined ||
    query.to !== undefined ||
    query.who !== undefined ||
    query.details !== undefined;
  const tableState: AuditTableState = {
    params: {
      limit: String(query.limit),
      action: query.action,
      targetType: query.targetType,
      from: query.from,
      to: query.to,
      who: query.who,
      details: query.details,
    },
    actions: ACTIONS.map((action) => ({
      value: action,
      label: label(action, deps.terms),
    })),
    targetTypes: TARGET_TYPES.map((targetType) => ({
      value: targetType,
      label: label(targetType, deps.terms),
    })),
  };

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Audit History"
        description="A permanent record of administrative actions, newest first. It never contains sign-in codes, ballots or selections. Times use your browser's local time zone."
      />
      <details className="group rounded-control border border-accent/30 bg-accent/5">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-control px-4 py-3 text-body font-semibold text-primary hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          <span>About this history</span>
          <ChevronDown
            aria-hidden="true"
            className="size-5 shrink-0 text-accent transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="grid gap-2 px-4 pb-4 text-body text-primary">
          <p>
            <span className="font-semibold">Reasons:</span> Some actions require
            a reason, which appears in Details. Other actions have no reason.
          </p>
          <p>
            <span className="font-semibold">Effective time:</span> when an event
            takes effect. <span className="font-semibold">Processed time:</span>{" "}
            when the system handled or reconciled it. Both are hidden by
            default; use <strong>Show Effective Time</strong> or{" "}
            <strong>Show Processed Time</strong> above the list independently
            when needed.
          </p>
          <p>
            <span className="font-semibold">Target ID:</span> the unique record
            identifier, useful for tracing or support; it is not a code or
            secret. IDs are hidden by default; use{" "}
            <strong>Show Target IDs</strong> above the list when needed.
          </p>
        </div>
      </details>

      {!parsed.success ? (
        <Notice tone="warning" heading="Some filters were not valid">
          They were ignored. Choose filters below to try again.
        </Notice>
      ) : null}

      <AuditTargetIdProvider>
        <AuditTableToolbar state={tableState} />

        {loadError ? (
          <Notice tone="error" heading="The audit history could not be loaded">
            <p>
              Try again in a moment. If this keeps happening, quote this
              reference to support: {loadError.code}.
            </p>
          </Notice>
        ) : result && result.data.length === 0 ? (
          <EmptyState
            title={
              filtersActive ? "No events match these filters" : "No events yet"
            }
          >
            <p>
              {filtersActive
                ? "Try different filter criteria."
                : "Administrative actions will appear here as they happen."}
            </p>
          </EmptyState>
        ) : result ? (
          <>
            <DataTable
              caption="Audit events"
              columns={columns(deps.terms, tableState)}
              rows={result.data}
              rowKey={(event) => event.id}
            />
            <Pagination
              basePath="/admin/audit"
              params={{
                action: query.action,
                targetType: query.targetType,
                from: query.from,
                to: query.to,
                who: query.who,
                details: query.details,
              }}
              page={result.page}
            />
          </>
        ) : null}
        {result && result.data.length === 0 ? (
          <Pagination
            basePath="/admin/audit"
            params={{
              action: query.action,
              targetType: query.targetType,
              from: query.from,
              to: query.to,
              who: query.who,
              details: query.details,
            }}
            page={result.page}
          />
        ) : null}
      </AuditTargetIdProvider>
    </div>
  );
}
