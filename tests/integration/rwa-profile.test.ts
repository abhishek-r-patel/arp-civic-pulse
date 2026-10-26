import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbError,
  hasDatabase,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";

describe.skipIf(!hasDatabase)("RWA profile settings", () => {
  let db: TestDatabase;
  let world: World;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.asDeployment((client) =>
      client.query(
        "select app_private.deployment_initialize_settings('Lakeview RWA', 'Asia/Kolkata')",
      ),
    );
    world = await seedWorld(db);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("gives members display branding only and protects the full profile", async () => {
    const branding = await db.asRole(
      "authenticated",
      { sub: world.alice.id },
      (client) =>
        client.query<{ get_rwa_branding: Record<string, unknown> }>(
          "select public.get_rwa_branding()",
        ),
    );
    expect(branding.rows[0]?.get_rwa_branding).toEqual({
      fullName: "Lakeview RWA",
      alias: "RWA",
      address: "RWA Address",
      email: "rwa@email.com",
      phone: "+91 123 456 7890",
      website: "",
      accentPalette: "TEAL",
      welcomeMessage: "",
      householdLabel: "Household",
      identifierKind: "NUMBER",
    });

    const forbidden = await dbError(
      db.asRole("authenticated", { sub: world.alice.id }, (client) =>
        client.query("select public.get_rwa_profile()"),
      ),
    );
    // Admin-only routines use the shared guard: a stable FORBIDDEN code.
    expect(forbidden.message).toBe("FORBIDDEN");

    const suspended = await dbError(
      db.asRole("authenticated", { sub: world.carol.id }, (client) =>
        client.query("select public.get_rwa_branding()"),
      ),
    );
    expect(suspended.code).toBe("42501");
  });

  it("serves the public identity to the service role only", async () => {
    const identity = await db.asRole(
      "service_role",
      { role: "service_role" },
      (client) =>
        client.query<{ get_public_rwa_identity: Record<string, unknown> }>(
          "select public.get_public_rwa_identity()",
        ),
    );
    expect(identity.rows[0]?.get_public_rwa_identity).toEqual({
      fullName: "Lakeview RWA",
      alias: "RWA",
      address: "RWA Address",
      accentPalette: "TEAL",
      householdLabel: "Household",
    });

    for (const [role, claims] of [
      ["anon", { role: "anon" }],
      ["authenticated", { sub: world.alice.id }],
    ] as const) {
      const denied = await dbError(
        db.asRole(role, claims, (client) =>
          client.query("select public.get_public_rwa_identity()"),
        ),
      );
      expect(denied.code).toBe("42501");
    }
  });

  it("lets admins update the profile and audits field names without values", async () => {
    const initial = await db.asRole(
      "authenticated",
      { sub: world.admin.id },
      (client) =>
        client.query<{ get_rwa_profile: Record<string, unknown> }>(
          "select public.get_rwa_profile()",
        ),
    );
    expect(initial.rows[0]?.get_rwa_profile).toEqual({
      fullName: "Lakeview RWA",
      alias: "RWA",
      address: "RWA Address",
      email: "rwa@email.com",
      phone: "+91 123 456 7890",
      website: "",
      accentPalette: "TEAL",
      welcomeMessage: "",
      householdLabel: "Household",
      identifierKind: "NUMBER",
      defaultHouseholds: [],
      rwaPositions: [
        "President",
        "Vice-President",
        "Secretary",
        "Joint-Secretary",
        "Treasurer",
      ],
    });

    const changed = await db.asRole(
      "authenticated",
      { sub: world.admin.id },
      (client) =>
        client.query<{ update_rwa_profile: Record<string, unknown> }>(
          "select public.update_rwa_profile($1::jsonb)",
          [
            JSON.stringify({
              fullName: "Lakeview Residents Association",
              alias: "Lakeview RWA",
              address: "12 Example Road",
              email: "contact@example.org",
              phone: "+91 123 456 7890",
              website: "https://example.org",
              accentPalette: "PLUM",
              welcomeMessage: "Welcome to our community portal.",
              householdLabel: "Flat",
              identifierKind: "ID",
              defaultHouseholds: ["H-101", "H-102"],
              rwaPositions: ["President", "Treasurer"],
            }),
          ],
        ),
      { commit: true },
    );
    expect(changed.rows[0]?.update_rwa_profile).toMatchObject({
      fullName: "Lakeview Residents Association",
      alias: "Lakeview RWA",
      website: "https://example.org",
      accentPalette: "PLUM",
      welcomeMessage: "Welcome to our community portal.",
      householdLabel: "Flat",
      identifierKind: "ID",
      defaultHouseholds: ["H-101", "H-102"],
      rwaPositions: ["President", "Treasurer"],
    });

    const currentName = await db.asOwner((client) =>
      client.query<{ name: string }>(
        "select name from public.rwa_settings where id = 1",
      ),
    );
    expect(currentName.rows[0]?.name).toBe("Lakeview Residents Association");

    // Members see the new display values immediately.
    const branding = await db.asRole(
      "authenticated",
      { sub: world.alice.id },
      (client) =>
        client.query<{ get_rwa_branding: Record<string, unknown> }>(
          "select public.get_rwa_branding()",
        ),
    );
    expect(branding.rows[0]?.get_rwa_branding).toMatchObject({
      fullName: "Lakeview Residents Association",
      accentPalette: "PLUM",
      welcomeMessage: "Welcome to our community portal.",
      householdLabel: "Flat",
      identifierKind: "ID",
    });
    // The suggestion lists are administrator-only.
    expect(branding.rows[0]?.get_rwa_branding).not.toHaveProperty(
      "defaultHouseholds",
    );
    expect(branding.rows[0]?.get_rwa_branding).not.toHaveProperty(
      "rwaPositions",
    );

    const audit = await db.asOwner((client) =>
      client.query<{ details: Record<string, unknown> }>(
        `select details from public.audit_events
         where action = 'RWA_PROFILE_UPDATED' and actor_profile_id = $1`,
        [world.admin.id],
      ),
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.details).toEqual({
      fields: [
        "fullName",
        "alias",
        "address",
        "email",
        "website",
        "accentPalette",
        "welcomeMessage",
        "householdLabel",
        "identifierKind",
        "defaultHouseholds",
        "rwaPositions",
      ],
    });
  });

  it("rejects member updates and malformed profile values", async () => {
    const profile = {
      fullName: "Residents Welfare Association",
      alias: "RWA",
      address: "RWA Address",
      email: "rwa@email.com",
      phone: "+91 123 456 7890",
      website: "",
      accentPalette: "TEAL",
      welcomeMessage: "",
      householdLabel: "Household",
      identifierKind: "NUMBER",
      defaultHouseholds: [],
      rwaPositions: ["President"],
    };
    const forbidden = await dbError(
      db.asRole("authenticated", { sub: world.alice.id }, (client) =>
        client.query("select public.update_rwa_profile($1::jsonb)", [
          JSON.stringify(profile),
        ]),
      ),
    );
    expect(forbidden.code).toBe("42501");

    const invalid = await dbError(
      db.asRole("authenticated", { sub: world.admin.id }, (client) =>
        client.query("select public.update_rwa_profile($1::jsonb)", [
          JSON.stringify({ ...profile, website: "javascript:alert(1)" }),
        ]),
      ),
    );
    expect(invalid.message).toBe("VALIDATION_FAILED");

    const wrongType = await dbError(
      db.asRole("authenticated", { sub: world.admin.id }, (client) =>
        client.query("select public.update_rwa_profile($1::jsonb)", [
          JSON.stringify({ ...profile, fullName: 42 }),
        ]),
      ),
    );
    expect(wrongType.message).toBe("VALIDATION_FAILED");

    for (const bad of [
      { accentPalette: "NEON" },
      { welcomeMessage: "<b>Hi</b>" },
      { welcomeMessage: "x".repeat(301) },
      { fullName: "" },
      { alias: "" },
      { householdLabel: "" },
      { householdLabel: "x".repeat(41) },
      { householdLabel: "<b>Flat</b>" },
      { identifierKind: "CODE" },
      { email: "not-an-email" },
      { defaultHouseholds: "H-101" },
      { defaultHouseholds: [101] },
      { defaultHouseholds: ["H-101", "h-101"] },
      { defaultHouseholds: [" H-101"] },
      { defaultHouseholds: ["x".repeat(101)] },
      { rwaPositions: [""] },
      { rwaPositions: ["<b>Chair</b>"] },
      { rwaPositions: Array.from({ length: 51 }, (_, i) => `Office ${i}`) },
    ]) {
      const rejected = await dbError(
        db.asRole("authenticated", { sub: world.admin.id }, (client) =>
          client.query("select public.update_rwa_profile($1::jsonb)", [
            JSON.stringify({ ...profile, ...bad }),
          ]),
        ),
      );
      expect(rejected.message).toBe("VALIDATION_FAILED");
    }
  });

  it("accepts blank optional contact fields", async () => {
    const blank = await db.asRole(
      "authenticated",
      { sub: world.admin.id },
      (client) =>
        client.query<{ update_rwa_profile: Record<string, unknown> }>(
          "select public.update_rwa_profile($1::jsonb)",
          [
            JSON.stringify({
              fullName: "Residents Welfare Association",
              alias: "RWA",
              address: "",
              email: "",
              phone: "",
              website: "",
              accentPalette: "TEAL",
              welcomeMessage: "",
              householdLabel: "Household",
              identifierKind: "NUMBER",
              defaultHouseholds: [],
              rwaPositions: [],
            }),
          ],
        ),
    );
    expect(blank.rows[0]?.update_rwa_profile).toMatchObject({
      address: "",
      email: "",
      phone: "",
      defaultHouseholds: [],
      rwaPositions: [],
    });
  });
});
