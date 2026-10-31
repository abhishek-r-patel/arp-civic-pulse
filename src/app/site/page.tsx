// Main product website home: what Civic Pulse does, how it is sold, and where to try it.
import type { Metadata } from "next";
import { PublicStructuredData } from "@/components/ui/public-structured-data";
import { mainSiteLinks, requireMainHost } from "@/server/site/main-host";
import { mainPublicMetadata } from "@/shared/metadata";

export const metadata: Metadata = {
  ...mainPublicMetadata("/"),
  title: { absolute: "Civic Pulse | Voting and polls for RWAs" },
};

const FEATURES = [
  {
    title: "Polls and elections",
    text: "Run PUBLIC polls, where members can see who chose each option once the poll ends, or PRIVATE elections for committee posts, which store totals for each choice but no ballot linked to a person's choice.",
  },
  {
    title: "One vote per home",
    text: "Keep a register of homes and residents, choose which homes are eligible for each vote, and accept one response per home.",
  },
  {
    title: "Simple, safe sign-in",
    text: "Residents sign in with a one-time code sent to their email. No passwords to remember, and new residents are enabled only by your administrators.",
  },
  {
    title: "Results you can share",
    text: "Publish results when a vote closes, download CSV and PDF copies for your records, and review an audit history that cannot be edited or deleted.",
  },
  {
    title: "Your own private site",
    text: "Each association gets its own web address and its own separate database, with your name, contact details and colours.",
  },
  {
    title: "Works on any phone",
    text: "Designed for small screens first, with large touch targets, light and dark themes and accessible forms.",
  },
] as const;

export default async function MainHomePage() {
  await requireMainHost();
  const { demoOrigin } = mainSiteLinks();
  const sectionHeading =
    "font-heading text-section font-semibold text-primary md:text-section-lg";

  return (
    <div className="grid gap-12">
      <PublicStructuredData path="/" />
      <section className="grid gap-4">
        <h1 className="font-heading text-page-title font-semibold md:text-page-title-lg">
          Voting and polls for Resident Welfare Associations
        </h1>
        <p className="max-w-3xl text-body text-muted">
          Civic Pulse helps your RWA ask residents what they think and run
          committee elections online, with one vote per home, clear results and
          a record you can trust.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/contact"
            className="inline-flex touch-target items-center justify-center rounded-control border border-accent bg-accent px-4 py-3 text-body font-semibold text-on-accent hover:bg-accent-strong"
          >
            Ask for a quote
          </a>
          {demoOrigin ? (
            <a
              href={demoOrigin}
              className="inline-flex touch-target items-center justify-center rounded-control border border-control-border bg-surface px-4 py-3 text-body font-semibold text-primary hover:bg-primary/5"
            >
              Try the demo
            </a>
          ) : null}
        </div>
      </section>

      <section
        id="features"
        aria-labelledby="features-heading"
        className="grid gap-4"
      >
        <h2 id="features-heading" className={sectionHeading}>
          What your association gets
        </h2>
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="grid content-start gap-2 rounded-control border border-border bg-surface p-4"
            >
              <h3 className="font-semibold text-primary">{feature.title}</h3>
              <p className="text-body text-muted">{feature.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="pricing"
        aria-labelledby="pricing-heading"
        className="grid gap-3"
      >
        <h2 id="pricing-heading" className={sectionHeading}>
          Pricing
        </h2>
        <div className="grid max-w-2xl gap-2 rounded-control border border-border bg-surface p-4">
          <h3 className="font-semibold text-primary">Annual plan</h3>
          <p className="text-body text-muted">
            One association, its own site and database, setup of your first
            administrator, and support by email. Prices depend on the size of
            your association: contact us for a quote.
          </p>
          <p>
            <a
              href="/contact"
              className="inline-flex touch-target items-center text-accent underline"
            >
              Contact us for a quote
            </a>
          </p>
        </div>
      </section>

      <section id="demo" aria-labelledby="demo-heading" className="grid gap-3">
        <h2 id="demo-heading" className={sectionHeading}>
          See it for yourself
        </h2>
        <p className="max-w-3xl text-body text-muted">
          {demoOrigin ? (
            <>
              The{" "}
              <a href={demoOrigin} className="text-accent underline">
                demo site
              </a>{" "}
              uses a fictional association. Sign in as a sample resident or
              committee member with one click; no email is needed and changes
              are turned off.
            </>
          ) : (
            <>
              A demo site with a fictional association is being prepared.{" "}
              <a href="/contact" className="text-accent underline">
                Contact us
              </a>{" "}
              for a walkthrough.
            </>
          )}
        </p>
      </section>
    </div>
  );
}
