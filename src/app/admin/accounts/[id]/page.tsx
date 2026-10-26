// Protected administrator account maintenance screen.
import { privateRecordMetadata } from "@/shared/metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AccountEditor } from "@/components/admin/account-forms";
import { flashNotices, firstValues } from "@/components/admin/format";
import { PageHeader } from "@/components/ui/layout";
import { ApiError } from "@/server/http/errors";
import { getAccount } from "@/server/register/accounts";
import { adminPageContext } from "@/server/register/page-context";
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
        description="Change this person's details, role or access."
      />
      <AccountEditor
        key={account.id}
        csrfToken={deps.csrfToken}
        account={account}
        flash={raw.notice ? notices[raw.notice] : undefined}
      />
    </div>
  );
}
