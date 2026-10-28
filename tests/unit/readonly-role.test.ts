/* Management roles are exclusive and independent from household voting eligibility. */
import { describe, expect, it } from "vitest";
import {
  canReviewAccount,
  canViewAdministration,
  createAccountSchema,
  patchAccountSchema,
  type ReviewAccountProjection,
} from "@/shared/contracts/register";

describe("rwa-readonly contract", () => {
  it("rejects assigning both management roles", () => {
    expect(
      createAccountSchema.safeParse({
        email: "committee@example.test",
        representativeName: "Example",
        isAdmin: true,
        isReadonly: true,
      }).success,
    ).toBe(false);
    expect(
      patchAccountSchema.safeParse({ isAdmin: true, isReadonly: true }).success,
    ).toBe(false);
    expect(
      patchAccountSchema.safeParse({ isAdmin: false, isReadonly: true })
        .success,
    ).toBe(true);
  });
  it("allows read-only committee access without treating a resident as a committee member", () => {
    expect(canViewAdministration({ isAdmin: false, isReadonly: true })).toBe(
      true,
    );
    expect(canViewAdministration({ isAdmin: true })).toBe(true);
    expect(canViewAdministration({ isAdmin: false })).toBe(false);
  });
  it("enables readonly like an administrator, with or without a household, while residents still need one", () => {
    const account: ReviewAccountProjection = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "committee@example.test",
      representativeName: "Example",
      isAdmin: false,
      isReadonly: true,
      status: "SUSPENDED",
      emailVerifiedAt: null,
      updatedAt: "2030-01-01T00:00:00Z",
      household: null,
    };
    expect(canReviewAccount(account, "enable")).toBe(true);
    expect(canReviewAccount(account, "eligible")).toBe(false);
    expect(canReviewAccount({ ...account, isReadonly: false }, "enable")).toBe(
      false,
    );
    expect(
      canReviewAccount(
        {
          ...account,
          household: { id: account.id, identifier: "A-101", isEligible: false },
        },
        "enable",
      ),
    ).toBe(true);

    const create = {
      email: "committee@example.test",
      representativeName: "Example",
      enable: true,
    };
    expect(
      createAccountSchema.safeParse({ ...create, isReadonly: true }).success,
    ).toBe(true);
    expect(createAccountSchema.safeParse(create).success).toBe(false);
  });
});
