// Protected workflow for adding a household to the register.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { HouseholdForm } from "@/components/admin/household-form";
import { PageHeader } from "@/components/ui/layout";
import {
  MAX_ASSIGNABLE,
  listAssignableAccounts,
} from "@/server/register/accounts";
import { adminPageContext } from "@/server/register/page-context";
import { loadHouseholdTerms } from "@/server/settings/rwa-profile";

export async function generateMetadata() {
  const terms = await loadHouseholdTerms();
  return {
    title: `Add ${terms.Household}`,
    description: `Create a register entry for this ${terms.household} and its representative details.`,
    alternates: { canonical: "/admin/households/new" },
  };
}

export default async function NewHouseholdPage() {
  const deps = await adminPageContext();
  const accounts = await listAssignableAccounts(deps);

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
        title={`Add ${deps.terms.Household}`}
        description={`Assign an existing account to represent this ${deps.terms.household}. This never creates or merges accounts.`}
      />
      <HouseholdForm
        csrfToken={deps.csrfToken}
        identifierLabel={deps.identifierLabel}
        accounts={accounts}
        limited={accounts.length >= MAX_ASSIGNABLE}
      />
    </div>
  );
}
