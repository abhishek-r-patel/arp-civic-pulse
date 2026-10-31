// Product website shell for the main host: no sessions, RWA data or backend calls.
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { NavLink } from "@/components/ui/nav-link";
import { PublicAnalytics } from "@/components/ui/public-analytics";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { getEnvironment } from "@/server/config/environment";
import { mainSiteLinks } from "@/server/site/main-host";
import { MAIN_PUBLIC_PAGES } from "@/shared/metadata";

const MAIN_ANALYTICS_PAGES = Object.fromEntries(
  MAIN_PUBLIC_PAGES.map((page) => [page.path, `${page.title} | Civic Pulse`]),
);

export function MainShell({
  children,
  mainContentId,
}: Readonly<{ children: ReactNode; mainContentId: string }>) {
  const { demoOrigin } = mainSiteLinks();
  const linkClass =
    "inline-flex touch-target items-center text-accent underline";

  return (
    <div>
      <a
        href={`#${mainContentId}`}
        className="sr-only touch-target rounded-control bg-surface px-4 py-3 font-semibold text-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to main content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto grid w-full max-w-content gap-1 px-4 py-2 md:px-6">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/"
              aria-label="Civic Pulse home"
              className="inline-flex touch-target min-w-0 flex-1 items-center gap-3 py-1 text-primary"
            >
              <Image
                src="/icon.svg"
                width={32}
                height={32}
                alt=""
                className="size-8 shrink-0"
              />
              <span className="font-heading text-lg font-semibold">
                Civic Pulse
              </span>
            </Link>
            <ThemeSwitcher />
          </div>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            <NavLink href="/">Product</NavLink>
            {demoOrigin ? (
              <a
                href={demoOrigin}
                className="inline-flex touch-target items-center rounded-control px-3 py-2 text-body font-semibold text-primary hover:bg-primary/5"
              >
                Try the demo
              </a>
            ) : null}
            <NavLink href="/contact">Contact sales</NavLink>
          </nav>
        </div>
      </header>
      <main
        id={mainContentId}
        tabIndex={-1}
        className="mx-auto w-full max-w-content px-4 py-8 focus:outline-none md:px-6 md:py-12"
      >
        {children}
      </main>
      <footer className="border-t border-border px-4 py-6 md:px-6">
        <div className="mx-auto flex max-w-content flex-col gap-x-8 gap-y-3 md:flex-row md:items-center">
          <nav
            aria-label="Information"
            className="flex flex-wrap gap-x-6 gap-y-2 text-caption"
          >
            <Link href="/" className={linkClass}>
              Product
            </Link>
            {demoOrigin ? (
              <a href={demoOrigin} className={linkClass}>
                Demo
              </a>
            ) : null}
            <Link href="/privacy" className={linkClass}>
              Privacy Notice
            </Link>
            <Link href="/contact" className={linkClass}>
              Contact
            </Link>
          </nav>
          <p className="max-w-full text-center text-caption text-muted md:ml-auto md:shrink-0 md:text-right">
            Civic Pulse By Abhishek Patel
          </p>
        </div>
        <PublicAnalytics
          measurementId={getEnvironment().GOOGLE_ANALYTICS_ID}
          pages={MAIN_ANALYTICS_PAGES}
        />
      </footer>
    </div>
  );
}
