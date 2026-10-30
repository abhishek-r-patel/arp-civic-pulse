import { z } from "zod";
import { confirmed, uuid } from "@/shared/validation/primitives";

/*
 * Submission bodies (docs/API.md section 4.2). The body carries no voting
 * type: the two shapes are mutually exclusive, strict objects, so a mixed or
 * extended payload fails. Identity, household, timestamps, counts and
 * idempotency identifiers are never accepted. Completeness against the frozen
 * ballot is rechecked inside the guarded database operation.
 */
export const openSubmissionSchema = z.strictObject({
  confirmed,
  optionId: uuid,
});

export const openMultipleSubmissionSchema = z.strictObject({
  confirmed,
  optionIds: z
    .array(uuid)
    .min(1, "Select at least one option.")
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Each option can be selected only once.",
    }),
});

// `candidateId: null` is the explicit NOTA choice; omitting the key is invalid.
export const closedSelectionSchema = z.strictObject({
  officeId: uuid,
  candidateId: uuid.nullable(),
});

export const closedSubmissionSchema = z.strictObject({
  confirmed,
  selections: z
    .array(closedSelectionSchema)
    .min(1, "Select a choice for every office.")
    .refine(
      (selections) =>
        new Set(selections.map((selection) => selection.officeId)).size ===
        selections.length,
      "Each office can appear only once.",
    ),
});

export const submissionSchema = z.union([
  openSubmissionSchema,
  openMultipleSubmissionSchema,
  closedSubmissionSchema,
]);

export type Submission = z.infer<typeof submissionSchema>;
