import { z } from "zod";
import { VOTE_STATUSES, VOTING_TYPES } from "@/shared/contracts/voting";
import { listQuerySchema, queryBoolean } from "@/shared/contracts/pagination";
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
    if (draft.eligibleHouseholdIds) {
      requireDistinct(
        context,
        ["eligibleHouseholdIds"],
        draft.eligibleHouseholdIds,
        "Duplicate household.",
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
    if (draft.votingType === "OPEN" && hasOffices) {
      context.addIssue({
        code: "custom",
        path: ["offices"],
        message: "OPEN votes have no offices.",
      });
    }
    if (draft.votingType === "CLOSED" && hasOptions) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "CLOSED votes have no options.",
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

// Early completion and cancellation need explicit confirmation and a recorded reason.
export const lifecycleActionSchema = z.strictObject({
  confirmed,
  reason: reasonText,
});

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
});
