import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { NewDraftForm } from "@/components/admin/vote-forms";
import { PageHeader } from "@/components/ui/layout";
import { adminPageContext } from "@/server/register/page-context";

export const metadata = { title: "New vote" };

export default async function NewVotePage() {
  const deps = await adminPageContext();

  return (
    <div className="grid gap-8">
      <Link
        href="/admin/votes"
        className="inline-flex touch-target w-fit items-center gap-1 font-semibold text-accent underline underline-offset-2"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        Votes
      </Link>
      <PageHeader
        title="New vote"
        description="Choose the voting type first. You will add the details, ballot, electorate and deadline next, and can preview everything before activating."
      />
      <NewDraftForm csrfToken={deps.csrfToken} />
    </div>
  );
}
