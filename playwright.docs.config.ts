import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "./scripts/docs",
  testMatch: "capture.spec.ts",
  grep: /illustrated documentation journeys|bulk account review|bulk import and scheduled opening|self-registration and one-step/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  projects: base.projects?.filter((project) => project.name === "chromium"),
  use: {
    ...base.use,
    actionTimeout: 20_000,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
