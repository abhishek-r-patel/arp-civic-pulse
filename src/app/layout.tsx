// Shared server-rendered document; protected routes are not indexable by default.
import type { Metadata, Viewport } from "next";
import { Manrope, Sora } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "@/components/ui/app-shell";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { APPEARANCE_BOOTSTRAP } from "@/shared/theme";
import { siteOrigin } from "@/shared/metadata";
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

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: {
    default: "Civic Pulse",
    template: "%s | Civic Pulse",
  },
  description:
    "Mobile-first voting and polls for a Resident Welfare Association.",
  robots: { index: false, follow: false },
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION || undefined },
};

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
