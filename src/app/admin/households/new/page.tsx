import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { HouseholdForm } from "@/components/admin/household-form";
import { PageHeader } from "@/components/ui/layout";
import { listAssignableAccounts } from "@/server/register/accounts";
import { adminPageContext } from "@/server/register/page-context";

export const metadata = { title: "Add household" };

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
        Households
      </Link>
      <PageHeader
        title="Add household"
        description="Assign a household to an existing account. This never creates or merges accounts."
      />
      <HouseholdForm csrfToken={deps.csrfToken} accounts={accounts} />
    </div>
  );
}
