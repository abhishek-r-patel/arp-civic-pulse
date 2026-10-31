// `npm run test:live` entry point: runs the live Vitest suites, then resets the
// demo project. The cross-customer paired test (tests/live/auth.live.test.ts)
// uses the demo project as project B and leaves test users there, so whenever it
// could have run, `npm run demo:reset` follows, even after a failed test run.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const args = process.argv.slice(2);
const localEnv = existsSync(".env.local")
  ? parseEnv(readFileSync(".env.local", "utf8"))
  : {};
const pairedTestConfigured = Object.keys(localEnv).some(
  (name) => name.startsWith("TENANT_TEST_") && localEnv[name],
);
// Explicit file filters that exclude the auth suite cannot run the paired test.
const fileFilters = args.filter((arg) => !arg.startsWith("-"));
const pairedTestSelected =
  fileFilters.length === 0 ||
  fileFilters.some((filter) => filter.includes("auth"));

const run = (command, commandArgs, options = {}) =>
  spawnSync(command, commandArgs, { stdio: "inherit", ...options }).status ?? 1;

const testStatus = run(process.execPath, [
  "node_modules/vitest/vitest.mjs",
  "run",
  "--config",
  "vitest.live.config.ts",
  ...args,
]);

if (pairedTestConfigured && pairedTestSelected) {
  console.log(
    "\nThe paired live test uses the demo project; resetting it now (npm run demo:reset).",
  );
  const resetStatus = run("npm run demo:reset", [], { shell: true });
  if (resetStatus !== 0) {
    console.error(
      "Demo reset FAILED: the demo may still hold live-test users. Fix the error and run `npm run demo:reset` before any demo.",
    );
    process.exit(testStatus || resetStatus);
  }
}

process.exit(testStatus);
