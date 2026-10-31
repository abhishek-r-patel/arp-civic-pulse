// Deliberately excludes member lists, ballots, results and administrative URLs.
import type { MetadataRoute } from "next";
import { hostDiscovery } from "@/server/site/discovery";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { origin, pages } = await hostDiscovery();
  return pages.map((page) => ({
    url: page.path === "/" ? origin : `${origin}${page.path}`,
  }));
}
