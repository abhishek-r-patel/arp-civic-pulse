import { describe, expect, it } from "vitest";
import {
  buildPatch,
  describeFieldPath,
  fieldIdForPath,
  isDirty,
  mergeOnto,
  rebaseOnto,
  stateFromDetail,
} from "@/components/admin/draft-model";
import type { AdminVoteDetail } from "@/shared/contracts/drafts";

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KOLKATA = "Asia/Kolkata";

function detail(overrides: Partial<AdminVoteDetail> = {}): AdminVoteDetail {
  return {
    id: ID(1),
    votingType: "PRIVATE",
    openSelectionMode: "SINGLE",
    openSelectionLimit: 1,
    status: "DRAFT",
    title: "Committee election",
    instructions: "Choose one per office.",
    closesAt: "2099-01-01T06:30:00.000Z",
    draftRevision: 3,
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
    activatedAt: null,
    completedAt: null,
    completionMode: null,
    completionReason: null,
    cancelledAt: null,
    cancellationReason: null,
    rwaName: "Lakeview RWA",
    timezone: KOLKATA,
    offices: [
      {
        id: ID(10),
        name: "Chair",
        position: 1,
        candidates: [
          { id: ID(20), name: "Asha", position: 1 },
          { id: ID(21), name: "Ravi", position: 2 },
        ],
      },
    ],
    options: [],
    eligibleHouseholdIds: [ID(30), ID(31)],
    ...overrides,
  };
}

const LOCAL = "2099-01-01T12:00";
const base = () => stateFromDetail(detail(), LOCAL);

describe("buildPatch", () => {
  it("sends nothing when nothing changed", () => {
    const result = buildPatch(base(), base(), KOLKATA);
    expect(result).toEqual({ ok: true, patch: {}, changed: [] });
    expect(isDirty(base(), base(), KOLKATA)).toBe(false);
  });

  it("sends only the sections that changed", () => {
    const current = { ...base(), title: "Renamed" };
    expect(buildPatch(base(), current, KOLKATA)).toEqual({
      ok: true,
      patch: { title: "Renamed" },
      changed: ["title"],
    });
  });

  it("sends the PUBLIC mode and limit as one coherent selection setting", () => {
    const current = {
      ...base(),
      votingType: "PUBLIC" as const,
      openSelectionMode: "MULTIPLE" as const,
      openSelectionLimit: 3,
      options: [
        { key: "new-1", label: "Monday" },
        { key: "new-2", label: "Tuesday" },
      ],
      offices: [],
    };
    expect(buildPatch(base(), current, KOLKATA)).toMatchObject({
      patch: {
        openSelectionMode: "MULTIPLE",
        openSelectionLimit: 3,
      },
      changed: expect.arrayContaining(["selection"]),
    });
  });

  it("does not send PUBLIC selection settings when changing to PRIVATE", () => {
    const openBase = stateFromDetail(
      detail({
        votingType: "PUBLIC",
        openSelectionMode: "MULTIPLE",
        openSelectionLimit: null,
        offices: [],
        options: [{ id: ID(40), label: "Yes", position: 1 }],
      }),
      LOCAL,
    );
    const current = {
      ...openBase,
      votingType: "PRIVATE" as const,
      openSelectionMode: "SINGLE" as const,
      openSelectionLimit: 1,
      options: [],
    };
    expect(buildPatch(openBase, current, KOLKATA)).toMatchObject({
      patch: { votingType: "PRIVATE" },
    });
    expect(buildPatch(openBase, current, KOLKATA)).not.toMatchObject({
      patch: expect.objectContaining({
        openSelectionMode: expect.anything(),
      }),
    });
  });

  it("clears instructions with null and the deadline with null", () => {
    const current = { ...base(), instructions: "   ", closesLocal: "" };
    expect(buildPatch(base(), current, KOLKATA)).toEqual({
      ok: true,
      patch: { instructions: null, closesAt: null },
      changed: ["instructions", "deadline"],
    });
  });

  it("converts the deadline in the RWA zone to an offset instant", () => {
    const current = { ...base(), closesLocal: "2099-02-03T18:00" };
    expect(buildPatch(base(), current, KOLKATA)).toMatchObject({
      ok: true,
      patch: { closesAt: "2099-02-03T12:30:00.000Z" },
    });
  });

  it("refuses an ambiguous or non-existent local deadline", () => {
    const current = { ...base(), closesLocal: "2026-11-01T01:30" };
    expect(buildPatch(base(), current, "America/New_York")).toEqual({
      ok: false,
      deadline: "AMBIGUOUS",
    });
    expect(
      buildPatch(
        base(),
        { ...base(), closesLocal: "2026-03-08T02:30" },
        "America/New_York",
      ),
    ).toEqual({ ok: false, deadline: "NONEXISTENT" });
  });

  it("cannot set a deadline without a known time zone", () => {
    const current = { ...base(), closesLocal: "2099-02-03T18:00" };
    expect(buildPatch(base(), current, null)).toEqual({
      ok: false,
      deadline: "INVALID",
    });
  });

  it("carries existing children by id with positions from screen order", () => {
    const current = base();
    current.offices[0]?.candidates.reverse();
    current.offices[0]?.candidates.push({ key: "new-1", name: "Meera" });
    const result = buildPatch(base(), current, KOLKATA);
    expect(result).toMatchObject({
      ok: true,
      changed: ["ballot"],
      patch: {
        offices: [
          {
            id: ID(10),
            name: "Chair",
            position: 1,
            candidates: [
              { id: ID(21), name: "Ravi", position: 1 },
              { id: ID(20), name: "Asha", position: 2 },
              { name: "Meera", position: 3 },
            ],
          },
        ],
      },
    });
    // A new child has no id at all, never an empty or placeholder one.
    if (!result.ok) {
      throw new Error("Expected a patch.");
    }
    const offices = result.patch.offices as { candidates: object[] }[];
    expect(offices[0]?.candidates[2]).not.toHaveProperty("id");
  });

  it("detects a changed electorate regardless of order", () => {
    expect(
      buildPatch(
        base(),
        { ...base(), selectedHouseholdIds: [ID(31), ID(30)] },
        KOLKATA,
      ),
    ).toMatchObject({ changed: [] });
    expect(
      buildPatch(
        base(),
        { ...base(), selectedHouseholdIds: [ID(30)] },
        KOLKATA,
      ),
    ).toMatchObject({
      changed: ["electorate"],
      patch: { eligibleHouseholdIds: [ID(30)] },
    });
  });

  it("sends the type and leaves the removed shape to the server", () => {
    const current = {
      ...base(),
      votingType: "PUBLIC" as const,
      offices: [],
      options: [
        { key: "new-1", label: "Yes" },
        { key: "new-2", label: "No" },
      ],
    };
    expect(buildPatch(base(), current, KOLKATA)).toEqual({
      ok: true,
      patch: {
        votingType: "PUBLIC",
        options: [
          { label: "Yes", position: 1 },
          { label: "No", position: 2 },
        ],
      },
      changed: ["type", "ballot"],
    });

    const bare = { ...base(), votingType: "PUBLIC" as const, offices: [] };
    expect(buildPatch(base(), bare, KOLKATA)).toMatchObject({
      patch: { votingType: "PUBLIC" },
      changed: ["type"],
    });
  });
});

describe("rebaseOnto", () => {
  it("keeps edits and drops ids that no longer exist on the server", () => {
    const mine = base();
    if (mine.offices[0]) {
      mine.offices[0].name = "Chairperson";
    }
    const latest = detail({
      draftRevision: 4,
      offices: [
        {
          id: ID(10),
          name: "Chair",
          position: 1,
          // Ravi was removed by someone else.
          candidates: [{ id: ID(20), name: "Asha", position: 1 }],
        },
      ],
    });
    const rebased = rebaseOnto(mine, latest);
    expect(rebased.offices[0]?.name).toBe("Chairperson");
    expect(rebased.offices[0]?.id).toBe(ID(10));
    expect(rebased.offices[0]?.candidates.map((c) => c.id)).toEqual([
      ID(20),
      undefined,
    ]);
    expect(rebased.offices[0]?.candidates.map((c) => c.name)).toEqual([
      "Asha",
      "Ravi",
    ]);
  });

  it("makes everything new when the whole office was removed", () => {
    const rebased = rebaseOnto(
      base(),
      detail({ draftRevision: 4, offices: [] }),
    );
    expect(rebased.offices[0]?.id).toBeUndefined();
    expect(
      rebased.offices[0]?.candidates.every((c) => c.id === undefined),
    ).toBe(true);
  });

  it("then produces a patch that only references things that exist", () => {
    const latest = detail({ draftRevision: 4, offices: [] });
    const rebased = rebaseOnto(base(), latest);
    const result = buildPatch(stateFromDetail(latest, LOCAL), rebased, KOLKATA);
    expect(JSON.stringify(result)).not.toContain(ID(10));
    expect(JSON.stringify(result)).not.toContain(ID(20));
  });
});

describe("mergeOnto (stale-edit recovery)", () => {
  it("keeps my change and takes someone else's change to a section I did not touch", () => {
    const oldBase = base();
    const mine = { ...oldBase, title: "My title" };
    const latest = detail({
      draftRevision: 4,
      instructions: "Their instructions.",
      closesAt: "2099-03-01T06:30:00.000Z",
    });
    const merged = mergeOnto(oldBase, mine, latest, "2099-03-01T12:00");
    expect(merged.state.title).toBe("My title");
    expect(merged.state.instructions).toBe("Their instructions.");
    expect(merged.state.closesLocal).toBe("2099-03-01T12:00");
    expect(merged.notes).toEqual([]);
    // Saving now only re-sends what is genuinely mine.
    expect(buildPatch(merged.baseline, merged.state, KOLKATA)).toMatchObject({
      patch: { title: "My title" },
      changed: ["title"],
    });
  });

  it("flags a section both sides changed and keeps mine", () => {
    const oldBase = base();
    const merged = mergeOnto(
      oldBase,
      { ...oldBase, title: "Mine" },
      detail({ draftRevision: 4, title: "Theirs" }),
      LOCAL,
    );
    expect(merged.state.title).toBe("Mine");
    expect(merged.notes).toEqual([
      "You and someone else both changed the title. Your version is kept.",
    ]);
  });

  it("keeps my ballot edits but never references items someone else removed", () => {
    const oldBase = base();
    const mine = base();
    mine.offices[0]?.candidates.push({ key: "new-1", name: "Meera" });
    const latest = detail({
      draftRevision: 4,
      offices: [
        {
          id: ID(10),
          name: "Chair",
          position: 1,
          candidates: [{ id: ID(20), name: "Asha", position: 1 }],
        },
      ],
    });
    const merged = mergeOnto(oldBase, mine, latest, LOCAL);
    expect(merged.state.offices[0]?.candidates.map((c) => c.name)).toEqual([
      "Asha",
      "Ravi",
      "Meera",
    ]);
    const patch = buildPatch(merged.baseline, merged.state, KOLKATA);
    expect(JSON.stringify(patch)).not.toContain(ID(21));
  });

  it("explains when a type change by someone else made my ballot edits unusable", () => {
    const oldBase = base();
    const mine = base();
    mine.offices[0]?.candidates.push({ key: "new-1", name: "Meera" });
    const latest = detail({
      draftRevision: 4,
      votingType: "PUBLIC",
      offices: [],
      options: [{ id: ID(40), label: "Yes", position: 1 }],
    });
    const merged = mergeOnto(oldBase, mine, latest, LOCAL);
    expect(merged.state.votingType).toBe("PUBLIC");
    expect(merged.state.offices).toEqual([]);
    expect(merged.notes.join(" ")).toContain("were not kept");
  });

  it("takes everything from the latest when I had changed nothing", () => {
    const oldBase = base();
    const latest = detail({ draftRevision: 4, title: "Theirs" });
    const merged = mergeOnto(oldBase, base(), latest, LOCAL);
    expect(merged.state).toEqual(merged.baseline);
    expect(isDirty(merged.baseline, merged.state, KOLKATA)).toBe(false);
  });
});

describe("field paths", () => {
  it("describes nested server paths in plain words", () => {
    expect(describeFieldPath("offices[1].candidates[0].name")).toBe(
      "Office 2, candidate 1 name",
    );
    expect(describeFieldPath("offices[0].name")).toBe("Office 1 name");
    expect(describeFieldPath("options[2].label")).toBe("Option 3 label");
    expect(describeFieldPath("closesAt")).toBe("Deadline");
  });

  it("maps server paths to the DOM ids of the controls", () => {
    expect(fieldIdForPath("offices[1].candidates[0].name")).toBe(
      "office-1-candidate-0-name",
    );
    expect(fieldIdForPath("offices[0].name")).toBe("office-0-name");
    expect(fieldIdForPath("options[2].label")).toBe("option-2-label");
    expect(fieldIdForPath("closesAt")).toBe("closesLocal");
    expect(fieldIdForPath("title")).toBe("title");
  });
});
