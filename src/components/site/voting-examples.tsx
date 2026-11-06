// Clearly fictional completed PUBLIC and PRIVATE examples for the product homepage.
"use client";

import { useState } from "react";

type ExampleMode = "PUBLIC" | "PRIVATE";

const PUBLIC_RESULTS = [
  { label: "Garden & walking paths", count: 54, percent: 60 },
  { label: "Children's play area", count: 27, percent: 30 },
  { label: "Community lounge", count: 9, percent: 10 },
] as const;

const PRIVATE_RESULTS = [
  { label: "Nisha Rao", count: 47, percent: 39 },
  { label: "Rohan Mehta", count: 31, percent: 26 },
  { label: "NOTA (None of the Above)", count: 4, percent: 3 },
] as const;

export function VotingExamples() {
  const [mode, setMode] = useState<ExampleMode>("PUBLIC");
  const isPublic = mode === "PUBLIC";
  const results = isPublic ? PUBLIC_RESULTS : PRIVATE_RESULTS;

  return (
    <figure data-voting-example={mode} className="product-vote-example">
      <div className="product-example-heading">
        <div>
          <p className="product-example-rwa">The Courtyard RWA</p>
          <p className="product-example-subtitle">Completed vote example</p>
        </div>
        <span className="product-example-fictional">
          Fictional data, not a live result
        </span>
      </div>
      <div
        role="group"
        aria-label="Voting example"
        className="product-example-switch"
      >
        <button
          type="button"
          aria-pressed={isPublic}
          onClick={() => setMode("PUBLIC")}
          className={isPublic ? "is-selected" : undefined}
        >
          PUBLIC poll
        </button>
        <button
          type="button"
          aria-pressed={!isPublic}
          onClick={() => setMode("PRIVATE")}
          className={!isPublic ? "is-selected" : undefined}
        >
          PRIVATE election
        </button>
      </div>
      <div className="product-example-status">
        <span>{isPublic ? "PUBLIC poll" : "PRIVATE election"}</span>
        <span>Completed</span>
      </div>
      <h2 className="product-example-question">
        {isPublic
          ? "Which shared space should we improve next?"
          : "Choose a committee chair"}
      </h2>
      <p className="product-example-description">
        {isPublic
          ? "Final responses are available to authorized members after completion."
          : "Completed election · aggregate results only"}
      </p>
      <ul
        className="product-example-results"
        aria-label={`${isPublic ? "Fictional PUBLIC poll" : "Fictional PRIVATE election aggregate"} results`}
      >
        {results.map((result, index) => (
          <li key={result.label}>
            <div className="product-example-result-label">
              <span>{result.label}</span>
              <span>
                {result.count} / {isPublic ? "90" : "120 eligible"} ·{" "}
                {result.percent}%
              </span>
            </div>
            <div className="product-example-track" aria-hidden="true">
              <div
                className={
                  index === 0
                    ? "product-example-bar is-leading"
                    : "product-example-bar"
                }
                style={{ width: `${result.percent}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="product-example-turnout">
        {isPublic
          ? "90 of 120 eligible homes participated"
          : "82 of 120 eligible homes participated · 68% turnout"}
      </p>
      {!isPublic ? (
        <p className="product-example-privacy">
          Candidate and NOTA totals are aggregated. Individual ballots are never
          shown. This is application level privacy, not cryptographic anonymity.
        </p>
      ) : null}
      <figcaption className="product-example-caption">
        Illustrative completed {isPublic ? "poll" : "PRIVATE election"};
        fictional data, not a live result.
      </figcaption>
    </figure>
  );
}
