import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Capacity tests: real PostgreSQL, 500 households, 100 concurrent users. Run on their own
// (never beside the other suites) with INTEGRATION_DATABASE_URL pointing at a DISPOSABLE
// server started with `-c max_connections=300`. See docs/PILOT_READINESS.md.
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
    include: ["tests/load/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
