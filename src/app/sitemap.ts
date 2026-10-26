// Deliberately excludes member lists, ballots, results and administrative URLs.
import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, siteOrigin } from "@/shared/metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({ url: `${siteOrigin()}${page.path}` }));
}
