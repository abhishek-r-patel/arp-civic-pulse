// Route-derived navigation uses generic record labels rather than resident details.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const labels: Record<string, string> = {
  "sign-in": "Sign in",
  privacy: "Privacy policy",
  contact: "Contact",
  admin: "Administration",
  votes: "Votes",
  accounts: "Accounts",
  households: "Households",
  audit: "Audit history",
  new: "New",
  results: "Results",
  preview: "Preview ballot",
  participation: "Participation",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  if (
    !parts.length ||
    parts.some((part) => !labels[part] && !/^[a-f0-9-]{36}$/i.test(part))
  )
    return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-6 text-caption text-muted">
      <ol className="flex flex-wrap items-center gap-2">
        <li>
          <a
            href={
              parts[0] === "admin" || parts[0] === "votes" ? "/" : "/sign-in"
            }
            className="inline-flex min-h-12 items-center text-accent underline"
          >
            Civic Pulse
          </a>
        </li>
        {parts.map((part, index) => (
          <li key={index} className="flex items-center gap-2">
            <ChevronRight aria-hidden="true" className="size-4" />
            {index === parts.length - 1 ? (
              <span aria-current="page">{labels[part] ?? "Details"}</span>
            ) : (
              <Link
                href={
                  index === 0 && part === "votes"
                    ? "/"
                    : `/${parts.slice(0, index + 1).join("/")}`
                }
                className="inline-flex min-h-12 items-center text-accent underline"
              >
                {labels[part] ?? "Details"}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
