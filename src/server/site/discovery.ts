// Server-only per-host discovery lists for robots.txt, the sitemap and structured data.
import "server-only";
import { getRequestTenantContext } from "@/server/config/tenant-context";
import { MAIN_PUBLIC_PAGES, PUBLIC_PAGES, siteOrigin } from "@/shared/metadata";

export interface HostDiscovery {
  origin: string;
  kind: "single" | "main" | "demo" | "customer";
  /** Pages this host asks search engines to index; empty for the demo. */
  pages: ReadonlyArray<{ path: string; title: string }>;
}

/*
 * Each host lists only its own pages at its own origin. The demo is never
 * indexed (fictional data), and the main website lists only product pages.
 */
export async function hostDiscovery(): Promise<HostDiscovery> {
  let origin = siteOrigin();
  let kind: HostDiscovery["kind"] = "single";
  try {
    const tenant = await getRequestTenantContext();
    origin = tenant.canonicalOrigin;
    kind = tenant.kind;
  } catch {
    // The proxy already refused unknown hosts.
  }
  const pages =
    kind === "main" ? MAIN_PUBLIC_PAGES : kind === "demo" ? [] : PUBLIC_PAGES;
  return { origin, kind, pages };
}
