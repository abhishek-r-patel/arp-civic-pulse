import { describe, expect, it } from "vitest";
import {
  accountListQuerySchema,
  activateSchema,
  auditQuerySchema,
  createDraftSchema,
  deadlineChangeSchema,
  describeDeadlineShift,
  draftPatchSchema,
  formatDuration,
  lifecycleActionSchema,
  voteListQuerySchema,
  voteTableQuerySchema,
} from "@/shared/contracts/admin-votes";
import { requestCodeSchema, verifyCodeSchema } from "@/shared/contracts/auth";
import { submissionSchema } from "@/shared/contracts/ballots";
import {
  decimalString,
  emailAddress,
  ianaTimezone,
  longText,
  nameText,
  offsetInstant,
} from "@/shared/validation/primitives";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("text and email normalization", () => {
  it("trims, NFC-normalizes and bounds names", () => {
    expect(nameText.parse("  Cafe\u0301  ")).toBe("Caf\u00e9");
    expect(nameText.safeParse("x".repeat(200)).success).toBe(true);
    expect(nameText.safeParse("x".repeat(201)).success).toBe(false);
    expect(nameText.safeParse("   ").success).toBe(false);
  });

  it("rejects control characters and markup", () => {
    expect(nameText.safeParse("Line\nbreak").success).toBe(false);
    expect(nameText.safeParse("Null\u0000byte").success).toBe(false);
    expect(nameText.safeParse("<b>bold</b>").success).toBe(false);
    expect(nameText.safeParse("5 < 6 and 7 > 3").success).toBe(true);
  });

  it("allows newlines in long text and normalizes line endings", () => {
    expect(longText.parse("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
    expect(longText.safeParse("bell\u0007").success).toBe(false);
  });

  it("trims and lowercases email without provider rewriting", () => {
    expect(emailAddress.parse("  Resident+Tag@Example.TEST ")).toBe(
      "resident+tag@example.test",
    );
    expect(emailAddress.safeParse("not-an-email").success).toBe(false);
    expect(
      emailAddress.safeParse(`${"a".repeat(250)}@example.test`).success,
    ).toBe(false);
  });
});

describe("scalar primitives", () => {
  it("requires an explicit offset on instants and returns UTC", () => {
    expect(offsetInstant.parse("2030-01-01T10:00:00+05:30")).toBe(
      "2030-01-01T04:30:00.000Z",
    );
    expect(offsetInstant.parse("2030-01-01T10:00:00Z")).toBe(
      "2030-01-01T10:00:00.000Z",
    );
    expect(offsetInstant.safeParse("2030-01-01T10:00:00").success).toBe(false);
    expect(offsetInstant.safeParse("2030-01-01").success).toBe(false);
    expect(offsetInstant.safeParse("2030-02-31T10:00:00Z").success).toBe(false);
  });

  it("validates IANA time zones", () => {
    expect(ianaTimezone.safeParse("Asia/Kolkata").success).toBe(true);
    expect(ianaTimezone.safeParse("Mars/Base").success).toBe(false);
  });

  it("accepts only canonical bigint decimal strings", () => {
    expect(decimalString.safeParse("0").success).toBe(true);
    expect(decimalString.safeParse("9223372036854775807").success).toBe(true);
    expect(decimalString.safeParse("9223372036854775808").success).toBe(false);
    expect(decimalString.safeParse("007").success).toBe(false);
    expect(decimalString.safeParse("-1").success).toBe(false);
  });
});

describe("authentication contracts", () => {
  it("normalizes email and requires a six-digit code", () => {
    expect(requestCodeSchema.parse({ email: " A@Example.test " })).toEqual({
      email: "a@example.test",
    });
    expect(
      verifyCodeSchema.safeParse({ email: "a@example.test", code: "123456" })
        .success,
    ).toBe(true);
    expect(
      verifyCodeSchema.safeParse({ email: "a@example.test", code: "12345" })
        .success,
    ).toBe(false);
    expect(
      verifyCodeSchema.safeParse({ email: "a@example.test", code: "12345a" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      requestCodeSchema.safeParse({ email: "a@example.test", role: "admin" })
        .success,
    ).toBe(false);
  });
});

describe("submissionSchema", () => {
  it("accepts a confirmed PUBLIC submission", () => {
    expect(
      submissionSchema.safeParse({ confirmed: true, optionId: A }).success,
    ).toBe(true);
  });

  it("accepts non-empty multi-select ballots and rejects empty or duplicate options", () => {
    expect(
      submissionSchema.safeParse({
        confirmed: true,
        optionIds: [A, B],
      }).success,
    ).toBe(true);
    expect(
      submissionSchema.safeParse({
        confirmed: true,
        optionIds: [],
      }).success,
    ).toBe(false);
    expect(
      submissionSchema.safeParse({
        confirmed: true,
        optionIds: [A, A],
      }).success,
    ).toBe(false);
  });

  it("accepts a PRIVATE submission with an explicit NOTA choice", () => {
    expect(
      submissionSchema.safeParse({
        confirmed: true,
        selections: [
          { officeId: A, candidateId: B },
          { officeId: C, candidateId: null },
        ],
      }).success,
    ).toBe(true);
  });

  it("requires explicit confirmation", () => {
    expect(
      submissionSchema.safeParse({ confirmed: false, optionId: A }).success,
    ).toBe(false);
    expect(submissionSchema.safeParse({ optionId: A }).success).toBe(false);
  });

  it("rejects an omitted candidateId and duplicate offices", () => {
    expect(
      submissionSchema.safeParse({
        confirmed: true,
        selections: [{ officeId: A }],
      }).success,
    ).toBe(false);
    expect(
      submissionSchema.safeParse({
        confirmed: true,
        selections: [
          { officeId: A, candidateId: B },
          { officeId: A, candidateId: null },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects mixed shapes and caller-supplied identity or totals", () => {
    expect(
      submissionSchema.safeParse({
        confirmed: true,
        optionId: A,
        selections: [],
      }).success,
    ).toBe(false);
    for (const extra of [
      "accountId",
      "profileId",
      "householdId",
      "role",
      "submittedAt",
      "counts",
      "idempotencyKey",
    ]) {
      expect(
        submissionSchema.safeParse({ confirmed: true, optionId: A, [extra]: A })
          .success,
      ).toBe(false);
    }
  });

  it("rejects non-UUID identifiers and empty PRIVATE ballots", () => {
    expect(
      submissionSchema.safeParse({ confirmed: true, optionId: "1" }).success,
    ).toBe(false);
    expect(
      submissionSchema.safeParse({ confirmed: true, selections: [] }).success,
    ).toBe(false);
  });
});

describe("draft contracts", () => {
  it("requires an exact voting type and rejects extra fields", () => {
    expect(createDraftSchema.safeParse({ votingType: "PUBLIC" }).success).toBe(
      true,
    );
    expect(createDraftSchema.safeParse({ votingType: "open" }).success).toBe(
      false,
    );
    expect(
      createDraftSchema.safeParse({ votingType: "PUBLIC", status: "ACTIVE" })
        .success,
    ).toBe(false);
  });

  it("requires a positive integer revision", () => {
    expect(draftPatchSchema.safeParse({}).success).toBe(false);
    expect(draftPatchSchema.safeParse({ expectedRevision: 0 }).success).toBe(
      false,
    );
    expect(draftPatchSchema.safeParse({ expectedRevision: 1.5 }).success).toBe(
      false,
    );
    expect(draftPatchSchema.safeParse({ expectedRevision: 1 }).success).toBe(
      true,
    );
  });

  it("requires a matching PUBLIC selection mode and limit", () => {
    expect(
      draftPatchSchema.safeParse({
        expectedRevision: 1,
        openSelectionMode: "SINGLE",
        openSelectionLimit: 1,
      }).success,
    ).toBe(true);
    expect(
      draftPatchSchema.safeParse({
        expectedRevision: 1,
        openSelectionMode: "MULTIPLE",
        openSelectionLimit: null,
      }).success,
    ).toBe(true);
    for (const invalid of [
      { openSelectionMode: "MULTIPLE" },
      { openSelectionLimit: 3 },
      { openSelectionMode: "SINGLE", openSelectionLimit: 2 },
      { openSelectionMode: "MULTIPLE", openSelectionLimit: 1 },
      {
        votingType: "PRIVATE",
        openSelectionMode: "MULTIPLE",
        openSelectionLimit: null,
      },
    ]) {
      expect(
        draftPatchSchema.safeParse({ expectedRevision: 1, ...invalid }).success,
      ).toBe(false);
    }
  });

  it("allows an empty draft title and nullable fields only where documented", () => {
    const result = draftPatchSchema.parse({
      expectedRevision: 2,
      title: "  ",
      instructions: null,
      closesAt: null,
    });
    expect(result.title).toBe("");
    expect(
      draftPatchSchema.safeParse({ expectedRevision: 1, title: null }).success,
    ).toBe(false);
  });

  it("requires an offset-bearing deadline", () => {
    expect(
      draftPatchSchema.safeParse({
        expectedRevision: 1,
        closesAt: "2030-01-01T00:00:00",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate households", () => {
    expect(
      draftPatchSchema.safeParse({
        expectedRevision: 1,
        eligibleHouseholdIds: [A, A],
      }).success,
    ).toBe(false);
    expect(
      draftPatchSchema.safeParse({
        expectedRevision: 1,
        eligibleHouseholdIds: [A, B],
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate positions and indistinguishable names within a parent", () => {
    const duplicatePosition = draftPatchSchema.safeParse({
      expectedRevision: 1,
      options: [
        { label: "Yes", position: 1 },
        { label: "No", position: 1 },
      ],
    });
    const duplicateLabel = draftPatchSchema.safeParse({
      expectedRevision: 1,
      options: [
        { label: "Yes", position: 1 },
        { label: "  YES ", position: 2 },
      ],
    });
    const duplicateCandidate = draftPatchSchema.safeParse({
      expectedRevision: 1,
      offices: [
        {
          name: "President",
          position: 1,
          candidates: [
            { name: "Asha Rao", position: 1 },
            { name: "asha  rao", position: 2 },
          ],
        },
      ],
    });
    expect(duplicatePosition.success).toBe(false);
    expect(duplicateLabel.success).toBe(false);
    expect(duplicateCandidate.success).toBe(false);
  });

  it("allows the same candidate name in different offices", () => {
    expect(
      draftPatchSchema.safeParse({
        expectedRevision: 1,
        offices: [
          {
            name: "President",
            position: 1,
            candidates: [{ name: "Asha Rao", position: 1 }],
          },
          {
            name: "Treasurer",
            position: 2,
            candidates: [{ name: "Asha Rao", position: 1 }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects mixed PUBLIC/PRIVATE configuration", () => {
    const office = { name: "President", position: 1, candidates: [] };
    const option = { label: "Yes", position: 1 };

    expect(
      draftPatchSchema.safeParse({
        expectedRevision: 1,
        offices: [office],
        options: [option],
      }).success,
    ).toBe(false);
    expect(
      draftPatchSchema.safeParse({
        expectedRevision: 1,
        votingType: "PUBLIC",
        offices: [office],
      }).success,
    ).toBe(false);
    expect(
      draftPatchSchema.safeParse({
        expectedRevision: 1,
        votingType: "PRIVATE",
        options: [option],
      }).success,
    ).toBe(false);
    expect(
      draftPatchSchema.safeParse({
        expectedRevision: 1,
        votingType: "PUBLIC",
        options: [option],
      }).success,
    ).toBe(true);
  });

  it("requires confirmation, and a reason for lifecycle actions", () => {
    expect(
      activateSchema.safeParse({ expectedRevision: 1, confirmed: true })
        .success,
    ).toBe(true);
    expect(activateSchema.safeParse({ expectedRevision: 1 }).success).toBe(
      false,
    );
    expect(
      lifecycleActionSchema.safeParse({ confirmed: true, reason: "  " })
        .success,
    ).toBe(false);
    expect(lifecycleActionSchema.safeParse({ confirmed: true }).success).toBe(
      false,
    );
    expect(
      lifecycleActionSchema.safeParse({
        confirmed: true,
        reason: "Quorum reached",
      }).success,
    ).toBe(true);
  });

  it("requires an offset deadline, confirmation and a reason to move a deadline", () => {
    const valid = {
      confirmed: true,
      closesAt: "2026-11-20T18:00:00+05:30",
      reason: "Low turnout",
    };
    expect(deadlineChangeSchema.safeParse(valid).success).toBe(true);
    for (const bad of [
      { ...valid, confirmed: false },
      { ...valid, closesAt: "2026-11-20T18:00" },
      { ...valid, reason: " " },
      { ...valid, extra: 1 },
    ]) {
      expect(deadlineChangeSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("describes a deadline move and pre-checks it against the browser clock", () => {
    const now = Date.parse("2026-11-10T00:00:00Z");
    const current = "2026-11-12T12:00:00.000Z";
    expect(
      describeDeadlineShift(current, "2026-11-14T15:30:00.000Z", now),
    ).toEqual({
      ok: true,
      direction: "EXTENDED",
      by: "2 days 3 hours 30 minutes",
    });
    expect(
      describeDeadlineShift(current, "2026-11-12T11:00:00.000Z", now),
    ).toEqual({ ok: true, direction: "SHORTENED", by: "1 hour" });
    expect(describeDeadlineShift(current, current, now)).toEqual({
      ok: false,
      problem: "UNCHANGED",
    });
    expect(
      describeDeadlineShift(current, "2026-11-10T00:04:00.000Z", now),
    ).toEqual({ ok: false, problem: "TOO_SOON" });
    expect(
      describeDeadlineShift(current, "2026-11-10T00:05:00.000Z", now).ok,
    ).toBe(true);
    // Hidden seconds on the current deadline do not distort the shown shift.
    const withSeconds = "2026-11-12T12:00:45.000Z";
    expect(
      describeDeadlineShift(withSeconds, "2026-11-14T12:00:00.000Z", now),
    ).toEqual({ ok: true, direction: "EXTENDED", by: "2 days" });
    expect(
      describeDeadlineShift(withSeconds, "2026-11-12T12:00:00.000Z", now),
    ).toEqual({ ok: false, problem: "UNCHANGED" });
    expect(formatDuration(1 * 60_000)).toBe("1 minute");
    expect(formatDuration(20_000)).toBe("less than a minute");
  });
});

describe("list query contracts", () => {
  it("validates the sortable, filtered administrator vote table query", () => {
    expect(voteTableQuerySchema.parse({})).toMatchObject({
      sort: "updated",
      direction: "desc",
    });
    expect(
      voteTableQuerySchema.parse({
        titleContains: "  Board  ",
        deadlineFrom: "2030-01-01T00:00:00Z",
        deadlineTo: "2030-01-02T00:00:00Z",
        changedFrom: "2030-01-01T00:00:00Z",
        changedTo: "2030-01-02T00:00:00Z",
        sort: "deadline",
        direction: "asc",
      }),
    ).toMatchObject({
      titleContains: "Board",
      sort: "deadline",
      direction: "asc",
    });
    expect(
      voteTableQuerySchema.safeParse({
        deadlineFrom: "2030-01-02T00:00:00Z",
        deadlineTo: "2030-01-01T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      voteTableQuerySchema.safeParse({
        changedFrom: "2030-01-02T00:00:00Z",
        changedTo: "2030-01-01T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      voteTableQuerySchema.safeParse({
        titleContains: "x".repeat(101),
      }).success,
    ).toBe(false);
    expect(
      voteTableQuerySchema.safeParse({ sort: "unsupported" }).success,
    ).toBe(false);
  });

  it("applies the default page size and parses limits", () => {
    expect(voteListQuerySchema.parse({}).limit).toBe(25);
    expect(voteListQuerySchema.parse({ limit: "100" }).limit).toBe(100);
  });

  it.each(["0", "101", "-1", "1.5", "abc", "", "1000"])(
    "rejects limit %j",
    (limit) => {
      expect(voteListQuerySchema.safeParse({ limit }).success).toBe(false);
    },
  );

  it("rejects unknown filters and invalid enum values", () => {
    expect(voteListQuerySchema.safeParse({ offset: "5" }).success).toBe(false);
    expect(voteListQuerySchema.safeParse({ sort: "title" }).success).toBe(
      false,
    );
    expect(voteListQuerySchema.safeParse({ status: "active" }).success).toBe(
      false,
    );
    expect(
      voteListQuerySchema.safeParse({ status: "ACTIVE", votingType: "PUBLIC" })
        .success,
    ).toBe(true);
  });

  it("parses boolean filters strictly", () => {
    expect(accountListQuerySchema.parse({ isAdmin: "true" }).isAdmin).toBe(
      true,
    );
    expect(accountListQuerySchema.safeParse({ isAdmin: "1" }).success).toBe(
      false,
    );
  });

  it("bounds the cursor length", () => {
    expect(
      voteListQuerySchema.safeParse({ cursor: "x".repeat(512) }).success,
    ).toBe(true);
    expect(
      voteListQuerySchema.safeParse({ cursor: "x".repeat(513) }).success,
    ).toBe(false);
  });

  it("uses inclusive-from, exclusive-to audit ranges and rejects inversion", () => {
    expect(
      auditQuerySchema.safeParse({
        from: "2030-01-01T00:00:00Z",
        to: "2030-01-02T00:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      auditQuerySchema.safeParse({
        from: "2030-01-02T00:00:00Z",
        to: "2030-01-01T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      auditQuerySchema.safeParse({
        from: "2030-01-01T00:00:00Z",
        to: "2030-01-01T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(auditQuerySchema.safeParse({ from: "2030-01-01" }).success).toBe(
      false,
    );
    expect(
      auditQuerySchema.safeParse({
        who: "  Asha Admin  ",
        details: " early ",
      }),
    ).toMatchObject({
      success: true,
      data: { who: "Asha Admin", details: "early" },
    });
    expect(
      auditQuerySchema.safeParse({
        who: " ",
      }).success,
    ).toBe(false);
    expect(
      auditQuerySchema.safeParse({
        details: "x".repeat(101),
      }).success,
    ).toBe(false);
  });
});
