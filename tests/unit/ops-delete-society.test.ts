// Offline safeguards for offboarding a society created by society:create.
import { describe, expect, it } from "vitest";
import {
  parseDeleteOptions,
  societyIdentity,
} from "../../scripts/ops/delete-society.ts";
import {
  bootstrapDirectory,
  removedHostResponseOk,
  serviceKeyRef,
  withCustomerEntry,
  withoutCustomerEntry,
} from "../../scripts/ops/vercel-directory.ts";

const options = parseDeleteOptions([
  "synthetic-society",
  "--confirm-delete",
  "civic-pulse-synthetic-society",
]);
const tenantId = "3b0c2f44-5d7e-4a8b-9c1d-2e3f4a5b6c7d";
const host = "synthetic-society.arp-civic-pulse.vercel.app";
const ref = "abcdefghijklmnopqrst";
const profile = {
  SOCIETY_NAME_ALIAS: "synthetic-society",
  SOCIETY_PROJECT_NAME: "civic-pulse-synthetic-society",
  SUPABASE_PROJECT_REF: ref,
  SOCIETY_TENANT_ID: tenantId,
  SOCIETY_HOST: host,
};

describe("society:delete inputs", () => {
  it("requires the exact project name as confirmation", () => {
    expect(options).toEqual({
      alias: "synthetic-society",
      projectName: "civic-pulse-synthetic-society",
      offboardActive: false,
    });
    expect(() => parseDeleteOptions(["synthetic-society"])).toThrow(
      "--confirm-delete civic-pulse-synthetic-society",
    );
    expect(() =>
      parseDeleteOptions([
        "synthetic-society",
        "--confirm-delete",
        "civic-pulse-other",
      ]),
    ).toThrow("--confirm-delete");
    expect(() =>
      parseDeleteOptions([
        "synthetic-society",
        "--confirm-delete",
        "civic-pulse-synthetic-society",
        "--force",
      ]),
    ).toThrow("Unexpected");
    expect(() => parseDeleteOptions(["Bad_Alias"])).toThrow("alias");
  });

  it("accepts --offboard-active once", () => {
    expect(
      parseDeleteOptions([
        "synthetic-society",
        "--offboard-active",
        "--confirm-delete",
        "civic-pulse-synthetic-society",
      ]).offboardActive,
    ).toBe(true);
  });
});

describe("society:delete target identity", () => {
  it("derives the project, tenant and host from the saved profile", () => {
    expect(societyIdentity(profile, options)).toEqual({
      ref,
      tenantId,
      host,
      projectUrl: `https://${ref}.supabase.co`,
    });
  });

  it("refuses a profile for another alias or an incomplete profile", () => {
    expect(() =>
      societyIdentity({ ...profile, SOCIETY_NAME_ALIAS: "other" }, options),
    ).toThrow("refusing to delete");
    expect(() =>
      societyIdentity({ ...profile, SOCIETY_TENANT_ID: undefined }, options),
    ).toThrow("refusing to delete");
  });

  it("never targets demo, testdb, protected tenants or platform hosts", () => {
    for (const protectedRef of [
      "hnqajjjemqepxuoqbsqx",
      "nycbbzgsilnxrgkwlwno",
    ]) {
      expect(() =>
        societyIdentity(
          { ...profile, SUPABASE_PROJECT_REF: protectedRef },
          options,
        ),
      ).toThrow("can never be deleted");
    }
    expect(() =>
      societyIdentity(
        {
          ...profile,
          SOCIETY_TENANT_ID: "22222222-2222-4222-8222-222222222222",
        },
        options,
      ),
    ).toThrow("can never be deleted");
    for (const platform of [
      "arp-civic-pulse.vercel.app",
      "demo.arp-civic-pulse.vercel.app",
      "beta.arp-civic-pulse.vercel.app",
      "tenant-a.arp-civic-pulse.vercel.app",
    ]) {
      expect(() =>
        societyIdentity({ ...profile, SOCIETY_HOST: platform }, options),
      ).toThrow("platform host");
    }
  });
});

describe("removing a customer from the tenant directory", () => {
  const base = bootstrapDirectory({
    demoPublishableKey: "sb_publishable_demo",
    tenantAPublishableKey: "sb_publishable_tenant_a",
  });
  const withSociety = withCustomerEntry(base, {
    host,
    kind: "customer",
    tenantId,
    state: "provisioning",
    projectUrl: `https://${ref}.supabase.co`,
    publishableKey: "sb_publishable_society",
    serviceRoleKeyRef: serviceKeyRef(tenantId),
  });

  it("removes only the matching entry and is idempotent", () => {
    const removed = withoutCustomerEntry(
      withSociety,
      host,
      tenantId,
      `https://${ref}.supabase.co`,
    );
    expect(removed).toEqual(base);
    expect(
      withoutCustomerEntry(
        removed,
        host,
        tenantId,
        `https://${ref}.supabase.co`,
      ),
    ).toEqual(base);
  });

  it("refuses an entry that does not fully match", () => {
    expect(() =>
      withoutCustomerEntry(
        withSociety,
        host,
        tenantId,
        "https://zzzzzzzzzzzzzzzzzzzz.supabase.co",
      ),
    ).toThrow("does not match");
    expect(() =>
      withoutCustomerEntry(
        base,
        "demo.arp-civic-pulse.vercel.app",
        "22222222-2222-4222-8222-222222222222",
        "https://hnqajjjemqepxuoqbsqx.supabase.co",
      ),
    ).toThrow("does not match");
    expect(() =>
      withoutCustomerEntry(
        withSociety,
        "tenant-a.arp-civic-pulse.vercel.app",
        tenantId,
        `https://${ref}.supabase.co`,
      ),
    ).toThrow("does not match");
  });

  it("expects the app's empty unlisted-host 404 after removal", () => {
    const response = {
      status: 404,
      vercelError: null,
      retryAfter: null,
      bodyLength: 0,
    };
    expect(removedHostResponseOk(response)).toBe(true);
    expect(
      removedHostResponseOk({
        ...response,
        vercelError: "DEPLOYMENT_NOT_FOUND",
      }),
    ).toBe(false);
    expect(removedHostResponseOk({ ...response, status: 503 })).toBe(false);
    expect(removedHostResponseOk({ ...response, status: 200 })).toBe(false);
  });
});
