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
    <div data-product-site>
      <a
        href={`#${mainContentId}`}
        className="sr-only touch-target rounded-control bg-surface px-4 py-3 font-semibold text-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to main content
      </a>
      <header className="border-b border-border bg-surface/80">
        <div className="product-container flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 lg:flex-none">
            <Link
              href="/"
              aria-label="Civic Pulse home"
              className="inline-flex touch-target min-w-0 flex-1 items-center gap-3 py-1 text-primary"
            >
              <Image
                src="/icon.svg"
                width={40}
                height={40}
                alt=""
                className="size-10 shrink-0"
              />
              <span className="font-heading text-lg font-semibold">
                Civic Pulse
              </span>
            </Link>
          </div>
          <nav
            aria-label="Main"
            className="order-3 flex w-full flex-wrap items-center gap-2 lg:order-none lg:w-auto"
          >
            <NavLink href="/">Product</NavLink>
            <Link href="/#features" className="product-nav-link">
              Features
            </Link>
            <Link href="/#pricing" className="product-nav-link">
              Pricing
            </Link>
            {demoOrigin ? (
              <a href={demoOrigin} className="product-nav-link">
                Try the demo
              </a>
            ) : null}
            <Link href="/contact" className="product-primary">
              Contact sales
            </Link>
          </nav>
          <div className="order-2 lg:order-none">
            <ThemeSwitcher />
          </div>
        </div>
      </header>
      <main
        id={mainContentId}
        tabIndex={-1}
        className="product-container py-8 focus:outline-none md:py-12"
      >
        {children}
      </main>
      <footer className="border-t border-border bg-surface py-8 md:py-10">
        <div className="product-container flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/"
              className="inline-flex touch-target items-center gap-3 font-heading text-lg font-semibold text-primary"
            >
              <Image
                src="/icon.svg"
                width={32}
                height={32}
                alt=""
                className="size-8"
              />
              Civic Pulse
            </Link>
            <p className="mt-2 text-caption text-muted">
              Thoughtful decisions. Connected communities.
            </p>
          </div>
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
        </div>
        <div className="product-container mt-6">
          <p className="border-t border-border pt-6 text-caption text-muted">
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
