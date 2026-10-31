import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
} from "./support/database";
import { seedWorld, type World } from "./support/fixtures";

/*
 * Upgrade-path regression: bring the prior schema forward on an isolated
 * PostgreSQL database and verify existing configuration plus the new palette.
 */
describe.skipIf(!hasDatabase)("migration upgrade compatibility", () => {
  let db: TestDatabase;
  let world: World;

  beforeAll(async () => {
    db = await createTestDatabase({ throughMigration: "20261123100000" });
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

  it("preserves settings while applying the next schema version", async () => {
    const before = await db.asOwner((client) =>
      client.query<{ full_name: string; accent_palette: string }>(
        "select full_name, accent_palette from public.rwa_settings where id = 1",
      ),
    );
    expect(before.rows[0]).toEqual({
      full_name: "Lakeview RWA",
      accent_palette: "TEAL",
    });

    const migration = readFileSync(
      new URL(
        "../../supabase/migrations/20261124100000_add_amber_accent_palette.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.asDeployment(async (client) => {
      await client.query("begin");
      try {
        await client.query(migration);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });

    const updated = await db.asRole(
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
              accentPalette: "AMBER",
              welcomeMessage: "Welcome.",
              householdLabel: "Flat",
              identifierKind: "ID",
              defaultHouseholds: [],
              rwaPositions: [
                "President",
                "Vice-President",
                "Secretary",
                "Joint-Secretary",
                "Treasurer",
              ],
            }),
          ],
        ),
      { commit: true },
    );
    expect(updated.rows[0]?.update_rwa_profile).toMatchObject({
      fullName: "Lakeview Residents Association",
      accentPalette: "AMBER",
    });

    const after = await db.asOwner((client) =>
      client.query<{ full_name: string; accent_palette: string }>(
        "select full_name, accent_palette from public.rwa_settings where id = 1",
      ),
    );
    expect(after.rows[0]).toEqual({
      full_name: "Lakeview Residents Association",
      accent_palette: "AMBER",
    });
  });
});
