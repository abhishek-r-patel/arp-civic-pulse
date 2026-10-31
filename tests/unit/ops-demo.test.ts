import { describe, expect, it } from "vitest";
import {
  DEMO_DEADLINE_LEAD_MS,
  DEMO_TABLES,
  demoResetTarget,
  demoSeedPlan,
} from "../../scripts/ops/demo.ts";
import { DEMO_PERSONAS } from "@/shared/demo";

const REF = "abcdefghijklmnopqrst";
const env = (overrides: Record<string, string | undefined> = {}) => ({
  DEMO_PROJECT_REF: REF,
  DEMO_SUPABASE_URL: `https://${REF}.supabase.co`,
  DEMO_SERVICE_ROLE_KEY: "service-role",
  DEMO_DATABASE_URL: `postgresql://postgres.${REF}:pw@aws-0.pooler.supabase.com:5432/postgres`,
  ...overrides,
});

describe("demoResetTarget", () => {
  it("accepts only credentials that all point at the confirmed demo project", () => {
    expect(demoResetTarget(env(), REF).projectRef).toBe(REF);
    expect(
      demoResetTarget(
        env({
          DEMO_DATABASE_URL: `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`,
        }),
        REF,
      ).projectRef,
    ).toBe(REF);
  });

  it("requires an exact --confirm of the project reference", () => {
    expect(() => demoResetTarget(env(), undefined)).toThrow(/--confirm/u);
    expect(() => demoResetTarget(env(), "zzzzzzzzzzzzzzzzzzzz")).toThrow(
      /--confirm/u,
    );
  });

  it("refuses mismatched API or database projects", () => {
    expect(() =>
      demoResetTarget(
        env({ DEMO_SUPABASE_URL: "https://otherprojectrefxxxx.supabase.co" }),
        REF,
      ),
    ).toThrow(/DEMO_SUPABASE_URL/u);
    expect(() =>
      demoResetTarget(
        env({
          DEMO_DATABASE_URL:
            "postgresql://postgres.otherprojectrefxxxx:pw@aws-0.pooler.supabase.com:5432/postgres",
        }),
        REF,
      ),
    ).toThrow(/DEMO_DATABASE_URL/u);
  });

  it("refuses the primary deployment's project and missing settings", () => {
    expect(() =>
      demoResetTarget(
        env({ NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` }),
        REF,
      ),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/u);
    expect(() =>
      demoResetTarget(env({ DEMO_SERVICE_ROLE_KEY: undefined }), REF),
    ).toThrow(/DEMO_SERVICE_ROLE_KEY/u);
    expect(() =>
      demoResetTarget(env({ DEMO_PROJECT_REF: "not-a-ref" }), "not-a-ref"),
    ).toThrow(/project reference/u);
  });
});

describe("demoSeedPlan", () => {
  const plan = demoSeedPlan(new Date("2026-01-01T00:00:00Z"));

  it("seeds one fictional resident per household, starting with the persona", () => {
    expect(plan.residents).toHaveLength(plan.households.length);
    expect(plan.residents[0]).toBe(DEMO_PERSONAS.resident.name);
    expect(new Set(plan.households).size).toBe(plan.households.length);
  });

  it("keeps open votes open well beyond a weekly reset and schedules in the future", () => {
    expect(plan.votes.openPoll.closesAt).toBe("2026-01-29T00:00:00.000Z");
    expect(plan.votes.scheduled.opensAt > "2026-01-01").toBe(true);
    expect(plan.votes.scheduled.closesAt > plan.votes.scheduled.opensAt).toBe(
      true,
    );
  });

  it("erases every app table, including the settings row", () => {
    expect(DEMO_TABLES).toContain("rwa_settings");
    expect(DEMO_TABLES).toContain("audit_events");
  });

  it("keeps the electorate to enabled residents with eligible flats", () => {
    const special = [
      plan.ineligibleIndex,
      plan.suspendedIndex,
      plan.deletedIndex,
    ];
    expect(new Set(special).size).toBe(3);
    expect(special.every((index) => index >= plan.electorateSize)).toBe(true);
    expect(Math.max(...special)).toBe(plan.residents.length - 1);
    expect(plan.blockASize).toBeLessThan(plan.electorateSize);
    expect(
      plan.households
        .slice(0, plan.blockASize)
        .every((flat) => flat.startsWith("A-")),
    ).toBe(true);
  });

  it("lists the flats that pending registrations claim and leaves some unclaimed", () => {
    const listed = plan.profile.defaultHouseholds;
    expect(new Set(listed).size).toBe(listed.length);
    for (const flat of [
      ...plan.households,
      ...plan.pendingRegistrations.map((entry) => entry.identifier),
      ...plan.unclaimedHouseholds,
    ]) {
      expect(listed).toContain(flat);
    }
    expect(plan.pendingRegistrations.length).toBeGreaterThan(0);
    expect(plan.unclaimedHouseholds.length).toBeGreaterThan(0);
  });

  it("gives every secret election instructions, which activation requires", () => {
    const { election, closingSoon, completedElection } = plan.votes;
    for (const vote of [election, closingSoon, completedElection]) {
      expect(vote.instructions.length).toBeGreaterThan(0);
    }
    expect(completedElection.offices).toHaveLength(3);
  });

  it("dates every vote state correctly relative to the reset", () => {
    const { votes } = plan;
    expect(votes.closingSoon.closesAt).toBe("2026-01-03T00:00:00.000Z");
    expect(votes.extended.extendedTo > votes.extended.closesAt).toBe(true);
    expect(votes.withdrawn.opensAt > "2026-01-01").toBe(true);
    expect(votes.withdrawn.closesAt > votes.withdrawn.opensAt).toBe(true);
    expect(DEMO_DEADLINE_LEAD_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("creates the RWA admin persona and keeps titles distinct", () => {
    expect(DEMO_PERSONAS.admin.email).toMatch(/@example\.com$/u);
    const titles = Object.values(plan.votes).map((vote) => vote.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.length).toBeGreaterThanOrEqual(15);
  });
});
