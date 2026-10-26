import "server-only";
import { VOTE_RATE_LIMITS, enforceRateLimit } from "@/server/auth/rate-limit";
import { exportFilename, renderResultsCsv } from "@/server/exports/csv";
import { availableExportFormats } from "@/server/exports/formats";
import { Semaphore } from "@/server/exports/semaphore";
import {
  PdfUnsupportedTextError,
  pdfFilename,
  renderResultsPdf,
} from "@/server/exports/pdf";
import { ApiError } from "@/server/http/errors";
import { BASE_HEADERS } from "@/server/http/response";
import { log } from "@/server/observability/logger";
import { getRwaBranding } from "@/server/settings/rwa-profile";
import type { RegisterDeps } from "@/server/register/shared";
import { buildHouseholdTerms } from "@/shared/contracts/household-terms";
import { getCompleteResults, getMemberVote } from "@/server/votes/member";

/*
 * Authorized, on-demand CSV and PDF downloads (docs/API.md section 5.2).
 * Nothing is stored and no bearer link exists: every download re-checks the
 * caller and re-reads the completed result. The complete file is rendered
 * BEFORE any success header is sent, so a failure is a clean 503 and never a
 * truncated file. Concurrent renders are bounded, PDF more tightly.
 */
// Only the CPU-heavy render is capped. Waiting callers queue for a bounded time, so a rush of
// downloads near a deadline gets slower rather than failing.
const RENDER_SLOTS = { csv: new Semaphore(8), pdf: new Semaphore(2) } as const;
const MAX_WAIT_MS = 15_000;
// A pilot has hundreds of households; this only stops a runaway render.
const MAX_BYTES = 25 * 1024 * 1024;

export async function exportResults(
  deps: RegisterDeps,
  voteId: string,
  format: string,
  requestId: string,
): Promise<Response> {
  const offered = availableExportFormats();
  if (format !== "csv" && format !== "pdf") {
    // Authorize against the object first so an inaccessible vote stays "not found".
    await getMemberVote(deps, voteId);
    throw new ApiError("EXPORT_FORMAT_UNAVAILABLE");
  }
  if (!offered.includes(format)) {
    await getMemberVote(deps, voteId);
    throw new ApiError("EXPORT_FORMAT_UNAVAILABLE");
  }

  await enforceRateLimit(
    deps.admin,
    VOTE_RATE_LIMITS.exportByProfile,
    "profile",
    deps.actor.id,
    "DEPENDENCY_UNAVAILABLE",
  );

  try {
    // The database read is not the scarce resource; rendering is.
    const results = await getCompleteResults(deps, voteId);
    const branding = await getRwaBranding(deps.client);
    const { address, email, phone } = branding;
    const terms = buildHouseholdTerms(
      branding.householdLabel,
      branding.identifierKind,
    );
    const release = await RENDER_SLOTS[format]
      .acquire(MAX_WAIT_MS)
      .catch(() => {
        throw new ApiError("DEPENDENCY_UNAVAILABLE", { retryAfterSeconds: 5 });
      });
    let body: string | Uint8Array<ArrayBuffer>;
    const generatedAt = new Date();
    try {
      body =
        format === "csv"
          ? renderResultsCsv(results, generatedAt, terms)
          : new Uint8Array(
              await renderResultsPdf(results, generatedAt, {
                terms,
                rwaContact: { address, email, phone },
              }),
            );
    } finally {
      release();
    }
    if (
      (typeof body === "string"
        ? Buffer.byteLength(body, "utf8")
        : body.byteLength) > MAX_BYTES
    ) {
      throw new Error("Export exceeds the size bound.");
    }

    return new Response(body, {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        "Content-Type":
          format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
        "Content-Disposition": `attachment; filename="${format === "csv" ? exportFilename(results) : pdfFilename(results)}"`,
        "X-Request-ID": requestId,
      },
    });
  } catch (error) {
    // Authorization, lifecycle and integrity outcomes keep their own codes.
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof PdfUnsupportedTextError) {
      // The text is never dropped or replaced; the CSV carries every character.
      log("warn", "exports.pdf_unsupported_text", { requestId });
      throw new ApiError("EXPORT_FAILED", {
        message:
          "The PDF cannot display some characters in this record. Download the CSV instead.",
      });
    }
    log("error", "exports.render_failed", { requestId });
    throw new ApiError("EXPORT_FAILED");
  }
}
