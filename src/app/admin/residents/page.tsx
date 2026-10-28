// Unified resident directory with account access, assignments and voting eligibility.
import { Upload, UserPlus } from "lucide-react";
import { AccountReviewTable } from "@/components/admin/account-review-table";
import { ManagementFields } from "@/components/admin/management-fields";
import { flashNotices, firstValues } from "@/components/admin/format";
import { Button, LinkButton } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { WelcomeMessage } from "@/components/ui/rwa-branding";
import { ApiError } from "@/server/http/errors";
import { listResidents } from "@/server/register/accounts";
import { adminPageContext } from "@/server/register/page-context";
import { residentListQuerySchema } from "@/shared/contracts/admin-votes";

export const metadata = {
  title: "Residents",
  description:
    "Administer registered member accounts and current access to Civic Pulse.",
  alternates: { canonical: "/admin/residents" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResidentsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const deps = await adminPageContext();
  const raw = firstValues(await searchParams);
  const flash = raw.notice ? flashNotices(deps.terms)[raw.notice] : undefined;
  const roleFilter = raw.isAdmin ?? "false";

  const parsed = residentListQuerySchema.safeParse({
    limit: raw.limit,
    cursor: raw.cursor,
    status: raw.status,
    isAdmin:
      roleFilter === "all"
        ? undefined
        : roleFilter === "readonly"
          ? "false"
          : roleFilter,
    isReadonly:
      roleFilter === "all"
        ? undefined
        : roleFilter === "readonly"
          ? "true"
          : "false",
    selfRegistered: raw.selfRegistered,
    identifier: raw.identifier,
    isEligible: raw.isEligible === "unassigned" ? undefined : raw.isEligible,
    hasHousehold: raw.isEligible === "unassigned" ? "false" : undefined,
  });
  const filtersInvalid = !parsed.success;
  const query = parsed.success
    ? parsed.data
    : residentListQuerySchema.parse({ isAdmin: "false", isReadonly: "false" });

  let result: Awaited<ReturnType<typeof listResidents>> | null = null;
  let loadError: ApiError | null = null;
  try {
    result = await listResidents(deps, query);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    loadError = error;
  }

  const filtersActive =
    query.status !== undefined ||
    query.isAdmin !== false ||
    query.isReadonly !== false ||
    query.selfRegistered !== undefined ||
    query.identifier !== undefined ||
    query.isEligible !== undefined ||
    query.hasHousehold !== undefined;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Residents"
        description={`Manage people, their ${deps.terms.households}, account access and voting eligibility together. Assign one representative per ${deps.terms.household}. Register changes apply to future votes only; scheduled, active and past votes keep their frozen assignments.`}
        actions={
          <div className="flex flex-wrap gap-3">
            <LinkButton
              href="/admin/residents/import"
              variant="secondary"
              disabled={!deps.actor.isAdmin}
            >
              <Upload aria-hidden="true" className="size-5" />
              Import CSV
            </LinkButton>
            <LinkButton
              href="/admin/residents/new"
              disabled={!deps.actor.isAdmin}
            >
              <UserPlus aria-hidden="true" className="size-5" />
              Add Resident
            </LinkButton>
          </div>
        }
      />
      <WelcomeMessage message={deps.branding.welcomeMessage} />

      {flash ? (
        <Notice tone="success" heading={flash}>
          Your change was saved.
        </Notice>
      ) : null}
      {filtersInvalid ? (
        <Notice tone="warning" heading="Some filters were not valid">
          They were ignored. Choose filters below to try again.
        </Notice>
      ) : null}

      <form
        method="get"
        className="grid gap-4 border-y border-border py-5 sm:grid-cols-2 sm:items-end lg:grid-cols-3"
      >
        <SelectField
          id="status"
          name="status"
          label="Status"
          defaultValue={raw.status ?? ""}
        >
          <option value="">Any status</option>
          <option value="ENABLED">Enabled</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DELETED">Deleted</option>
        </SelectField>
        <SelectField
          id="isEligible"
          name="isEligible"
          label="Voting eligibility"
          defaultValue={raw.isEligible ?? ""}
        >
          <option value="">Any eligibility</option>
          <option value="true">Eligible</option>
          <option value="false">Not eligible</option>
          <option value="unassigned">No {deps.terms.household} assigned</option>
        </SelectField>
        <TextField
          id="identifier"
          name="identifier"
          label={`Exact ${deps.identifierLabel}`}
          hint={`Matches the full ${deps.identifierLabel.toLowerCase()} value.`}
          defaultValue={raw.identifier ?? ""}
          autoComplete="off"
        />
        <SelectField
          id="isAdmin"
          name="isAdmin"
          label="Role"
          defaultValue={roleFilter}
        >
          <option value="all">All roles</option>
          <option value="true">RWA Admin (rwa-admin)</option>
          <option value="readonly">RWA ReadOnly (rwa-readonly)</option>
          <option value="false">Voters (voter)</option>
        </SelectField>
        <SelectField
          id="selfRegistered"
          name="selfRegistered"
          label="Source"
          defaultValue={raw.selfRegistered ?? ""}
        >
          <option value="">Any source</option>
          <option value="true">Self-registered</option>
          <option value="false">Added by an administrator</option>
        </SelectField>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit">Apply Filters</Button>
          {filtersActive ? (
            <LinkButton href="/admin/residents" variant="secondary">
              Clear
            </LinkButton>
          ) : null}
        </div>
      </form>

      {loadError ? (
        <Notice tone="error" heading="Residents could not be loaded">
          <p>
            Try again in a moment or restart the list. If this keeps happening,
            quote this reference to support: {loadError.code}.
          </p>
          <LinkButton href="/admin/residents" variant="secondary">
            Restart list
          </LinkButton>
        </Notice>
      ) : result && result.data.length === 0 ? (
        filtersActive ? (
          <EmptyState
            title="No residents match these filters"
            action={
              <LinkButton href="/admin/residents" variant="secondary">
                Clear Filters
              </LinkButton>
            }
          >
            <p>
              Try a different status, role, source, eligibility or identifier.
            </p>
          </EmptyState>
        ) : (
          <EmptyState
            title="There are no residents yet"
            action={
              <LinkButton
                href="/admin/residents/new"
                disabled={!deps.actor.isAdmin}
              >
                Add a Resident
              </LinkButton>
            }
          >
            <p>
              Create a resident and assign their {deps.terms.household} in one
              step.
            </p>
          </EmptyState>
        )
      ) : result ? (
        <>
          <ManagementFields canManage={deps.actor.isAdmin}>
            <AccountReviewTable
              key={`${query.cursor ?? "first"}:${query.limit}:${query.status ?? "all"}:${roleFilter}:${raw.selfRegistered ?? "any"}:${query.identifier ?? ""}:${raw.isEligible ?? "any"}`}
              accounts={result.data}
              csrfToken={deps.csrfToken}
            />
          </ManagementFields>
          <Pagination
            basePath="/admin/residents"
            params={{
              limit: String(query.limit),
              status: raw.status,
              isAdmin: roleFilter,
              selfRegistered: raw.selfRegistered,
              identifier: raw.identifier,
              isEligible: raw.isEligible,
            }}
            page={result.page}
            hasCursor={Boolean(raw.cursor)}
          />
        </>
      ) : null}
    </div>
  );
}
