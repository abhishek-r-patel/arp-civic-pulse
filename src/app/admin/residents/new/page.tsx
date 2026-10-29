// Protected one-step resident onboarding; voter accounts require a household in this form.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AccountCreateForm } from "@/components/admin/account-forms";
import { ManagementFields } from "@/components/admin/management-fields";
import { PageHeader } from "@/components/ui/layout";
import { adminPageContext } from "@/server/register/page-context";
import { loadHouseholdChoices } from "@/server/settings/rwa-profile";

export const metadata = {
  title: "Add Resident",
  description: "Provision a registered member account for your association.",
  alternates: { canonical: "/admin/residents/new" },
};

export default async function NewAccountPage() {
  const deps = await adminPageContext();
  const choices = await loadHouseholdChoices(deps);

  return (
    <div data-form-page className="mx-auto grid w-full max-w-ballot gap-8">
      <Link
        href="/admin/residents"
        className="inline-flex touch-target w-fit items-center gap-1 font-semibold text-accent underline underline-offset-2"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        Residents
      </Link>
      <PageHeader
        title="Add Resident"
        description={`Create a sign-in identity and profile for one person, and assign their ${deps.terms.household} in the same step.`}
      />
      <ManagementFields canManage={deps.actor.isAdmin}>
        <AccountCreateForm csrfToken={deps.csrfToken} choices={choices} />
      </ManagementFields>
    </div>
  );
}
