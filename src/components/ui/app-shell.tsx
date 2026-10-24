import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/access/sign-out-button";
import { getSessionState } from "@/server/authorization/account";
import { getCsrfToken } from "@/server/http/csrf-cookie";
import { NavLink } from "./nav-link";

export const MAIN_CONTENT_ID = "main-content";

// One shell is shared by member and administrator routes. Navigation depends
// on the verified, current profile; unauthenticated screens show no navigation
// that could reveal the register, ballots or results.
export async function AppShell({
  children,
}: Readonly<{ children: ReactNode }>) {
  const session = await getSessionState();
  const csrfToken =
    session.state === "anonymous" ? undefined : await getCsrfToken();
  const account = session.state === "account" ? session.account : null;

  return (
    <>
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only touch-target rounded-control bg-surface px-4 py-3 font-semibold text-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to main content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 md:px-6">
          <Link
            href="/"
            className="inline-flex touch-target items-center text-card-heading font-bold text-primary"
          >
            Civic Pulse
          </Link>

          {account ? (
            <>
              <nav
                aria-label="Main"
                className="order-3 flex w-full flex-wrap gap-1 md:order-none md:w-auto"
              >
                <NavLink href="/">Votes</NavLink>
                {account.isAdmin ? (
                  <>
                    <NavLink href="/admin/households">Households</NavLink>
                    <NavLink href="/admin/accounts">Accounts</NavLink>
                  </>
                ) : null}
              </nav>
              <div className="flex items-center gap-3">
                <p className="hidden text-caption text-muted sm:block">
                  {account.representativeName}
                  {account.isAdmin ? " · Administrator" : ""}
                </p>
                <SignOutButton csrfToken={csrfToken} />
              </div>
            </>
          ) : null}
        </div>
      </header>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-content px-4 py-8 focus:outline-none md:px-6 md:py-12"
      >
        {children}
      </main>
    </>
  );
}
