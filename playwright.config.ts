// Browser verification; screenshot assets change only in the explicitly opted-in docs capture suite.
import { defineConfig, devices } from "@playwright/test";

// Optional local settings (ignored by Git), used by the LIVE_AUTH specs and the dev server.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the default e2e specs do not need one.
}

const port = process.env.PLAYWRIGHT_PORT ?? "3100";
const host =
  process.env.PLAYWRIGHT_HOST === "localhost" ? "localhost" : "127.0.0.1";
const baseURL = `http://${host}:${port}`;

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
  // Hosted-only specs (for example TENANT_HTTP_REMOTE=1) need no local server.
  webServer:
    process.env.PLAYWRIGHT_NO_WEB_SERVER === "1"
      ? undefined
      : {
          command: `npm run dev -- --hostname ${host} --port ${port}`,
          url: process.env.PLAYWRIGHT_READY_URL ?? baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { APP_ORIGIN: baseURL },
        },
});
