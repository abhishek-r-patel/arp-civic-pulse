"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "./cn";

// Highlights the current section for sighted users and exposes it to assistive technology.
export function NavLink({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>) {
  const pathname = usePathname();
  const current = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "inline-flex touch-target items-center rounded-control px-3 py-2 text-body font-semibold",
        current
          ? "bg-accent/10 text-accent underline decoration-2 underline-offset-8"
          : "text-primary hover:bg-primary/5",
      )}
    >
      {children}
    </Link>
  );
}
