// Offline safeguards for creating and preparing a society Supabase project.
import { describe, expect, it } from "vitest";
import {
  assertFreeSlot,
  databaseUrlFor,
  parseSocietyOptions,
  projectCreateBody,
  societyProfileFile,
} from "../../scripts/ops/create-society.ts";

const demo = {
  id: "hnqajjjemqepxuoqbsqx",
  name: "civic-pulse-tenant-b-test",
  status: "ACTIVE_HEALTHY",
  region: "ap-southeast-1",
};
const testdb = {
  id: "nycbbzgsilnxrgkwlwno",
  name: "civic-pulse-testdb",
  status: "INACTIVE",
  region: "ap-south-1",
};

const args = [
  "premier-inspira-maplewood",
  "--confirm-create",
  "civic-pulse-premier-inspira-maplewood",
  "--rwa-name",
  "Premier Inspira Maplewood",
  "--host",
  "premier-inspira-maplewood.example.org",
  "--admin-name",
  "First Admin",
  "--admin-email",
  "admin@example.org",
];

describe("society creation inputs", () => {
  it("requires explicit confirmation and provisioning inputs", () => {
    expect(parseSocietyOptions(args)).toMatchObject({
      alias: "premier-inspira-maplewood",
      projectName: "civic-pulse-premier-inspira-maplewood",
      rwaName: "Premier Inspira Maplewood",
      timezone: "Asia/Kolkata",
    });
    expect(() => parseSocietyOptions(args.slice(0, 3))).toThrow(/--rwa-name/);
    expect(() =>
      parseSocietyOptions([
        ...args.slice(0, 1),
        "--confirm-create",
        "wrong-name",
        ...args.slice(3),
      ]),
    ).toThrow(/--confirm-create/);
    expect(() => parseSocietyOptions(["../outside", ...args.slice(1)])).toThrow(
      /alias/u,
    );
    expect(() => parseSocietyOptions([...args, "--typo", "value"])).toThrow(
      /Unknown/u,
    );
  });

  it("expands --subdomain onto the platform domain and guards host options", () => {
    const withoutHost = [...args.slice(0, 5), ...args.slice(7)];
    expect(
      parseSocietyOptions([...withoutHost, "--subdomain", "Maplewood"]).host,
    ).toBe("maplewood.arp-civic-pulse.vercel.app");
    expect(parseSocietyOptions(args).host).toBe(
      "premier-inspira-maplewood.example.org",
    );
    expect(() =>
      parseSocietyOptions([...args, "--subdomain", "maplewood"]),
    ).toThrow(/either --subdomain or --host/u);
    expect(() => parseSocietyOptions(withoutHost)).toThrow(/--subdomain/u);
    for (const bad of ["maple.wood", "https://maplewood", "-maplewood"]) {
      expect(() =>
        parseSocietyOptions([...withoutHost, "--subdomain", bad]),
      ).toThrow(/single DNS label/u);
    }
    expect(() =>
      parseSocietyOptions([...withoutHost, "--subdomain", "demo"]),
    ).toThrow(/reserved/u);
  });

  it("uses a single git-ignored profile path for an alias", () => {
    expect(societyProfileFile("premier-inspira-maplewood")).toBe(
      ".env.premier-inspira-maplewood.local",
    );
    expect(() => societyProfileFile("../secrets")).toThrow(/alias/u);
  });

  it("builds the verified Mumbai pooler URL without exposing the password", () => {
    const url = new URL(
      databaseUrlFor(
        "abcdefghijklmnopqrst",
        "test password /? secret",
        "ap-south-1",
      ),
    );
    expect(url.hostname).toBe("aws-0-ap-south-1.pooler.supabase.com");
    expect(url.port).toBe("5432");
    expect(decodeURIComponent(url.username)).toBe(
      "postgres.abcdefghijklmnopqrst",
    );
    expect(decodeURIComponent(url.password)).toBe("test password /? secret");
    expect(url.pathname).toBe("/postgres");
  });

  it("uses the current organization_slug project-create API field", () => {
    expect(
      projectCreateBody("my-organization", "civic-pulse-example", "db-secret"),
    ).toEqual({
      organization_slug: "my-organization",
      db_pass: "db-secret",
      name: "civic-pulse-example",
      plan: "free",
      region_selection: { type: "specific", code: "ap-south-1" },
    });
  });
});

describe("free-tier project slot guard", () => {
  it("allows demo plus paused testdb to use the second slot", () => {
    expect(() => assertFreeSlot([demo, testdb])).not.toThrow();
  });

  it("refuses a paused demo, active testdb, or another active project", () => {
    expect(() =>
      assertFreeSlot([{ ...demo, status: "INACTIVE" }, testdb]),
    ).toThrow(/demo/);
    expect(() =>
      assertFreeSlot([demo, { ...testdb, status: "ACTIVE_HEALTHY" }]),
    ).toThrow(/testdb project/);
    expect(() =>
      assertFreeSlot([
        demo,
        testdb,
        {
          id: "abcdefghijklmnopqrst",
          name: "another-project",
          status: "ACTIVE_HEALTHY",
          region: "ap-south-1",
        },
      ]),
    ).toThrow(/another-project/);
    expect(() =>
      assertFreeSlot(
        [demo, testdb, { ...demo, id: "abcdefghijklmnopqrst" }],
        "abcdefghijklmnopqrst",
      ),
    ).not.toThrow();
  });
});
