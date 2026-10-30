// Unified resident directory with account access, assignments and voting eligibility.
import { Upload, UserPlus } from "lucide-react";
import { AccountReviewTable } from "@/components/admin/account-review-table";
import { flashNotices, firstValues } from "@/components/admin/format";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/server/http/errors";
import { readPageNumber } from "@/server/http/numbered-page";
import { listResidentTable } from "@/server/register/accounts";
import { adminPageContext } from "@/server/register/page-context";
import { getRwaProfile } from "@/server/settings/rwa-profile";
import { residentTableQuerySchema } from "@/shared/contracts/admin-votes";

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
  const { defaultHouseholds } = await getRwaProfile(deps.client);
  const raw = firstValues(await searchParams);
  const flash = raw.notice ? flashNotices(deps.terms)[raw.notice] : undefined;
  const roleFilter = raw.isAdmin ?? "false";

  const parsed = residentTableQuerySchema.safeParse({
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
    identifierContains: raw.identifier,
    isEligible: raw.isEligible === "unassigned" ? undefined : raw.isEligible,
    hasHousehold: raw.isEligible === "unassigned" ? "false" : undefined,
    representative: raw.representative,
    changedFrom: raw.changedFrom,
    changedTo: raw.changedTo,
    sort: raw.sort,
    direction: raw.direction,
  });
  const filtersInvalid = !parsed.success;
  const query = parsed.success
    ? parsed.data
    : residentTableQuerySchema.parse({ isAdmin: "false", isReadonly: "false" });

  let result: Awaited<ReturnType<typeof listResidentTable>> | null = null;
  let loadError: ApiError | null = null;
  try {
    result = await listResidentTable(deps, query, readPageNumber(raw.page));
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
    query.identifierContains !== undefined ||
    query.isEligible !== undefined ||
    query.hasHousehold !== undefined ||
    query.representative !== undefined ||
    query.changedFrom !== undefined ||
    query.changedTo !== undefined;

  const params = {
    limit: String(query.limit),
    status: query.status,
    isAdmin: parsed.success ? roleFilter : "false",
    selfRegistered:
      query.selfRegistered === undefined
        ? undefined
        : String(query.selfRegistered),
    identifier: query.identifierContains,
    isEligible:
      query.hasHousehold === false
        ? "unassigned"
        : query.isEligible === undefined
          ? undefined
          : String(query.isEligible),
    representative: query.representative,
    changedFrom: query.changedFrom,
    changedTo: query.changedTo,
    sort: query.sort,
    direction: query.direction,
  };

  return (
    <div className="grid gap-8">
      <header
        data-page-header
        className="grid min-w-0 gap-2 border-b border-border pb-5 md:pb-6"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
          <h1 className="font-heading text-page-title font-semibold md:text-page-title-lg">
            Residents
          </h1>
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
        </div>
        <p className="text-body text-muted">
          Manage residents, {deps.terms.households}, sign-in access, and voting
          eligibility. One representative per {deps.terms.household}. Changes to
          assignments or eligibility apply to future votes only; existing votes
          keep their original assignments.
        </p>
      </header>

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
      ) : null}
      {result ? (
        <>
          <AccountReviewTable
            key={`${result.page.numbered?.currentPage}:${JSON.stringify(params)}`}
            accounts={result.data}
            csrfToken={deps.csrfToken}
            canManage={deps.actor.isAdmin}
            tableState={{
              params,
              identifiers: defaultHouseholds,
              sort: query.sort,
              direction: query.direction,
            }}
          />
          <Pagination
            basePath="/admin/residents"
            params={params}
            page={result.page}
          />
        </>
      ) : null}
    </div>
  );
}
