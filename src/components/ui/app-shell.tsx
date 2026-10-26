// Session-aware server shell with safe public navigation and contextual breadcrumbs.
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/access/sign-out-button";
import { getSessionState } from "@/server/authorization/account";
import { getCsrfToken } from "@/server/http/csrf-cookie";
import { NavLink } from "./nav-link";
import { Breadcrumbs } from "./breadcrumbs";
import { PublicAnalytics } from "./public-analytics";
import { getEnvironment } from "@/server/config/environment";

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
          <a
            href={account ? "/" : "/sign-in"}
            className="inline-flex touch-target items-center text-card-heading font-bold text-primary"
          >
            Civic Pulse
          </a>

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
                    <NavLink href="/admin/votes">Manage votes</NavLink>
                    <NavLink href="/admin/audit">Audit history</NavLink>
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
        <Breadcrumbs />
        {children}
      </main>
      <footer className="border-t border-border px-4 py-6 md:px-6">
        <div className="mx-auto flex max-w-content flex-col gap-x-8 gap-y-3 md:flex-row md:items-center">
          <nav
            aria-label="Information"
            className="flex flex-wrap gap-x-6 gap-y-2 text-caption"
          >
            <a
              href="/sign-in"
              className="inline-flex min-h-12 items-center text-accent underline"
            >
              Sign In
            </a>
            <a
              href="/user-guide.html"
              className="inline-flex min-h-12 items-center text-accent underline"
            >
              User Guide
            </a>
            <a
              href="/privacy"
              className="inline-flex min-h-12 items-center text-accent underline"
            >
              Privacy Policy
            </a>
            <a
              href="/contact"
              className="inline-flex min-h-12 items-center text-accent underline"
            >
              Contact
            </a>
          </nav>
          <p className="max-w-full text-center text-caption text-muted md:ml-auto md:shrink-0 md:text-right">
            Civic Pulse By Abhishek Patel
          </p>
        </div>
        <PublicAnalytics measurementId={getEnvironment().GOOGLE_ANALYTICS_ID} />
      </footer>
    </>
  );
}
