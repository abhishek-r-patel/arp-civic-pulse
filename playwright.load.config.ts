import { defineConfig } from "@playwright/test";

// Optional local settings (ignored by Git).
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the load test needs one.
}

/*
 * The HTTP load test drives a server YOU started (a production build behind a
 * TLS front), so there is no webServer here. See docs/PILOT_READINESS.md.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "load-live.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  expect: { timeout: 30_000 },
});
