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
import { reportError } from "@/server/observability/error-reporting";
import { getRwaBranding } from "@/server/settings/rwa-profile";
import {
  assertOk,
  callRoutine,
  loadAuthIdentities,
  type RegisterDeps,
} from "@/server/register/shared";
import { buildHouseholdTerms } from "@/shared/contracts/household-terms";
import { canViewAdministration } from "@/shared/contracts/register";
import { participationMonitorSchema } from "@/shared/contracts/member-votes";
import type { OpenResults } from "@/shared/contracts/results";
import {
  getCompleteResultsBundle,
  getMemberVote,
  enforceReadLimit,
  type PublicResponseIdentity,
} from "@/server/votes/member";
import type {
  PrivateVoterRow,
  PublicPdfResponseRow,
} from "@/server/exports/pdf";

/*
 * RWA Admin/ReadOnly-only on-demand CSV and PDF downloads (docs/API.md
 * section 5.2). Residents view results in-app. The PRIVATE PDF composes a
 * separate submitted-voter roster after session-backed authorization. Nothing
 * is stored or linked; render the complete file before success headers.
 */
// Only the CPU-heavy render is capped. Waiting callers queue for a bounded time, so a rush of
// downloads near a deadline gets slower rather than failing.
const RENDER_SLOTS = { csv: new Semaphore(8), pdf: new Semaphore(2) } as const;
const MAX_WAIT_MS = 15_000;
// A pilot has hundreds of households; this only stops a runaway render.
const MAX_BYTES = 25 * 1024 * 1024;
const PRIVATE_ROSTER_PAGE_SIZE = 100;

interface ParticipationIdentity {
  representativeName: string;
  householdIdentifier: string;
  householdId: string;
}

export async function getPrivateVoterRosterForPdf(
  deps: RegisterDeps,
  voteId: string,
  expectedSubmittedCount: string,
): Promise<PrivateVoterRow[]> {
  if (!canViewAdministration(deps.actor)) {
    throw new ApiError("FORBIDDEN");
  }
  await enforceReadLimit(deps);

  const participants: ParticipationIdentity[] = [];
  let after: { key: string; householdId: string } | null = null;
  let hasMore = true;
  const seenCursors = new Set<string>();
  while (hasMore) {
    const raw = await callRoutine<unknown>(
      deps.client,
      "get_vote_participation",
      {
        p_vote_id: voteId,
        p_submitted: true,
        p_limit: PRIVATE_ROSTER_PAGE_SIZE,
        p_after_key: after?.key ?? null,
        p_after_household: after?.householdId ?? null,
      },
    );
    const parsed = participationMonitorSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.voteId !== voteId ||
      parsed.data.status !== "COMPLETED"
    ) {
      throw new ApiError("RESULTS_INTEGRITY_ERROR");
    }
    participants.push(
      ...parsed.data.rows.map((row) => ({
        representativeName: row.representativeName,
        householdIdentifier: row.householdIdentifier,
        householdId: row.cursor.householdId,
      })),
    );
    if (BigInt(participants.length) > BigInt(expectedSubmittedCount)) {
      throw new ApiError("RESULTS_INTEGRITY_ERROR");
    }
    hasMore = parsed.data.hasMore;
    const last = parsed.data.rows.at(-1);
    if (hasMore && !last) {
      throw new ApiError("RESULTS_INTEGRITY_ERROR");
    }
    if (hasMore && last) {
      const cursor = JSON.stringify(last.cursor);
      if (seenCursors.has(cursor)) {
        throw new ApiError("RESULTS_INTEGRITY_ERROR");
      }
      seenCursors.add(cursor);
    }
    after = hasMore && last ? last.cursor : null;
  }

  if (BigInt(participants.length) !== BigInt(expectedSubmittedCount)) {
    throw new ApiError("RESULTS_INTEGRITY_ERROR");
  }

  const profileByHousehold = new Map<string, string>();
  for (let offset = 0; offset < participants.length; offset += 100) {
    const householdIds = participants
      .slice(offset, offset + 100)
      .map((participant) => participant.householdId);
    const { data, error } = await deps.client
      .from("electorate")
      .select("household_id, representative_profile_id")
      .eq("vote_id", voteId)
      .in("household_id", householdIds)
      .returns<
        { household_id: string; representative_profile_id: string | null }[]
      >();
    assertOk(error);
    for (const row of data ?? []) {
      if (row.representative_profile_id) {
        profileByHousehold.set(row.household_id, row.representative_profile_id);
      }
    }
  }

  const profileIds = participants.map((participant) => {
    const profileId = profileByHousehold.get(participant.householdId);
    if (!profileId) {
      throw new ApiError("RESULTS_INTEGRITY_ERROR");
    }
    return profileId;
  });
  const identities = await loadAuthIdentities(deps.admin, profileIds);
  const rows = participants.map((participant): PrivateVoterRow => {
    const profileId = profileByHousehold.get(participant.householdId);
    const email = profileId ? identities.get(profileId)?.email : null;
    if (!email) {
      throw new ApiError("RESULTS_INTEGRITY_ERROR");
    }
    return {
      representativeName: participant.representativeName,
      householdIdentifier: participant.householdIdentifier,
      email,
    };
  });
  const collator = new Intl.Collator("en", {
    numeric: true,
    sensitivity: "base",
  });
  rows.sort(
    (left, right) =>
      collator.compare(left.householdIdentifier, right.householdIdentifier) ||
      collator.compare(left.representativeName, right.representativeName),
  );
  return rows;
}

export async function getPublicResponseRowsForPdf(
  deps: RegisterDeps,
  voteId: string,
  results: OpenResults,
  responseIdentities: readonly PublicResponseIdentity[],
): Promise<PublicPdfResponseRow[]> {
  if (!canViewAdministration(deps.actor)) {
    throw new ApiError("FORBIDDEN");
  }
  if (
    results.vote.status !== "COMPLETED" ||
    results.namedResponses.length !== responseIdentities.length ||
    results.namedResponses.some((response, index) => {
      const identity = responseIdentities[index];
      return (
        !identity ||
        response.representativeName !== identity.representativeName ||
        response.householdIdentifier !== identity.householdIdentifier ||
        JSON.stringify(response.optionLabels) !==
          JSON.stringify(identity.optionLabels)
      );
    })
  ) {
    throw new ApiError("RESULTS_INTEGRITY_ERROR");
  }
  if (responseIdentities.length === 0) return [];

  await enforceReadLimit(deps);
  const profileByHousehold = new Map<string, string>();
  for (let offset = 0; offset < responseIdentities.length; offset += 100) {
    const householdIds = responseIdentities
      .slice(offset, offset + 100)
      .map((response) => response.householdId);
    const { data, error } = await deps.client
      .from("electorate")
      .select("household_id, representative_profile_id")
      .eq("vote_id", voteId)
      .in("household_id", householdIds)
      .returns<
        { household_id: string; representative_profile_id: string | null }[]
      >();
    assertOk(error);
    for (const row of data ?? []) {
      if (row.representative_profile_id) {
        profileByHousehold.set(row.household_id, row.representative_profile_id);
      }
    }
  }

  const profileIds = responseIdentities.map((response) => {
    const profileId = profileByHousehold.get(response.householdId);
    if (!profileId) throw new ApiError("RESULTS_INTEGRITY_ERROR");
    return profileId;
  });
  const identities = await loadAuthIdentities(deps.admin, profileIds);
  const rows = responseIdentities.map((response): PublicPdfResponseRow => {
    const profileId = profileByHousehold.get(response.householdId);
    const email = profileId ? identities.get(profileId)?.email : null;
    if (!email) throw new ApiError("RESULTS_INTEGRITY_ERROR");
    return {
      householdIdentifier: response.householdIdentifier,
      representativeName: response.representativeName,
      email,
      optionLabels: response.optionLabels,
    };
  });
  const collator = new Intl.Collator("en", {
    numeric: true,
    sensitivity: "base",
  });
  rows.sort(
    (left, right) =>
      collator.compare(left.householdIdentifier, right.householdIdentifier) ||
      collator.compare(left.representativeName, right.representativeName),
  );
  return rows;
}

export async function exportResults(
  deps: RegisterDeps,
  voteId: string,
  format: string,
  requestId: string,
): Promise<Response> {
  const offered = availableExportFormats(deps.tenant);
  if (format !== "csv" && format !== "pdf") {
    // Authorize against the object first so an inaccessible vote stays "not found".
    await getMemberVote(deps, voteId);
    throw new ApiError("EXPORT_FORMAT_UNAVAILABLE");
  }
  if (!canViewAdministration(deps.actor)) {
    const vote = await getMemberVote(deps, voteId);
    if (vote.status === "COMPLETED") {
      throw new ApiError("FORBIDDEN");
    }
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
    const { results, publicResponseIdentities } =
      await getCompleteResultsBundle(deps, voteId);
    if (results.vote.status !== "COMPLETED") {
      throw new ApiError("RESULTS_UNAVAILABLE");
    }
    const branding = await getRwaBranding(deps.client);
    const { address, email, phone } = branding;
    const terms = buildHouseholdTerms(
      branding.householdLabel,
      branding.identifierKind,
    );
    const privateVoters =
      format === "pdf" && results.votingType === "PRIVATE"
        ? await getPrivateVoterRosterForPdf(
            deps,
            voteId,
            results.submittedCount,
          )
        : undefined;
    const publicResponses =
      format === "pdf" && results.votingType === "PUBLIC"
        ? await getPublicResponseRowsForPdf(
            deps,
            voteId,
            results,
            publicResponseIdentities,
          )
        : undefined;
    const release = await RENDER_SLOTS[format]
      .acquire(MAX_WAIT_MS)
      .catch(() => {
        throw new ApiError("DEPENDENCY_UNAVAILABLE", {
          retryAfterSeconds: 5,
          cause: {
            source: "capacity",
            code: `EXPORT_${format.toUpperCase()}_BUSY`,
          },
        });
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
                rwaAlias: branding.alias,
                accentPalette: branding.accentPalette,
                pdfCardsPerPage: branding.pdfCardsPerPage,
                pdfVotersPerPage: branding.pdfVotersPerPage,
                ...(privateVoters ? { privateVoters } : {}),
                ...(publicResponses ? { publicResponses } : {}),
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
        message: offered.includes("csv")
          ? "The PDF cannot display some characters in this record. Download the CSV instead."
          : "The PDF cannot display some characters in this record. Ask the deployment operator whether CSV can be enabled for this RWA.",
        cause: { source: "export", code: "PDF_UNSUPPORTED_TEXT" },
        // A known font limitation with a CSV workaround, not a fault to alert on.
        report: false,
      });
    }
    log("error", "exports.render_failed", { requestId });
    reportError(error, {
      event: "exports.render_failed",
      error_code: "EXPORT_FAILED",
      error_category: "internal",
      error_type: "system",
    });
    // Already reported above with the original render error and its stack.
    throw new ApiError("EXPORT_FAILED", {
      cause: {
        source: "export",
        code: `${format.toUpperCase()}_RENDER_FAILED`,
      },
      report: false,
    });
  }
}
