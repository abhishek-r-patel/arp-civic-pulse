import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Live tests talk to YOUR disposable hosted Supabase project, using the values in
// .env.local (never committed). Without them the suites are skipped.
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
    // One shared project and shared Auth rate limits: run files one at a time.
    fileParallelism: false,
  },
}));
