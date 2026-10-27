// Browser verification; visual-only runs can preserve the user's deliberately frozen guide assets.
import { defineConfig, devices } from "@playwright/test";

// Optional local settings (ignored by Git), used by the LIVE_AUTH specs and the dev server.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the default e2e specs do not need one.
}

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Assertions wait for real network round trips (and, locally, dev-server compiles).
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional: use an installed browser (for example "msedge") when the
        // network blocks `npx playwright install`.
        channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL,
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command:
      process.env.PLAYWRIGHT_PRESERVE_GUIDE === "1"
        ? `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`
        : `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { APP_ORIGIN: baseURL },
  },
});
