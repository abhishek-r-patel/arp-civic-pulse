import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResultsView } from "@/components/votes/results-view";
import { projectResults, rawResultsSchema } from "@/shared/contracts/results";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("PUBLIC results layout", () => {
  it("groups the outcome and totals in a card and keeps named responses unframed", () => {
    const results = projectResults(
      rawResultsSchema.parse({
        vote: {
          id: "00000000-0000-4000-8000-000000000001",
          votingType: "PUBLIC",
          openSelectionMode: "SINGLE",
          openSelectionLimit: 1,
          status: "COMPLETED",
          title: "Repaint the clubhouse?",
          instructions: null,
          closesAt: "2026-05-01T12:00:00.000Z",
          timezone: "Asia/Kolkata",
          rwaName: "Lakeview RWA",
          policyVersions: { A1: "v1" },
          activatedAt: "2026-04-20T05:00:00.000Z",
          completedAt: "2026-05-01T12:00:00.000Z",
          completionMode: "DEADLINE",
          completionReason: null,
        },
        eligibleCount: "4",
        submittedCount: "2",
        options: [
          {
            id: "00000000-0000-4000-8000-000000000010",
            label: "Yes",
            position: 1,
            count: "2",
          },
          {
            id: "00000000-0000-4000-8000-000000000011",
            label: "No",
            position: 2,
            count: "0",
          },
        ],
        offices: [],
        namedResponses: [
          {
            representativeName: "Example Resident",
            householdIdentifier: "A-101",
            optionLabels: ["Yes"],
            cursor: {
              key: "A-101",
              householdId: "00000000-0000-4000-8000-000000000101",
            },
          },
        ],
        namedPage: { hasMore: false },
      }),
    );
    const html = renderToStaticMarkup(
      createElement(ResultsView, {
        results,
        page: null,
        basePath: "/votes/example/results",
        formats: [],
        identifierLabel: "Flat Number",
      }),
    );

    expect(html).toContain(
      '<div class="mx-auto grid w-full max-w-5xl gap-4"><section aria-labelledby="totals"',
    );
    const totalsIndex = html.indexOf('aria-labelledby="totals"');
    const outcomeIndex = html.indexOf('role="status"');
    const namedIndex = html.indexOf('aria-labelledby="named"');
    expect(totalsIndex).toBeGreaterThan(-1);
    expect(outcomeIndex).toBeGreaterThan(totalsIndex);
    expect(html.slice(outcomeIndex, html.indexOf(">", outcomeIndex))).toContain(
      "border-success/50",
    );
    expect(html.slice(outcomeIndex, html.indexOf(">", outcomeIndex))).toContain(
      "bg-success/10",
    );
    expect(html.slice(outcomeIndex, html.indexOf(">", outcomeIndex))).toContain(
      "shadow-panel",
    );
    expect(namedIndex).toBeGreaterThan(totalsIndex);
    const totalsSection = html.slice(
      totalsIndex,
      html.indexOf("</section>", totalsIndex),
    );
    expect(totalsSection).toContain("rounded-card");
    expect(totalsSection).toContain('role="status"');
    expect(totalsSection).not.toContain("max-w-ballot");
    expect(html.slice(namedIndex, html.indexOf(">", namedIndex))).not.toContain(
      "rounded-card",
    );
    const descriptionIndex = html.indexOf("While voting is open", namedIndex);
    const descriptionStart = html.lastIndexOf("<p", descriptionIndex);
    const description = html.slice(
      descriptionStart,
      html.indexOf("</p>", descriptionIndex),
    );
    expect(description).toContain('class="text-body text-muted"');
    expect(description).not.toContain("max-w-ballot");
    expect(html).toMatch(/<thead role="rowgroup">/u);
    expect(html).not.toContain("max-md:block");
    expect(html).toContain("min-w-[36rem]");
  });

  it("uses a full-width card and bars for a single PRIVATE office", () => {
    const results = projectResults(
      rawResultsSchema.parse({
        vote: {
          id: "00000000-0000-4000-8000-000000000001",
          votingType: "PRIVATE",
          openSelectionMode: "SINGLE",
          openSelectionLimit: 1,
          status: "COMPLETED",
          title: "Committee election",
          instructions: null,
          closesAt: "2026-05-01T12:00:00.000Z",
          timezone: "Asia/Kolkata",
          rwaName: "Lakeview RWA",
          policyVersions: { A1: "v1" },
          activatedAt: "2026-04-20T05:00:00.000Z",
          completedAt: "2026-05-01T12:00:00.000Z",
          completionMode: "DEADLINE",
          completionReason: null,
        },
        eligibleCount: "4",
        submittedCount: "2",
        options: [],
        offices: [
          {
            id: "00000000-0000-4000-8000-000000000020",
            name: "Chair",
            position: 1,
            notaCount: "0",
            candidates: [
              {
                id: "00000000-0000-4000-8000-000000000021",
                name: "Asha",
                position: 1,
                count: "2",
              },
            ],
          },
        ],
        namedResponses: null,
        namedPage: null,
      }),
    );
    const html = renderToStaticMarkup(
      createElement(ResultsView, {
        results,
        page: null,
        basePath: "/votes/example/results",
        formats: [],
        identifierLabel: "Flat Number",
      }),
    );

    expect(html).toContain('<div class="mx-auto grid w-full max-w-5xl gap-4">');
    expect(html).not.toContain("md:grid-cols-2");
    const officeIndex = html.indexOf('aria-labelledby="office-');
    const officeCard = html.slice(
      officeIndex,
      html.indexOf("</section>", officeIndex),
    );
    expect(officeCard).toContain("rounded-card");
    expect(officeCard).toContain("Elected candidate");
    expect(officeCard).toContain("p-4 md:p-5");
    expect(officeCard).not.toContain("max-w-ballot");
  });
});
