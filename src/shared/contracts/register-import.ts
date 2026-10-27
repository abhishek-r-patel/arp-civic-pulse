/* Bounded CSV register import contracts; no roles or existing-record changes are accepted. */
import { parse } from "csv-parse/browser/esm/sync";
import { z } from "zod";
import {
  createAccountSchema,
  createHouseholdSchema,
} from "@/shared/contracts/register";
import { normalizedKey } from "@/shared/contracts/admin-votes";

export const IMPORT_LIMIT = 500;
export const IMPORT_BYTE_LIMIT = 256 * 1024;
export const IMPORT_HEADERS = [
  "identifier",
  "representative_name",
  "email",
  "is_eligible",
] as const;
export const IMPORT_TEMPLATE = `${IMPORT_HEADERS.join(",")}\nA-101,Example Resident,resident@example.test,true\n`;

export const importRowSchema = z.strictObject({
  identifier: createHouseholdSchema.shape.identifier,
  representativeName: createAccountSchema.shape.representativeName,
  email: createAccountSchema.shape.email,
  isEligible: z.boolean(),
});
export type ImportRow = z.output<typeof importRowSchema>;
export interface ImportCsvResult {
  rows: ImportRow[];
  errors: { row: number; message: string }[];
}

export function parseRegisterCsv(csv: string): ImportCsvResult {
  const errors: ImportCsvResult["errors"] = [];
  if (new TextEncoder().encode(csv).length > IMPORT_BYTE_LIMIT) {
    return {
      rows: [],
      errors: [{ row: 0, message: "Use a CSV file no larger than 256 KiB." }],
    };
  }
  let records: string[][];
  try {
    const parsed: unknown = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 4096,
    });
    records = z.array(z.array(z.string())).parse(parsed);
  } catch {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          message: "The CSV is malformed. Check its quotes and column counts.",
        },
      ],
    };
  }
  const header = records.shift()?.map((value) => value.trim());
  if (
    !header ||
    header.length !== IMPORT_HEADERS.length ||
    new Set(header).size !== header.length ||
    IMPORT_HEADERS.some((key) => !header.includes(key))
  ) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          message: `Use exactly these columns: ${IMPORT_HEADERS.join(", ")}.`,
        },
      ],
    };
  }
  if (records.length === 0 || records.length > IMPORT_LIMIT) {
    return {
      rows: [],
      errors: [
        { row: 0, message: `Include between 1 and ${IMPORT_LIMIT} residents.` },
      ],
    };
  }
  const rows: ImportRow[] = [];
  const identifiers = new Set<string>();
  const emails = new Set<string>();
  records.forEach((record, index) => {
    const values = Object.fromEntries(
      header.map((key, column) => [key, record[column]?.trim()]),
    );
    const eligibility = values.is_eligible?.toLowerCase();
    const result = importRowSchema.safeParse({
      identifier: values.identifier,
      representativeName: values.representative_name,
      email: values.email,
      isEligible:
        eligibility === "true"
          ? true
          : eligibility === "false"
            ? false
            : undefined,
    });
    if (!result.success) {
      errors.push({
        row: index + 2,
        message: result.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(" "),
      });
      return;
    }
    const identifier = normalizedKey(result.data.identifier);
    if (identifiers.has(identifier) || emails.has(result.data.email)) {
      errors.push({
        row: index + 2,
        message: "Duplicate identifier or email in this file.",
      });
    }
    identifiers.add(identifier);
    emails.add(result.data.email);
    rows.push(result.data);
  });
  return { rows: errors.length ? [] : rows, errors };
}

export const importRequestSchema = z
  .strictObject({
    row: importRowSchema,
    action: z.enum(["preview", "import"]),
    confirmed: z.literal(true).optional(),
  })
  .refine(
    (value) => value.action === "preview" || value.confirmed === true,
    "Confirmation is required.",
  );

export interface ImportOutcome {
  row: number;
  identifier: string;
  state: "READY" | "EXISTING" | "CONFLICT" | "IMPORTED" | "ENABLED" | "FAILED";
  message: string;
  accountId?: string;
}
