// Protected administrator account maintenance screen.
import { privateRecordMetadata } from "@/shared/metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  AccountEditor,
  AccountHouseholdSection,
} from "@/components/admin/account-forms";
import { ManagementFields } from "@/components/admin/management-fields";
import { flashNotices, firstValues } from "@/components/admin/format";
import { AccountStatusBadge, RoleBadge } from "@/components/ui/badges";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { ApiError } from "@/server/http/errors";
import { getAccount } from "@/server/register/accounts";
import { getAccountHousehold } from "@/server/register/households";
import { adminPageContext } from "@/server/register/page-context";
import { loadHouseholdChoices } from "@/server/settings/rwa-profile";
import { idParamsSchema } from "@/shared/contracts/register";

export const generateMetadata = privateRecordMetadata(
  "Manage account",
  "Review and maintain a registered member's account and access status.",
  "/admin/accounts/[id]",
);

export default async function AccountPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const parsed = idParamsSchema.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }
  const deps = await adminPageContext();
  const raw = firstValues(await searchParams);
  const notices = flashNotices(deps.terms);

  let account;
  try {
    account = await getAccount(deps, parsed.data.id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }
  const household = await getAccountHousehold(deps, account.id);
  const choices = await loadHouseholdChoices(deps, household?.identifier);

  return (
    <div className="grid gap-8">
      <Link
        href="/admin/accounts"
        className="inline-flex touch-target w-fit items-center gap-1 font-semibold text-accent underline underline-offset-2"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        Accounts
      </Link>
      <PageHeader
        title={account.representativeName}
        description={`Change this person's details, role, ${deps.terms.household} or access.`}
      />
      {account.isAppSupport ? (
        <div className="grid max-w-ballot gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <AccountStatusBadge status={account.status} />
            <RoleBadge isAdmin={false} isReadonly isAppSupport />
          </div>
          <p className="text-body break-all">
            {account.email ?? "Email unavailable"}
          </p>
          <Notice tone="info" heading="Managed From RWA Settings">
            This is the App Support account. It is always read-only, has no{" "}
            {deps.terms.household} and cannot vote. Turn it on or off from{" "}
            <Link
              href="/admin/settings#app-support"
              className="font-semibold underline underline-offset-2"
            >
              RWA Settings, App Support Access
            </Link>
            .
          </Notice>
        </div>
      ) : (
        <ManagementFields canManage={deps.actor.isAdmin}>
          <div className="grid gap-10">
            <AccountEditor
              key={account.id}
              csrfToken={deps.csrfToken}
              account={account}
              flash={raw.notice ? notices[raw.notice] : undefined}
            />
            <AccountHouseholdSection
              csrfToken={deps.csrfToken}
              accountId={account.id}
              household={household}
              choices={choices}
              disabled={account.status === "DELETED"}
            />
          </div>
        </ManagementFields>
      )}
    </div>
  );
}
