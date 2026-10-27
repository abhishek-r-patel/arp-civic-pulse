import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  PdfUnsupportedTextError,
  renderResultsPdf,
  segmentRuns,
} from "@/server/exports/pdf";
import {
  projectResults,
  RESULTS_DISCLAIMER,
  type RawResults,
} from "@/shared/contracts/results";

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const generated = new Date("2026-05-02T06:30:00.000Z");

const baseVote = (
  overrides: Partial<RawResults["vote"]> = {},
): RawResults["vote"] => ({
  id: ID(1),
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
  ...overrides,
});

function openRaw(
  count: number,
  name: (i: number) => string,
  vote: Partial<RawResults["vote"]> = {},
): RawResults {
  const yes = Math.ceil(count / 2);
  return {
    vote: baseVote(vote),
    eligibleCount: String(count + 5),
    submittedCount: String(count),
    options: [
      { id: ID(10), label: "Yes, repaint", position: 1, count: String(yes) },
      { id: ID(11), label: "No", position: 2, count: String(count - yes) },
    ],
    offices: [],
    namedResponses: Array.from({ length: count }, (_, i) => ({
      representativeName: name(i),
      householdIdentifier: `H-${String(i).padStart(4, "0")}`,
      optionLabels: [i % 2 === 0 ? "Yes, repaint" : "No"],
      cursor: { key: "k", householdId: ID(9) },
    })),
    namedPage: { hasMore: false },
  };
}

function closedRaw(): RawResults {
  return {
    vote: baseVote({
      votingType: "PRIVATE",
      instructions: "Choose one per office.",
    }),
    eligibleCount: "4",
    submittedCount: "3",
    options: [],
    offices: [
      {
        id: ID(20),
        name: "Chair",
        position: 1,
        notaCount: "1",
        candidates: [
          { id: ID(21), name: "Asha", position: 1, count: "1" },
          { id: ID(22), name: "Ravi", position: 2, count: "1" },
        ],
      },
      {
        id: ID(30),
        name: "Treasurer",
        position: 2,
        notaCount: "3",
        candidates: [{ id: ID(31), name: "Meera", position: 1, count: "0" }],
      },
    ],
    namedResponses: null,
    namedPage: null,
  };
}

async function readPdf(buffer: Buffer) {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
  }).promise;
  const pages: string[] = [];
  const sizes: [number, number][] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
    sizes.push([x1 - x0, y1 - y0]);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
    );
  }
  const info = (await doc.getMetadata()).info as Record<string, unknown>;
  return { pages, sizes, info, text: pages.join("\n") };
}

// Squash whitespace differences: text extraction splits runs differently from layout.
const squash = (text: string) => text.replace(/\s+/gu, "");

const samples = join(process.cwd(), "test-results", "pdf-samples");
async function keep(name: string, buffer: Buffer) {
  await mkdir(samples, { recursive: true });
  await writeFile(join(samples, name), buffer);
}

describe("segmentRuns", () => {
  it("uses Inter for Latin and the Devanagari face only where needed", () => {
    expect(segmentRuns("Alice Rao", false)).toEqual([
      { face: "Inter", text: "Alice Rao" },
    ]);
    const mixed = segmentRuns("Rahul राहुल शर्मा Sharma", false);
    expect(mixed.map((r) => r.face)).toEqual(["Inter", "Deva", "Inter"]);
    expect(mixed.map((r) => r.text).join("")).toBe("Rahul राहुल शर्मा Sharma");
    expect(segmentRuns("बोल्ड", true)[0]?.face).toBe("Deva-Bold");
  });

  it("keeps conjuncts and joiners inside one run so shaping is not broken", () => {
    // क्ष (ka + virama + ssa) and a zero-width joiner sequence.
    const runs = segmentRuns("क्षत्रिय क\u094d\u200dष", false);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.face).toBe("Deva");
  });

  it.each([
    ["CJK", "李小龍"],
    ["emoji", "Vote 🗳️"],
    ["Arabic", "مرحبا"],
    ["a control character", "bad\u0007name"],
  ])("fails loudly for %s instead of dropping it", (_label, text) => {
    expect(() => segmentRuns(text, false)).toThrow(PdfUnsupportedTextError);
  });
});

describe("renderResultsPdf", () => {
  it("renders an A4 PDF with the same facts as the screen, CSV and API", async () => {
    const results = projectResults(
      openRaw(3, (i) => ["Alice Rao", "Bob Iyer", "Dave Nair"][i] as string),
    );
    const pdf = await renderResultsPdf(results, generated);
    await keep("open-small.pdf", pdf);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const read = await readPdf(pdf);
    expect(read.pages).toHaveLength(1);
    expect(read.sizes[0]?.map(Math.round)).toEqual([595, 842]);
    const text = squash(read.text);
    for (const expected of [
      "Repaint the clubhouse?",
      "Lakeview RWA",
      "Mon 20 Apr 2026, 10:30 AM IST",
      "Fri 1 May 2026, 5:30 PM IST",
      "Households that voted 3/8 38%",
      "Leading option: Yes, repaint",
      "Yes, repaint (Leading) 2/8 25%",
      "No 1/8 13%",
      "Alice Rao",
      "H-0001",
      "Page 1 of 1",
      "Asia/Kolkata",
      RESULTS_DISCLAIMER,
      "not a backup, an electronic signature, or a certificate",
    ]) {
      expect(text, expected).toContain(squash(expected));
    }
    expect(read.info.Title).toBe("Results: Repaint the clubhouse?");
  });

  it("lists every named response across pages, with a repeated header and page numbers", async () => {
    const count = 500;
    const results = projectResults(
      openRaw(count, (i) => `Resident ${String(i).padStart(3, "0")} Surname`),
    );
    const started = Date.now();
    const pdf = await renderResultsPdf(results, generated);
    const elapsed = Date.now() - started;
    await keep("open-500.pdf", pdf);

    const read = await readPdf(pdf);
    expect(read.pages.length).toBeGreaterThan(8);
    const text = squash(read.text);
    for (let i = 0; i < count; i += 1) {
      expect(text, `row ${i}`).toContain(
        `Resident${String(i).padStart(3, "0")}Surname`,
      );
    }
    // Header repeats on every continuation page.
    const withHeader = read.pages.filter((p) =>
      squash(p).includes("RepresentativeHouseholdNumberChoice"),
    );
    expect(withHeader.length).toBeGreaterThanOrEqual(read.pages.length - 1);
    // Page X of N on every page, N correct.
    read.pages.forEach((page, index) => {
      expect(squash(page)).toContain(`Page${index + 1}of${read.pages.length}`);
    });
    expect(elapsed).toBeLessThan(10_000);
    expect(pdf.length).toBeLessThan(5_000_000);
  }, 60_000);

  it("shapes and wraps long, multiscript and unbroken text instead of clipping it", async () => {
    const long = "Venkata Subrahmanyam Lakshmi Narasimha Rao ".repeat(5).trim();
    const unbroken = `H${"0123456789".repeat(9)}`;
    const names = [
      long,
      "राहुल शर्मा (Rahul Sharma)",
      "क्षत्रिय ज्ञानी श्रीमती अनुराधा",
      "José Ångström Çelik Ñandú",
      "Ольга Иванова",
      unbroken,
    ];
    const results = projectResults(
      openRaw(names.length, (i) => names[i] as string),
    );
    const pdf = await renderResultsPdf(results, generated);
    await keep("open-multiscript.pdf", pdf);

    const read = await readPdf(pdf);
    const text = squash(read.text);
    // Latin, accented Latin and Cyrillic come out exactly; long/unbroken text is complete.
    for (const expected of [
      long,
      "José Ångström Çelik Ñandú",
      "Ольга Иванова",
      unbroken,
    ]) {
      expect(text, expected).toContain(squash(expected));
    }
    // Devanagari glyphs are embedded (a subset of Noto Sans Devanagari), not substituted.
    expect(pdf.includes(Buffer.from("NotoSansDevanagari"))).toBe(true);
    expect(pdf.includes(Buffer.from("Inter"))).toBe(true);
  });

  it("carries only aggregates for a PRIVATE vote, with the instructions and no identity", async () => {
    const results = projectResults(closedRaw());
    const pdf = await renderResultsPdf(results, generated);
    await keep("closed.pdf", pdf);
    const text = squash((await readPdf(pdf)).text);
    for (const expected of [
      "Chair",
      "Treasurer",
      "NOTA (None of the Above)",
      "Tie. These candidates received the same highest count: Asha; Ravi",
      "No winner: no candidate received a vote.",
      "Choose one per office.",
      "Asha (Tied) 1/4 25%",
      "Ravi (Tied) 1/4 25%",
      "Meera 0/4 0%",
      "NOTA (None of the Above) 3/4 75%",
      "Your selections are not shown to the Resident, RWA Admin or RWA ReadOnly personas through the app",
    ]) {
      expect(text, expected).toContain(squash(expected));
    }
    expect(text).not.toContain("Who chose what");
    expect(text).not.toMatch(/H-\d{4}/u);
  });

  it("labels an early completion with its reason", async () => {
    const results = projectResults(
      openRaw(2, (i) => `Person ${i}`, {
        completionMode: "EARLY",
        completionReason: "Quorum reached",
      }),
    );
    const text = squash(
      (await readPdf(await renderResultsPdf(results, generated))).text,
    );
    expect(text).toContain(
      squash("Completed early by an administrator. Reason: Quorum reached"),
    );
  });

  it("states zero turnout and no leader without inventing numbers", async () => {
    const raw = openRaw(0, () => "x");
    raw.eligibleCount = "0";
    const text = squash(
      (await readPdf(await renderResultsPdf(projectResults(raw), generated)))
        .text,
    );
    expect(text).toContain(
      squash("No households were eligible for this vote."),
    );
    expect(text).toContain(squash("Yes, repaint 0/0 —"));
    expect(text).toContain(
      squash("No votes were submitted, so no option leads."),
    );
    expect(text).toContain(squash("No responses to list."));
    expect(text).not.toContain("NaN");
  });

  it("refuses to produce a PDF when any text is outside the approved scripts", async () => {
    const results = projectResults(
      openRaw(2, (i) => (i === 1 ? "李小龍" : "Alice")),
    );
    await expect(renderResultsPdf(results, generated)).rejects.toThrow(
      PdfUnsupportedTextError,
    );
  });

  it("uses neutral grays only: every color has equal red, green and blue", async () => {
    const pdf = await renderResultsPdf(projectResults(closedRaw()), generated, {
      compress: false,
    });
    const content = pdf.toString("latin1");
    const colors = [
      ...content.matchAll(/([0-9.]+) ([0-9.]+) ([0-9.]+) (?:scn|SCN)/gu),
    ];
    expect(colors.length).toBeGreaterThan(0);
    for (const [, r, g, b] of colors) {
      expect(r === g && g === b, `${r} ${g} ${b}`).toBe(true);
    }
    expect(content).not.toMatch(/\s[0-9.]+ [0-9.]+ [0-9.]+ [0-9.]+ (?:k|K)\s/u);
    expect(content).not.toContain("/DeviceCMYK");
  });
});
