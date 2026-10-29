// Authorized RWA Admin/ReadOnly participation and audit-history reads.
import "server-only";
import { z } from "zod";
import { buildKnownPage, decodeCursor } from "@/server/http/cursor";
import { numberedPage } from "@/server/http/numbered-page";
import { ApiError } from "@/server/http/errors";
import { callRoutine, type RegisterDeps } from "@/server/register/shared";
import { enforceReadLimit } from "@/server/votes/member";
import {
  auditQuerySchema,
  participationQuerySchema,
} from "@/shared/contracts/admin-votes";
import {
  auditListSchema,
  participationMonitorSchema,
  type AuditEvent,
} from "@/shared/contracts/member-votes";
import type { PageInfo } from "@/shared/contracts/pagination";
import { uuid } from "@/shared/validation/primitives";

/*
 * Management monitoring. Participation shows who has and has not submitted
 * (frozen name and household identifier) and never a choice, an email or a
 * per-submission time. The audit history exposes allowlisted fields only. Both
 * database routines re-check the caller as an enabled RWA Admin or RWA ReadOnly.
 */
function parse<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError("INTERNAL_ERROR");
  }
  return result.data;
}

const participationPosition = z.object({ key: z.string().max(100), id: uuid });

export interface ParticipationReport {
  voteId: string;
  status: "SCHEDULED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  eligibleCount: string;
  submittedCount: string;
  rows: {
    representativeName: string;
    householdIdentifier: string;
    submitted: boolean;
  }[];
}

export async function getParticipationReport(
  deps: RegisterDeps,
  voteId: string,
  query: z.output<typeof participationQuerySchema>,
  requestedPage?: number,
): Promise<{ data: ParticipationReport; page: PageInfo }> {
  await enforceReadLimit(deps);
  const binding = {
    endpoint: "/api/admin/votes/participation",
    parentId: voteId,
    filters: { submitted: query.submitted },
  };
  const window =
    requestedPage === undefined
      ? undefined
      : await numberedPage(
          deps,
          "participation",
          requestedPage,
          query.limit,
          binding,
        );
  if (window) query = { ...query, cursor: window.cursor };
  const after = query.cursor
    ? decodeCursor(query.cursor, binding, participationPosition)
    : null;

  const report = parse(
    participationMonitorSchema,
    await callRoutine(deps.client, "get_vote_participation", {
      p_vote_id: voteId,
      p_submitted: query.submitted ?? null,
      p_limit: query.limit,
      p_after_key: after?.key ?? null,
      p_after_household: after?.id ?? null,
    }),
  );

  const { rows, page } = buildKnownPage(
    report.rows,
    report.hasMore,
    query.limit,
    binding,
    (row) => ({ key: row.cursor.key, id: row.cursor.householdId }),
  );
  if (window) page.numbered = window.numbered;
  return {
    data: {
      voteId: report.voteId,
      status: report.status,
      eligibleCount: report.eligibleCount,
      submittedCount: report.submittedCount,
      rows: rows.map((row) => ({
        representativeName: row.representativeName,
        householdIdentifier: row.householdIdentifier,
        submitted: row.submitted,
      })),
    },
    page,
  };
}

const auditPosition = z.object({ id: z.string().regex(/^\d{1,19}$/u) });

export async function listAuditEvents(
  deps: RegisterDeps,
  query: z.output<typeof auditQuerySchema>,
  requestedPage?: number,
): Promise<{ data: AuditEvent[]; page: PageInfo }> {
  await enforceReadLimit(deps);
  const binding = {
    endpoint: "/api/admin/audit",
    filters: {
      action: query.action,
      targetType: query.targetType,
      from: query.from,
      to: query.to,
      who: query.who,
      details: query.details,
    },
  };
  const window =
    requestedPage === undefined
      ? undefined
      : await numberedPage(deps, "audit", requestedPage, query.limit, binding);
  if (window) query = { ...query, cursor: window.cursor };
  const after = query.cursor
    ? decodeCursor(query.cursor, binding, auditPosition)
    : null;

  const list = parse(
    auditListSchema,
    await callRoutine(deps.client, "list_audit_events", {
      p_limit: query.limit,
      p_after_id: after?.id ?? null,
      p_action: query.action ?? null,
      p_target_type: query.targetType ?? null,
      p_from: query.from ?? null,
      p_to: query.to ?? null,
      ...(query.who ? { p_who: query.who } : {}),
      ...(query.details ? { p_details: query.details } : {}),
    }),
  );

  const { rows, page } = buildKnownPage(
    list.rows,
    list.hasMore,
    query.limit,
    binding,
    (row) => ({ id: row.id }),
  );
  if (window) page.numbered = window.numbered;
  return { data: rows, page };
}
