// Protected administrative audit history with server-side filters.
import { formatInstant, firstValues } from "@/components/admin/format";
import { Button, LinkButton } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SelectField } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/server/http/errors";
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
  "PROFILE_UPDATED",
  "PROFILE_STATUS_CHANGED",
  "PROFILE_ROLE_CHANGED",
  "HOUSEHOLD_CREATED",
  "HOUSEHOLD_UPDATED",
  "DRAFT_CREATED",
  "DRAFT_UPDATED",
  "VOTE_ACTIVATED",
  "VOTE_COMPLETED",
  "VOTE_CANCELLED",
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

function detailValue(key: string, value: unknown): string {
  if (typeof value !== "string") {
    return JSON.stringify(value);
  }
  return key === "votingType" ? (LEGACY_VOTING_TYPES[value] ?? value) : value;
}

function Details({
  details,
  terms,
}: Readonly<{
  details: AuditEvent["details"];
  terms: HouseholdTerms;
}>) {
  const entries = Object.entries(details);
  if (entries.length === 0) {
    return <span className="text-muted">—</span>;
  }
  return (
    <dl className="grid gap-0.5 text-caption">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-wrap gap-x-2">
          <dt className="font-semibold text-muted">
            {detailLabel(key, terms)}:
          </dt>
          <dd className="min-w-0 break-words">{detailValue(key, value)}</dd>
        </div>
      ))}
    </dl>
  );
}

const columns = (terms: HouseholdTerms): Column<AuditEvent>[] => [
  {
    key: "when",
    header: "When",
    cell: (event) => (
      <time dateTime={event.occurredAt}>{formatInstant(event.occurredAt)}</time>
    ),
  },
  {
    key: "actor",
    header: "Who",
    cell: (event) =>
      event.actorKind === "PROFILE"
        ? (event.actorName ?? "Former account")
        : label(event.actorKind, terms),
  },
  {
    key: "action",
    header: "Action",
    cell: (event) => label(event.action, terms),
  },
  {
    key: "target",
    header: "Target",
    cell: (event) => (
      <span>
        {label(event.targetType, terms)}
        <span className="block text-caption break-all text-muted">
          {event.targetId}
        </span>
      </span>
    ),
  },
  { key: "reason", header: "Reason", cell: (event) => event.reason ?? "—" },
  {
    key: "details",
    header: "Details",
    cell: (event) => <Details details={event.details} terms={terms} />,
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
  });
  const query = parsed.success ? parsed.data : auditQuerySchema.parse({});

  let result: Awaited<ReturnType<typeof listAuditEvents>> | null = null;
  let loadError: ApiError | null = null;
  try {
    result = await listAuditEvents(deps, query);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    loadError = error;
  }

  const filtersActive =
    query.action !== undefined || query.targetType !== undefined;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Audit History"
        description="A permanent record of administrative actions, newest first. It never contains sign-in codes, ballots or selections. Times are UTC."
      />

      {!parsed.success ? (
        <Notice tone="warning" heading="Some filters were not valid">
          They were ignored. Choose filters below to try again.
        </Notice>
      ) : null}

      <form
        method="get"
        className="grid gap-4 rounded-card border border-border bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <SelectField
          id="action"
          name="action"
          label="Action"
          defaultValue={raw.action ?? ""}
        >
          <option value="">Any action</option>
          {ACTIONS.map((action) => (
            <option key={action} value={action}>
              {label(action, deps.terms)}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="targetType"
          name="targetType"
          label="Target"
          defaultValue={raw.targetType ?? ""}
        >
          <option value="">Any target</option>
          {TARGET_TYPES.map((type) => (
            <option key={type} value={type}>
              {label(type, deps.terms)}
            </option>
          ))}
        </SelectField>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit">Apply Filters</Button>
          {filtersActive ? (
            <LinkButton href="/admin/audit" variant="secondary">
              Clear
            </LinkButton>
          ) : null}
        </div>
      </form>

      {loadError ? (
        <Notice tone="error" heading="The audit history could not be loaded">
          <p>
            Try again in a moment. If this keeps happening, quote this reference
            to support: {loadError.code}.
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
              ? "Try a different action or target."
              : "Administrative actions will appear here as they happen."}
          </p>
        </EmptyState>
      ) : result ? (
        <>
          <DataTable
            caption="Audit events"
            columns={columns(deps.terms)}
            rows={result.data}
            rowKey={(event) => event.id}
          />
          <Pagination
            basePath="/admin/audit"
            params={{ action: raw.action, targetType: raw.targetType }}
            page={result.page}
            hasCursor={Boolean(raw.cursor)}
          />
        </>
      ) : null}
    </div>
  );
}
