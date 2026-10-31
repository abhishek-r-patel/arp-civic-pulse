// Server-only guards and data for the main product website (src/app/site).
import "server-only";
import { notFound } from "next/navigation";
import {
  activeSiteOrigin,
  getRequestTenantContext,
} from "@/server/config/tenant-context";
import { getEnvironment } from "@/server/config/environment";

/*
 * The `/site` pages exist only for the main host, which reaches them through a
 * proxy rewrite. Any other host (an RWA, the demo, or a single-RWA deployment)
 * gets a 404, so RWA visitors never see product marketing at `/site`.
 */
export async function requireMainHost(): Promise<void> {
  const tenant = await getRequestTenantContext();
  if (tenant.kind !== "main") notFound();
}

export function mainSiteLinks(): {
  demoOrigin: string | undefined;
  salesEmail: string | undefined;
} {
  return {
    demoOrigin: activeSiteOrigin("demo"),
    salesEmail: getEnvironment().SALES_CONTACT_EMAIL,
  };
}
