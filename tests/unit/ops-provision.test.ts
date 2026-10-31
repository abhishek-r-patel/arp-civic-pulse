import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  authConfigPatch,
  authConfigProblems,
  directoryEntry,
  localMigrationVersions,
  migrationStatus,
  provisionPlan,
  serviceRoleKeyRef,
} from "../../scripts/ops/provision";

const REF = "abcdefghijklmnopqrst";
const TENANT = "33333333-3333-4333-8333-333333333333";

const env = (extra: Record<string, string | undefined> = {}) => ({
  PROVISION_PROJECT_REF: REF,
  PROVISION_SUPABASE_URL: `https://${REF}.supabase.co`,
  PROVISION_SERVICE_ROLE_KEY: "service-secret",
  PROVISION_DATABASE_URL: `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`,
  PROVISION_PUBLISHABLE_KEY: "sb_publishable_example",
  PROVISION_ADMIN_EMAIL: "admin@example.org",
  ...extra,
});

const options = (extra: Record<string, string | undefined> = {}) => ({
  confirm: REF,
  "tenant-id": TENANT,
  host: "rwa-one.example.org",
  "rwa-name": "Sample Residents Association",
  "admin-name": "Sample Admin",
  ...extra,
});

const directory = (entries: object[]) =>
  JSON.stringify({ version: 1, entries });

describe("provisionPlan", () => {
  it("accepts a fresh, confirmed project", () => {
    const { target, request } = provisionPlan(env(), options());
    expect(target.projectRef).toBe(REF);
    expect(request).toMatchObject({
      tenantId: TENANT,
      host: "rwa-one.example.org",
      timezone: "Asia/Kolkata",
    });
  });

  it("requires confirmation and valid inputs", () => {
    expect(() => provisionPlan(env(), options({ confirm: undefined }))).toThrow(
      /--confirm/u,
    );
    expect(() =>
      provisionPlan(env(), options({ "tenant-id": "not-a-uuid" })),
    ).toThrow(/--tenant-id/u);
    expect(() => provisionPlan(env(), options({ host: "bad host" }))).toThrow(
      /--host/u,
    );
    expect(() =>
      provisionPlan(env(), options({ timezone: "Mars/Olympus" })),
    ).toThrow(/time zone/u);
    expect(() =>
      provisionPlan(env({ PROVISION_ADMIN_EMAIL: "nope" }), options()),
    ).toThrow(/PROVISION_ADMIN_EMAIL/u);
  });

  it("refuses credentials for a different project", () => {
    expect(() =>
      provisionPlan(
        env({
          PROVISION_SUPABASE_URL: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co",
        }),
        options(),
      ),
    ).toThrow(/PROVISION_SUPABASE_URL/u);
  });

  it("refuses a secret key in place of the publishable key", () => {
    expect(() =>
      provisionPlan(
        env({ PROVISION_PUBLISHABLE_KEY: "service-secret" }),
        options(),
      ),
    ).toThrow(/publishable/u);
    expect(() =>
      provisionPlan(
        env({ PROVISION_PUBLISHABLE_KEY: "sb_secret_x" }),
        options(),
      ),
    ).toThrow(/publishable/u);
  });

  it("never provisions the demo project", () => {
    expect(() =>
      provisionPlan(env({ DEMO_PROJECT_REF: REF }), options()),
    ).toThrow(/demo/u);
    expect(() =>
      provisionPlan(
        env({
          TENANT_DIRECTORY_JSON: directory([
            {
              host: "demo.example.org",
              kind: "demo",
              tenantId: TENANT,
              projectUrl: `https://${REF}.supabase.co`,
            },
          ]),
        }),
        options(),
      ),
    ).toThrow(/demo/u);
  });

  it("refuses a project or host the directory gives to another tenant", () => {
    const other = "44444444-4444-4444-8444-444444444444";
    expect(() =>
      provisionPlan(
        env({
          TENANT_DIRECTORY_JSON: directory([
            {
              host: "x.example.org",
              kind: "customer",
              tenantId: other,
              projectUrl: `https://${REF}.supabase.co`,
            },
          ]),
        }),
        options(),
      ),
    ).toThrow(/project to another tenant/u);
    expect(() =>
      provisionPlan(
        env({
          TENANT_DIRECTORY_JSON: directory([
            {
              host: "rwa-one.example.org",
              kind: "customer",
              tenantId: other,
              projectUrl: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co",
            },
          ]),
        }),
        options(),
      ),
    ).toThrow(/host to another tenant/u);
    expect(() =>
      provisionPlan(
        env({
          TENANT_DIRECTORY_JSON: directory([
            {
              host: "rwa-one.example.org",
              kind: "customer",
              tenantId: TENANT,
              projectUrl: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co",
            },
          ]),
        }),
        options(),
      ),
    ).toThrow(/different project/u);
  });

  it("allows re-running for the same tenant already in the directory", () => {
    expect(() =>
      provisionPlan(
        env({
          TENANT_DIRECTORY_JSON: directory([
            {
              host: "rwa-one.example.org",
              kind: "customer",
              tenantId: TENANT,
              projectUrl: `https://${REF}.supabase.co`,
            },
          ]),
        }),
        options(),
      ),
    ).not.toThrow();
  });
});

describe("migrationStatus", () => {
  it("lists pending and unknown remote versions", () => {
    expect(migrationStatus(["1", "2", "3"], ["1", "9"])).toEqual({
      pending: ["2", "3"],
      unknownRemote: ["9"],
      complete: false,
    });
    expect(migrationStatus(["1"], ["1"]).complete).toBe(true);
  });

  it("reads the repository migration versions", async () => {
    const versions = await localMigrationVersions(
      path.join(process.cwd(), "supabase", "migrations"),
    );
    expect(versions.length).toBeGreaterThan(10);
    expect(versions[0]).toBe("20261024100000");
  });
});

describe("Auth configuration", () => {
  const template = "<p>Your code is {{ .Token }}</p>";

  it("a patched configuration has no fixable problems", () => {
    const patched = authConfigPatch("rwa-one.example.org", template);
    expect(authConfigProblems(patched, "rwa-one.example.org")).toEqual({
      fixable: [],
      smtp: false,
    });
    expect(
      authConfigProblems(
        { ...patched, smtp_host: "smtp.example.org" },
        "rwa-one.example.org",
      ).smtp,
    ).toBe(true);
  });

  it("reports wildcard redirects, open sign-up and a code-less template", () => {
    const { fixable } = authConfigProblems(
      {
        disable_signup: false,
        site_url: "https://rwa-one.example.org",
        uri_allow_list: "https://*.example.org",
        mailer_otp_length: 8,
        mailer_templates_magic_link_content: "{{ .ConfirmationURL }}",
      },
      "rwa-one.example.org",
    );
    expect(fixable).toHaveLength(4);
  });
});

describe("directoryEntry", () => {
  it("names the secret variable without containing a secret", () => {
    const { request } = provisionPlan(env(), options());
    const entry = directoryEntry(request, REF, "provisioning");
    expect(entry).toEqual({
      host: "rwa-one.example.org",
      kind: "customer",
      tenantId: TENANT,
      state: "provisioning",
      projectUrl: `https://${REF}.supabase.co`,
      publishableKey: "sb_publishable_example",
      serviceRoleKeyRef: serviceRoleKeyRef(TENANT),
    });
    expect(entry.serviceRoleKeyRef).toBe(
      "TENANT_33333333333343338333333333333333_SUPABASE_SERVICE_ROLE_KEY",
    );
    expect(JSON.stringify(entry)).not.toContain("service-secret");
  });
});
