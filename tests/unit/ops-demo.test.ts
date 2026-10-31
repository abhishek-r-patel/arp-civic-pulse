import { describe, expect, it } from "vitest";
import {
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
});
