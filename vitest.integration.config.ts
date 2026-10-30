import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Real-database tests (the heavy capacity test lives in tests/load, run by vitest.load.config.ts,
// so it cannot starve the timing-sensitive tests here). Requires INTEGRATION_DATABASE_URL pointing at a
// DISPOSABLE local PostgreSQL server (see supabase/README.md). Without it the
// suites are skipped rather than silently passing against nothing.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/fixtures/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
