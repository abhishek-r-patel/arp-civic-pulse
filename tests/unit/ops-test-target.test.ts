// Test-target switching between the synthetic demo and testdb, offline.
import { describe, expect, it } from "vitest";
import {
  currentTarget,
  fetchProjectKeys,
  pauseStep,
  planSwitch,
  projectKeysFromResponse,
  rawValues,
  refreshDemoOpsProfile,
  refreshPairedDemoKeys,
  refreshTestProfile,
  resumeStep,
  withValues,
} from "../../scripts/ops/test-target.ts";

const DEMO = "hnqajjjemqepxuoqbsqx";
const TESTDB = "nycbbzgsilnxrgkwlwno";

const profile = (ref: string, paired = "") =>
  [
    `NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=pub-${ref}`,
    `SUPABASE_SERVICE_ROLE_KEY=svc-${ref}`,
    `SUPABASE_PROJECT_REF=${ref}`,
    `SUPABASE_DB_PASSWORD=pw-${ref}`,
    `LIVE_DATABASE_URL=postgresql://postgres.${ref}:pw-${ref}@pooler.supabase.com:5432/postgres`,
    `TENANT_TEST_SUPABASE_URL=${paired && `https://${paired}.supabase.co`}`,
    `TENANT_TEST_SUPABASE_PUBLISHABLE_KEY=${paired && "pub-b"}`,
    `TENANT_TEST_SUPABASE_SERVICE_ROLE_KEY=${paired && "svc-b"}`,
    `TENANT_TEST_DATABASE_URL=${paired && `postgresql://postgres:x@db.${paired}.supabase.co:5432/postgres`}`,
    "",
  ].join("\n");

const demoLocal = `# app\nAPP_ORIGIN=http://localhost:3000\n${profile(DEMO)}SUPABASE_ACCESS_TOKEN=tok\n`;
const files = {
  ".env.local": demoLocal,
  ".env.demo.local": "DEMO_PROJECT_REF=x\nDEMO_SHARED_TEST_PROJECT=true\n",
  ".env.testdb.local": profile(TESTDB, DEMO),
};
const healthy = { demo: "ACTIVE_HEALTHY", testdb: "ACTIVE_HEALTHY" };
const refreshedKeys = {
  publishable: "sb_publishable_rotated",
  serviceRole: "sb_secret_rotated",
};
const written = (plan: ReturnType<typeof planSwitch>, file: string) =>
  plan.writes.find((write) => write.file === file)?.text ?? "";

describe("withValues", () => {
  it("replaces every occurrence in place and appends missing keys", () => {
    expect(withValues("# c\r\nA=1\r\nB=2\r\nA=3\r\n", { A: "9", C: "7" })).toBe(
      "# c\r\nA=9\r\nB=2\r\nA=9\r\nC=7\r\n",
    );
  });
});

describe("planSwitch", () => {
  it("switches demo to testdb, saving demo and keeping other settings", () => {
    const plan = planSwitch("testdb", files, healthy);
    const local = written(plan, ".env.local");
    expect(currentTarget(local)).toBe("testdb");
    expect(local).toContain("APP_ORIGIN=http://localhost:3000");
    expect(local).toContain("SUPABASE_ACCESS_TOKEN=tok");
    expect(rawValues(local).TENANT_TEST_SUPABASE_URL).toBe(
      `https://${DEMO}.supabase.co`,
    );
    expect(written(plan, ".env.demo.local")).toContain(
      "DEMO_SHARED_TEST_PROJECT=false",
    );
    expect(currentTarget(written(plan, ".env.demo-test.local"))).toBe("demo");
  });

  it("round-trips back to demo without losing the testdb pairing", () => {
    const toTestdb = planSwitch("testdb", files, healthy);
    const next = Object.fromEntries(
      toTestdb.writes.map((write) => [write.file, write.text]),
    );
    const back = planSwitch("demo", { ...files, ...next }, healthy);
    expect(written(back, ".env.local")).toBe(demoLocal);
    expect(written(back, ".env.demo.local")).toContain(
      "DEMO_SHARED_TEST_PROJECT=true",
    );
    expect(written(back, ".env.testdb.local")).toBe(files[".env.testdb.local"]);
  });

  it("disables the paired test while demo is paused, keeping the archive", () => {
    const plan = planSwitch("testdb", files, {
      ...healthy,
      demo: "INACTIVE",
    });
    expect(
      rawValues(written(plan, ".env.local")).TENANT_TEST_DATABASE_URL,
    ).toBe("");
    expect(plan.warnings[0]).toMatch(/paired/);
    const local = written(plan, ".env.local");
    const back = planSwitch(
      "testdb",
      { ...files, ".env.local": local },
      healthy,
    );
    expect(written(back, ".env.testdb.local")).toBe(files[".env.testdb.local"]);
  });

  it("refuses paused targets, unknown projects and mismatched profiles", () => {
    expect(() =>
      planSwitch("testdb", files, { ...healthy, testdb: "INACTIVE" }),
    ).toThrow(/INACTIVE/);
    expect(() =>
      planSwitch(
        "testdb",
        { ...files, ".env.local": profile("abcdefghijklmnopqrst") },
        healthy,
      ),
    ).toThrow(/refusing/);
    expect(() =>
      planSwitch(
        "testdb",
        {
          ...files,
          ".env.testdb.local": profile(TESTDB).replace(
            `https://${TESTDB}`,
            "https://abcdefghijklmnopqrst",
          ),
        },
        healthy,
      ),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() =>
      planSwitch(
        "testdb",
        { ...files, ".env.testdb.local": profile(TESTDB, TESTDB) },
        healthy,
      ),
    ).toThrow(/TENANT_TEST/);
    expect(() =>
      planSwitch("demo", { ...files, ".env.local": profile(TESTDB) }, healthy),
    ).toThrow(/does not exist/);
  });
});

describe("pause and resume steps", () => {
  it("pauses healthy testdb, waits on transitions and is idempotent", () => {
    expect(pauseStep("ACTIVE_HEALTHY")).toBe("pause");
    expect(pauseStep("PAUSING")).toBe("wait");
    expect(pauseStep("INACTIVE")).toBe("done");
    expect(() => pauseStep("PAUSE_FAILED")).toThrow(/PAUSE_FAILED/);
  });

  it("restores paused testdb, waits on start-up and is idempotent", () => {
    expect(resumeStep("INACTIVE")).toBe("restore");
    expect(resumeStep("COMING_UP")).toBe("wait");
    expect(resumeStep("UNKNOWN (network error)")).toBe("wait");
    expect(resumeStep("ACTIVE_HEALTHY")).toBe("done");
    expect(() => resumeStep("RESTORE_FAILED")).toThrow(/RESTORE_FAILED/);
  });
});

describe("Supabase credential refresh", () => {
  it("selects only the publishable and legacy service_role keys", () => {
    expect(
      projectKeysFromResponse([
        { name: "anon", type: "legacy", api_key: "legacy-anon" },
        { name: "service_role", type: "legacy", api_key: "legacy-service" },
        { name: "default", type: "publishable", api_key: "publishable" },
        { name: "default", type: "secret", api_key: "secret" },
      ]),
    ).toEqual({
      publishable: "publishable",
      serviceRole: "legacy-service",
    });
    expect(
      projectKeysFromResponse(
        [
          { name: "service_role", type: "legacy", api_key: "legacy-service" },
          { name: "default", type: "publishable", api_key: "publishable" },
          { name: "default", type: "secret", api_key: "secret-service" },
        ],
        "sb_secret_saved",
      ).serviceRole,
    ).toBe("secret-service");
    expect(() => projectKeysFromResponse([])).toThrow(/no API keys/);
  });

  it("fetches revealed keys from the exact Supabase project", async () => {
    let requestUrl = "";
    let authorization = "";
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json([
        { name: "service_role", type: "legacy", api_key: "role" },
        { name: "default", type: "publishable", api_key: "pub" },
      ]);
    };
    await expect(
      fetchProjectKeys(TESTDB, "access-token", undefined, fetcher),
    ).resolves.toEqual({ publishable: "pub", serviceRole: "role" });
    expect(requestUrl).toBe(
      `https://api.supabase.com/v1/projects/${TESTDB}/api-keys?reveal=true`,
    );
    expect(authorization).toBe("Bearer access-token");
  });

  it("refreshes testdb API values while preserving its saved DB credentials", () => {
    const text = `# testdb settings\n${profile(TESTDB, DEMO)}RATE_LIMIT_HMAC_KEY=keep-me\n`;
    const refreshed = refreshTestProfile(text, TESTDB, refreshedKeys);
    const values = rawValues(refreshed);
    expect(values.NEXT_PUBLIC_SUPABASE_URL).toBe(
      `https://${TESTDB}.supabase.co`,
    );
    expect(values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(
      refreshedKeys.publishable,
    );
    expect(values.SUPABASE_SERVICE_ROLE_KEY).toBe(refreshedKeys.serviceRole);
    expect(values.SUPABASE_DB_PASSWORD).toBe(`pw-${TESTDB}`);
    expect(values.LIVE_DATABASE_URL).toContain(`postgres.${TESTDB}`);
    expect(refreshed).toContain("RATE_LIMIT_HMAC_KEY=keep-me");
    expect(() =>
      refreshTestProfile(
        text.replace(`pw-${TESTDB}`, ""),
        TESTDB,
        refreshedKeys,
      ),
    ).toThrow(/database password/);
    expect(() =>
      refreshTestProfile(
        text.replace(
          `SUPABASE_PROJECT_REF=${TESTDB}`,
          "SUPABASE_PROJECT_REF=abcdefghijklmnopqrst",
        ),
        TESTDB,
        refreshedKeys,
      ),
    ).toThrow(/SUPABASE_PROJECT_REF/);
    expect(() =>
      refreshTestProfile(
        text.replace(
          `LIVE_DATABASE_URL=postgresql://postgres.${TESTDB}`,
          "LIVE_DATABASE_URL=postgresql://postgres.abcdefghijklmnopqrst",
        ),
        TESTDB,
        refreshedKeys,
      ),
    ).toThrow(/LIVE_DATABASE_URL/);
    expect(() =>
      refreshTestProfile(
        text.replace(
          `LIVE_DATABASE_URL=postgresql://postgres.${TESTDB}:pw-${TESTDB}@`,
          `LIVE_DATABASE_URL=postgresql://postgres.${TESTDB}:other@`,
        ),
        TESTDB,
        refreshedKeys,
      ),
    ).toThrow(/saved database password/);
  });

  it("refreshes the saved demo operations key and paired-test API keys", () => {
    const demoOps =
      `DEMO_PROJECT_REF=${DEMO}\n` +
      `DEMO_SUPABASE_URL=https://${DEMO}.supabase.co\n` +
      `DEMO_SERVICE_ROLE_KEY=old\n` +
      `DEMO_DATABASE_URL=postgresql://postgres.${DEMO}:pw@pooler.supabase.com:5432/postgres\n`;
    const refreshed = refreshDemoOpsProfile(demoOps, refreshedKeys);
    expect(refreshed).toContain(
      `DEMO_SERVICE_ROLE_KEY=${refreshedKeys.serviceRole}`,
    );
    expect(refreshed).toContain(
      `DEMO_DATABASE_URL=postgresql://postgres.${DEMO}:pw@pooler.supabase.com:5432/postgres`,
    );

    const paired = refreshPairedDemoKeys(
      profile(TESTDB, DEMO),
      demoOps,
      refreshedKeys,
    );
    const testdbValues = rawValues(paired.testdbText);
    expect(testdbValues.TENANT_TEST_SUPABASE_PUBLISHABLE_KEY).toBe(
      refreshedKeys.publishable,
    );
    expect(testdbValues.TENANT_TEST_SUPABASE_SERVICE_ROLE_KEY).toBe(
      refreshedKeys.serviceRole,
    );
    expect(testdbValues.TENANT_TEST_DATABASE_URL).toContain(
      `db.${DEMO}.supabase.co`,
    );
    expect(paired.demoText).toContain(
      `DEMO_SERVICE_ROLE_KEY=${refreshedKeys.serviceRole}`,
    );
  });
});
