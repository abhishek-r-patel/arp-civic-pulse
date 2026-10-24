import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "./scripts/docs",
  testMatch: "capture.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  projects: base.projects?.filter((project) => project.name === "chromium"),
  use: { ...base.use, trace: "off", video: "off", screenshot: "off" },
});
