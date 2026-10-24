import { redirect } from "next/navigation";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { getSessionState } from "@/server/authorization/account";

export const metadata = { title: "Votes" };

// Member home. Votes themselves arrive with the voting phases; until then an
// honest empty state explains what will appear here.
export default async function HomePage() {
  const session = await getSessionState();
  if (session.state !== "account") {
    redirect("/sign-in");
  }
  const { account } = session;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Votes"
        description={`Signed in as ${account.representativeName}. Votes you are eligible for will appear here.`}
      />

      {account.isAdmin ? (
        <Notice tone="info" heading="Administrator tools">
          <p>
            Maintain the household register and accounts. Administrator access
            does not make you eligible to vote; eligibility comes from the
            household register.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <LinkButton href="/admin/households" variant="secondary">
              Household register
            </LinkButton>
            <LinkButton href="/admin/accounts" variant="secondary">
              Accounts
            </LinkButton>
          </div>
        </Notice>
      ) : null}

      <EmptyState title="No votes yet">
        <p>
          There are no votes for you to take part in right now. When your RWA
          opens one that includes your household, it will be listed here with
          its deadline.
        </p>
      </EmptyState>
    </div>
  );
}
