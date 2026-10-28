// Protected administrator account directory.
import { UserPlus } from "lucide-react";
import { AccountReviewTable } from "@/components/admin/account-review-table";
import { ManagementFields } from "@/components/admin/management-fields";
import { flashNotices, firstValues } from "@/components/admin/format";
import { Button, LinkButton } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/server/http/errors";
import { listAccounts } from "@/server/register/accounts";
import { adminPageContext } from "@/server/register/page-context";
import { accountListQuerySchema } from "@/shared/contracts/admin-votes";

export const metadata = {
  title: "Accounts",
  description:
    "Administer registered member accounts and current access to Civic Pulse.",
  alternates: { canonical: "/admin/accounts" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AccountsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const deps = await adminPageContext();
  const raw = firstValues(await searchParams);
  const flash = raw.notice ? flashNotices(deps.terms)[raw.notice] : undefined;
  const roleFilter = raw.isAdmin ?? "false";

  const parsed = accountListQuerySchema.safeParse({
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
  });
  const filtersInvalid = !parsed.success;
  const query = parsed.success
    ? parsed.data
    : accountListQuerySchema.parse({ isAdmin: "false", isReadonly: "false" });

  let result: Awaited<ReturnType<typeof listAccounts>> | null = null;
  let loadError: ApiError | null = null;
  try {
    result = await listAccounts(deps, query);
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
    query.selfRegistered !== undefined;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Accounts"
        description={`People who can sign in. Each account is one sign-in identity plus its role and status. Residents also need a ${deps.terms.household} before they can be enabled.`}
        actions={
          <LinkButton href="/admin/accounts/new" disabled={!deps.actor.isAdmin}>
            <UserPlus aria-hidden="true" className="size-5" />
            Add Account
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
        className="grid gap-4 border-y border-border py-5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
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
            <LinkButton href="/admin/accounts" variant="secondary">
              Clear
            </LinkButton>
          ) : null}
        </div>
      </form>

      {loadError ? (
        <Notice tone="error" heading="Accounts could not be loaded">
          Try again in a moment. If this keeps happening, quote this reference
          to support: {loadError.code}.
        </Notice>
      ) : result && result.data.length === 0 ? (
        filtersActive ? (
          <EmptyState
            title="No accounts match these filters"
            action={
              <LinkButton href="/admin/accounts" variant="secondary">
                Clear Filters
              </LinkButton>
            }
          >
            <p>Try a different status, role or source.</p>
          </EmptyState>
        ) : (
          <EmptyState
            title="There are no accounts yet"
            action={
              <LinkButton
                href="/admin/accounts/new"
                disabled={!deps.actor.isAdmin}
              >
                Add an Account
              </LinkButton>
            }
          >
            <p>Create an account for each resident who will vote.</p>
          </EmptyState>
        )
      ) : result ? (
        <>
          <ManagementFields canManage={deps.actor.isAdmin}>
            <AccountReviewTable
              key={`${query.cursor ?? "first"}:${query.limit}:${query.status ?? "all"}:${roleFilter}:${raw.selfRegistered ?? "any"}`}
              accounts={result.data}
              csrfToken={deps.csrfToken}
            />
          </ManagementFields>
          <Pagination
            basePath="/admin/accounts"
            params={{
              status: raw.status,
              isAdmin: roleFilter,
              selfRegistered: raw.selfRegistered,
            }}
            page={result.page}
            hasCursor={Boolean(raw.cursor)}
          />
        </>
      ) : null}
    </div>
  );
}
