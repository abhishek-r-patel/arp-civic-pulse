// Management-only export authorization and PRIVATE voter-roster composition tests.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisterDeps } from "@/server/register/shared";

const mocks = vi.hoisted(() => ({
  assertOk: vi.fn(),
  callRoutine: vi.fn(),
  loadAuthIdentities: vi.fn(),
  enforceExportRateLimit: vi.fn(),
  enforceReadLimit: vi.fn(),
  getCompleteResults: vi.fn(),
  getMemberVote: vi.fn(),
}));

vi.mock("@/server/register/shared", () => ({
  assertOk: mocks.assertOk,
  callRoutine: mocks.callRoutine,
  loadAuthIdentities: mocks.loadAuthIdentities,
}));
vi.mock("@/server/auth/rate-limit", () => ({
  VOTE_RATE_LIMITS: { exportByProfile: {} },
  enforceRateLimit: mocks.enforceExportRateLimit,
}));
vi.mock("@/server/votes/member", () => ({
  enforceReadLimit: mocks.enforceReadLimit,
  getCompleteResults: mocks.getCompleteResults,
  getMemberVote: mocks.getMemberVote,
}));

import {
  exportResults,
  getPrivateVoterRosterForPdf,
} from "@/server/exports/results-export";

const voteId = "00000000-0000-4000-8000-000000000001";
const householdId = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function managementDeps(
  rows: {
    household_id: string;
    representative_profile_id: string | null;
  }[] = [],
  isAdmin = true,
  isReadonly = !isAdmin,
): RegisterDeps {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    returns: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.returns.mockResolvedValue({ data: rows, error: null });
  return {
    tenant: {
      kind: "single",
      tenantId: "single-rwa",
      hostname: "main.localhost",
      canonicalOrigin: "http://main.localhost",
      state: "active",
      projectUrl: undefined,
      publishableKey: undefined,
      serviceRoleKeyRef: undefined,
    },
    client: { from: vi.fn(() => query) } as unknown as RegisterDeps["client"],
    admin: {} as RegisterDeps["admin"],
    actor: {
      id: householdId(999),
      representativeName: "Example Administrator",
      isAdmin,
      isReadonly,
    },
  };
}

function participationPage(
  rows: {
    representativeName: string;
    householdIdentifier: string;
    householdId: string;
  }[],
  hasMore = false,
) {
  return {
    voteId,
    status: "COMPLETED",
    eligibleCount: String(rows.length),
    submittedCount: String(rows.length),
    rows: rows.map((row) => ({
      representativeName: row.representativeName,
      householdIdentifier: row.householdIdentifier,
      submitted: true,
      cursor: { key: row.householdIdentifier, householdId: row.householdId },
    })),
    hasMore,
  };
}

describe("management-only result exports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertOk.mockImplementation(() => undefined);
    mocks.enforceExportRateLimit.mockResolvedValue(undefined);
    mocks.enforceReadLimit.mockResolvedValue(undefined);
  });

  it("rejects a resident's direct export request", async () => {
    const deps = managementDeps([], false, false);
    mocks.getMemberVote.mockResolvedValue({ status: "COMPLETED" });
    await expect(
      exportResults(deps, voteId, "pdf", "request-id"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.getMemberVote).toHaveBeenCalledWith(deps, voteId);
    expect(mocks.getCompleteResults).not.toHaveBeenCalled();
  });

  it("uses current Auth emails and sorts the complete roster by identifier", async () => {
    const participants = [
      {
        representativeName: "Cora",
        householdIdentifier: "C-1",
        householdId: householdId(3),
      },
      {
        representativeName: "Bea",
        householdIdentifier: "A-10",
        householdId: householdId(2),
      },
      {
        representativeName: "Ari",
        householdIdentifier: "A-2",
        householdId: householdId(1),
      },
    ];
    mocks.callRoutine.mockResolvedValue(participationPage(participants));
    mocks.loadAuthIdentities.mockResolvedValue(
      new Map([
        [householdId(1), { email: "ari@example.test", emailVerifiedAt: null }],
        [householdId(2), { email: "bea@example.test", emailVerifiedAt: null }],
        [householdId(3), { email: "cora@example.test", emailVerifiedAt: null }],
      ]),
    );
    const deps = managementDeps(
      participants.map((participant) => ({
        household_id: participant.householdId,
        representative_profile_id: participant.householdId,
      })),
    );

    await expect(
      getPrivateVoterRosterForPdf(deps, voteId, "3"),
    ).resolves.toEqual([
      {
        representativeName: "Ari",
        householdIdentifier: "A-2",
        email: "ari@example.test",
      },
      {
        representativeName: "Bea",
        householdIdentifier: "A-10",
        email: "bea@example.test",
      },
      {
        representativeName: "Cora",
        householdIdentifier: "C-1",
        email: "cora@example.test",
      },
    ]);
    expect(mocks.callRoutine).toHaveBeenCalledWith(
      expect.anything(),
      "get_vote_participation",
      expect.objectContaining({ p_submitted: true, p_limit: 100 }),
    );
  });

  it("fails closed when the participation count differs from completed results", async () => {
    mocks.callRoutine.mockResolvedValue(participationPage([]));
    await expect(
      getPrivateVoterRosterForPdf(managementDeps(), voteId, "1"),
    ).rejects.toMatchObject({ code: "RESULTS_INTEGRITY_ERROR" });
  });

  it("fails closed when a submitted representative has no current Auth email", async () => {
    const participant = {
      representativeName: "Ari",
      householdIdentifier: "A-1",
      householdId: householdId(1),
    };
    mocks.callRoutine.mockResolvedValue(participationPage([participant]));
    mocks.loadAuthIdentities.mockResolvedValue(
      new Map([[householdId(1), { email: null, emailVerifiedAt: null }]]),
    );
    const deps = managementDeps([
      {
        household_id: participant.householdId,
        representative_profile_id: participant.householdId,
      },
    ]);
    await expect(
      getPrivateVoterRosterForPdf(deps, voteId, "1"),
    ).rejects.toMatchObject({ code: "RESULTS_INTEGRITY_ERROR" });
  });
});
