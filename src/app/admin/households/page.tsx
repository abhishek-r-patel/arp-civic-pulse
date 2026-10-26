// Protected administrator household register.
import Link from "next/link";
import { Plus } from "lucide-react";
import {
  FLASH_NOTICES,
  firstValues,
  formatInstant,
} from "@/components/admin/format";
import { AccountStatusBadge, EligibilityBadge } from "@/components/ui/badges";
import { Button, LinkButton } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SelectField, TextField } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/server/http/errors";
import { listHouseholds } from "@/server/register/households";
import { adminPageContext } from "@/server/register/page-context";
import {
  householdListQuerySchema,
  type HouseholdProjection,
} from "@/shared/contracts/register";

export const metadata = {
  title: "Households",
  description:
    "Maintain the association household register and representative assignments.",
  alternates: { canonical: "/admin/households" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const columns: Column<HouseholdProjection>[] = [
  {
    key: "identifier",
    header: "Household",
    cell: (household) => (
      <span className="font-semibold">{household.identifier}</span>
    ),
  },
  {
    key: "representative",
    header: "Representative",
    cell: (household) => (
      <span className="grid gap-1">
        <span className="font-semibold">{household.representative.name}</span>
        <span className="text-caption break-all text-muted">
          {household.representative.email ?? "Email unavailable"}
        </span>
        <span>
          <AccountStatusBadge status={household.representative.status} />
        </span>
      </span>
    ),
  },
  {
    key: "eligibility",
    header: "Eligibility",
    cell: (household) => <EligibilityBadge eligible={household.isEligible} />,
  },
  {
    key: "updated",
    header: "Last changed",
    cell: (household) => formatInstant(household.updatedAt),
  },
  {
    key: "actions",
    header: "Actions",
    cell: (household) => (
      <Link
        href={`/admin/households/${household.id}`}
        className="inline-flex touch-target items-center font-semibold text-accent underline underline-offset-2"
      >
        Edit<span className="sr-only"> household {household.identifier}</span>
      </Link>
    ),
  },
];

export default async function HouseholdsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const deps = await adminPageContext();
  const raw = firstValues(await searchParams);
  const flash = raw.notice ? FLASH_NOTICES[raw.notice] : undefined;

  const parsed = householdListQuerySchema.safeParse({
    limit: raw.limit,
    cursor: raw.cursor,
    isEligible: raw.isEligible,
    identifier: raw.identifier,
  });
  const filtersInvalid = !parsed.success;
  const query = parsed.success
    ? parsed.data
    : householdListQuerySchema.parse({});

  let result: Awaited<ReturnType<typeof listHouseholds>> | null = null;
  let loadError: ApiError | null = null;
  try {
    result = await listHouseholds(deps, query);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    loadError = error;
  }

  const filtersActive =
    query.isEligible !== undefined || query.identifier !== undefined;
  const params = {
    isEligible: raw.isEligible,
    identifier: raw.identifier,
  };

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Households"
        description="The register of households and the one account that represents each. Edits apply to future votes only; a vote already active keeps the names and representatives it started with."
        actions={
          <LinkButton href="/admin/households/new">
            <Plus aria-hidden="true" className="size-5" />
            Add household
          </LinkButton>
        }
      />

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
        className="grid gap-4 rounded-card border border-border bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <SelectField
          id="isEligible"
          name="isEligible"
          label="Eligibility"
          defaultValue={raw.isEligible ?? ""}
        >
          <option value="">All households</option>
          <option value="true">Eligible</option>
          <option value="false">Not eligible</option>
        </SelectField>
        <TextField
          id="identifier"
          name="identifier"
          label="Exact household identifier"
          hint="Matches the whole identifier."
          defaultValue={raw.identifier ?? ""}
          autoComplete="off"
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit">Apply filters</Button>
          {filtersActive ? (
            <LinkButton href="/admin/households" variant="secondary">
              Clear
            </LinkButton>
          ) : null}
        </div>
      </form>

      {loadError ? (
        <Notice tone="error" heading="The register could not be loaded">
          Try again in a moment. If this keeps happening, quote this reference
          to support: {loadError.code}.
        </Notice>
      ) : result && result.data.length === 0 ? (
        filtersActive ? (
          <EmptyState
            title="No households match these filters"
            action={
              <LinkButton href="/admin/households" variant="secondary">
                Clear filters
              </LinkButton>
            }
          >
            <p>Try a different eligibility option or identifier.</p>
          </EmptyState>
        ) : (
          <EmptyState
            title="The register has no households yet"
            action={
              <LinkButton href="/admin/households/new">
                Add the first household
              </LinkButton>
            }
          >
            <p>
              Add each household and the account that represents it. Create the
              representative&apos;s account first if it does not exist.
            </p>
          </EmptyState>
        )
      ) : result ? (
        <>
          <DataTable
            caption="Household register"
            columns={columns}
            rows={result.data}
            rowKey={(household) => household.id}
          />
          <Pagination
            basePath="/admin/households"
            params={params}
            page={result.page}
            hasCursor={Boolean(raw.cursor)}
          />
        </>
      ) : null}
    </div>
  );
}
