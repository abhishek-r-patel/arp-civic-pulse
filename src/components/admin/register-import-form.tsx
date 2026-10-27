/* Memory-only CSV preview and sequential imports; uncertain rows are rechecked before retry. */
"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, FileCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function RegisterImportForm({
  csrfToken,
}: Readonly<{ csrfToken: string | undefined }>) {
  const terms = useHouseholdTerms();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [outcomes, setOutcomes] = useState<Record<number, ImportOutcome>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(0);

  async function loadFile(file: File | undefined) {
    setRows([]);
    setOutcomes({});
    setErrors([]);
    setChecked(false);
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
  return (
    <div className="grid gap-6">
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
        <Download className="size-5" aria-hidden="true" /> Download CSV Template
      </a>
      <div className="grid gap-2">
        <label htmlFor="register-csv" className="font-semibold">
          Register CSV
        </label>
        <input
          id="register-csv"
          type="file"
          accept=".csv,text/csv"
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-5xl table-auto text-left text-body">
              <caption className="sr-only">
                Register import preview and results
              </caption>
              <thead>
                <tr>
                  {[
                    "Row",
                    terms.identifierLabel,
                    "Representative",
                    "Email",
                    "Eligible",
                    "Outcome",
                  ].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="border-b border-border p-3 whitespace-nowrap"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    <td className="border-b border-border p-3">{index + 2}</td>
                    <td className="border-b border-border p-3">
                      {row.identifier}
                    </td>
                    <td className="border-b border-border p-3">
                      {row.representativeName}
                    </td>
                    <td className="border-b border-border p-3 break-all">
                      {row.email}
                    </td>
                    <td className="border-b border-border p-3">
                      {row.isEligible ? "Yes" : "No"}
                    </td>
                    <td className="min-w-52 border-b border-border p-3">
                      {outcomes[index]?.message ?? "Not checked"}
                      {outcomes[index]?.accountId ? (
                        <Link
                          className="inline-flex touch-target items-center font-semibold text-accent underline"
                          href={`/admin/accounts/${outcomes[index]?.accountId}`}
                        >
                          Review Account
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
