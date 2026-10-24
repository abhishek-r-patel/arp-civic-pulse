import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { HouseholdForm } from "@/components/admin/household-form";
import { PageHeader } from "@/components/ui/layout";
import { ApiError } from "@/server/http/errors";
import { listAssignableAccounts } from "@/server/register/accounts";
import { getHousehold } from "@/server/register/households";
import { adminPageContext } from "@/server/register/page-context";
import { idParamsSchema } from "@/shared/contracts/register";

export const metadata = { title: "Edit household" };

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
        Households
      </Link>
      <PageHeader
        title={`Edit household ${household.identifier}`}
        description="Change the label, the representative or eligibility."
      />
      <HouseholdForm
        csrfToken={deps.csrfToken}
        accounts={accounts}
        household={household}
      />
    </div>
  );
}
