// Session-aware server shell with safe public navigation and contextual breadcrumbs.
import type { ReactNode } from "react";
import Image from "next/image";
import { SignOutButton } from "@/components/access/sign-out-button";
import { getSessionState } from "@/server/authorization/account";
import { getCsrfToken } from "@/server/http/csrf-cookie";
import { NavLink } from "./nav-link";
import { Breadcrumbs } from "./breadcrumbs";
import { PublicAnalytics } from "./public-analytics";
import { getEnvironment } from "@/server/config/environment";
import { log } from "@/server/observability/logger";
import {
  loadCurrentBranding,
  loadHouseholdTerms,
  loadPublicRwaIdentity,
} from "@/server/settings/rwa-profile";
import { HouseholdTermsProvider } from "./household-terms";
import { RwaContactBlock } from "./rwa-branding";
import { ThemeSwitcher } from "./theme-switcher";
import { canViewAdministration } from "@/shared/contracts/register";

export const MAIN_CONTENT_ID = "main-content";

// Branding must never take the shell down: fall back to the product name.
async function shellBranding() {
  try {
    return await loadCurrentBranding();
  } catch {
    log("warn", "settings.branding_unavailable", {});
    return null;
  }
}

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
  const branding = account ? await shellBranding() : null;
  const publicIdentity = account ? null : await loadPublicRwaIdentity();
  const rwaAlias = branding?.alias ?? publicIdentity?.alias ?? null;
  const headerTitle = rwaAlias ? `Civic Pulse for ${rwaAlias}` : "Civic Pulse";
  const initials =
    account?.representativeName
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => Array.from(part)[0] ?? "")
      .join("") ?? "";
  const palette = (branding ?? publicIdentity)?.accentPalette;
  const terms = await loadHouseholdTerms();

  return (
    <HouseholdTermsProvider terms={terms}>
      <div data-palette={palette}>
        <a
          href={`#${MAIN_CONTENT_ID}`}
          className="sr-only touch-target rounded-control bg-surface px-4 py-3 font-semibold text-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
        >
          Skip to main content
        </a>
        <header className="border-b border-border bg-surface">
          {/* Row one: title and signed-in identity. Row two: tabs on the left
              and Sign Out on the right, so the button stays beside the tabs
              at every width instead of wrapping onto its own line. */}
          <div className="mx-auto grid w-full max-w-content gap-1 px-4 py-2 md:px-6">
            <div className="flex items-center justify-between gap-3">
              <a
                href={account ? "/" : "/sign-in"}
                aria-label={headerTitle}
                className="inline-flex touch-target min-w-0 flex-1 items-center gap-3 py-1 text-primary"
              >
                <Image
                  src="/icon.svg"
                  width={32}
                  height={32}
                  alt=""
                  className="size-8 shrink-0"
                />
                <span className="grid min-w-0 gap-0.5">
                  <span className="font-heading text-lg font-semibold">
                    Civic Pulse
                  </span>
                  {rwaAlias ? (
                    <span className="text-caption text-muted">{rwaAlias}</span>
                  ) : null}
                </span>
              </a>
              <div className="flex shrink-0 items-center gap-3">
                {account ? (
                  <>
                    <p className="hidden text-caption text-muted sm:block">
                      {account.representativeName}
                      {account.isAdmin
                        ? " · RWA Admin"
                        : account.isReadonly
                          ? " · RWA ReadOnly"
                          : ""}
                    </p>
                    <span
                      className="hidden size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-caption font-semibold text-primary sm:inline-flex"
                      aria-hidden="true"
                    >
                      {initials}
                    </span>
                  </>
                ) : null}
                <ThemeSwitcher />
              </div>
            </div>

            {account ? (
              <div className="flex items-start justify-between gap-3">
                <nav
                  aria-label="Main"
                  className="flex min-w-0 flex-1 flex-wrap gap-1"
                >
                  <NavLink href="/">Votes</NavLink>
                  {canViewAdministration(account) ? (
                    <>
                      <NavLink href="/admin/residents">Residents</NavLink>
                      <NavLink href="/admin/settings">RWA Settings</NavLink>
                      <NavLink href="/admin/votes">Manage Votes</NavLink>
                      <NavLink href="/admin/audit">Audit History</NavLink>
                    </>
                  ) : null}
                </nav>
                <div className="shrink-0">
                  <SignOutButton csrfToken={csrfToken} />
                </div>
              </div>
            ) : null}
          </div>{" "}
        </header>
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="mx-auto w-full max-w-content px-4 py-8 focus:outline-none md:px-6 md:py-12"
        >
          <Breadcrumbs homeLabel={branding?.alias ?? "Civic Pulse"} />
          {children}
        </main>
        <footer className="border-t border-border px-4 py-6 md:px-6">
          {branding ? <RwaContactBlock branding={branding} /> : null}
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
                href="/register"
                className="inline-flex min-h-12 items-center text-accent underline"
              >
                Register
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
          <PublicAnalytics
            measurementId={getEnvironment().GOOGLE_ANALYTICS_ID}
          />
        </footer>
      </div>
    </HouseholdTermsProvider>
  );
}
