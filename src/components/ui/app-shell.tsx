import Link from "next/link";
import type { ReactNode } from "react";

export const MAIN_CONTENT_ID = "main-content";

// One shell is shared by member and administrator routes.
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only touch-target rounded-control bg-surface px-4 py-3 font-semibold text-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to main content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-16 w-full max-w-content items-center px-4 md:px-6">
          <Link
            href="/"
            className="inline-flex touch-target items-center text-card-heading font-bold text-primary"
          >
            Civic Pulse
          </Link>
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
