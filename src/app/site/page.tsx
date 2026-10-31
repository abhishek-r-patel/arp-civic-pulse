// Main product website home: what Civic Pulse does, how it is sold, and where to try it.
import type { Metadata } from "next";
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCheck,
  FileCheck2,
  Fingerprint,
  Globe2,
  House,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Smartphone,
  Vote,
} from "lucide-react";
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
    icon: Vote,
    text: "Everyday decisions or your next committee. PUBLIC polls reveal named responses after closure; PRIVATE elections store choice totals, not individual ballots.",
  },
  {
    title: "One vote per home",
    icon: House,
    text: "A clear resident register, an eligible electorate for each vote, and one response per home. Fair participation starts with the essentials.",
  },
  {
    title: "Simple, safe sign-in",
    icon: Fingerprint,
    text: "An email, a one-time code, and you're in. No passwords to remember. Your administrators decide which residents can access the site.",
  },
  {
    title: "Results you can share",
    icon: FileCheck2,
    text: "Clear results after closure, CSV and PDF downloads for your records, and an audit history that cannot be edited or deleted.",
  },
  {
    title: "Your own private site",
    icon: Globe2,
    text: "Your association's web address, name and colours. A separate database keeps your community's records apart from other associations.",
  },
  {
    title: "Works on any phone",
    icon: Smartphone,
    text: "A thoughtful, mobile-first experience with comfortable touch targets, accessible forms, and light and dark appearances.",
  },
] as const;

const STEPS = [
  {
    title: "Make it your community's",
    text: "Start with your own site, set up your administrators, and bring your resident register together.",
  },
  {
    title: "Put a decision to a vote",
    text: "Create a poll or election, choose eligible homes, and set when voting opens and closes.",
  },
  {
    title: "Move forward with clarity",
    text: "Residents vote from their phones. When voting ends, view results and download records.",
  },
] as const;

const SAMPLE_RESULTS = [
  { label: "Garden & walking paths", count: 54, percent: 60 },
  { label: "Children's play area", count: 27, percent: 30 },
  { label: "Community lounge", count: 9, percent: 10 },
] as const;

export default async function MainHomePage() {
  await requireMainHost();
  const { demoOrigin } = mainSiteLinks();

  return (
    <div data-product-home className="grid gap-16 md:gap-24">
      <PublicStructuredData path="/" />
      <section className="product-hero grid items-center gap-12 py-8 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:py-16">
        <div className="grid justify-items-start gap-6">
          <p className="product-eyebrow inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-2 text-caption font-semibold text-accent">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-accent"
            />
            For communities that care
          </p>
          <h1 className="product-title font-semibold text-primary">
            Better decisions.
            <br />
            <span className="text-accent">Stronger communities.</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted">
            Bring every home into the conversation. Thoughtful online voting and
            polls for Resident Welfare Associations, with clear results and a
            record you can trust.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <a href="/contact" className="product-primary">
              Ask for a quote{" "}
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
            {demoOrigin ? (
              <a href={demoOrigin} className="product-secondary">
                Try the demo
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
            ) : null}
          </div>
          <p className="flex items-center gap-2 text-caption text-muted">
            <ShieldCheck
              aria-hidden="true"
              className="size-4 shrink-0 text-accent"
            />
            One vote per home. A dedicated site for your RWA.
          </p>
        </div>

        <figure className="product-preview relative min-w-0 rounded-[2rem] border border-accent/10 p-5 sm:p-8">
          <div className="relative rounded-2xl border border-border bg-surface p-5 shadow-panel sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <House aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <p className="font-semibold text-primary">
                    The Courtyard RWA
                  </p>
                  <p className="text-caption text-muted">
                    Your community, connected
                  </p>
                </div>
              </div>
              <CheckCheck aria-hidden="true" className="size-5 text-accent" />
            </div>
            <div className="flex flex-wrap gap-2 pt-6 text-caption font-semibold">
              <span className="inline-flex items-center gap-2 rounded-full bg-secondary/10 px-3 py-1 text-secondary">
                <Vote aria-hidden="true" className="size-4" /> PUBLIC poll
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-success">
                <Check aria-hidden="true" className="size-4" /> Completed
              </span>
            </div>
            <h2 className="mt-4 text-xl font-semibold text-primary">
              A little more green.
              <br />A little more together.
            </h2>
            <p className="mt-2 text-caption text-muted">
              Which shared space should we improve next?
            </p>
            <ul className="mt-6 grid gap-5">
              {SAMPLE_RESULTS.map((result, index) => (
                <li key={result.label}>
                  <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-caption">
                    <span className="font-medium text-primary">
                      {result.label}
                    </span>
                    <span className="text-muted tabular-nums">
                      {result.count} / 90 &middot; {result.percent}%
                    </span>
                  </div>
                  <div
                    aria-hidden="true"
                    className="mt-2 h-2 overflow-hidden rounded-full bg-primary/5"
                  >
                    <div
                      className={`h-full rounded-full ${index === 0 ? "bg-accent" : "bg-muted/40"}`}
                      style={{ width: `${result.percent}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-6 flex items-center gap-2 border-t border-border pt-4 text-caption text-muted">
              <CheckCheck
                aria-hidden="true"
                className="size-4 shrink-0 text-accent"
              />
              90 of 120 eligible homes participated
            </p>
          </div>
          <figcaption className="relative mt-4 text-center text-caption text-muted">
            An illustrative poll with fictional data, not a live result.
          </figcaption>
        </figure>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-6 border-y border-border py-6">
        <p className="text-caption font-semibold text-muted">
          Built around what matters
        </p>
        {[
          { icon: House, label: "Fair participation" },
          { icon: LockKeyhole, label: "Clear privacy rules" },
          { icon: FileCheck2, label: "Records you can keep" },
        ].map(({ icon: Icon, label }) => (
          <p
            key={label}
            className="flex items-center gap-3 text-caption font-semibold text-primary"
          >
            <Icon aria-hidden="true" className="size-5 text-accent" />
            {label}
          </p>
        ))}
      </div>

      <section
        id="features"
        aria-labelledby="features-heading"
        className="grid gap-8"
      >
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="product-eyebrow text-caption font-semibold text-accent">
              Considered in every detail
            </p>
            <h2 id="features-heading" className="product-section-title mt-3">
              Everything your association needs.
              <br />
              Nothing in the way.
            </h2>
          </div>
          <a
            href="#how-it-works"
            className="inline-flex touch-target items-center gap-2 text-caption font-semibold text-accent"
          >
            A simpler way forward{" "}
            <ArrowDown aria-hidden="true" className="size-4" />
          </a>
        </div>
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ title, text, icon: Icon }) => (
            <li
              key={title}
              className="product-feature grid content-start gap-3 rounded-2xl border border-border bg-surface p-6 md:p-8"
            >
              <span className="mb-3 flex size-12 items-center justify-center rounded-xl bg-accent/8 text-accent">
                <Icon aria-hidden="true" className="size-6" />
              </span>
              <h3 className="text-lg font-semibold text-primary">{title}</h3>
              <p className="text-body leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ul>
        <p className="max-w-3xl text-caption leading-relaxed text-muted">
          PRIVATE elections provide application-level privacy, not cryptographic
          anonymity. Privileged operators and small-election inference remain
          limitations.{" "}
          <a
            href="/privacy"
            className="inline-flex touch-target items-center text-accent underline"
          >
            Read our privacy notice
          </a>
        </p>
      </section>

      <section
        id="how-it-works"
        aria-labelledby="how-heading"
        className="grid gap-10"
      >
        <div className="max-w-2xl">
          <p className="product-eyebrow text-caption font-semibold text-accent">
            From conversation to a decision
          </p>
          <h2 id="how-heading" className="product-section-title mt-3">
            Less coordination.
            <br />
            More community.
          </h2>
        </div>
        <ol className="grid gap-8 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="border-t border-border pt-6">
              <span
                className="font-heading text-3xl font-medium text-accent"
                aria-hidden="true"
              >
                0{index + 1}
              </span>
              <h3 className="mt-5 text-lg font-semibold text-primary">
                {step.title}
              </h3>
              <p className="mt-3 max-w-sm leading-relaxed text-muted">
                {step.text}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section
        id="pricing"
        aria-labelledby="pricing-heading"
        className="product-pricing grid items-center gap-8 rounded-[2rem] border border-accent/15 p-6 sm:p-10 lg:grid-cols-2 lg:gap-16 lg:p-12"
      >
        <div>
          <p className="product-eyebrow text-caption font-semibold text-accent">
            A plan for your community
          </p>
          <h2 id="pricing-heading" className="product-section-title mt-3">
            Your own space.
            <br />
            One annual plan.
          </h2>
          <p className="mt-5 max-w-md leading-relaxed text-muted">
            A dedicated home for your association&apos;s decisions. Pricing
            depends on the size of your RWA, with a quote tailored to your
            community.
          </p>
          <a href="/contact" className="product-primary mt-6">
            Contact us for a quote{" "}
            <ArrowRight aria-hidden="true" className="size-4" />
          </a>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-semibold text-primary">Annual plan</h3>
            <Globe2
              aria-hidden="true"
              className="size-6 shrink-0 text-accent"
            />
          </div>
          <p className="mt-2 text-caption text-muted">
            One association. A dedicated setup.
          </p>
          <ul className="mt-6 grid gap-4 border-t border-border pt-6">
            {[
              "Your own site and separate database",
              "PUBLIC polls and PRIVATE elections",
              "Setup of your first administrator",
              "CSV and PDF results downloads",
              "Support by email",
            ].map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 text-body text-primary"
              >
                <Check
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 text-accent"
                />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-6 border-t border-border pt-4 text-caption text-muted">
            Pricing tailored to your association&apos;s size.
          </p>
        </div>
      </section>

      <section
        id="demo"
        aria-labelledby="demo-heading"
        className="grid justify-items-center gap-5 py-4 text-center md:py-8"
      >
        <span className="flex size-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent/5 text-accent">
          <Vote aria-hidden="true" className="size-7" />
        </span>
        <p className="product-eyebrow text-caption font-semibold text-accent">
          Experience Civic Pulse
        </p>
        <h2 id="demo-heading" className="product-section-title">
          Your next chapter starts
          <br />
          with a conversation.
        </h2>
        <p className="max-w-2xl leading-relaxed text-muted">
          {demoOrigin ? (
            <>
              Explore a fictional association as a resident, committee member or
              RWA admin. One-click sign-in, no email needed. Visitors share the
              demo, and it is reset regularly.
            </>
          ) : (
            <>
              A demo site with a fictional association is being prepared.
              Contact us for a walkthrough of what Civic Pulse can bring to your
              community.
            </>
          )}
        </p>
        <a href={demoOrigin ?? "/contact"} className="product-primary mt-2">
          {demoOrigin ? "Try the demo" : "Request a walkthrough"}
          <ArrowRight aria-hidden="true" className="size-4" />
        </a>
        <a
          href="/contact"
          className="inline-flex touch-target items-center gap-2 text-caption font-semibold text-accent"
        >
          <Mail aria-hidden="true" className="size-4" /> Prefer a conversation?
          Contact sales
        </a>
      </section>
    </div>
  );
}
