/* Protected bulk register workflow; uploaded resident information stays in page memory. */
import { RegisterImportForm } from "@/components/admin/register-import-form";
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
          <LinkButton href="/admin/households" variant="secondary">
            <ChevronLeft className="size-5" aria-hidden="true" />
            {deps.terms.Households}
          </LinkButton>
        }
      />
      <RegisterImportForm csrfToken={deps.csrfToken} />
    </div>
  );
}
