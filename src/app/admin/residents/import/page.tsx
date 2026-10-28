/* Protected bulk register workflow; uploaded resident information stays in page memory. */
import { RegisterImportForm } from "@/components/admin/register-import-form";
import { ManagementFields } from "@/components/admin/management-fields";
import { LinkButton } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { adminPageContext } from "@/server/register/page-context";

export const metadata = { title: "Import Register" };

export default async function ImportRegisterPage() {
  const deps = await adminPageContext();
  return (
    <div className="grid gap-8">
      <PageHeader
        title={`Import ${deps.terms.Households}`}
        actions={
          <LinkButton href="/admin/residents" variant="secondary">
            <ChevronLeft className="size-5" aria-hidden="true" />
            Residents
          </LinkButton>
        }
      />
      <ManagementFields canManage={deps.actor.isAdmin}>
        <RegisterImportForm csrfToken={deps.csrfToken} />
      </ManagementFields>
    </div>
  );
}
