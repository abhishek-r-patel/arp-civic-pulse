import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { openSync, type Font } from "fontkit";
import { privacyCopy } from "@/components/votes/privacy-notice";
import {
  DEFAULT_HOUSEHOLD_TERMS,
  type HouseholdTerms,
} from "@/shared/contracts/household-terms";
import type { VoteResults } from "@/shared/contracts/results";
import { formatInZone } from "@/shared/time/zoned";

/*
 * A4 portrait, grayscale, locally generated PDF of a COMPLETED result
 * (docs/API.md section 5.2). It is rendered from exactly the same projection
 * as the screen, the API and the CSV, complete in memory, so a failure can
 * still be reported cleanly before any success header is sent.
 *
 * Text is laid out here, not by PDFKit's wrapper, so long names and
 * identifiers wrap, table rows continue across pages under a repeated header,
 * and every character is checked against the bundled fonts first: Inter for
 * Latin, Greek and Cyrillic, with Noto Sans Devanagari as the configured
 * fallback for Devanagari. A character neither font covers FAILS the export
 * with PdfUnsupportedTextError: it is never dropped or replaced by a box.
 */
export class PdfUnsupportedTextError extends Error {
  constructor() {
    super("The report contains text the bundled fonts cannot display.");
    this.name = "PdfUnsupportedTextError";
  }
}

const FONT_DIR = join(process.cwd(), "public", "fonts", "pdf");

// Approved scripts, in order of preference. Adding a script means bundling a licensed font here.
const FACES = [
  { id: "Inter", file: "Inter-Regular.ttf" },
  { id: "Inter-Bold", file: "Inter-Bold.ttf" },
  { id: "Deva", file: "NotoSansDevanagari-Regular.ttf" },
  { id: "Deva-Bold", file: "NotoSansDevanagari-Bold.ttf" },
] as const;
type FaceId = (typeof FACES)[number]["id"];

interface LoadedFace {
  id: FaceId;
  path: string;
  buffer: Buffer;
  font: Font;
}

let faces: Map<FaceId, LoadedFace> | undefined;

function loadFaces(): Map<FaceId, LoadedFace> {
  if (!faces) {
    faces = new Map(
      FACES.map(({ id, file }) => {
        const path = join(FONT_DIR, file);
        const buffer = readFileSync(path);
        return [id, { id, path, buffer, font: openSync(path) as Font }];
      }),
    );
  }
  return faces;
}

const PAGE = {
  width: 595.28,
  height: 841.89,
  left: 48,
  right: 48,
  top: 64,
  bottom: 64,
};
const BODY_WIDTH = PAGE.width - PAGE.left - PAGE.right;
// Neutral grays only (equal red, green and blue): prints and photocopies identically in black and white.
const INK = "#000000";
const MUTED = "#444444";
const RULE = "#999999";
const SHADE = "#e6e6e6";
const BAR_LEADER = "#1a1a1a";
const BAR_DEFAULT = "#808080";

interface Run {
  face: FaceId;
  text: string;
}

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

// Splits text into runs by font coverage, keeping combining sequences together.
export function segmentRuns(text: string, bold: boolean): Run[] {
  const set = loadFaces();
  const order: FaceId[] = bold
    ? ["Inter-Bold", "Deva-Bold"]
    : ["Inter", "Deva"];
  const runs: Run[] = [];
  let current: FaceId | undefined;

  for (const { segment } of segmenter.segment(text)) {
    const points = [...segment].map((c) => c.codePointAt(0) as number);
    // Control characters have no glyph and no business in a record.
    if (points.some((p) => p < 0x20 || (p >= 0x7f && p < 0xa0))) {
      throw new PdfUnsupportedTextError();
    }
    const covers = (id: FaceId) =>
      points.every((p) =>
        (set.get(id) as LoadedFace).font.hasGlyphForCodePoint(p),
      );
    // Stay in the current font when it can show this cluster: shaping stays intact.
    const face = current && covers(current) ? current : order.find(covers);
    if (!face) {
      throw new PdfUnsupportedTextError();
    }
    const last = runs.at(-1);
    if (last && last.face === face) {
      last.text += segment;
    } else {
      runs.push({ face, text: segment });
    }
    current = face;
  }
  return runs;
}

type Doc = InstanceType<typeof PDFDocument>;

class Writer {
  readonly doc: Doc;
  y = PAGE.top;
  private ink = "";
  private face = "";
  private fontSize = 0;
  private readonly title: string;

  constructor(
    private readonly rwaName: string,
    title: string,
    info: { generatedAt: Date; voteTitle: string; compress: boolean },
  ) {
    this.title = title;
    this.doc = new PDFDocument({
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
      compress: info.compress,
      autoFirstPage: false,
      // Grayscale-only output; PDFKit's own Helvetica data is never needed.
      font: (loadFaces().get("Inter") as LoadedFace).path,
      info: {
        Title: `Results: ${info.voteTitle}`.slice(0, 200),
        Author: rwaName.slice(0, 200),
        Creator: "Civic Pulse",
        Producer: "Civic Pulse (PDFKit)",
        CreationDate: info.generatedAt,
      },
    });
    for (const face of loadFaces().values()) {
      this.doc.registerFont(face.id, face.buffer);
    }
    this.newPage();
  }

  // Each page starts with PDF defaults, so the cached drawing state is void on a page change.
  private resetState(): void {
    this.ink = "";
    this.face = "";
    this.fontSize = 0;
  }

  newPage(): void {
    this.resetState();
    this.doc.addPage({
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    this.y = PAGE.top;
  }

  // Measuring is the hot path (every word of every row); results repeat a lot.
  private readonly widths = new Map<string, number>();

  private width(runs: Run[], size: number): number {
    let total = 0;
    for (const run of runs) {
      const key = `${run.face}|${size}|${run.text}`;
      let value = this.widths.get(key);
      if (value === undefined) {
        // fontkit measures the same shaped advance PDFKit uses, several times faster than doc.widthOfString.
        const { font } = loadFaces().get(run.face) as LoadedFace;
        value = (font.layout(run.text).advanceWidth * size) / font.unitsPerEm;
        this.widths.set(key, value);
      }
      total += value;
    }
    return total;
  }

  /** Greedy word wrap into lines of runs; words wider than the line are broken by character. */
  wrap(text: string, bold: boolean, size: number, maxWidth: number): Run[][] {
    const lines: Run[][] = [];
    for (const paragraph of text.split(/\r?\n/u)) {
      let line: Run[] = [];
      let lineWidth = 0;
      const push = (runs: Run[], width: number) => {
        line.push(...runs);
        lineWidth += width;
      };
      const flush = () => {
        lines.push(line);
        line = [];
        lineWidth = 0;
      };

      for (const token of paragraph.split(/(\s+)/u).filter((t) => t !== "")) {
        const space = /^\s+$/u.test(token);
        const runs = segmentRuns(space ? " " : token, bold);
        const width = this.width(runs, size);
        if (space) {
          if (line.length > 0) {
            push(runs, width);
          }
          continue;
        }
        if (lineWidth + width <= maxWidth) {
          push(runs, width);
          continue;
        }
        if (line.length > 0) {
          flush();
        }
        if (width <= maxWidth) {
          push(runs, width);
          continue;
        }
        // A single unbroken token longer than the line (an identifier, a URL): break between characters.
        for (const { segment } of segmenter.segment(token)) {
          const piece = segmentRuns(segment, bold);
          const pieceWidth = this.width(piece, size);
          if (lineWidth + pieceWidth > maxWidth && line.length > 0) {
            flush();
          }
          push(piece, pieceWidth);
        }
      }
      flush();
    }
    // Trailing spaces never contribute to a line's width or its right edge.
    return lines.map((l) => {
      const copy = l.map((r) => ({ ...r }));
      const last = copy.at(-1);
      if (last) {
        last.text = last.text.replace(/\s+$/u, "");
      }
      return copy;
    });
  }

  private drawLine(
    runs: Run[],
    x: number,
    y: number,
    size: number,
    color: string,
    align: "left" | "right",
    boxWidth: number,
  ): void {
    const total = this.width(runs, size);
    let cursor = align === "right" ? x + boxWidth - total : x;
    // PDFKit re-emits state on every call; only change what actually changed.
    if (this.ink !== color) {
      this.doc.fillColor(color);
      this.ink = color;
    }
    for (const run of runs) {
      if (this.face !== run.face) {
        this.doc.font(run.face);
        this.face = run.face;
      }
      if (this.fontSize !== size) {
        this.doc.fontSize(size);
        this.fontSize = size;
      }
      this.doc.text(run.text, cursor, y, { lineBreak: false });
      cursor += this.width([run], size);
    }
  }
  ensure(height: number): boolean {
    if (this.y + height > PAGE.height - PAGE.bottom) {
      this.newPage();
      return true;
    }
    return false;
  }

  gap(points: number): void {
    this.y += points;
  }

  paragraph(
    text: string,
    options: {
      size?: number;
      bold?: boolean;
      color?: string;
      indent?: number;
    } = {},
  ): void {
    const size = options.size ?? 10;
    const indent = options.indent ?? 0;
    const lineHeight = size * 1.4;
    for (const line of this.wrap(
      text,
      options.bold ?? false,
      size,
      BODY_WIDTH - indent,
    )) {
      this.ensure(lineHeight);
      this.drawLine(
        line,
        PAGE.left + indent,
        this.y,
        size,
        options.color ?? INK,
        "left",
        BODY_WIDTH - indent,
      );
      this.y += lineHeight;
    }
  }

  heading(text: string, size = 13): void {
    this.gap(10);
    // Keep a heading with at least a couple of lines of what follows.
    this.ensure(size * 1.4 + 40);
    this.paragraph(text, { size, bold: true });
    this.gap(2);
  }

  rule(): void {
    this.doc
      .save()
      .lineWidth(0.5)
      .strokeColor(RULE)
      .moveTo(PAGE.left, this.y)
      .lineTo(PAGE.width - PAGE.right, this.y)
      .stroke()
      .restore();
  }

  /**
   * "Label   count/total  percent" above a horizontal bar, one per row. Leaders
   * are bold, dark and tagged in text; NOTA ("muted") is hatched because it
   * cannot win. Bars stay legible in greyscale print.
   */
  bars(
    rows: readonly {
      label: string;
      value: string;
      percent: string | null;
      tone: "leader" | "default" | "muted";
    }[],
  ): void {
    const size = 10;
    const lineHeight = size * 1.4;
    const barHeight = 7;
    const valueWidth = 120;
    const labelWidth = BODY_WIDTH - valueWidth - 8;
    for (const row of rows) {
      const lines = this.wrap(
        row.label,
        row.tone === "leader",
        size,
        labelWidth,
      );
      this.ensure(lines.length * lineHeight + barHeight + 12);
      lines.forEach((line, n) =>
        this.drawLine(
          line,
          PAGE.left,
          this.y + n * lineHeight,
          size,
          INK,
          "left",
          labelWidth,
        ),
      );
      this.drawLine(
        segmentRuns(row.value, true),
        PAGE.left + BODY_WIDTH - valueWidth,
        this.y,
        size,
        INK,
        "right",
        valueWidth,
      );
      this.y += lines.length * lineHeight + 2;
      const fraction =
        row.percent === null ? 0 : Math.min(1, Number(row.percent) / 100);
      const filled = BODY_WIDTH * fraction;
      this.doc
        .save()
        .rect(PAGE.left, this.y, BODY_WIDTH, barHeight)
        .fill(SHADE)
        .restore();
      if (filled > 0) {
        if (row.tone === "muted") {
          this.doc.save().rect(PAGE.left, this.y, filled, barHeight).clip();
          this.doc.lineWidth(1.2).strokeColor(BAR_DEFAULT);
          for (let x = -barHeight; x < filled; x += 4) {
            this.doc
              .moveTo(PAGE.left + x, this.y + barHeight)
              .lineTo(PAGE.left + x + barHeight, this.y)
              .stroke();
          }
          this.doc.restore();
        } else {
          this.doc
            .save()
            .rect(PAGE.left, this.y, filled, barHeight)
            .fill(row.tone === "leader" ? BAR_LEADER : BAR_DEFAULT)
            .restore();
        }
      }
      this.y += barHeight + 10;
    }
  }

  table<Row>(
    columns: {
      header: string;
      width: number;
      align?: "left" | "right";
      bold?: boolean;
    }[],
    rows: readonly Row[],
    cell: (row: Row, index: number) => string[],
  ): void {
    const size = 9.5;
    const lineHeight = size * 1.4;
    const pad = 4;
    const total = columns.reduce((sum, c) => sum + c.width, 0);
    const scale = BODY_WIDTH / total;
    const widths = columns.map((c) => c.width * scale);

    const header = () => {
      const lines = columns.map((c, i) =>
        this.wrap(c.header, true, size, (widths[i] as number) - pad * 2),
      );
      const height =
        Math.max(...lines.map((l) => l.length)) * lineHeight + pad * 2;
      this.ensure(height + lineHeight * 2);
      this.doc
        .save()
        .rect(PAGE.left, this.y, BODY_WIDTH, height)
        .fill(SHADE)
        .restore();
      let x = PAGE.left;
      lines.forEach((cellLines, i) => {
        cellLines.forEach((line, n) =>
          this.drawLine(
            line,
            x + pad,
            this.y + pad + n * lineHeight,
            size,
            INK,
            columns[i]?.align ?? "left",
            (widths[i] as number) - pad * 2,
          ),
        );
        x += widths[i] as number;
      });
      this.y += height;
    };

    header();
    rows.forEach((row, index) => {
      const values = cell(row, index);
      const wrapped = values.map((value, i) =>
        this.wrap(
          value,
          columns[i]?.bold ?? false,
          size,
          (widths[i] as number) - pad * 2,
        ),
      );
      const height =
        Math.max(1, ...wrapped.map((l) => l.length)) * lineHeight + pad * 2;
      if (this.y + height > PAGE.height - PAGE.bottom) {
        this.newPage();
        header();
      }
      let x = PAGE.left;
      wrapped.forEach((cellLines, i) => {
        cellLines.forEach((line, n) =>
          this.drawLine(
            line,
            x + pad,
            this.y + pad + n * lineHeight,
            size,
            INK,
            columns[i]?.align ?? "left",
            (widths[i] as number) - pad * 2,
          ),
        );
        x += widths[i] as number;
      });
      this.y += height;
      this.rule();
    });
  }

  /** Header/footer with page numbers, once the total page count is known. */
  decorate(footerNote: string): void {
    const range = this.doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      this.doc.switchToPage(range.start + i);
      this.resetState();
      const topRuns =
        this.wrap(
          `${this.rwaName} · ${this.title}`,
          false,
          8.5,
          BODY_WIDTH - 90,
        )[0] ?? [];
      this.drawLine(
        topRuns,
        PAGE.left,
        30,
        8.5,
        MUTED,
        "left",
        BODY_WIDTH - 90,
      );
      this.drawLine(
        segmentRuns(`Page ${i + 1} of ${range.count}`, false),
        PAGE.width - PAGE.right - 90,
        30,
        8.5,
        MUTED,
        "right",
        90,
      );
      this.doc
        .save()
        .lineWidth(0.5)
        .strokeColor(RULE)
        .moveTo(PAGE.left, 46)
        .lineTo(PAGE.width - PAGE.right, 46)
        .stroke()
        .restore();
      const note = this.wrap(footerNote, false, 7.5, BODY_WIDTH)[0] ?? [];
      this.drawLine(
        note,
        PAGE.left,
        PAGE.height - 36,
        7.5,
        MUTED,
        "left",
        BODY_WIDTH,
      );
    }
  }

  finish(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      this.doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", reject);
      this.doc.end();
    });
  }
}

const percentText = (value: string | null) =>
  value === null ? "—" : `${value}%`;

// "4/10   40.00%": a count out of the eligible electorate and its share.
const barValue = (count: string, eligible: string, percent: string | null) =>
  `${count}/${eligible}   ${percentText(percent)}`;

function kindLabel(type: "PUBLIC" | "PRIVATE") {
  return type === "PUBLIC"
    ? "PUBLIC voting (named responses)"
    : "PRIVATE voting (secret ballot, totals only)";
}

function completedAt(results: VoteResults): string {
  if (
    results.vote.status !== "COMPLETED" ||
    results.vote.completedAt === null
  ) {
    throw new Error("Only completed results can be exported.");
  }
  return results.vote.completedAt;
}

export async function renderResultsPdf(
  results: VoteResults,
  generatedAt: Date,
  options: {
    compress?: boolean;
    // Household wording; defaults to "Household"/"Household Number".
    terms?: HouseholdTerms;
    // Current RWA contact lines printed under the organization name.
    rwaContact?: { address: string; email: string; phone: string };
  } = {},
): Promise<Buffer> {
  const { vote } = results;
  const terms = options.terms ?? DEFAULT_HOUSEHOLD_TERMS;
  const copy = privacyCopy(terms);
  const completed = completedAt(results);
  const zone = vote.timezone;
  // A printed record outlives the year it was made in: pass an epoch "now" so the year is always shown.
  const at = (iso: string) => formatInZone(iso, zone, new Date(0));

  const writer = new Writer(vote.rwaName, vote.title, {
    generatedAt,
    voteTitle: vote.title,
    compress: options.compress ?? true,
  });

  writer.paragraph("Civic Pulse · Result of a completed vote", {
    size: 9,
    color: MUTED,
  });
  writer.paragraph(vote.title, { size: 20, bold: true });
  writer.gap(4);
  writer.paragraph(vote.rwaName, { size: 11, color: MUTED });
  if (options.rwaContact) {
    const { address, email, phone } = options.rwaContact;
    if (address) {
      writer.paragraph(address, { size: 9, color: MUTED });
    }
    const contactLine = [email, phone].filter(Boolean).join(" · ");
    if (contactLine) {
      writer.paragraph(contactLine, { size: 9, color: MUTED });
    }
  }
  writer.gap(8);

  writer.table(
    [
      { header: "Detail", width: 150, bold: true },
      { header: "Value", width: 345 },
    ],
    [
      ["Voting type", kindLabel(results.votingType)],
      ["Status", "Completed"],
      ["Voting opened", at(vote.activatedAt)],
      ["Voting ended", at(completed)],
      [
        "How it ended",
        vote.completionMode === "EARLY"
          ? `Completed early by an administrator. Reason: ${vote.completionReason ?? "not recorded"}`
          : "Ran to its deadline",
      ],
      ["Time zone", zone],
      [
        "Report generated",
        `${at(generatedAt.toISOString())} (from the completed result)`,
      ],
    ],
    (row) => row,
  );

  writer.heading("Turnout");
  if (results.turnout.percent === null) {
    writer.paragraph(`No ${terms.households} were eligible for this vote.`);
  } else {
    writer.gap(2);
    writer.bars([
      {
        label: `${terms.Households} that voted`,
        value: barValue(
          results.turnout.numerator,
          results.turnout.denominator,
          results.turnout.percent,
        ),
        percent: results.turnout.percent,
        tone: "leader",
      },
    ]);
  }
  writer.paragraph(
    `Eligibility was fixed when the vote was activated. Each figure below is a count out of the ${results.eligibleCount} eligible ${String(results.eligibleCount) === "1" ? terms.household : terms.households}, with its percentage.`,
    {
      size: 8.5,
      color: MUTED,
    },
  );

  if (results.votingType === "PUBLIC") {
    if (results.vote.openSelectionMode === "MULTIPLE") {
      writer.paragraph(
        `Each ${terms.household} submitted one ballot with multiple selections. Option percentages can add up to more than 100%.`,
        { size: 8.5, color: MUTED },
      );
    }
    writer.heading("Outcome");
    const leaders = results.options
      .filter((o) => results.leaderOptionIds.includes(o.id))
      .map((o) => o.label);
    writer.paragraph(
      results.outcome === "NO_VOTES"
        ? "No votes were submitted, so no option leads."
        : results.outcome === "TIE"
          ? `Tie. These options received the same highest count: ${leaders.join("; ")}.`
          : `Leading option: ${leaders[0] ?? ""}`,
      { bold: true },
    );

    writer.heading("Totals");
    writer.bars(
      results.options.map((o) => {
        const leading =
          results.outcome !== "NO_VOTES" &&
          results.leaderOptionIds.includes(o.id);
        return {
          label: leading
            ? `${o.label} (${results.outcome === "TIE" ? "Tied" : "Leading"})`
            : o.label,
          value: barValue(o.count, results.eligibleCount, o.eligiblePercent),
          percent: o.eligiblePercent,
          tone: leading ? "leader" : "default",
        };
      }),
    );

    writer.heading(
      `Who chose what (${results.namedResponses.length} responses)`,
    );
    writer.paragraph(copy.PUBLIC, { size: 8.5, color: MUTED });
    writer.gap(4);
    if (results.namedResponses.length === 0) {
      writer.paragraph("No responses to list.");
    } else {
      writer.table(
        [
          { header: "Representative", width: 190 },
          { header: terms.identifierLabel, width: 100 },
          { header: "Choice", width: 205 },
        ],
        results.namedResponses,
        (n) => [
          n.representativeName,
          n.householdIdentifier,
          n.optionLabels.join("; "),
        ],
      );
    }
  } else {
    writer.heading("Results by office");
    writer.paragraph(`${copy.PRIVATE} ${copy.CLOSED_LIMITS}`, {
      size: 8.5,
      color: MUTED,
    });
    writer.paragraph(
      "NOTA (None of the Above) is counted separately and cannot win. The candidate with the highest count among candidates is elected, even if NOTA receives more votes. No candidate is elected if no candidate receives a vote; tied candidate totals remain a tie.",
      { size: 8.5, color: MUTED },
    );
    for (const office of results.offices) {
      writer.heading(office.name, 11.5);
      const leaders = office.candidates
        .filter((c) => office.leaderCandidateIds.includes(c.id))
        .map((c) => c.name);
      writer.paragraph(
        office.outcome === "NO_WINNER"
          ? "No winner: no candidate received a vote."
          : office.outcome === "TIE"
            ? `Tie. These candidates received the same highest count: ${leaders.join("; ")}.`
            : `Elected candidate: ${leaders[0] ?? ""}`,
        { bold: true },
      );
      writer.gap(4);
      writer.bars([
        ...office.candidates.map((c) => {
          const leading =
            office.outcome !== "NO_WINNER" &&
            office.leaderCandidateIds.includes(c.id);
          return {
            label: leading
              ? `${c.name} (${office.outcome === "TIE" ? "Tied" : "Elected"})`
              : c.name,
            value: barValue(c.count, results.eligibleCount, c.eligiblePercent),
            percent: c.eligiblePercent,
            tone: leading ? ("leader" as const) : ("default" as const),
          };
        }),
        {
          label: "NOTA (None of the Above)",
          value: barValue(
            office.nota.count,
            results.eligibleCount,
            office.nota.eligiblePercent,
          ),
          percent: office.nota.eligiblePercent,
          tone: "muted",
        },
      ]);
    }
  }

  if (vote.instructions) {
    writer.heading("Instructions given to voters");
    writer.paragraph(vote.instructions);
  }

  writer.heading("About this record");
  writer.paragraph(results.disclaimer);
  writer.paragraph(
    "This printable report is derived from the authoritative database result. It is not a backup, an electronic signature, or a certificate. A printed or downloaded copy cannot be recalled or deleted by the RWA.",
    { size: 8.5, color: MUTED },
  );

  writer.decorate(
    `Generated ${at(generatedAt.toISOString())} · ${zone} · Record ${vote.id.slice(0, 8)}`,
  );
  return writer.finish();
}

export function pdfFilename(results: VoteResults): string {
  return `civic-pulse-results-${completedAt(results).slice(0, 10)}-${results.vote.id.slice(0, 8)}.pdf`;
}
