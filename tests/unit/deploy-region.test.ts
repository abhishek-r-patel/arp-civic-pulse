// Guards the Mumbai-only hosting policy: Vercel functions in bom1 and every new
// RWA Supabase project in ap-south-1 (docs/DEPLOYMENT.md, "Region policy").
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOCIETY_REGION } from "../../scripts/ops/create-society.ts";

describe("deployment region policy", () => {
  it("pins Vercel functions to Mumbai (bom1)", () => {
    const config = JSON.parse(
      readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
    ) as { regions?: unknown };
    expect(config.regions).toEqual(["bom1"]);
  });

  it("creates RWA Supabase projects in Mumbai (ap-south-1)", () => {
    expect(SOCIETY_REGION).toBe("ap-south-1");
  });
});
