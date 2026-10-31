// Server-only public identity and breadcrumb schema; never describes private records.
import { hostDiscovery } from "@/server/site/discovery";
import type { PublicPagePath } from "@/shared/metadata";

export async function PublicStructuredData({
  path,
}: Readonly<{ path: PublicPagePath }>) {
  const { origin, kind, pages } = await hostDiscovery();
  const page = pages.find((entry) => entry.path === path);
  // The demo is not indexed, so it publishes no schema.
  if (!page) return null;
  const home = kind === "main" ? "/" : "/sign-in";
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
            item: `${origin}${home}`,
          },
          ...(path === home
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
