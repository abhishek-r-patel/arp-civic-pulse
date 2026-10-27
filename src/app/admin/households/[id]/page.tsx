// Protected household maintenance preserving historical voting entitlements.
import { privateRecordMetadata } from "@/shared/metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { HouseholdForm } from "@/components/admin/household-form";
import { ManagementFields } from "@/components/admin/management-fields";
import { PageHeader } from "@/components/ui/layout";
import { ApiError } from "@/server/http/errors";
import {
  MAX_ASSIGNABLE,
  listAssignableAccounts,
} from "@/server/register/accounts";
import { getHousehold } from "@/server/register/households";
import { adminPageContext } from "@/server/register/page-context";
import { loadHouseholdTerms } from "@/server/settings/rwa-profile";
import { idParamsSchema } from "@/shared/contracts/register";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const terms = await loadHouseholdTerms();
  return privateRecordMetadata(
    `Edit ${terms.Household}`,
    `Update current ${terms.household} details without rewriting historical voting assignments.`,
    "/admin/households/[id]",
  )({ params });
}

export default async function EditHouseholdPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const parsed = idParamsSchema.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }
  const deps = await adminPageContext();

  let household;
  try {
    household = await getHousehold(deps, parsed.data.id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }
  const accounts = await listAssignableAccounts(
    deps,
    household.representativeAccountId,
  );

  return (
    <div className="grid gap-8">
      <Link
        href="/admin/households"
        className="inline-flex touch-target w-fit items-center gap-1 font-semibold text-accent underline underline-offset-2"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        {deps.terms.Households}
      </Link>
      <PageHeader
        title={`Edit ${deps.identifierLabel} ${household.identifier}`}
        description={`Change the ${deps.identifierLabel.toLowerCase()}, the representative or eligibility.`}
      />
      <ManagementFields canManage={deps.actor.isAdmin}>
        <HouseholdForm
          csrfToken={deps.csrfToken}
          identifierLabel={deps.identifierLabel}
          accounts={accounts}
          household={household}
          limited={accounts.length >= MAX_ASSIGNABLE}
        />
      </ManagementFields>
    </div>
  );
}
