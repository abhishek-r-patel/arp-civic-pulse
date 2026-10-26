// Shared server-rendered document; protected routes are not indexable by default.
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "@/components/ui/app-shell";
import { siteOrigin } from "@/shared/metadata";
import "@/styles/globals.css";

// next/font downloads Inter at build time and serves it from this application.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
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
    <html lang="en" className={inter.variable}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
