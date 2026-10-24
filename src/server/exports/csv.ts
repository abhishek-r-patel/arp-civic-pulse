import type { VoteResults } from "@/shared/contracts/results";

/*
 * CSV export of a COMPLETED result (docs/API.md section 5.2). One rectangular
 * schema with fixed columns; unused cells are empty. The whole document is
 * rendered in memory from the same projection the screen and API use, so
 * nothing is sent until it is complete. No emails, counters or selection
 * history ever appear, and a CLOSED export carries no identity columns.
 */
export const CSV_COLUMNS = [
  "recordType",
  "rwaName",
  "voteTitle",
  "votingType",
  "timezone",
  "activatedAt",
  "completedAt",
  "completionMode",
  "completionReason",
  "generatedAt",
  "office",
  "label",
  "count",
  "numerator",
  "denominator",
  "percent",
  "outcome",
  "representativeName",
  "householdIdentifier",
  "choice",
  "notice",
] as const;
type Column = (typeof CSV_COLUMNS)[number];
type Cells = Partial<Record<Column, string | null>>;

// Spreadsheets treat these leading characters as a formula (CSV injection).
const FORMULA_START = /^[\t\r ]*[=+\-@]|^[\t\r]/u;
// Control characters other than tab and line breaks have no place in a record.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;
const NEEDS_QUOTES = /[",\r\n]/u;

export function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  let text = value
    .replace(CONTROL, "")
    .replace(/\r\n|\r/gu, "\n")
    .normalize("NFC");
  if (FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/** Excel needs the byte-order mark to read UTF-8 names correctly. */
const BOM = "\uFEFF";
const EOL = "\r\n";

const joinLabels = (labels: readonly string[]) => labels.join("; ");

export function renderResultsCsv(
  results: VoteResults,
  generatedAt: Date,
): string {
  const { vote } = results;
  const meta: Cells = {
    rwaName: vote.rwaName,
    voteTitle: vote.title,
    votingType: vote.votingType,
    timezone: vote.timezone,
    activatedAt: vote.activatedAt,
    completedAt: vote.completedAt,
    completionMode: vote.completionMode,
    completionReason: vote.completionReason,
    generatedAt: generatedAt.toISOString(),
  };
  const rows: Cells[] = [];
  const add = (recordType: string, cells: Cells) =>
    rows.push({ ...meta, recordType, ...cells });

  if (results.votingType === "OPEN") {
    const leaders = results.options
      .filter((option) => results.leaderOptionIds.includes(option.id))
      .map((option) => option.label);
    add("SUMMARY", {
      label: "Poll outcome",
      count: results.submittedCount,
      outcome: results.outcome,
      choice: joinLabels(leaders),
    });
  } else {
    add("SUMMARY", {
      label: "Election results",
      count: results.submittedCount,
    });
  }

  add("TURNOUT", {
    label: "Turnout",
    numerator: results.turnout.numerator,
    denominator: results.turnout.denominator,
    percent: results.turnout.percent,
  });

  if (results.votingType === "OPEN") {
    for (const option of results.options) {
      add("OPTION", {
        label: option.label,
        count: option.count,
        numerator: option.count,
        denominator: results.submittedCount,
        percent: option.percent,
      });
    }
    for (const named of results.namedResponses) {
      add("NAMED_RESPONSE", {
        representativeName: named.representativeName,
        householdIdentifier: named.householdIdentifier,
        choice: named.optionLabel,
      });
    }
  } else {
    for (const office of results.offices) {
      for (const candidate of office.candidates) {
        add("CANDIDATE", {
          office: office.name,
          label: candidate.name,
          count: candidate.count,
          numerator: candidate.count,
          denominator: results.submittedCount,
          percent: candidate.percent,
        });
      }
      add("ABSTENTION", {
        office: office.name,
        label: "Abstain",
        count: office.abstention.count,
        numerator: office.abstention.count,
        denominator: results.submittedCount,
        percent: office.abstention.percent,
      });
      add("OFFICE_OUTCOME", {
        office: office.name,
        outcome: office.outcome,
        choice: joinLabels(
          office.candidates
            .filter((candidate) =>
              office.leaderCandidateIds.includes(candidate.id),
            )
            .map((candidate) => candidate.name),
        ),
      });
    }
  }

  if (vote.instructions) {
    add("NOTICE", { label: "Instructions", notice: vote.instructions });
  }
  if (vote.completionMode === "EARLY") {
    add("NOTICE", {
      label: "Completed early",
      notice: `Voting was completed early by an administrator. Reason: ${vote.completionReason ?? "not recorded"}`,
    });
  }
  add("NOTICE", { label: "Record", notice: results.disclaimer });

  const lines = rows.map((row) =>
    CSV_COLUMNS.map((column) => csvCell(row[column])).join(","),
  );
  return BOM + [CSV_COLUMNS.join(","), ...lines].join(EOL) + EOL;
}

/** A server-generated name: only the completion date and a short random-looking id. */
export function exportFilename(results: VoteResults): string {
  const date = results.vote.completedAt.slice(0, 10);
  return `civic-pulse-results-${date}-${results.vote.id.slice(0, 8)}.csv`;
}
