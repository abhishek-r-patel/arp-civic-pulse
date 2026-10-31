import { describe, expect, it } from "vitest";
import {
  migrationDatabaseTarget,
  migrationStatusReport,
} from "../../scripts/ops/migration-status";

const ref = "abcdefghijklmnopqrst";

describe("migration database target", () => {
  it("accepts a confirmed direct database URL", () => {
    expect(
      migrationDatabaseTarget(
        ref,
        `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres`,
        ref,
      ),
    ).toEqual({
      projectRef: ref,
      databaseUrl: `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres`,
    });
  });

  it("accepts the matching Supabase session pooler identity", () => {
    expect(
      migrationDatabaseTarget(
        ref,
        `postgresql://postgres.${ref}:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
        ref,
      ).projectRef,
    ).toBe(ref);
  });

  it("refuses a mismatch between confirmation and target", () => {
    expect(() =>
      migrationDatabaseTarget(
        ref,
        `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres`,
        "zyxwvutsrqponmlkjihgf",
      ),
    ).toThrow("confirmed project does not match");
  });

  it("refuses a database URL for another project without echoing credentials", () => {
    const url =
      "postgresql://postgres:do-not-print@db.zyxwvutsrqponmlkjihgf.supabase.co:5432/postgres";
    let message = "";
    try {
      migrationDatabaseTarget(ref, url, ref);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("does not match");
    expect(message).not.toContain("do-not-print");
  });
});

describe("migration status report", () => {
  it("reports a matching schema as current", () => {
    expect(
      migrationStatusReport(ref, ["1", "2"], ["1", "2"], false),
    ).toMatchObject({
      status: "current",
      localCount: 2,
      remoteCount: 2,
      latestLocal: "2",
      latestRemote: "2",
      pending: [],
      unknownRemote: [],
    });
  });

  it("distinguishes behind, unknown and divergent schemas", () => {
    expect(migrationStatusReport(ref, ["1", "2"], ["1"], false).status).toBe(
      "behind",
    );
    expect(migrationStatusReport(ref, ["1"], ["1", "9"], false).status).toBe(
      "unknown-remote",
    );
    expect(
      migrationStatusReport(ref, ["1", "2"], ["1", "9"], false).status,
    ).toBe("divergent");
  });

  it("distinguishes a fresh project from application tables with no ledger", () => {
    expect(migrationStatusReport(ref, ["1"], null, false).status).toBe(
      "uninitialized",
    );
    expect(migrationStatusReport(ref, ["1"], null, true).status).toBe(
      "untracked",
    );
  });

  it("refuses duplicate local migration versions", () => {
    expect(() => migrationStatusReport(ref, ["1", "1"], ["1"], false)).toThrow(
      "Local migration versions are duplicated",
    );
  });
});
