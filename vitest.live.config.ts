import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Live tests use the synthetic demo via .env.local (never committed).
// Without credentials the suites are skipped; test:live restores demo data.
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/fixtures/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/live/**/*.test.ts"],
    env: loadEnv(mode, process.cwd(), ""),
    testTimeout: 90_000,
    hookTimeout: 120_000,
    // Keep hosted project traffic serial to avoid shared Auth rate limits and data races.
    fileParallelism: false,
  },
}));
