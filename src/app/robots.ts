// Public discovery only; authorization, not robots.txt, protects resident data.
import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, siteOrigin } from "@/shared/metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        ...PUBLIC_PAGES.map((page) => `${page.path}$`),
        "/opengraph-image",
      ],
      disallow: ["/", "/api/", "/admin/", "/votes/"],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
