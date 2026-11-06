// Regression checks for demo restoration without contacting hosted services.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runLiveTests } from "./live.mjs";

const demo = {
  NEXT_PUBLIC_SUPABASE_URL: "https://hnqajjjemqepxuoqbsqx.supabase.co",
};

function run(args, env, statuses = [0, 0]) {
  const calls = [];
  const status = runLiveTests(args, env, (...call) => {
    calls.push(call);
    return statuses[calls.length - 1];
  });
  return { calls, status };
}

test("resets the primary demo after every selected suite, even on failure", () => {
  for (const args of [[], ["drafts"], ["--testNamePattern", "validation"]]) {
    for (const testStatus of [0, 1]) {
      const result = run(args, demo, [testStatus, 0]);
      assert.equal(result.calls.length, 2);
      assert.equal(result.calls[1][0], "npm run demo:reset");
      assert.equal(result.status, testStatus);
      assert.deepEqual(result.calls[0][1].slice(4), args);
    }
  }
});

test("reset failures fail the command without hiding test failures", () => {
  assert.equal(run([], demo, [0, 2]).status, 2);
  assert.equal(run([], demo, [1, 2]).status, 1);
});

test("does not reset an unrelated primary project without paired settings", () => {
  for (const env of [{}, { NEXT_PUBLIC_SUPABASE_URL: "not a URL" }]) {
    assert.equal(run([], env).calls.length, 1);
  }
});

test("preserves paired-test cleanup, including option values", () => {
  const paired = { TENANT_TEST_SUPABASE_URL: demo.NEXT_PUBLIC_SUPABASE_URL };
  for (const args of [[], ["auth"], ["--testNamePattern", "validation"]]) {
    assert.equal(run(args, paired).calls.length, 2);
  }
  assert.equal(run(["drafts"], paired).calls.length, 1);
  assert.equal(run([], { TENANT_TEST_SUPABASE_URL: "" }).calls.length, 1);
});
