/* CSV boundary tests; server orchestration and database guards are tested separately. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/server/http/errors";
import { importRegisterRow } from "@/server/register/import";
import {
  findAuthUserIdByEmail,
  provisionAccount,
} from "@/server/register/provisioning";
import {
  assertCurrentAdmin,
  callRoutine,
  type RegisterDeps,
} from "@/server/register/shared";
import {
  IMPORT_HEADERS,
  IMPORT_LIMIT,
  importRequestSchema,
  parseRegisterCsv,
} from "@/shared/contracts/register-import";

vi.mock("@/server/register/provisioning", () => ({
  findAuthUserIdByEmail: vi.fn(),
  provisionAccount: vi.fn(),
}));
vi.mock("@/server/register/shared", () => ({
  assertCurrentAdmin: vi.fn(),
  callRoutine: vi.fn(),
}));

const header = IMPORT_HEADERS.join(",");
describe("register CSV", () => {
  it("parses BOM, CRLF, quoted commas, reordered columns and normalized email", () => {
    const parsed = parseRegisterCsv(
      '\uFEFFemail,is_eligible,identifier,representative_name\r\nRESIDENT@example.test,true,A-101,"Resident, Example"\r\n',
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        identifier: "A-101",
        representativeName: "Resident, Example",
        email: "resident@example.test",
        isEligible: true,
      },
    ]);
  });
  it.each([
    `${header},is_admin\nA-101,Alice,a@example.test,true,true`,
    `${header}\nA-101,Alice,a@example.test,yes`,
    `${header}\nA-101,Alice,a@example.test,true\na-101,Bob,b@example.test,true`,
    `${header}\nA-101,Alice,a@example.test,true\nＡ-101,Bob,b@example.test,true`,
    `${header}\nA-101,Alice,a@example.test,true\nA-102,Bob,A@example.test,false`,
    `${header}\nA-101,"Alice,a@example.test,true`,
    `${header}\nA-101,<b>Alice</b>,a@example.test,true`,
    header,
  ])("rejects invalid files without returning actionable rows", (csv) => {
    const result = parseRegisterCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.rows).toEqual([]);
  });
  it("bounds row count and bytes", () => {
    expect(
      parseRegisterCsv(
        `${header}\n${Array.from({ length: IMPORT_LIMIT + 1 }, (_, index) => `A-${index},Resident,resident${index}@example.test,true`).join("\n")}`,
      ).errors.length,
    ).toBe(1);
    expect(parseRegisterCsv("x".repeat(256 * 1024 + 1)).errors.length).toBe(1);
  });
  it("requires explicit mutation confirmation", () => {
    const row = {
      identifier: "A-101",
      representativeName: "Alice",
      email: "a@example.test",
      isEligible: true,
    };
    expect(
      importRequestSchema.safeParse({ row, action: "preview" }).success,
    ).toBe(true);
    expect(
      importRequestSchema.safeParse({ row, action: "import" }).success,
    ).toBe(false);
    expect(
      importRequestSchema.safeParse({ row, action: "import", confirmed: true })
        .success,
    ).toBe(true);
    expect(
      importRequestSchema.safeParse({ row, action: "enable", confirmed: true })
        .success,
    ).toBe(false);
  });
});

describe("register import orchestration", () => {
  const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const client = {} as SupabaseClient;
  const deps: RegisterDeps = {
    client,
    admin: client,
    actor: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      representativeName: "Admin",
      isAdmin: true,
    },
  };
  const row = {
    identifier: "A-101",
    representativeName: "Alice",
    email: "a@example.test",
    isEligible: true,
  };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(assertCurrentAdmin).mockResolvedValue(undefined);
    vi.mocked(findAuthUserIdByEmail).mockResolvedValue(null);
  });
  it("previews without provisioning or writing", async () => {
    vi.mocked(callRoutine).mockResolvedValue({ state: "READY" });
    expect(await importRegisterRow(deps, row, false)).toMatchObject({
      state: "READY",
    });
    expect(provisionAccount).not.toHaveBeenCalled();
    expect(callRoutine).toHaveBeenCalledExactlyOnceWith(
      client,
      "check_register_import",
      expect.objectContaining({ p_account_id: null }),
    );
  });
  it.each(["EXISTING", "CONFLICT"])(
    "does not provision or overwrite a %s row",
    async (state) => {
      vi.mocked(callRoutine).mockResolvedValue({ state });
      expect(await importRegisterRow(deps, row, true)).toMatchObject({ state });
      expect(provisionAccount).not.toHaveBeenCalled();
      expect(callRoutine).toHaveBeenCalledTimes(1);
    },
  );
  it("provisions a non-admin account then invokes the guarded assignment", async () => {
    vi.mocked(callRoutine)
      .mockResolvedValueOnce({ state: "READY" })
      .mockResolvedValueOnce({ state: "IMPORTED", accountId });
    vi.mocked(provisionAccount).mockResolvedValue({
      accountId,
      authIdentity: "created",
      profile: "created",
    });
    expect(await importRegisterRow(deps, row, true)).toMatchObject({
      state: "IMPORTED",
      accountId,
    });
    expect(provisionAccount).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        isAdmin: false,
        actorProfileId: deps.actor.id,
      }),
    );
    expect(callRoutine).toHaveBeenLastCalledWith(
      client,
      "import_register_household",
      expect.objectContaining({ p_account_id: accountId }),
    );
  });
  it("surfaces provider partial failure and does not assign or enable", async () => {
    vi.mocked(callRoutine).mockResolvedValue({ state: "READY" });
    vi.mocked(provisionAccount).mockRejectedValue(
      new ApiError("PROVISIONING_INCOMPLETE"),
    );
    await expect(importRegisterRow(deps, row, true)).rejects.toMatchObject({
      code: "PROVISIONING_INCOMPLETE",
    });
    expect(callRoutine).toHaveBeenCalledTimes(1);
  });
  it("rechecks authorization before looking up or provisioning identities", async () => {
    vi.mocked(assertCurrentAdmin).mockRejectedValue(new ApiError("FORBIDDEN"));
    await expect(importRegisterRow(deps, row, true)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(findAuthUserIdByEmail).not.toHaveBeenCalled();
  });
});
