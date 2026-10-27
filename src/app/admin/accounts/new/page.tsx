// Protected workflow for provisioning a registered account.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AccountCreateForm } from "@/components/admin/account-forms";
import { ManagementFields } from "@/components/admin/management-fields";
import { PageHeader } from "@/components/ui/layout";
import { adminPageContext } from "@/server/register/page-context";

export const metadata = {
  title: "Add Account",
  description: "Provision a registered member account for your association.",
  alternates: { canonical: "/admin/accounts/new" },
};

export default async function NewAccountPage() {
  const deps = await adminPageContext();

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
        title="Add Account"
        description="Create a sign-in identity and profile for one person."
      />
      <ManagementFields canManage={deps.actor.isAdmin}>
        <AccountCreateForm csrfToken={deps.csrfToken} />
      </ManagementFields>
    </div>
  );
}
