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

export function siteOrigin(): string {
  return new URL(process.env.APP_ORIGIN || "http://localhost:3000").origin;
}

export function publicMetadata(
  path: (typeof PUBLIC_PAGES)[number]["path"],
): Metadata {
  const page = PUBLIC_PAGES.find((entry) => entry.path === path);
  if (!page) throw new Error("Unknown public metadata route");
  const url = new URL(path, siteOrigin()).href;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: "Civic Pulse",
      title: `${page.title} | Civic Pulse`,
      description: page.description,
      url,
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
        canonical: new URL(route.replace("[id]", id), siteOrigin()).href,
      },
    };
  };
}
