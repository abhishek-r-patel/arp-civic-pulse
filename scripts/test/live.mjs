// Hosted live-test runner: restores synthetic demo data after tests that can
// write to it, including failed runs. Never run this during a planned demo.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const spawn = (command, commandArgs, options = {}) =>
  spawnSync(command, commandArgs, { stdio: "inherit", ...options }).status ?? 1;

export function runLiveTests(args, env, run = spawn) {
  const primaryIsDemo =
    URL.canParse(env.NEXT_PUBLIC_SUPABASE_URL) &&
    new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname ===
      "arxkuxlbynjbqcjuugde.supabase.co";
  const pairedTestConfigured = Object.keys(env).some(
    (name) => name.startsWith("TENANT_TEST_") && env[name],
  );
  // Option values can look like file filters; a redundant reset is safer than
  // missing cleanup after a paired test.
  const pairedTestSelected =
    args.length === 0 ||
    args.some((arg) => arg.startsWith("-") || arg.includes("auth"));

  const testStatus = run(process.execPath, [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.live.config.ts",
    ...args,
  ]);

  if (primaryIsDemo || (pairedTestConfigured && pairedTestSelected)) {
    console.log(
      "\nLive tests use the demo project; resetting it now (npm run demo:reset).",
    );
    const resetStatus = run("npm run demo:reset", [], { shell: true });
    if (resetStatus !== 0) {
      console.error(
        "Demo reset FAILED: the demo may still hold live-test users. Fix the error and run `npm run demo:reset` before any demo.",
      );
      return testStatus || resetStatus;
    }
  }
  return testStatus;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const localEnv = existsSync(".env.local")
    ? parseEnv(readFileSync(".env.local", "utf8"))
    : {};
  process.exit(
    runLiveTests(process.argv.slice(2), { ...localEnv, ...process.env }),
  );
}
