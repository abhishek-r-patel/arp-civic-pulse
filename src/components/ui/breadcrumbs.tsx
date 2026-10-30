// Route-derived navigation uses generic record labels rather than resident details.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useHouseholdTerms } from "./household-terms";

const baseLabels: Record<string, string> = {
  "sign-in": "Sign in",
  privacy: "Privacy policy",
  contact: "Contact",
  admin: "Administration",
  votes: "Votes",
  residents: "Residents",
  import: "Import Residents",
  households: "Households",
  settings: "Settings",
  audit: "Audit History",
  new: "New",
  results: "Results",
  preview: "Preview Ballot",
  participation: "Participation",
};

export function Breadcrumbs({
  homeLabel = "Civic Pulse",
}: Readonly<{ homeLabel?: string }>) {
  const pathname = usePathname();
  const terms = useHouseholdTerms();
  const labels: Record<string, string> = {
    ...baseLabels,
    households: terms.Households,
  };
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
            className="inline-flex touch-target items-center text-accent underline"
          >
            {homeLabel}
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
                className="inline-flex touch-target items-center text-accent underline"
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
