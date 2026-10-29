// Validated administrator vote editing, lifecycle and listing requests.
import { z } from "zod";
import { VOTE_STATUSES, VOTING_TYPES } from "@/shared/contracts/voting";
import { listQuerySchema, queryBoolean } from "@/shared/contracts/pagination";
import { householdListQuerySchema } from "@/shared/contracts/register";
import {
  confirmed,
  draftTitleText,
  longText,
  nameText,
  offsetInstant,
  position,
  reasonText,
  revision,
  uuid,
} from "@/shared/validation/primitives";

/*
 * Provisional technical collection bounds sized against the pilot (500
 * households). They protect parsing and memory; they are not election rules
 * and must be confirmed during pilot validation (docs/API.md section 6.1).
 */
export const COLLECTION_LIMITS = {
  households: 1_000,
  offices: 50,
  candidatesPerOffice: 100,
  options: 100,
} as const;

const votingType = z.enum(VOTING_TYPES);

// Case/width/whitespace-insensitive key used to detect indistinguishable labels.
export function normalizedKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ");
}

const candidateSchema = z.strictObject({
  id: uuid.optional(),
  name: nameText,
  position,
});

const officeSchema = z.strictObject({
  id: uuid.optional(),
  name: nameText,
  position,
  candidates: z
    .array(candidateSchema)
    .max(COLLECTION_LIMITS.candidatesPerOffice),
});

const optionSchema = z.strictObject({
  id: uuid.optional(),
  label: nameText,
  position,
});

export const createDraftSchema = z.strictObject({ votingType });

function requireDistinct(
  context: z.RefinementCtx,
  path: (string | number)[],
  values: readonly (string | number | undefined)[],
  message: string,
): void {
  const seen = new Set<string | number>();
  values.forEach((value, index) => {
    if (value === undefined) {
      return;
    }
    if (seen.has(value)) {
      context.addIssue({ code: "custom", path: [...path, index], message });
    }
    seen.add(value);
  });
}

export const draftPatchSchema = z
  .strictObject({
    expectedRevision: revision,
    votingType: votingType.optional(),
    openSelectionMode: z.enum(["SINGLE", "MULTIPLE"]).optional(),
    openSelectionLimit: z.number().int().min(1).max(100).nullable().optional(),
    title: draftTitleText.optional(),
    instructions: longText.nullable().optional(),
    closesAt: offsetInstant.nullable().optional(),
    eligibleHouseholdIds: z
      .array(uuid)
      .max(COLLECTION_LIMITS.households)
      .optional(),
    offices: z.array(officeSchema).max(COLLECTION_LIMITS.offices).optional(),
    options: z.array(optionSchema).max(COLLECTION_LIMITS.options).optional(),
  })
  .superRefine((draft, context) => {
    const hasMode = draft.openSelectionMode !== undefined;
    const hasLimit = Object.hasOwn(draft, "openSelectionLimit");
    if (hasMode !== hasLimit) {
      context.addIssue({
        code: "custom",
        path: [hasMode ? "openSelectionLimit" : "openSelectionMode"],
        message: "Set the PUBLIC selection mode and limit together.",
      });
    } else if (hasMode) {
      const validModeLimit =
        (draft.openSelectionMode === "SINGLE" &&
          draft.openSelectionLimit === 1) ||
        (draft.openSelectionMode === "MULTIPLE" &&
          (draft.openSelectionLimit === null ||
            (draft.openSelectionLimit !== undefined &&
              draft.openSelectionLimit >= 2)));
      if (!validModeLimit) {
        context.addIssue({
          code: "custom",
          path: ["openSelectionLimit"],
          message:
            "Single-select uses a limit of 1; multi-select uses 2 or more, or no limit.",
        });
      }
    }
    if (draft.votingType === "PRIVATE" && (hasMode || hasLimit)) {
      context.addIssue({
        code: "custom",
        path: ["openSelectionMode"],
        message: "PUBLIC selection settings do not apply to PRIVATE elections.",
      });
    }

    if (draft.eligibleHouseholdIds) {
      requireDistinct(
        context,
        ["eligibleHouseholdIds"],
        draft.eligibleHouseholdIds,
        "Duplicate entries are not allowed.",
      );
    }

    if (draft.offices) {
      requireDistinct(
        context,
        ["offices"],
        draft.offices.map((o) => o.id),
        "Duplicate ID.",
      );
      requireDistinct(
        context,
        ["offices"],
        draft.offices.map((o) => o.position),
        "Duplicate position.",
      );
      requireDistinct(
        context,
        ["offices"],
        draft.offices.map((o) => normalizedKey(o.name)),
        "Duplicate office name.",
      );

      draft.offices.forEach((office, index) => {
        const base = ["offices", index, "candidates"];
        requireDistinct(
          context,
          base,
          office.candidates.map((c) => c.id),
          "Duplicate ID.",
        );
        requireDistinct(
          context,
          base,
          office.candidates.map((c) => c.position),
          "Duplicate position.",
        );
        requireDistinct(
          context,
          base,
          office.candidates.map((c) => normalizedKey(c.name)),
          "Duplicate candidate name.",
        );
      });
    }

    if (draft.options) {
      requireDistinct(
        context,
        ["options"],
        draft.options.map((o) => o.id),
        "Duplicate ID.",
      );
      requireDistinct(
        context,
        ["options"],
        draft.options.map((o) => o.position),
        "Duplicate position.",
      );
      requireDistinct(
        context,
        ["options"],
        draft.options.map((o) => normalizedKey(o.label)),
        "Duplicate option label.",
      );
    }

    // Never reinterpret options as candidates: reject mixed ballot configuration.
    const hasOffices = (draft.offices?.length ?? 0) > 0;
    const hasOptions = (draft.options?.length ?? 0) > 0;
    if (hasOffices && hasOptions) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "A vote cannot contain both offices and options.",
      });
    }
    if (draft.votingType === "PUBLIC" && hasOffices) {
      context.addIssue({
        code: "custom",
        path: ["offices"],
        message: "PUBLIC votes have no offices.",
      });
    }
    if (draft.votingType === "PRIVATE" && hasOptions) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "PRIVATE votes have no options.",
      });
    }
  });

export const revisionOnlySchema = z.strictObject({
  expectedRevision: revision,
});

export const activateSchema = z.strictObject({
  expectedRevision: revision,
  confirmed,
});

export const scheduleVoteSchema = activateSchema.extend({
  opensAt: offsetInstant,
});

// Early completion and cancellation need explicit confirmation and a recorded reason.
export const lifecycleActionSchema = z.strictObject({
  confirmed,
  reason: reasonText,
});

/*
 * Moving an ACTIVE vote's deadline (later or earlier). The database clock
 * decides whether the new deadline is far enough ahead; the reason is
 * recorded only in the audit history.
 */
export const DEADLINE_CHANGE_MIN_LEAD_MINUTES = 5;

export const deadlineChangeSchema = z.strictObject({
  confirmed,
  closesAt: offsetInstant,
  reason: reasonText,
});

export type DeadlineShift =
  | { ok: true; direction: "EXTENDED" | "SHORTENED"; by: string }
  | { ok: false; problem: "UNCHANGED" | "TOO_SOON" };

/** "2 days 3 hours", "45 minutes": whole minutes, zero parts omitted. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  const parts: string[] = [];
  const add = (value: number, unit: string) => {
    if (value > 0) {
      parts.push(`${value} ${unit}${value === 1 ? "" : "s"}`);
    }
  };
  add(Math.floor(minutes / 1440), "day");
  add(Math.floor((minutes % 1440) / 60), "hour");
  add(minutes % 60, "minute");
  return parts.length === 0 ? "less than a minute" : parts.join(" ");
}

/**
 * Pre-checks a new deadline in the browser so the administrator sees the
 * effect before confirming. The database repeats the checks with its own clock.
 * The shift is measured from the current deadline truncated to the minute,
 * because that is what the minute-precision input shows; otherwise an untouched
 * input would read as "brought forward" by the hidden seconds.
 */
export function describeDeadlineShift(
  currentIso: string,
  nextIso: string,
  nowMs: number = Date.now(),
): DeadlineShift {
  const current = Math.floor(new Date(currentIso).getTime() / 60_000) * 60_000;
  const next = new Date(nextIso).getTime();
  if (next === current) {
    return { ok: false, problem: "UNCHANGED" };
  }
  if (next < nowMs + DEADLINE_CHANGE_MIN_LEAD_MINUTES * 60_000) {
    return { ok: false, problem: "TOO_SOON" };
  }
  return {
    ok: true,
    direction: next > current ? "EXTENDED" : "SHORTENED",
    by: formatDuration(next - current),
  };
}

export type DraftPatch = z.infer<typeof draftPatchSchema>;

export const voteListQuerySchema = listQuerySchema({
  status: z.enum(VOTE_STATUSES).optional(),
  votingType: votingType.optional(),
});

export const participationQuerySchema = listQuerySchema({
  submitted: queryBoolean.optional(),
});

export const auditQuerySchema = listQuerySchema({
  action: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
    .optional(),
  targetType: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
    .optional(),
  from: offsetInstant.optional(),
  to: offsetInstant.optional(),
}).refine((query) => !query.from || !query.to || query.from < query.to, {
  path: ["to"],
  message: "The end must be after the start.",
});

export const accountListQuerySchema = listQuerySchema({
  status: z.enum(["ENABLED", "SUSPENDED", "DELETED"]).optional(),
  isAdmin: queryBoolean.optional(),
  isReadonly: queryBoolean.optional(),
  selfRegistered: queryBoolean.optional(),
});

// Legacy directory cursors use flat/name ordering; the account API retains profile-ID ordering.
export const residentListQuerySchema = accountListQuerySchema.extend({
  identifier: householdListQuerySchema.shape.identifier,
  isEligible: householdListQuerySchema.shape.isEligible,
  hasHousehold: queryBoolean.optional(),
});

export const RESIDENT_SORT_KEYS = [
  "representative",
  "household",
  "status",
  "role",
  "eligibility",
  "updated",
] as const;
export const residentTableQuerySchema = residentListQuerySchema
  .extend({
    identifierContains: householdListQuerySchema.shape.identifier,
    representative: z.string().trim().min(1).max(200).optional(),
    changedFrom: offsetInstant.optional(),
    changedTo: offsetInstant.optional(),
    sort: z.enum(RESIDENT_SORT_KEYS).default("household"),
    direction: z.enum(["asc", "desc"]).default("asc"),
  })
  .refine(
    (value) =>
      !value.changedFrom ||
      !value.changedTo ||
      new Date(value.changedFrom) < new Date(value.changedTo),
    {
      path: ["changedTo"],
      message: "The end must be after the start.",
    },
  );
export type ResidentTableQuery = z.output<typeof residentTableQuerySchema>;
