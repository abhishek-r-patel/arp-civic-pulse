import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  csvCell,
  exportFilename,
  renderResultsCsv,
} from "@/server/exports/csv";
import {
  projectResults,
  RESULTS_DISCLAIMER,
  type ClosedResults,
  type OpenResults,
  type RawResults,
} from "@/shared/contracts/results";

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const vote = (
  overrides: Partial<RawResults["vote"]> = {},
): RawResults["vote"] => ({
  id: ID(1),
  votingType: "OPEN",
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

const cursor = { key: "A-1", householdId: ID(9) };

function open(overrides: Partial<RawResults> = {}): RawResults {
  return {
    vote: vote(),
    eligibleCount: "7",
    submittedCount: "3",
    options: [
      { id: ID(10), label: "Yes", position: 1, count: "2" },
      { id: ID(11), label: "No", position: 2, count: "1" },
    ],
    offices: [],
    namedResponses: [
      {
        representativeName: "Alice Rao",
        householdIdentifier: "A-101",
        optionId: ID(10),
        optionLabel: "Yes",
        cursor,
      },
    ],
    namedPage: { hasMore: false },
    ...overrides,
  };
}

function closed(overrides: Partial<RawResults> = {}): RawResults {
  return {
    vote: vote({ votingType: "CLOSED" }),
    eligibleCount: "4",
    submittedCount: "3",
    options: [],
    offices: [
      {
        id: ID(20),
        name: "Chair",
        position: 1,
        abstentionCount: "1",
        candidates: [
          { id: ID(21), name: "Asha", position: 1, count: "1" },
          { id: ID(22), name: "Ravi", position: 2, count: "1" },
        ],
      },
      {
        id: ID(30),
        name: "Treasurer",
        position: 2,
        abstentionCount: "3",
        candidates: [{ id: ID(31), name: "Meera", position: 1, count: "0" }],
      },
    ],
    namedResponses: null,
    namedPage: null,
    ...overrides,
  };
}

describe("projectResults", () => {
  it("derives turnout, percentages and a leader for an open poll, with the disclaimer", () => {
    const r = projectResults(open()) as OpenResults;
    expect(r.turnout).toEqual({
      numerator: "3",
      denominator: "7",
      percent: "42.86",
    });
    expect(r.options.map((o) => o.percent)).toEqual(["66.67", "33.33"]);
    expect(r.outcome).toBe("LEADER");
    expect(r.leaderOptionIds).toEqual([ID(10)]);
    expect(r.disclaimer).toBe(RESULTS_DISCLAIMER);
    // The cursor is paging plumbing and never part of the projection.
    expect(JSON.stringify(r)).not.toContain('"cursor"');
  });

  it("reports ties, no votes and zero turnout without inventing numbers", () => {
    const tie = projectResults(
      open({
        submittedCount: "2",
        options: [
          { id: ID(10), label: "Yes", position: 1, count: "1" },
          { id: ID(11), label: "No", position: 2, count: "1" },
        ],
      }),
    ) as OpenResults;
    expect(tie.outcome).toBe("TIE");
    expect(tie.leaderOptionIds).toHaveLength(2);

    const none = projectResults(
      open({
        eligibleCount: "0",
        submittedCount: "0",
        options: [{ id: ID(10), label: "Yes", position: 1, count: "0" }],
        namedResponses: [],
      }),
    ) as OpenResults;
    expect(none.outcome).toBe("NO_VOTES");
    expect(none.turnout.percent).toBeNull();
    expect(none.options[0]?.percent).toBeNull();
  });

  it("derives per-office outcomes with abstention separate from candidates", () => {
    const r = projectResults(closed()) as ClosedResults;
    const [chair, treasurer] = r.offices;
    expect(chair?.outcome).toBe("TIE");
    expect(chair?.abstention).toEqual({ count: "1", percent: "33.33" });
    // All three abstained: no candidate leads.
    expect(treasurer?.outcome).toBe("NO_WINNER");
    expect(treasurer?.leaderCandidateIds).toEqual([]);
    expect(treasurer?.abstention.percent).toBe("100.00");
    expect("namedResponses" in r).toBe(false);
  });

  it("stays exact for counts beyond double precision", () => {
    const r = projectResults(
      open({
        eligibleCount: "9007199254740993",
        submittedCount: "9007199254740993",
        options: [
          { id: ID(10), label: "Yes", position: 1, count: "9007199254740993" },
        ],
      }),
    ) as OpenResults;
    expect(r.turnout.percent).toBe("100.00");
    expect(r.options[0]?.count).toBe("9007199254740993");
  });
});

describe("csvCell", () => {
  it("quotes commas, quotes and line breaks and normalizes newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\r\ntwo\rthree")).toBe('"one\ntwo\nthree"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
  });

  it.each(["=SUM(A1)", "+1", "-1+2", "@cmd", "\t=1", " =1", '=HYPERLINK("x")'])(
    "neutralizes the formula starter %j",
    (value) => {
      const cell = csvCell(value);
      expect(cell.replace(/^"/u, "").startsWith("'")).toBe(true);
    },
  );

  it("keeps unicode and strips control characters", () => {
    expect(csvCell("Ananya Ṛaó 李")).toBe("Ananya Ṛaó 李");
    expect(csvCell("a\u0000b\u0007c")).toBe("abc");
  });
});

describe("renderResultsCsv", () => {
  const generated = new Date("2026-05-02T00:00:00.000Z");

  // Minimal RFC 4180 reader: proves the output round-trips, quotes included.
  function parseCsv(csv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    const text = csv.replace(/^\uFEFF/u, "");
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i] as string;
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\r" && text[i + 1] === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        i += 1;
      } else {
        cell += ch;
      }
    }
    return rows;
  }

  it("writes a BOM, CRLF line endings and the fixed header", () => {
    const csv = renderResultsCsv(projectResults(open()), generated);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).not.toMatch(/[^\r]\n/u);
    expect(parseCsv(csv)[0]).toEqual([...CSV_COLUMNS]);
  });

  it("is rectangular and includes SUMMARY, TURNOUT, OPTION, NAMED_RESPONSE and NOTICE rows for an open poll", () => {
    const rows = parseCsv(renderResultsCsv(projectResults(open()), generated));
    expect(rows.slice(1).map((r) => r[0])).toEqual([
      "SUMMARY",
      "TURNOUT",
      "OPTION",
      "OPTION",
      "NAMED_RESPONSE",
      "NOTICE",
    ]);
    for (const row of rows) {
      expect(row).toHaveLength(CSV_COLUMNS.length);
    }
    const col = (name: (typeof CSV_COLUMNS)[number]) =>
      CSV_COLUMNS.indexOf(name);
    const named = rows.find((r) => r[0] === "NAMED_RESPONSE");
    expect(named?.[col("representativeName")]).toBe("Alice Rao");
    expect(named?.[col("householdIdentifier")]).toBe("A-101");
    expect(named?.[col("choice")]).toBe("Yes");
    expect(rows.find((r) => r[0] === "SUMMARY")?.[col("outcome")]).toBe(
      "LEADER",
    );
    expect(rows.at(-1)?.[col("notice")]).toBe(RESULTS_DISCLAIMER);
    // Report metadata repeats on every row.
    expect(new Set(rows.slice(1).map((r) => r[col("rwaName")]))).toEqual(
      new Set(["Lakeview RWA"]),
    );
  });

  it("carries only aggregates for a closed vote, with identity columns blank", () => {
    const csv = renderResultsCsv(projectResults(closed()), generated);
    expect(csv).not.toContain("NAMED_RESPONSE");
    const rows = parseCsv(csv).slice(1);
    const name = CSV_COLUMNS.indexOf("representativeName");
    const household = CSV_COLUMNS.indexOf("householdIdentifier");
    for (const row of rows) {
      expect(row[name]).toBe("");
      expect(row[household]).toBe("");
    }
    expect(rows.map((r) => r[0])).toEqual(
      expect.arrayContaining(["CANDIDATE", "ABSTENTION", "OFFICE_OUTCOME"]),
    );
  });

  it("labels an early completion with its reason", () => {
    const csv = renderResultsCsv(
      projectResults(
        open({
          vote: vote({
            completionMode: "EARLY",
            completionReason: "Quorum reached",
          }),
        }),
      ),
      generated,
    );
    expect(csv).toContain("Completed early");
    expect(csv).toContain("Quorum reached");
  });

  it("protects spreadsheets from hostile names and labels", () => {
    const csv = renderResultsCsv(
      projectResults(
        open({
          vote: vote({ title: '=HYPERLINK("http://x")' }),
          namedResponses: [
            {
              representativeName: "@SUM(1+1)",
              householdIdentifier: "-2+3",
              optionId: ID(10),
              optionLabel: "Yes",
              cursor,
            },
          ],
        }),
      ),
      generated,
    );
    expect(csv).toContain("'@SUM(1+1)");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/mu);
  });

  it("generates a safe filename that never includes the title", () => {
    const name = exportFilename(
      projectResults(open({ vote: vote({ title: "../../etc/passwd" }) })),
    );
    expect(name).toBe("civic-pulse-results-2026-05-01-00000000.csv");
  });
});
