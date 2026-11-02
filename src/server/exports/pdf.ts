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
/*
 * A4 portrait, locally generated PDF of a COMPLETED result. PUBLIC results use
 * the grayscale report; PRIVATE elections use the branded results and
 * management-only participation report. Both render completely in memory.
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
const PRIVATE_LEFT = 24;
const PRIVATE_WIDTH = PAGE.width - PRIVATE_LEFT * 2;
const PRIVATE_FOOTER_RULE_Y = PAGE.height - 102;
const PRIVATE_CONTENT_BOTTOM = PRIVATE_FOOTER_RULE_Y - 16;
// Neutral grays only (equal red, green and blue): prints and photocopies identically in black and white.
const INK = "#000000";
const MUTED = "#444444";
const RULE = "#999999";
const SHADE = "#e6e6e6";
const BAR_LEADER = "#1a1a1a";
const BAR_DEFAULT = "#808080";
const ACCENT_COLORS = {
  TEAL: "#0c6953",
  BLUE: "#1d4ed8",
  FOREST: "#166534",
  PLUM: "#6b21a8",
  SLATE: "#334155",
  AMBER: "#92400e",
} as const;

export interface PrivateVoterRow {
  representativeName: string;
  householdIdentifier: string;
  email: string;
}

type PrivateResults = Extract<VoteResults, { votingType: "PRIVATE" }>;
type PrivateOffice = PrivateResults["offices"][number];

interface PrivateReportBranding {
  alias: string;
  accent: string;
  contact: { address: string; email: string; phone: string };
}

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
  private readonly privateReport?: PrivateReportBranding;

  constructor(
    private readonly rwaName: string,
    title: string,
    info: {
      generatedAt: Date;
      voteTitle: string;
      compress: boolean;
      privateReport?: PrivateReportBranding;
    },
  ) {
    this.title = title;
    this.privateReport = info.privateReport;
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
    this.y = this.privateReport ? 86 : PAGE.top;
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

  drawTextAt(
    text: string,
    x: number,
    y: number,
    width: number,
    size: number,
    color: string = INK,
    bold = false,
    align: "left" | "right" | "center" = "left",
  ): number {
    if (!text) return 0;
    const lineHeight = size * 1.25;
    const lines = this.wrap(text, bold, size, width);
    lines.forEach((line, index) => {
      const lineWidth = this.width(line, size);
      const lineX =
        align === "right"
          ? x + width - lineWidth
          : align === "center"
            ? x + (width - lineWidth) / 2
            : x;
      this.drawLine(
        line,
        lineX,
        y + index * lineHeight,
        size,
        color,
        "left",
        width,
      );
    });
    return lines.length * lineHeight;
  }

  ensure(height: number): boolean {
    const bottom = this.privateReport
      ? PRIVATE_CONTENT_BOTTOM
      : PAGE.height - PAGE.bottom;
    if (this.y + height > bottom) {
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

  private officeCardRows(office: PrivateOffice) {
    return [
      ...office.candidates.map((candidate) => ({
        label: candidate.name,
        count: candidate.count,
        percent: candidate.eligiblePercent,
        leader: office.leaderCandidateIds.includes(candidate.id),
      })),
      {
        label: "NOTA (None of the Above)",
        count: office.nota.count,
        percent: office.nota.eligiblePercent,
        leader: false,
      },
    ];
  }

  private officeCardHeight(office: PrivateOffice, width: number): number {
    const nameWidth = width - 94;
    const leaders = office.candidates
      .filter((candidate) => office.leaderCandidateIds.includes(candidate.id))
      .map((candidate) => candidate.name);
    const detail =
      office.outcome === "NO_WINNER"
        ? "No candidate elected"
        : leaders.join("; ");
    const detailHeight =
      Math.max(1, this.wrap(detail, true, 8, width - 16).length) * 10;
    const rowsHeight = this.officeCardRows(office).reduce((total, row) => {
      const lineCount = Math.max(
        1,
        this.wrap(row.label, row.leader, 7.2, nameWidth).length,
      );
      return total + Math.max(11, lineCount * 8.5 + 2);
    }, 0);
    return 40 + detailHeight + rowsHeight + 8;
  }

  private drawPrivateOfficeCard(
    office: PrivateOffice,
    x: number,
    y: number,
    width: number,
  ): number {
    const branding = this.privateReport as PrivateReportBranding;
    const height = this.officeCardHeight(office, width);
    const leaders = office.candidates
      .filter((candidate) => office.leaderCandidateIds.includes(candidate.id))
      .map((candidate) => candidate.name);
    const detail =
      office.outcome === "NO_WINNER"
        ? "No candidate elected"
        : leaders.join("; ");
    const status =
      office.outcome === "LEADER"
        ? "ELECTED"
        : office.outcome === "TIE"
          ? "TIED"
          : "NO WINNER";

    this.doc
      .save()
      .lineWidth(0.65)
      .strokeColor("#c8d0d5")
      .roundedRect(x, y, width, height, 4)
      .fillAndStroke("#ffffff", "#c8d0d5")
      .restore();
    this.doc
      .save()
      .roundedRect(x, y, width, 3, 1.5)
      .fill(branding.accent)
      .restore();

    this.drawTextAt(
      office.name,
      x + 8,
      y + 8,
      width - 86,
      9.2,
      branding.accent,
      true,
    );
    this.drawTextAt(
      status,
      x + width - 72,
      y + 9,
      64,
      6.4,
      branding.accent,
      true,
      "right",
    );
    const detailY = y + 22;
    const detailHeight = this.drawTextAt(
      detail,
      x + 8,
      detailY,
      width - 16,
      8,
      INK,
      true,
    );
    let rowY = detailY + Math.max(detailHeight, 10) + 4;
    this.doc
      .save()
      .lineWidth(0.45)
      .strokeColor("#d8dee2")
      .moveTo(x + 8, rowY - 2)
      .lineTo(x + width - 8, rowY - 2)
      .stroke()
      .restore();

    const rows = this.officeCardRows(office);
    const nameWidth = width - 94;
    for (const [index, row] of rows.entries()) {
      const lines = this.wrap(row.label, row.leader, 7.2, nameWidth);
      const rowHeight = Math.max(11, lines.length * 8.5 + 2);
      if (row.leader) {
        this.doc
          .save()
          .fillColor(branding.accent)
          .fillOpacity(0.13)
          .roundedRect(x + 6, rowY, width - 12, rowHeight, 2)
          .fill()
          .restore();
        this.doc
          .save()
          .roundedRect(x + 6, rowY, 2, rowHeight, 1)
          .fill(branding.accent)
          .restore();
      } else if (index % 2 === 1) {
        this.doc
          .save()
          .rect(x + 8, rowY, width - 16, rowHeight)
          .fill("#f5f6f6")
          .restore();
      }
      this.drawTextAt(
        row.label,
        x + 11,
        rowY + 1,
        nameWidth - 3,
        7.2,
        INK,
        row.leader,
      );
      this.drawTextAt(
        row.count,
        x + width - 79,
        rowY + 1,
        31,
        7.2,
        INK,
        false,
        "right",
      );
      this.drawTextAt(
        percentText(row.percent),
        x + width - 43,
        rowY + 1,
        35,
        7.2,
        MUTED,
        false,
        "right",
      );
      rowY += rowHeight;
    }
    return height;
  }

  private drawPrivateOfficeFallback(
    office: PrivateOffice,
    eligibleCount: string,
  ): void {
    const leaders = office.candidates
      .filter((candidate) => office.leaderCandidateIds.includes(candidate.id))
      .map((candidate) => candidate.name);
    this.heading(office.name, 11);
    this.paragraph(
      office.outcome === "NO_WINNER"
        ? "No winner: no candidate received a vote."
        : office.outcome === "TIE"
          ? `Tie. These candidates received the same highest count: ${leaders.join("; ")}.`
          : `Elected candidate: ${leaders[0] ?? ""}`,
      { bold: true },
    );
    this.bars([
      ...office.candidates.map((candidate) => ({
        label: candidate.name,
        value: barValue(
          candidate.count,
          eligibleCount,
          candidate.eligiblePercent,
        ),
        percent: candidate.eligiblePercent,
        tone: office.leaderCandidateIds.includes(candidate.id)
          ? ("leader" as const)
          : ("default" as const),
      })),
      {
        label: "NOTA (None of the Above)",
        value: barValue(
          office.nota.count,
          eligibleCount,
          office.nota.eligiblePercent,
        ),
        percent: office.nota.eligiblePercent,
        tone: "muted" as const,
      },
    ]);
  }

  drawPrivateResults(
    results: PrivateResults,
    terms: HouseholdTerms,
    opening: string,
    closing: string,
    voters: readonly PrivateVoterRow[],
  ): void {
    const branding = this.privateReport as PrivateReportBranding;
    this.y = 86;
    let height = this.drawTextAt(
      results.vote.title,
      PRIVATE_LEFT,
      this.y,
      PRIVATE_WIDTH,
      20,
      INK,
      true,
    );
    this.y += height + 5;
    height = this.drawTextAt(
      `Opens at ${opening} · Closed at ${closing}`,
      PRIVATE_LEFT,
      this.y,
      PRIVATE_WIDTH,
      8.2,
      MUTED,
    );
    this.y += height + 6;

    if (results.vote.instructions) {
      this.drawTextAt(
        "VOTE BACKGROUND",
        PRIVATE_LEFT,
        this.y,
        PRIVATE_WIDTH,
        6.6,
        MUTED,
        true,
      );
      this.y += 9;
      height = this.drawTextAt(
        results.vote.instructions,
        PRIVATE_LEFT,
        this.y,
        PRIVATE_WIDTH,
        8,
        INK,
      );
      this.y += height + 7;
    }

    const participationHeight = 24;
    this.doc
      .save()
      .lineWidth(0.6)
      .strokeColor("#d8dee2")
      .roundedRect(PRIVATE_LEFT, this.y, PRIVATE_WIDTH, participationHeight, 4)
      .fillAndStroke("#f5f7f7", "#d8dee2")
      .restore();
    this.drawTextAt(
      `${results.submittedCount} of ${results.eligibleCount} ${terms.households} participated`,
      PRIVATE_LEFT + 10,
      this.y + 7,
      PRIVATE_WIDTH - 90,
      8.2,
      INK,
      true,
    );
    this.drawTextAt(
      percentText(results.turnout.percent),
      PRIVATE_LEFT + PRIVATE_WIDTH - 64,
      this.y + 4,
      54,
      12,
      branding.accent,
      true,
      "right",
    );
    this.y += participationHeight + 12;
    this.drawTextAt(
      `${results.disclaimer} This report is derived from the authoritative database, not a backup.`,
      PRIVATE_LEFT,
      this.y,
      PRIVATE_WIDTH,
      6.1,
      MUTED,
    );
    this.y += 9;
    this.drawTextAt(
      "RESULTS BY OFFICE",
      PRIVATE_LEFT,
      this.y,
      PRIVATE_WIDTH,
      8,
      branding.accent,
      true,
    );
    this.y += 13;

    const gap = 10;
    const cardWidth = (PRIVATE_WIDTH - gap) / 2;
    for (let index = 0; index < results.offices.length; index += 2) {
      const first = results.offices[index];
      const second = results.offices[index + 1];
      if (!first) continue;
      const firstHeight = this.officeCardHeight(first, cardWidth);
      const secondHeight = second
        ? this.officeCardHeight(second, cardWidth)
        : 0;
      const rowHeight = Math.max(firstHeight, secondHeight);
      const pageCapacity = PRIVATE_CONTENT_BOTTOM - 108;
      if (rowHeight > pageCapacity) {
        if (this.y > 112) {
          this.newPage();
          this.drawTextAt(
            "RESULTS BY OFFICE · CONTINUED",
            PRIVATE_LEFT,
            this.y,
            PRIVATE_WIDTH,
            8,
            branding.accent,
            true,
          );
          this.y += 14;
        }
        this.drawPrivateOfficeFallback(first, results.eligibleCount);
        if (second) {
          this.drawPrivateOfficeFallback(second, results.eligibleCount);
        }
        continue;
      }
      if (this.y + rowHeight > PRIVATE_CONTENT_BOTTOM) {
        this.newPage();
        this.drawTextAt(
          "RESULTS BY OFFICE · CONTINUED",
          PRIVATE_LEFT,
          this.y,
          PRIVATE_WIDTH,
          8,
          branding.accent,
          true,
        );
        this.y += 14;
      }
      const rowY = this.y;
      this.drawPrivateOfficeCard(first, PRIVATE_LEFT, rowY, cardWidth);
      if (second) {
        this.drawPrivateOfficeCard(
          second,
          PRIVATE_LEFT + cardWidth + gap,
          rowY,
          cardWidth,
        );
      }
      this.y += rowHeight + 9;
    }

    this.newPage();
    height = this.drawTextAt(
      results.vote.title,
      PRIVATE_LEFT,
      this.y,
      PRIVATE_WIDTH,
      20,
      INK,
      true,
    );
    this.y += height + 3;
    height = this.drawTextAt(
      "REPRESENTATIVES WHO VOTED",
      PRIVATE_LEFT,
      this.y,
      PRIVATE_WIDTH,
      8.5,
      branding.accent,
      true,
      "center",
    );
    this.y += height + 3;
    this.drawPrivateVoterTable(results.vote.title, terms, voters);
  }

  private drawPrivateVoterTable(
    voteTitle: string,
    terms: HouseholdTerms,
    voters: readonly PrivateVoterRow[],
  ): void {
    const branding = this.privateReport as PrivateReportBranding;
    const widths = [125, 175, PRIVATE_WIDTH - 300];
    const headers = [
      terms.identifierLabel.toUpperCase(),
      "REPRESENTATIVE",
      "EMAIL",
    ];
    const headerHeight = 17;
    const fontSize = 6.4;
    const lineHeight = 7.5;
    const padding = 2;
    const xForColumn = (index: number) =>
      PRIVATE_LEFT +
      widths.slice(0, index).reduce((sum, width) => sum + width, 0);
    const drawHeader = () => {
      this.doc
        .save()
        .roundedRect(PRIVATE_LEFT, this.y, PRIVATE_WIDTH, headerHeight, 3)
        .fill(branding.accent)
        .restore();
      headers.forEach((header, index) =>
        this.drawTextAt(
          header,
          xForColumn(index) + 6,
          this.y + 5,
          (widths[index] as number) - 12,
          fontSize,
          "#ffffff",
          true,
        ),
      );
      this.y += headerHeight;
    };
    const drawContinuation = () => {
      this.newPage();
      const titleHeight = this.drawTextAt(
        voteTitle,
        PRIVATE_LEFT,
        this.y,
        PRIVATE_WIDTH,
        12,
        INK,
        true,
      );
      this.y += titleHeight + 2;
      const subtitleHeight = this.drawTextAt(
        "REPRESENTATIVES WHO VOTED · CONTINUED",
        PRIVATE_LEFT,
        this.y,
        PRIVATE_WIDTH,
        7.5,
        branding.accent,
        true,
        "center",
      );
      this.y += subtitleHeight + 3;
      drawHeader();
    };

    drawHeader();
    if (voters.length === 0) {
      this.drawTextAt(
        "No representatives voted.",
        PRIVATE_LEFT + 6,
        this.y + 5,
        PRIVATE_WIDTH - 12,
        8,
        MUTED,
      );
      return;
    }

    voters.forEach((voter, index) => {
      const values = [
        voter.householdIdentifier,
        voter.representativeName,
        voter.email,
      ];
      const wrapped = values.map((value, column) =>
        this.wrap(value, false, fontSize, (widths[column] as number) - 12),
      );
      const rowHeight = Math.max(
        11.5,
        ...wrapped.map((lines) => lines.length * lineHeight + padding * 2),
      );
      if (this.y + rowHeight > PRIVATE_CONTENT_BOTTOM) {
        drawContinuation();
      }
      const rowY = this.y;
      if (index % 2 === 0) {
        this.doc
          .save()
          .rect(PRIVATE_LEFT, rowY, PRIVATE_WIDTH, rowHeight)
          .fill("#f2f5f4")
          .restore();
      }
      wrapped.forEach((lines, column) =>
        lines.forEach((line, lineIndex) =>
          this.drawLine(
            line,
            xForColumn(column) + 6,
            rowY + padding + lineIndex * lineHeight,
            fontSize,
            INK,
            "left",
            (widths[column] as number) - 12,
          ),
        ),
      );
      this.doc
        .save()
        .lineWidth(0.4)
        .strokeColor("#d8dee2")
        .moveTo(PRIVATE_LEFT, rowY + rowHeight)
        .lineTo(PRIVATE_LEFT + PRIVATE_WIDTH, rowY + rowHeight)
        .stroke()
        .restore();
      this.y += rowHeight;
    });
  }

  private decoratePrivatePage(pageNumber: number, pageCount: number): void {
    const branding = this.privateReport;
    if (!branding) return;
    const rightX = PAGE.width - PRIVATE_LEFT - 275;
    const leftWidth = rightX - PRIVATE_LEFT - 12;

    this.doc
      .save()
      .roundedRect(PRIVATE_LEFT, 18, 30, 30, 6)
      .fill(branding.accent)
      .restore();
    this.doc
      .save()
      .lineWidth(1.2)
      .strokeColor("#ffffff")
      .roundedRect(PRIVATE_LEFT + 7, 24, 16, 12, 2)
      .stroke()
      .moveTo(PRIVATE_LEFT + 11, 36)
      .lineTo(PRIVATE_LEFT + 9, 40)
      .lineTo(PRIVATE_LEFT + 16, 36)
      .stroke()
      .restore();
    this.drawTextAt("Civic Pulse", PRIVATE_LEFT + 38, 21, 180, 11, INK, true);
    this.drawTextAt(
      branding.alias,
      PRIVATE_LEFT + 38,
      37,
      leftWidth - 38,
      7.5,
      MUTED,
    );
    this.drawTextAt("Results", rightX, 21, 275, 10.5, INK, true, "right");
    this.drawTextAt(
      "PRIVATE Voting",
      rightX,
      37,
      275,
      7.5,
      branding.accent,
      true,
      "right",
    );
    this.doc
      .save()
      .lineWidth(0.6)
      .strokeColor(RULE)
      .moveTo(PRIVATE_LEFT, 63)
      .lineTo(PAGE.width - PRIVATE_LEFT, 63)
      .stroke()
      .moveTo(PRIVATE_LEFT, PRIVATE_FOOTER_RULE_Y)
      .lineTo(PAGE.width - PRIVATE_LEFT, PRIVATE_FOOTER_RULE_Y)
      .stroke()
      .restore();

    const footerTop = PRIVATE_FOOTER_RULE_Y + 8;
    const fullNameHeight = this.drawTextAt(
      this.rwaName,
      PRIVATE_LEFT,
      footerTop,
      leftWidth,
      7.2,
      INK,
      true,
    );
    this.drawTextAt(
      "This is a computer-generated letter and does not require a signature",
      rightX,
      footerTop,
      275,
      6.2,
      MUTED,
      false,
      "right",
    );
    let nextY = footerTop + Math.max(fullNameHeight, 9);
    const address = branding.contact.address.replace(/\s+/gu, " ").trim();
    if (address) {
      const height = this.drawTextAt(
        address,
        PRIVATE_LEFT,
        nextY,
        leftWidth,
        6.3,
        MUTED,
      );
      nextY += Math.max(height, 8);
    }
    const contact = [branding.contact.email, branding.contact.phone]
      .filter(Boolean)
      .join(" · ");
    const contactY = nextY;
    const contactHeight = contact
      ? this.drawTextAt(contact, PRIVATE_LEFT, contactY, leftWidth, 6.3, MUTED)
      : 0;
    this.drawTextAt(
      `Page ${pageNumber} of ${pageCount}`,
      rightX,
      contactY + Math.max(0, contactHeight - 8),
      275,
      7,
      INK,
      true,
      "right",
    );
  }

  /** Header/footer with page numbers, once the total page count is known. */
  decorate(footerNote: string): void {
    const range = this.doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      this.doc.switchToPage(range.start + i);
      this.resetState();
      if (this.privateReport) {
        this.decoratePrivatePage(i + 1, range.count);
        continue;
      }
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

function localDateTimeWithoutZone(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("day")} ${read("month")} ${read("year")}, ${read("hour")}:${read("minute")} ${read("dayPeriod").toUpperCase()}`;
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
    rwaAlias?: string;
    accentPalette?: keyof typeof ACCENT_COLORS;
    privateVoters?: readonly PrivateVoterRow[];
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
    ...(vote.votingType === "PRIVATE"
      ? {
          privateReport: {
            alias: options.rwaAlias ?? vote.rwaName,
            accent: ACCENT_COLORS[options.accentPalette ?? "TEAL"],
            contact: options.rwaContact ?? {
              address: "",
              email: "",
              phone: "",
            },
          },
        }
      : {}),
  });

  if (results.votingType === "PRIVATE") {
    const privateVoters = options.privateVoters;
    if (privateVoters === undefined) {
      throw new Error("A PRIVATE PDF requires its completed voter roster.");
    }
    writer.drawPrivateResults(
      results,
      terms,
      localDateTimeWithoutZone(vote.activatedAt, zone),
      localDateTimeWithoutZone(completed, zone),
      privateVoters,
    );
    writer.decorate(results.disclaimer);
    return writer.finish();
  }

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
