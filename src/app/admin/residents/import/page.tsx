/* Protected bulk register workflow; uploaded resident information stays in page memory. */
import Link from "next/link";
import { RegisterImportForm } from "@/components/admin/register-import-form";
import { ManagementFields } from "@/components/admin/management-fields";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { adminPageContext } from "@/server/register/page-context";

export const metadata = { title: "Import Register" };

export default async function ImportRegisterPage() {
  const deps = await adminPageContext();
  return (
    <div className="grid w-full gap-8">
      <div data-form-page className="mx-auto grid w-full max-w-ballot gap-8">
        <Link
          href="/admin/residents"
          className="inline-flex touch-target w-fit items-center gap-1 font-semibold text-accent underline underline-offset-2"
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
          Residents
        </Link>
        <PageHeader title={`Import ${deps.terms.Households}`} />
      </div>
      <ManagementFields canManage={deps.actor.isAdmin}>
        <RegisterImportForm csrfToken={deps.csrfToken} />
      </ManagementFields>
    </div>
  );
}
