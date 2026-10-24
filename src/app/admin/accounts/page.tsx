import Link from "next/link";
import { UserPlus } from "lucide-react";
import {
  FLASH_NOTICES,
  firstValues,
  formatInstant,
} from "@/components/admin/format";
import { AccountStatusBadge, RoleBadge } from "@/components/ui/badges";
import { Button, LinkButton } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SelectField } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/server/http/errors";
import { listAccounts } from "@/server/register/accounts";
import { adminPageContext } from "@/server/register/page-context";
import { accountListQuerySchema } from "@/shared/contracts/admin-votes";
import type { AccountProjection } from "@/shared/contracts/register";

export const metadata = { title: "Accounts" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const columns: Column<AccountProjection>[] = [
  {
    key: "name",
    header: "Name",
    cell: (account) => (
      <span className="grid gap-1">
        <span className="font-semibold">{account.representativeName}</span>
        <span className="text-caption break-all text-muted">
          {account.email ?? "Email unavailable"}
          {account.email && !account.emailVerifiedAt ? " · not verified" : ""}
        </span>
      </span>
    ),
  },
  {
    key: "role",
    header: "Role",
    cell: (account) => <RoleBadge isAdmin={account.isAdmin} />,
  },
  {
    key: "status",
    header: "Status",
    cell: (account) => <AccountStatusBadge status={account.status} />,
  },
  {
    key: "updated",
    header: "Last changed",
    cell: (account) => formatInstant(account.updatedAt),
  },
  {
    key: "actions",
    header: "Actions",
    cell: (account) => (
      <Link
        href={`/admin/accounts/${account.id}`}
        className="inline-flex touch-target items-center font-semibold text-accent underline underline-offset-2"
      >
        Manage<span className="sr-only"> {account.representativeName}</span>
      </Link>
    ),
  },
];

export default async function AccountsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const deps = await adminPageContext();
  const raw = firstValues(await searchParams);
  const flash = raw.notice ? FLASH_NOTICES[raw.notice] : undefined;

  const parsed = accountListQuerySchema.safeParse({
    limit: raw.limit,
    cursor: raw.cursor,
    status: raw.status,
    isAdmin: raw.isAdmin,
  });
  const filtersInvalid = !parsed.success;
  const query = parsed.success ? parsed.data : accountListQuerySchema.parse({});

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
    query.status !== undefined || query.isAdmin !== undefined;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Accounts"
        description="People who can sign in. Each account is one sign-in identity plus its role and status. Residents also need a household before they can be enabled."
        actions={
          <LinkButton href="/admin/accounts/new">
            <UserPlus aria-hidden="true" className="size-5" />
            Add account
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
          defaultValue={raw.isAdmin ?? ""}
        >
          <option value="">Any role</option>
          <option value="true">Administrators</option>
          <option value="false">Residents</option>
        </SelectField>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit">Apply filters</Button>
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
                Clear filters
              </LinkButton>
            }
          >
            <p>Try a different status or role.</p>
          </EmptyState>
        ) : (
          <EmptyState
            title="There are no accounts yet"
            action={
              <LinkButton href="/admin/accounts/new">Add an account</LinkButton>
            }
          >
            <p>Create an account for each resident who will vote.</p>
          </EmptyState>
        )
      ) : result ? (
        <>
          <DataTable
            caption="Accounts"
            columns={columns}
            rows={result.data}
            rowKey={(account) => account.id}
          />
          <Pagination
            basePath="/admin/accounts"
            params={{ status: raw.status, isAdmin: raw.isAdmin }}
            page={result.page}
            hasCursor={Boolean(raw.cursor)}
          />
        </>
      ) : null}
    </div>
  );
}
