// Configuration-report decisions and credential-safe failures.
import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configurationReport,
  inspectConfiguration,
  type ConfigurationSnapshot,
} from "../../scripts/ops/configuration.ts";

const environment = {
  APP_ORIGIN: "https://vote.example.test",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.example.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-placeholder",
  RATE_LIMIT_HMAC_KEY: "x".repeat(32),
};

function snapshot(): ConfigurationSnapshot & {
  settings: NonNullable<ConfigurationSnapshot["settings"]>;
} {
  return {
    checkedAt: "2026-10-28T10:00:00+00:00",
    settings: {
      fullName: "Lakeview RWA",
      alias: "Lakeview",
      timezone: "Asia/Kolkata",
      timezoneValid: true,
      householdLabel: "Flat",
      identifierKind: "NUMBER",
      accentPalette: "TEAL",
      optionalFieldsProvided: {
        address: false,
        email: false,
        phone: false,
        website: false,
        welcomeMessage: false,
      },
      placeholderFields: [],
      defaultHouseholds: 0,
      rwaPositions: 5,
      listsValid: true,
      missingApprovals: [],
      missingRetention: [],
      retentionDays: {
        vote: 365,
        audit: 365,
        inactiveProfile: 365,
        rateLimit: 30,
        backup: 90,
      },
    },
    accounts: {
      total: 3,
      enabled: 3,
      suspended: 0,
      deleted: 0,
      enabledAdmins: 1,
      enabledObservers: 1,
      enabledAppSupport: 0,
      enabledResidents: 1,
      conflictingRoles: 0,
      enabledWithoutHousehold: 0,
      households: 2,
      eligibleHouseholds: 2,
      readyHouseholds: 2,
    },
    votes: {
      byStatus: { COMPLETED: 1 },
      byType: { PRIVATE: 1 },
      drafts: 0,
      readyDrafts: 0,
      draftBlockers: {},
      overdueScheduledVotes: 0,
    },
    operations: {
      settingsPresent: true,
      policyReady: true,
      activeVotes: 0,
      overdueActiveVotes: 0,
      invariantFailures: 0,
      expiredVotesPending: 0,
      expiredAuditPending: 0,
      expiredRateBucketsPending: 0,
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("configuration inspection", () => {
  it("allows optional blank contacts and empty suggestion lists without claiming production readiness", () => {
    const report = configurationReport(snapshot(), environment);
    expect(report.ok).toBe(true);
    expect(report.productionReady).toBe(false);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report.unverified.join(" ")).toContain("last-seen");
    const json = JSON.stringify(report);
    for (const secret of Object.values(environment))
      expect(json).not.toContain(secret);
  });

  it("checks all seven approvals independently of the older status routine's retention-only policy flag", () => {
    const source = snapshot();
    source.settings.missingApprovals = ["A2", "A7"];
    expect(source.operations.policyReady).toBe(true);
    const report = configurationReport(source, environment);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ code: "POLICY_APPROVALS", status: "fail" }),
    );
    expect(report.settings?.missingApprovals).toEqual(["A2", "A7"]);
  });

  it("fails explicitly for missing settings and missing retention", () => {
    const source: ConfigurationSnapshot = snapshot();
    source.settings = null;
    expect(configurationReport(source, environment).checks).toContainEqual(
      expect.objectContaining({ code: "SETTINGS_PRESENT", status: "fail" }),
    );
    const retention = snapshot();
    retention.settings.missingRetention = ["backup_retention_days"];
    expect(configurationReport(retention, environment).ok).toBe(false);
  });

  it.each([
    ["ENABLED_ADMIN", { enabledAdmins: 0 }],
    ["EXCLUSIVE_ROLES", { conflictingRoles: 1 }],
    ["ACCOUNT_ASSIGNMENTS", { enabledWithoutHousehold: 1 }],
  ])("fails the %s account guard", (code, changes) => {
    const source = snapshot();
    Object.assign(source.accounts, changes);
    const report = configurationReport(source, environment);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ code, status: "fail" }),
    );
  });

  it("warns, without failing, while App Support Access is on", () => {
    const source = snapshot();
    source.accounts.enabledAppSupport = 1;
    const report = configurationReport(source, environment);
    expect(report.ok).toBe(true);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ code: "APP_SUPPORT_ACCESS", status: "warn" }),
    );
  });

  it("reports incomplete drafts, no votes, placeholder fields and an empty electorate as warnings, not failures", () => {
    const source = snapshot();
    source.settings.placeholderFields = ["email"];
    source.accounts.readyHouseholds = 0;
    source.votes.byStatus = {};
    source.votes.drafts = 1;
    source.votes.draftBlockers = { TITLE_REQUIRED: 1 };
    const report = configurationReport(source, environment);
    expect(report.ok).toBe(true);
    expect(
      report.checks
        .filter((check) => check.status === "warn")
        .map((check) => check.code),
    ).toEqual([
      "PLACEHOLDER_PROFILE",
      "READY_ELECTORATE",
      "ELIGIBLE_ACCOUNT_STATUS",
      "VOTES_PRESENT",
      "DRAFT_READINESS",
    ]);
  });

  it.each(["overdueActiveVotes", "invariantFailures"] as const)(
    "fails on operational %s",
    (key) => {
      const source = snapshot();
      source.operations[key] = 1;
      expect(configurationReport(source, environment).ok).toBe(false);
    },
  );

  it("fails for overdue scheduled opening without trying to open a vote", () => {
    const source = snapshot();
    source.votes.overdueScheduledVotes = 1;
    expect(configurationReport(source, environment).checks).toContainEqual(
      expect.objectContaining({ code: "SCHEDULED_OPENING", status: "fail" }),
    );
  });

  it("enforces production shape even under NODE_ENV=development and never prints invalid values", () => {
    const report = configurationReport(snapshot(), {
      ...environment,
      NODE_ENV: "development",
      RATE_LIMIT_HMAC_KEY: "do-not-print",
    });
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).toContain("RATE_LIMIT_HMAC_KEY");
    expect(JSON.stringify(report)).not.toContain("do-not-print");
  });

  it("requires an explicit inspection credential, not an app service key or backup credential", async () => {
    await expect(
      inspectConfiguration({ ...environment, BACKUP_DATABASE_URL: "unused" }),
    ).rejects.toThrow("CONFIG_DATABASE_URL is required");
  });

  it("rejects remote TLS downgrades without disclosing the connection URL", async () => {
    await expect(
      inspectConfiguration({
        CONFIG_DATABASE_URL:
          "postgres://operator:do-not-print@database.example.test/app?sslmode=disable",
      }),
    ).rejects.toThrow(/^Configuration inspection unavailable\./u);
  });

  it("redacts provider errors, closes a failed connection, and never returns fabricated counts", async () => {
    vi.spyOn(Client.prototype, "connect").mockRejectedValue(
      new Error("do-not-print credentials or rows"),
    );
    const end = vi.spyOn(Client.prototype, "end").mockResolvedValue();
    await expect(
      inspectConfiguration({
        CONFIG_DATABASE_URL: "postgres://operator@127.0.0.1/app",
      }),
    ).rejects.toThrow(/^Configuration inspection unavailable\./u);
    expect(end).toHaveBeenCalledOnce();
  });
});
