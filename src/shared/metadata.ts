// Shared public metadata and the explicit crawlable route inventory.
import type { Metadata } from "next";

export const PUBLIC_PAGES = [
  {
    path: "/sign-in",
    title: "Sign in",
    description:
      "Sign in to Civic Pulse, the registered-member voting and polling service for your Resident Welfare Association.",
  },
  {
    path: "/privacy",
    title: "Privacy policy",
    description:
      "How Civic Pulse handles resident information, voting records, contact messages and optional analytics.",
  },
  {
    path: "/contact",
    title: "Contact",
    description:
      "Contact the Civic Pulse administrator for account, privacy and service enquiries. Never send voting selections or sign-in codes.",
  },
  {
    path: "/user-guide",
    title: "User Guide",
    description:
      "Choose an illustrated Resident or RWA Admin guide for Civic Pulse registration, voting, management and results.",
  },
  {
    path: "/user-guide/resident",
    title: "Resident Guide",
    description:
      "Learn how to register, sign in, vote in PUBLIC polls and PRIVATE elections, recover safely and view results.",
  },
  {
    path: "/user-guide/rwa-admin",
    title: "RWA Admin Guide",
    description:
      "Set up your RWA, manage residents and eligibility, prepare and monitor votes, and review results and audit history.",
  },
] as const;

// Main product website pages (served from src/app/site; see host-routes.ts).
export const MAIN_PUBLIC_PAGES = [
  {
    path: "/",
    title: "Voting and polls for Resident Welfare Associations",
    description:
      "Civic Pulse gives each Resident Welfare Association its own private site for registered-member polls and elections, with results, downloads and audit history.",
  },
  {
    path: "/contact",
    title: "Contact sales",
    description:
      "Ask about Civic Pulse for your Resident Welfare Association. Annual plans are quoted per association.",
  },
  {
    path: "/privacy",
    title: "Website privacy notice",
    description:
      "What the Civic Pulse product website collects, and how each RWA's own site handles resident information.",
  },
] as const;

export type PublicPagePath =
  | (typeof PUBLIC_PAGES)[number]["path"]
  | (typeof MAIN_PUBLIC_PAGES)[number]["path"];

// Last-resort origin when no request host is available (build-time rendering).
export function siteOrigin(): string {
  return new URL(process.env.APP_ORIGIN || "http://localhost:3000").origin;
}

/*
 * Canonical and Open Graph URLs are relative: the root layout sets
 * `metadataBase` to the requesting host's canonical origin, so each RWA host
 * and the main website describe their own address, never another host's.
 */
function pageMetadata(
  page: Readonly<{ path: string; title: string; description: string }>,
): Metadata {
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.path },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: "Civic Pulse",
      title: `${page.title} | Civic Pulse`,
      description: page.description,
      url: page.path,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: "Civic Pulse - Resident Welfare Association voting and polls",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${page.title} | Civic Pulse`,
      description: page.description,
      images: ["/opengraph-image"],
    },
  };
}

export function publicMetadata(
  path: (typeof PUBLIC_PAGES)[number]["path"],
): Metadata {
  const page = PUBLIC_PAGES.find((entry) => entry.path === path);
  if (!page) throw new Error("Unknown public metadata route");
  return pageMetadata(page);
}

export function mainPublicMetadata(
  path: (typeof MAIN_PUBLIC_PAGES)[number]["path"],
): Metadata {
  const page = MAIN_PUBLIC_PAGES.find((entry) => entry.path === path);
  if (!page) throw new Error("Unknown main website metadata route");
  return pageMetadata(page);
}

export function privateMetadata(title: string, description: string): Metadata {
  return { title, description, robots: { index: false, follow: false } };
}

export function privateRecordMetadata(
  title: string,
  description: string,
  route: string,
) {
  return async ({
    params,
  }: Readonly<{ params: Promise<{ id: string }> }>): Promise<Metadata> => {
    const { id } = await params;
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id,
      )
    ) {
      return privateMetadata(title, description);
    }
    return {
      ...privateMetadata(`${title} - ${id}`, description),
      alternates: {
        canonical: route.replace("[id]", id),
      },
    };
  };
}
