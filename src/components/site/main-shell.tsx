// Product website shell for the main host: no sessions, RWA data or backend calls.
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { PublicAnalytics } from "@/components/ui/public-analytics";
import { MainSiteNavigation } from "@/components/site/main-site-navigation";
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
      <MainSiteNavigation demoOrigin={demoOrigin} />
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
          <p className="border-t border-border pt-6 text-center text-caption text-muted">
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
