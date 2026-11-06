// Offline safeguards for the shared Vercel project's tenant directory.
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { parseTenantDirectory } from "../../src/server/config/tenant-directory.ts";
import {
  assertCanAddCustomer,
  bootstrapDirectory,
  quotedDirectory,
  serviceKeyRef,
  newHostResponseOk,
  validateDirectory,
  withCustomerEntry,
  type RwaEntry,
} from "../../scripts/ops/vercel-directory.ts";

const base = bootstrapDirectory({
  demoPublishableKey: "sb_publishable_demo#1",
  tenantAPublishableKey: "sb_publishable_tenant_a",
});
const tenantId = "3b0c2f44-5d7e-4a8b-9c1d-2e3f4a5b6c7d";
const maplewood: RwaEntry = {
  host: "maplewood.arp-civic-pulse.vercel.app",
  kind: "customer",
  tenantId,
  state: "provisioning",
  projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
  publishableKey: "sb_publishable_maplewood",
  serviceRoleKeyRef: serviceKeyRef(tenantId),
};

describe("tenant directory", () => {
  it("rebuilds the live entries in a form the app accepts in full", () => {
    const parsed = parseTenantDirectory(JSON.stringify(base));
    expect(parsed.invalidHosts).toEqual([]);
    expect(
      parsed.entries.map((entry) => `${entry.kind}:${entry.host}`),
    ).toEqual([
      "main:arp-civic-pulse.vercel.app",
      "demo:demo.arp-civic-pulse.vercel.app",
      "customer:tenant-a.arp-civic-pulse.vercel.app",
    ]);
  });

  it("adds a society idempotently and never downgrades an active entry", () => {
    const added = withCustomerEntry(base, maplewood);
    expect(parseTenantDirectory(JSON.stringify(added)).invalidHosts).toEqual(
      [],
    );
    expect(added.entries).toHaveLength(4);
    expect(withCustomerEntry(added, maplewood)).toEqual(added);
    const active = withCustomerEntry(
      validateDirectory({
        version: 1,
        entries: added.entries.map((entry) =>
          entry.host === maplewood.host ? { ...entry, state: "active" } : entry,
        ),
      }),
      maplewood,
    );
    expect(active.entries.at(-1)?.state).toBe("active");
  });

  it("refuses conflicts that would take over another RWA", () => {
    expect(() =>
      assertCanAddCustomer(base, "demo.arp-civic-pulse.vercel.app", tenantId),
    ).toThrow(/already gives/u);
    expect(() =>
      withCustomerEntry(base, {
        ...maplewood,
        projectUrl: "https://hnqajjjemqepxuoqbsqx.supabase.co",
      }),
    ).toThrow(/another tenant/u);
    const added = withCustomerEntry(base, maplewood);
    expect(() =>
      withCustomerEntry(added, { ...maplewood, host: "other.example.org" }),
    ).toThrow(/refusing to move/u);
    expect(() =>
      withCustomerEntry(added, {
        ...maplewood,
        projectUrl: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co",
      }),
    ).toThrow(/different Supabase project/u);
    expect(() =>
      withCustomerEntry(base, { ...maplewood, publishableKey: "sb_secret_x" }),
    ).toThrow(/incomplete/u);
    expect(() =>
      withCustomerEntry(base, { ...maplewood, serviceRoleKeyRef: "TENANT_X" }),
    ).toThrow(/incomplete/u);
  });

  it("caps customers at ten", () => {
    let directory = base;
    for (let i = 0; i < 9; i += 1) {
      const id = `3b0c2f44-5d7e-4a8b-9c1d-2e3f4a5b6c${i}0`;
      directory = withCustomerEntry(directory, {
        ...maplewood,
        host: `rwa${i}.arp-civic-pulse.vercel.app`,
        tenantId: id,
        projectUrl: `https://project${i}aaaaaaaaaaaaa.supabase.co`,
        serviceRoleKeyRef: serviceKeyRef(id),
      });
    }
    expect(() => withCustomerEntry(directory, maplewood)).toThrow(
      /at most 10/u,
    );
  });

  it("round-trips through the ignored env file, including # and quotes", () => {
    const line = `TENANT_DIRECTORY_JSON=${quotedDirectory(base)}`;
    expect(JSON.parse(parseEnv(line).TENANT_DIRECTORY_JSON ?? "")).toEqual(
      base,
    );
  });
});

describe("post-deploy new-host check", () => {
  const response = (
    status: number,
    extra: Partial<{
      vercelError: string;
      retryAfter: string;
      bodyLength: number;
    }> = {},
  ) => ({
    status,
    vercelError: extra.vercelError ?? null,
    retryAfter: extra.retryAfter ?? null,
    bodyLength: extra.bodyLength ?? 0,
  });

  it("accepts only the app's empty 503 for a provisioning tenant", () => {
    expect(newHostResponseOk("provisioning", response(503))).toBe(true);
    for (const bad of [
      response(0),
      response(200),
      response(404),
      response(500),
      response(502),
      response(503, { vercelError: "DEPLOYMENT_PAUSED" }),
      response(503, { retryAfter: "300", bodyLength: 120 }),
      response(503, { bodyLength: 40 }),
    ]) {
      expect(newHostResponseOk("provisioning", bad)).toBe(false);
    }
  });

  it("requires a served page for an active tenant", () => {
    expect(newHostResponseOk("active", response(200))).toBe(true);
    expect(newHostResponseOk("active", response(503))).toBe(false);
    expect(newHostResponseOk("active", response(500))).toBe(false);
    expect(
      newHostResponseOk(
        "active",
        response(200, { vercelError: "FUNCTION_INVOCATION_FAILED" }),
      ),
    ).toBe(false);
  });
});
