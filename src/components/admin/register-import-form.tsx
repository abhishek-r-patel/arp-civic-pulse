/* Memory-only CSV preview and sequential imports; uncertain rows are rechecked before retry. */
"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, FileCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import { apiRequest } from "@/shared/http/api-client";
import {
  IMPORT_BYTE_LIMIT,
  IMPORT_TEMPLATE,
  parseRegisterCsv,
  type ImportOutcome,
  type ImportRow,
} from "@/shared/contracts/register-import";

type RegisterPreviewRow = ImportRow & {
  rowNumber: number;
  outcome: ImportOutcome | undefined;
};

export function RegisterImportForm({
  csrfToken,
}: Readonly<{ csrfToken: string | undefined }>) {
  const terms = useHouseholdTerms();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [outcomes, setOutcomes] = useState<Record<number, ImportOutcome>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(0);

  async function loadFile(file: File | undefined) {
    setRows([]);
    setOutcomes({});
    setErrors([]);
    setChecked(false);
    setShowPreview(false);
    setProgress(0);
    if (!file) return;
    if (file.size > IMPORT_BYTE_LIMIT) {
      setErrors(["Use a CSV file no larger than 256 KiB."]);
      return;
    }
    try {
      const parsed = parseRegisterCsv(await file.text());
      setRows(parsed.rows);
      setErrors(
        parsed.errors.map((error) => `Row ${error.row}: ${error.message}`),
      );
    } catch {
      setErrors(["The file could not be read. Select it again."]);
    }
  }

  async function run(action: "preview" | "import") {
    setBusy(true);
    setConfirm(false);
    setErrors([]);
    setProgress(0);
    if (action === "preview") setShowPreview(true);
    let completed = true;
    for (const [index, row] of rows.entries()) {
      if (
        action === "preview" &&
        ["IMPORTED", "EXISTING"].includes(outcomes[index]?.state ?? "")
      )
        continue;
      if (action === "import" && outcomes[index]?.state !== "READY") continue;
      const result = await apiRequest<Omit<ImportOutcome, "row">>(
        "/api/admin/households/import",
        {
          method: "POST",
          csrfToken,
          body: {
            row,
            action,
            ...(action === "import" && { confirmed: true }),
          },
        },
      );
      setProgress(index + 1);
      if (!result.ok) {
        setErrors([
          `Row ${index + 2}: ${result.message} No further rows were processed. Check the register again before retrying; this row may be partly or fully saved. Reference: ${result.requestId ?? result.code}.`,
        ]);
        completed = false;
        setChecked(false);
        break;
      }
      setOutcomes((current) => ({
        ...current,
        [index]: { ...result.data, row: index + 2 },
      }));
    }
    if (completed) setChecked(action === "preview");
    setBusy(false);
  }

  const ready = Object.values(outcomes).filter(
    (outcome) => outcome.state === "READY",
  ).length;
  const previewRows: RegisterPreviewRow[] = rows.map((row, index) => ({
    ...row,
    rowNumber: index + 2,
    outcome: outcomes[index],
  }));
  const previewColumns: readonly Column<RegisterPreviewRow>[] = [
    {
      key: "row",
      header: "Row",
      numeric: true,
      cell: (row) => row.rowNumber,
    },
    {
      key: "identifier",
      header: terms.identifierLabel,
      className: "break-all",
      cell: (row) => row.identifier,
    },
    {
      key: "representative",
      header: "Representative",
      cell: (row) => row.representativeName,
    },
    {
      key: "email",
      header: "Email",
      className: "break-all",
      cell: (row) => row.email,
    },
    {
      key: "eligible",
      header: "Eligible",
      cell: (row) => (row.isEligible ? "Yes" : "No"),
    },
    {
      key: "outcome",
      header: "Outcome",
      cell: (row) => (
        <div className="grid justify-items-start gap-1">
          <span>{row.outcome?.message ?? "Not checked"}</span>
          {row.outcome?.accountId ? (
            <Link
              className="inline-flex touch-target items-center font-semibold text-accent underline"
              href={`/admin/residents/${row.outcome.accountId}`}
            >
              Review Account
            </Link>
          ) : null}
        </div>
      ),
    },
  ];
  return (
    <div className="grid min-w-0 gap-6">
      <div className="mx-auto grid w-full max-w-ballot gap-6 form-panel">
        <Notice tone="info" heading="New accounts remain suspended">
          Review each imported representative before enabling access. Existing
          register entries and scheduled or active electorates are never
          overwritten.
        </Notice>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE)}`}
          download="register-template.csv"
          className="inline-flex touch-target w-fit items-center gap-2 font-semibold text-accent underline"
        >
          <Download className="size-5" aria-hidden="true" /> Download CSV
          Template
        </a>
        <div className="grid gap-2">
          <label htmlFor="register-csv" className="font-semibold">
            Register CSV
          </label>
          <p id="register-csv-hint" className="text-caption text-muted">
            Selecting a CSV reads and parses it in your browser. Choose Check
            Register to preview each row; nothing is imported until you confirm
            the separate Import action.
          </p>
          <input
            id="register-csv"
            type="file"
            accept=".csv,text/csv"
            aria-describedby="register-csv-hint"
            disabled={busy}
            onChange={(event) => void loadFile(event.target.files?.[0])}
            className="touch-target max-w-full rounded-control border border-control-border bg-surface p-3 text-body"
          />
        </div>
        {errors.length ? (
          <Notice tone="error" heading="Import needs attention">
            <ul className="list-disc pl-5">
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        {rows.length ? (
          <>
            <p role="status">
              {busy
                ? `Processed ${progress} of ${rows.length}`
                : `${rows.length} rows; ${ready} ready to import`}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void run("preview")}
              >
                <FileCheck className="size-5" aria-hidden="true" />
                Check Register
              </Button>
              <Button
                disabled={busy || !checked || ready === 0}
                onClick={() => setConfirm(true)}
              >
                <Upload className="size-5" aria-hidden="true" />
                Import {ready} {terms.Households}
              </Button>
            </div>
          </>
        ) : null}
      </div>
      {showPreview && rows.length ? (
        <DataTable
          caption="Register import preview and results"
          columns={previewColumns}
          rows={previewRows}
          rowKey={(row) => row.identifier}
        />
      ) : null}
      <ConfirmDialog
        open={confirm}
        title="Import Register"
        confirmLabel="Import Suspended Accounts"
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void run("import")}
      >
        <p>
          Create {ready} register entries and representative accounts? Newly
          created accounts remain suspended. Conflicts are skipped, existing
          records are not overwritten, and each row is committed independently.
        </p>
      </ConfirmDialog>
    </div>
  );
}
