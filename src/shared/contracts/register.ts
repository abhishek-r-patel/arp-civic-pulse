// Account and household administration contracts, including the bounded review table.
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

export const createAccountSchema = z
  .strictObject({
    email: emailAddress,
    representativeName: nameText,
    isAdmin: z.boolean().default(false),
    isReadonly: z.boolean().optional(),
    /** Optional household created with the account in one transaction. */
    household: z
      .strictObject({
        identifier: householdIdentifier,
        isEligible: z.boolean().default(false),
      })
      .optional(),
    /** Enable sign-in straight after creation. */
    enable: z.boolean().default(false),
  })
  .refine((value) => !(value.isAdmin && value.isReadonly), {
    message: "Choose either rwa-admin or rwa-readonly, never both.",
    path: ["isReadonly"],
  })
  .refine((value) => !value.enable || value.isAdmin || value.household, {
    message:
      "Residents and RWA ReadOnly accounts need a household before they can be enabled.",
    path: ["enable"],
  });

// Assigns a household to an account, or moves the account's household to a new identifier.
export const accountHouseholdSchema = z.strictObject({
  identifier: householdIdentifier,
});
export type AccountHouseholdInput = z.output<typeof accountHouseholdSchema>;

export interface AccountHousehold {
  id: string;
  identifier: string;
  isEligible: boolean;
}

/** Household choices for administrator forms; `listed` means only `options` are accepted. */
export interface HouseholdChoices {
  listed: boolean;
  options: string[];
}

const atLeastOne = (value: Record<string, unknown>) =>
  Object.values(value).some((field) => field !== undefined);

// Omitted fields mean "unchanged". Nothing here is nullable.
export const patchAccountSchema = z
  .strictObject({
    email: emailAddress.optional(),
    representativeName: nameText.optional(),
    status: z.enum(ACCOUNT_STATUSES).optional(),
    isAdmin: z.boolean().optional(),
    isReadonly: z.boolean().optional(),
  })
  .refine(atLeastOne, { message: "Provide at least one field to change." })
  .refine((value) => !(value.isAdmin && value.isReadonly), {
    message: "Choose either rwa-admin or rwa-readonly, never both.",
    path: ["isReadonly"],
  });

export const createHouseholdSchema = z.strictObject({
  identifier: householdIdentifier,
  representativeAccountId: uuid,
  isEligible: z.boolean().default(false),
});

/*
 * Public resident self-registration. `website` is a honeypot that people never
 * see; a filled value is accepted but silently ignored by the route.
 */
export const selfRegistrationSchema = z.strictObject({
  representativeName: nameText,
  email: emailAddress,
  identifier: householdIdentifier,
  website: z.string().max(200).optional(),
});
export type SelfRegistrationInput = z.output<typeof selfRegistrationSchema>;

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
  /** False with isReadonly=false is the implicit `voter` role. */
  isAdmin: boolean;
  /** Omitted when false; mutually exclusive with isAdmin and separate from vote entitlement. */
  isReadonly?: boolean;
  /** Omitted when false; the resident created this account through /register. */
  selfRegistered?: boolean;
  emailVerifiedAt: string | null;
  updatedAt: string;
}

/** Management-page read capability only; never authorizes mutations or ballots. */
export function canViewAdministration(account: {
  isAdmin: boolean;
  isReadonly?: boolean;
}): boolean {
  return account.isAdmin || account.isReadonly === true;
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

export interface ReviewAccountProjection extends AccountProjection {
  household: { id: string; identifier: string; isEligible: boolean } | null;
}

export type AccountReviewAction = "enable" | "eligible";

export function canReviewAccount(
  account: ReviewAccountProjection,
  action: AccountReviewAction,
): boolean {
  if (account.status === "DELETED") return false;
  return action === "enable"
    ? account.status === "SUSPENDED" &&
        account.email !== null &&
        (account.isAdmin || account.household !== null)
    : account.household !== null && !account.household.isEligible;
}

export function accountReviewTargets(
  accounts: readonly ReviewAccountProjection[],
  selected: ReadonlySet<string>,
  action: AccountReviewAction,
): ReviewAccountProjection[] {
  return accounts.filter(
    (account) => selected.has(account.id) && canReviewAccount(account, action),
  );
}

export type CreateAccountInput = z.output<typeof createAccountSchema>;
export type PatchAccountInput = z.output<typeof patchAccountSchema>;
export type CreateHouseholdInput = z.output<typeof createHouseholdSchema>;
export type PatchHouseholdInput = z.output<typeof patchHouseholdSchema>;
