// Shared server-rendered document; protected routes are not indexable by default.
import type { Metadata, Viewport } from "next";
import { Manrope, Sora } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "@/components/ui/app-shell";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { APPEARANCE_BOOTSTRAP } from "@/shared/theme";
import { siteOrigin } from "@/shared/metadata";
import {
  getRequestTenantContext,
  type TenantContext,
} from "@/server/config/tenant-context";
import "@/styles/globals.css";

// Browser font requests stay on this application; PDF fonts remain independently bundled.
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});
const sora = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sora",
});

/*
 * `metadataBase` is the requesting host's own canonical origin, so relative
 * canonical, Open Graph and share-image URLs never point at another RWA's host.
 */
export async function generateMetadata(): Promise<Metadata> {
  let origin = siteOrigin();
  let kind: TenantContext["kind"] = "single";
  try {
    const tenant = await getRequestTenantContext();
    origin = tenant.canonicalOrigin;
    kind = tenant.kind;
  } catch {
    // The proxy already refused unknown hosts; fall back to the configured origin.
  }
  return {
    metadataBase: new URL(origin),
    title: {
      default: "Civic Pulse",
      template: "%s | Civic Pulse",
    },
    description:
      kind === "main"
        ? "Voting and polls for Resident Welfare Associations, with a private site for each association."
        : "Mobile-first voting and polls for a Resident Welfare Association.",
    robots: { index: false, follow: false },
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${sora.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
      </head>
      <body>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
