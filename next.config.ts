// Security headers; optional public analytics uses narrowly scoped Google endpoints.
import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const analyticsEnabled = Boolean(process.env.GOOGLE_ANALYTICS_ID);

function supabaseOrigin(): string | undefined {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

// Next.js injects inline bootstrap scripts, so script-src needs 'unsafe-inline'
// until a nonce-based policy is adopted. Everything else stays restrictive.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}${analyticsEnabled ? " https://www.googletagmanager.com" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${supabaseOrigin() ? ` ${supabaseOrigin()}` : ""}${isProduction ? "" : " ws: wss:"}${analyticsEnabled ? " https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // PDFKit and fontkit read their data files at run time; bundling them breaks that.
  serverExternalPackages: ["pdfkit", "fontkit"],
  // The PDF renderer loads the bundled fonts from disk: keep them in a traced build output.
  outputFileTracingIncludes: {
    "/api/votes/[id]/exports/[format]": ["./public/fonts/pdf/**/*"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Member data must never be stored by shared caches. Static assets keep
        // the framework's immutable caching.
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
