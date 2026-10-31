// Public discovery only; authorization, not robots.txt, protects resident data.
import type { MetadataRoute } from "next";
import { hostDiscovery } from "@/server/site/discovery";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { origin, kind, pages } = await hostDiscovery();
  if (kind === "demo") {
    return { rules: { userAgent: "*", disallow: ["/"] } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: [...pages.map((page) => `${page.path}$`), "/opengraph-image"],
      disallow: ["/", "/api/", "/admin/", "/votes/"],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
