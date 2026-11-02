import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  PdfUnsupportedTextError,
  renderResultsPdf,
  segmentRuns,
} from "@/server/exports/pdf";
import { projectResults, type RawResults } from "@/shared/contracts/results";
import { buildHouseholdTerms } from "@/shared/contracts/household-terms";

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
      openRaw(3, (i) => ["Alice Rao", "Bob Iyer", "Dave Nair"][i] as string, {
        rwaName: "Lakeview Residents Welfare Association",
        instructions: "Residents may select one option.",
      }),
    );
    if (results.votingType !== "PUBLIC") {
      throw new Error("Expected a PUBLIC results fixture.");
    }
    const pdf = await renderResultsPdf(results, generated, {
      terms: buildHouseholdTerms("Flat", "ID"),
      rwaAlias: "Lakeview RWA",
      rwaContact: {
        address: "1 Example Road, Sample City",
        email: "office@lakeview.example.test",
        phone: "+91 123 456 7890",
      },
      publicResponses: results.namedResponses.map((response, index) => ({
        ...response,
        email: `resident${index + 1}@example.test`,
      })),
    });
    await keep("open-small.pdf", pdf);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const read = await readPdf(pdf);
    expect(read.pages).toHaveLength(2);
    expect(read.sizes[0]?.map(Math.round)).toEqual([595, 842]);
    const text = squash(read.text);
    for (const expected of [
      "Repaint the clubhouse?",
      "Lakeview Residents Welfare Association",
      "Lakeview RWA",
      "1 Example Road, Sample City",
      "office@lakeview.example.test",
      "Opens at 20 Apr 2026, 10:30 AM",
      "Closed at 1 May 2026, 5:30 PM",
      "VOTE BACKGROUND",
      "Residents may select one option.",
      "3 of 8 flats participated",
      "RESULTS",
      "Completed",
      "PUBLIC Voting",
      "Outcome",
      "LEADING",
      "Yes, repaint",
      "Yes, repaint 2 25%",
      "No 1 13%",
      "REPRESENTATIVES WHO VOTED",
      "FLAT ID",
      "EMAIL",
      "CHOICE",
      "Alice Rao",
      "H-0001",
      "resident1@example.test",
      "Page 1 of 2",
      "Page 2 of 2",
    ]) {
      expect(text, expected).toContain(squash(expected));
    }
    expect(text).not.toContain("Leading option");
    expect(squash(read.pages[0] ?? "")).toContain(
      squash("Outcome Yes, repaint LEADING"),
    );
    expect(squash(read.pages[1] ?? "")).not.toContain("Whilevotingisopen");
    expect(squash(read.pages[1] ?? "")).toContain("FLATID");
    expect(squash(read.pages[1] ?? "")).toContain("CHOICE");
    expect(text).not.toContain("This record is not a signature");
    expect(squash(read.pages[0] ?? "")).not.toContain("AliceRao");
    expect(squash(read.pages[1] ?? "")).toContain("AliceRao");
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
      squash(p).includes("HOUSEHOLDNUMBERREPRESENTATIVEEMAILCHOICE"),
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

  it("renders a branded PRIVATE summary and setting-labelled voter roster without choices", async () => {
    const results = projectResults(closedRaw());
    const pdf = await renderResultsPdf(results, generated, {
      terms: buildHouseholdTerms("Flat", "ID"),
      rwaAlias: "Lakeview RWA",
      rwaContact: {
        address: "1 Example Road, Sample City",
        email: "contact@example.test",
        phone: "+91 123 456 7890",
      },
      privateVoters: [
        {
          representativeName: "Asha Rao",
          householdIdentifier: "A-101",
          email: "asha@example.test",
        },
        {
          representativeName: "Ravi Nair",
          householdIdentifier: "B-102",
          email: "ravi@example.test",
        },
      ],
    });
    await keep("closed.pdf", pdf);
    const read = await readPdf(pdf);
    expect(read.pages).toHaveLength(2);
    const text = squash(read.text);
    for (const expected of [
      "Repaint the clubhouse?",
      "Opens at 20 Apr 2026, 10:30 AM",
      "Closed at 1 May 2026, 5:30 PM",
      "3 of 4 flats participated",
      "RESULTS",
      "Completed",
      "PRIVATE Voting",
      "REPRESENTATIVES WHO VOTED",
      "FLAT ID",
      "REPRESENTATIVE",
      "EMAIL",
      "Chair",
      "Treasurer",
      "TIE",
      "Asha; Ravi",
      "NOTA (None of the Above)",
      "No candidate elected",
      "Choose one per office.",
      "A-101 Asha Rao asha@example.test",
      "B-102 Ravi Nair ravi@example.test",
      "This is a computer-generated letter and does not require a signature",
      "Page 1 of 2",
      "Page 2 of 2",
    ]) {
      expect(text, expected).toContain(squash(expected));
    }
    expect(text).not.toContain("IST");
    expect(text).not.toContain("This record is not a signature");
    expect(text).not.toContain("Who chose what");
    expect(text).not.toContain("People who run the system");
    expect(text).not.toContain("Asha (Tied)");
    expect(squash(read.pages[1] ?? "")).not.toContain("CHOICE");
    expect(squash(read.pages[0] ?? "")).toContain(
      squash("Chair Asha; Ravi TIE"),
    );
    expect(squash(read.pages[0] ?? "")).toContain(
      squash("Treasurer No candidate elected NO WINNER"),
    );
  });

  it("refuses to render a PRIVATE PDF without its voter roster", async () => {
    await expect(
      renderResultsPdf(projectResults(closedRaw()), generated),
    ).rejects.toThrow("A PRIVATE PDF requires its completed voter roster.");
  });

  it("keeps seven two-column office cards on the first page", async () => {
    const raw = closedRaw();
    const template = raw.offices[0];
    if (!template) {
      throw new Error("Expected a PRIVATE office fixture.");
    }
    raw.offices = Array.from({ length: 7 }, (_, index) => ({
      ...template,
      id: ID(100 + index),
      name: `Office ${index + 1}`,
      position: index + 1,
      candidates: template.candidates.map((candidate, candidateIndex) => ({
        ...candidate,
        id: ID(200 + index * 10 + candidateIndex),
      })),
    }));
    const results = projectResults(raw);
    const read = await readPdf(
      await renderResultsPdf(results, generated, { privateVoters: [] }),
    );
    expect(read.pages).toHaveLength(2);
    const firstPage = squash(read.pages[0] ?? "");
    for (let index = 1; index <= 7; index += 1) {
      expect(firstPage).toContain(`Office${index}`);
    }
  });

  it("fits 50 voter rows on the roster page and continues larger lists with repeated headers", async () => {
    const results = projectResults(closedRaw());
    const voters = Array.from({ length: 50 }, (_, index) => ({
      representativeName: `Resident ${String(index + 1).padStart(2, "0")}`,
      householdIdentifier: `A-${String(index + 1).padStart(3, "0")}`,
      email: `resident${String(index + 1).padStart(2, "0")}@example.test`,
    }));
    const fifty = await readPdf(
      await renderResultsPdf(results, generated, { privateVoters: voters }),
    );
    expect(fifty.pages).toHaveLength(2);
    expect(squash(fifty.pages[1] ?? "")).toContain("resident50@example.test");

    const sixty = await readPdf(
      await renderResultsPdf(results, generated, {
        privateVoters: [
          ...voters,
          ...voters.slice(0, 10).map((voter, index) => ({
            ...voter,
            householdIdentifier: `B-${String(index + 1).padStart(3, "0")}`,
            email: `extra${String(index + 1).padStart(2, "0")}@example.test`,
          })),
        ],
      }),
    );
    expect(sixty.pages.length).toBeGreaterThan(2);
    expect(squash(sixty.text)).toContain("REPRESENTATIVESWHOVOTED·CONTINUED");
    expect(squash(sixty.text)).toContain("extra10@example.test");
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
    expect(text).toContain(squash("Yes, repaint 0 —"));
    expect(text).toContain(
      squash("No votes were submitted, so no option leads."),
    );
    expect(text).toContain(squash("No responses to list."));
    expect(text).not.toContain("NaN");
  });

  it("labels a tied PUBLIC poll as TIE", async () => {
    const raw = openRaw(2, (index) => `Resident ${index}`);
    const text = squash(
      (await readPdf(await renderResultsPdf(projectResults(raw), generated)))
        .text,
    );
    expect(text).toContain("TIE");
    expect(text).not.toContain("TIED");
  });

  it("refuses to produce a PDF when any text is outside the approved scripts", async () => {
    const results = projectResults(
      openRaw(2, (i) => (i === 1 ? "李小龍" : "Alice")),
    );
    await expect(renderResultsPdf(results, generated)).rejects.toThrow(
      PdfUnsupportedTextError,
    );
  });

  it("uses branded RGB accents without CMYK output", async () => {
    const pdf = await renderResultsPdf(
      projectResults(openRaw(3, (i) => `Resident ${i}`)),
      generated,
      {
        compress: false,
      },
    );
    const content = pdf.toString("latin1");
    const colors = [
      ...content.matchAll(/([0-9.]+) ([0-9.]+) ([0-9.]+) (?:scn|SCN)/gu),
    ];
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.some(([, r, g, b]) => r !== g || g !== b)).toBe(true);
    expect(content).not.toMatch(/\s[0-9.]+ [0-9.]+ [0-9.]+ [0-9.]+ (?:k|K)\s/u);
    expect(content).not.toContain("/DeviceCMYK");
  });
});
