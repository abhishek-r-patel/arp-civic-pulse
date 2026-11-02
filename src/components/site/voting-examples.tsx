// Fictional completed PUBLIC and PRIVATE result examples for the main-site hero.
"use client";

import { useState } from "react";
import { Check, CheckCheck, House, LockKeyhole, Vote } from "lucide-react";

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
    <figure
      data-voting-example={mode}
      className="product-preview relative min-w-0 rounded-[2rem] border border-accent/10 p-5 sm:p-8"
    >
      <div className="relative rounded-2xl border border-border bg-surface p-5 shadow-panel sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <House aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="font-semibold text-primary">The Courtyard RWA</p>
              <p className="text-caption text-muted">
                Your community, connected
              </p>
            </div>
          </div>
          <CheckCheck aria-hidden="true" className="size-5 text-accent" />
        </div>

        <div
          role="group"
          aria-label="Voting example"
          className="mt-5 grid grid-cols-2 gap-1 rounded-full border border-border bg-primary/5 p-1"
        >
          <button
            type="button"
            aria-pressed={isPublic}
            onClick={() => setMode("PUBLIC")}
            className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-3 text-caption font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${isPublic ? "bg-accent text-on-accent shadow-panel" : "text-primary hover:bg-surface"}`}
          >
            <Vote aria-hidden="true" className="size-4" />
            PUBLIC poll
          </button>
          <button
            type="button"
            aria-pressed={!isPublic}
            onClick={() => setMode("PRIVATE")}
            className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-3 text-caption font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${!isPublic ? "bg-accent text-on-accent shadow-panel" : "text-primary hover:bg-surface"}`}
          >
            <LockKeyhole aria-hidden="true" className="size-4" />
            PRIVATE election
          </button>
        </div>

        <div className="flex flex-wrap gap-2 pt-5 text-caption font-semibold">
          <span className="inline-flex items-center gap-2 rounded-full bg-secondary/10 px-3 py-1 text-secondary">
            {isPublic ? (
              <Vote aria-hidden="true" className="size-4" />
            ) : (
              <LockKeyhole aria-hidden="true" className="size-4" />
            )}
            {isPublic ? "PUBLIC poll" : "PRIVATE election"}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-success">
            <Check aria-hidden="true" className="size-4" /> Completed
          </span>
        </div>

        <h2 className="mt-4 text-xl font-semibold text-primary">
          {isPublic ? (
            <>
              A little more green.
              <br />A little more together.
            </>
          ) : (
            "Choose a committee chair"
          )}
        </h2>
        <p className="mt-2 text-caption text-muted">
          {isPublic
            ? "Which shared space should we improve next?"
            : "Completed election · aggregate results only"}
        </p>

        <ul className="mt-6 grid gap-5">
          {results.map((result, index) => (
            <li key={result.label}>
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-caption">
                <span className="font-medium text-primary">{result.label}</span>
                <span className="text-muted tabular-nums">
                  {result.count} / {isPublic ? "90" : "120 eligible"} ·{" "}
                  {result.percent}%
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
          {isPublic
            ? "90 of 120 eligible homes participated"
            : "82 of 120 eligible homes participated · 68% turnout"}
        </p>
        {!isPublic ? (
          <p className="mt-3 flex items-start gap-2 text-caption text-muted">
            <LockKeyhole
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-accent"
            />
            Candidate and NOTA totals are aggregated. Individual ballots are
            never shown.
          </p>
        ) : null}
      </div>
      <figcaption className="relative mt-4 text-center text-caption text-muted">
        An illustrative completed {isPublic ? "poll" : "PRIVATE election"} with
        fictional data, not a live result.
      </figcaption>
    </figure>
  );
}
