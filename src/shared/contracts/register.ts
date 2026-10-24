import { z } from "zod";
import { listQuerySchema, queryBoolean } from "@/shared/contracts/pagination";
import {
  emailAddress,
  nameText,
  singleLineText,
  FIELD_LIMITS,
  uuid,
} from "@/shared/validation/primitives";

/*
 * Register administration contracts (docs/API.md section 4.3). Account email
 * and verification state live in Supabase Auth and are only ever projected,
 * never stored in application tables.
 */
export const ACCOUNT_STATUSES = ["ENABLED", "SUSPENDED", "DELETED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  ENABLED: "Enabled",
  SUSPENDED: "Suspended",
  DELETED: "Deleted",
};

const householdIdentifier = singleLineText(FIELD_LIMITS.householdLabel);

export const createAccountSchema = z.strictObject({
  email: emailAddress,
  representativeName: nameText,
  isAdmin: z.boolean().default(false),
});

const atLeastOne = (value: Record<string, unknown>) =>
  Object.values(value).some((field) => field !== undefined);

// Omitted fields mean "unchanged". Nothing here is nullable.
export const patchAccountSchema = z
  .strictObject({
    email: emailAddress.optional(),
    representativeName: nameText.optional(),
    status: z.enum(ACCOUNT_STATUSES).optional(),
    isAdmin: z.boolean().optional(),
  })
  .refine(atLeastOne, { message: "Provide at least one field to change." });

export const createHouseholdSchema = z.strictObject({
  identifier: householdIdentifier,
  representativeAccountId: uuid,
  isEligible: z.boolean().default(false),
});

export const patchHouseholdSchema = z
  .strictObject({
    identifier: householdIdentifier.optional(),
    representativeAccountId: uuid.optional(),
    isEligible: z.boolean().optional(),
  })
  .refine(atLeastOne, { message: "Provide at least one field to change." });

export const householdListQuerySchema = listQuerySchema({
  isEligible: queryBoolean.optional(),
  identifier: householdIdentifier.optional(),
});

export const idParamsSchema = z.strictObject({ id: uuid });

export interface AccountProjection {
  id: string;
  email: string | null;
  representativeName: string;
  status: AccountStatus;
  isAdmin: boolean;
  emailVerifiedAt: string | null;
  updatedAt: string;
}

export interface HouseholdProjection {
  id: string;
  identifier: string;
  representativeAccountId: string;
  isEligible: boolean;
  updatedAt: string;
  representative: {
    name: string;
    email: string | null;
    status: AccountStatus;
  };
}

export type CreateAccountInput = z.output<typeof createAccountSchema>;
export type PatchAccountInput = z.output<typeof patchAccountSchema>;
export type CreateHouseholdInput = z.output<typeof createHouseholdSchema>;
export type PatchHouseholdInput = z.output<typeof patchHouseholdSchema>;
