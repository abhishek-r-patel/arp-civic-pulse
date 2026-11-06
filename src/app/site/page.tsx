// Main product website home: explain the RWA offer and preserve its public routes.
import type { Metadata } from "next";
import { Fragment } from "react";
import { PublicStructuredData } from "@/components/ui/public-structured-data";
import { LandingMotion } from "@/components/site/landing-motion";
import { VotingExamples } from "@/components/site/voting-examples";
import { mainSiteLinks, requireMainHost } from "@/server/site/main-host";
import { mainPublicMetadata } from "@/shared/metadata";

export const metadata: Metadata = {
  ...mainPublicMetadata("/"),
  title: { absolute: "Civic Pulse | Online voting and polls for RWAs" },
};

const BENEFITS = [
  {
    title: "Set who can participate",
    text: "Choose eligible homes for each vote. The electorate is fixed when a vote is activated or scheduled.",
  },
  {
    title: "Keep PUBLIC and PRIVATE distinct",
    text: "PUBLIC responses become attributable to authorized members after completion. PRIVATE choices remain aggregate totals in the application.",
  },
  {
    title: "Let residents vote by phone",
    text: "Residents sign in with an email code and use a clear, responsive voting experience.",
  },
  {
    title: "Review results and audit history",
    text: "Authorized administrators can download completed PDF reports and operator enabled CSV files. The audit history cannot be edited or deleted.",
  },
] as const;

const STEPS = [
  {
    title: "Prepare resident access",
    text: "Set up the association site and review the resident register before inviting participation.",
  },
  {
    title: "Create the vote",
    text: "Choose PUBLIC or PRIVATE, define eligible homes, and set when voting opens and closes.",
  },
  {
    title: "Review the outcome",
    text: "Residents submit from their devices. After completion, authorized users can review results and available reports.",
  },
] as const;

const FAQS = [
  {
    question: "What is Civic Pulse?",
    answer:
      "An online voting and polling service for Resident Welfare Associations, with separate PUBLIC and PRIVATE vote types.",
  },
  {
    question: "How do PUBLIC and PRIVATE votes differ?",
    answer:
      "PUBLIC final responses are attributable to authorized members after completion. PRIVATE results show aggregate choices, not individual ballots. Application level privacy cannot prevent every inference by privileged operators or in very small elections.",
  },
  {
    question: "Who can vote?",
    answer:
      "An enabled representative can vote only when their home is eligible for that specific vote. The eligible electorate is fixed when the vote is activated or scheduled.",
  },
  {
    question: "Can a resident change a submitted vote?",
    answer:
      "A PUBLIC response can be replaced while the vote is active and before its deadline. A PRIVATE election submission is final.",
  },
  {
    question: "How do residents sign in?",
    answer:
      "Residents use a one time code sent to their email. A self registered account needs administrator review and enablement before it can access the voting site.",
  },
  {
    question: "What reports are available?",
    answer:
      "Authorized management can download a PDF after a vote completes. CSV is available only when the deployment operator enables it. Residents review results in the app.",
  },
  {
    question: "How is pricing determined?",
    answer:
      "Civic Pulse has an annual plan quoted for each association. Ask us for current pricing and service details.",
  },
] as const;

export default async function MainHomePage() {
  await requireMainHost();
  const { demoOrigin } = mainSiteLinks();

  return (
    <div data-product-home>
      <PublicStructuredData path="/" />
      <LandingMotion>
        <section className="product-hero" aria-labelledby="hero-title">
          <div className="product-hero-copy">
            <p className="product-eyebrow">For Resident Welfare Associations</p>
            <h1 className="product-title" id="hero-title">
              Online voting for every RWA decision.
            </h1>
            <p className="product-lede">
              Give each eligible home a clear way to take part in PUBLIC polls
              and PRIVATE elections, with phone friendly voting and printable
              results.
            </p>
            <div className="product-actions">
              <a href="/contact" className="product-primary">
                Ask for a quote
              </a>
              {demoOrigin ? (
                <a href={demoOrigin} className="product-secondary">
                  Try the demo
                </a>
              ) : null}
            </div>
            <p className="product-proof-line">
              One response per eligible home.
            </p>
          </div>
          <div id="examples" className="product-example-wrap">
            <VotingExamples />
          </div>
        </section>

        <section
          className="product-tagline"
          aria-label="Civic Pulse benefit"
          data-scroll-reveal
        >
          <h2 className="product-tagline-text">
            {[
              "Fair",
              "voting",
              "for",
              "every",
              "home.",
              "Clear",
              "results",
              "for",
              "every",
              "community.",
            ].map((word, index) => (
              <Fragment key={`${word}-${index}`}>
                <span data-tagline-word data-word-index={index}>
                  {word}
                </span>
                {index === 4 ? <br /> : " "}
              </Fragment>
            ))}
          </h2>
        </section>

        <section
          id="features"
          className="product-section"
          aria-labelledby="benefits-title"
          data-scroll-reveal
        >
          <header className="product-section-header">
            <p className="product-eyebrow">A clearer way to decide together</p>
            <h2 className="product-section-title" id="benefits-title">
              The rules stay clear. The result is easier to review.
            </h2>
          </header>
          <div className="product-benefits">
            {BENEFITS.map((benefit, index) => (
              <article
                key={benefit.title}
                className={`product-benefit product-benefit-${index + 1}`}
              >
                <h3>{benefit.title}</h3>
                <p>{benefit.text}</p>
              </article>
            ))}
          </div>
          <p className="product-privacy-note">
            PRIVATE elections provide application level privacy, not
            cryptographic anonymity. Privileged operators and small election
            inference remain limitations.{" "}
            <a href="/privacy">Read the privacy notice</a>
          </p>
        </section>

        <section
          id="how-it-works"
          className="product-section"
          aria-labelledby="steps-title"
          data-scroll-reveal
        >
          <header className="product-section-header">
            <p className="product-eyebrow">From setup to results</p>
            <h2 className="product-section-title" id="steps-title">
              Three steps from a question to a recorded outcome.
            </h2>
          </header>
          <ol className="product-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="product-step-number" aria-hidden="true">
                  0{index + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="product-pricing"
          id="pricing"
          aria-labelledby="pricing-title"
          data-scroll-reveal
        >
          <div className="product-pricing-copy">
            <p className="product-eyebrow">One annual plan</p>
            <h2 className="product-section-title" id="pricing-title">
              A dedicated voting site for your association.
            </h2>
            <p>
              Pricing is quoted based on the size of your RWA. Ask us for
              current pricing and service details.
            </p>
            <a href="/contact" className="product-primary">
              Ask for a quote
            </a>
          </div>
          <ul className="product-plan-list">
            <li>Your own site and separate database</li>
            <li>PUBLIC polls and PRIVATE elections</li>
            <li>Setup of your first administrator</li>
            <li>Completed results in the app</li>
            <li>Printable PDF reports and CSV when enabled</li>
            <li>Support by email</li>
            <li>An audit history that cannot be edited or deleted</li>
          </ul>
        </section>

        <section
          className="product-section"
          id="faq"
          aria-labelledby="faq-title"
          data-scroll-reveal
        >
          <header className="product-section-header">
            <p className="product-eyebrow">Questions, answered plainly</p>
            <h2 className="product-section-title" id="faq-title">
              Before your association starts.
            </h2>
          </header>
          <div className="product-faq">
            {FAQS.map((item) => (
              <article key={item.question} className="product-faq-item">
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="product-final-cta"
          id="contact"
          aria-labelledby="contact-title"
          data-scroll-reveal
        >
          <p className="product-eyebrow">Start with a conversation</p>
          <h2 className="product-section-title" id="contact-title">
            Online voting for every RWA decision.
          </h2>
          <p>
            {demoOrigin
              ? "Explore the shared fictional association as a resident, committee member, or RWA Admin with one click sign in and no email needed. The demo resets regularly."
              : "A demo site with a fictional association is being prepared. Contact us for a walkthrough."}
          </p>
          <div className="product-actions">
            <a href="/contact" className="product-primary">
              Ask for a quote
            </a>
            {demoOrigin ? (
              <a href={demoOrigin} className="product-secondary">
                Try the demo
              </a>
            ) : (
              <a href="/contact" className="product-text-link">
                Request a walkthrough
              </a>
            )}
          </div>
        </section>
      </LandingMotion>
    </div>
  );
}
