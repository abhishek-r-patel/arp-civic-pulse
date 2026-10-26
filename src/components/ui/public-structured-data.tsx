// Server-only public identity and breadcrumb schema; never describes private records.
import { PUBLIC_PAGES, siteOrigin } from "@/shared/metadata";

export function PublicStructuredData({
  path,
}: Readonly<{ path: (typeof PUBLIC_PAGES)[number]["path"] }>) {
  const origin = siteOrigin();
  const page = PUBLIC_PAGES.find((entry) => entry.path === path);
  if (!page) throw new Error("Unknown public schema route");
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: "Civic Pulse",
        url: origin,
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          url: `${origin}/contact`,
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Civic Pulse",
            item: `${origin}/sign-in`,
          },
          ...(path === "/sign-in"
            ? []
            : [
                {
                  "@type": "ListItem",
                  position: 2,
                  name: page.title,
                  item: `${origin}${path}`,
                },
              ]),
        ],
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
      }}
    />
  );
}
