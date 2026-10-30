// Native-guide asset, source-path and stable-navigation checks without a running app.
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join, dirname, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { GUIDE_IMAGES, guideImagePath } from "../../src/shared/guides/screenshots.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(join(root, path), "utf8");
const dimensions = JSON.parse(await read("public/guides/dimensions.json"));
const confirmations = ["move", "suspend", "deleteResident", "deleteDraft", "eligible", "enable", "importConfirm", "activate", "schedule", "withdraw", "deadline", "complete", "cancel"];

test("every curated screenshot exists once, has exact PNG dimensions and is used", async () => {
  const contents = (await Promise.all(["resident", "admin"].map((persona) => read(`src/components/guides/${persona}-content.tsx`)))).join("\n");
  const expected = new Set();
  for (const [key, [, , caption]] of Object.entries(GUIDE_IMAGES)) {
    const path = guideImagePath(key);
    assert.ok(!expected.has(path), `Duplicate illustration: ${path}`);
    expected.add(path);
    assert.ok(caption.length > 20);
    assert.ok(contents.includes(`image="${key}"`), `Unreferenced illustration: ${key}`);
    const buffer = await readFile(join(root, "public", path.slice(1)));
    assert.equal(buffer.subarray(1, 4).toString(), "PNG");
    const size = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    assert.deepEqual(dimensions[path], size, `Stale intrinsic dimensions: ${path}`);
    if (confirmations.includes(key)) {
      assert.ok(size.width <= 640 && size.height <= 1000, `Confirmation must be dialog-only: ${path}`);
    }
  }
  assert.deepEqual(new Set(Object.keys(dimensions)), expected);
  const actual = new Set();
  for (const persona of ["resident", "rwa-admin"]) {
    for (const file of await readdir(join(root, "public/guides", persona))) {
      actual.add(`/guides/${persona}/${file}`);
    }
  }
  assert.deepEqual(actual, expected, "Publish only curated referenced images");
});

test("persona contents have unique stable fragments and required end-to-end coverage", async () => {
  const required = {
    resident: ["registration", "sign-in", "public-voting", "private-voting", "uncertain-submission", "completed-results"],
    admin: ["rwa-settings", "add-residents", "review-registrations", "prepare-vote", "monitor", "results-and-audit"],
    technical: ["source-map", "ballot-trace", "database-erd", "deployment-operations", "debugging", "testing"],
  };
  for (const [persona, ids] of Object.entries(required)) {
    const source = await read(`src/components/guides/${persona}-content.tsx`);
    const fragments = [...source.matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);
    assert.equal(fragments.length, new Set(fragments).size, `${persona}: repeated fragments`);
    for (const id of ids) assert.ok(fragments.includes(id), `${persona}: missing ${id}`);
  }
});

test("technical walkthrough points to real source files", async () => {
  const source = await read("src/components/guides/technical-content.tsx");
  const paths = new Set(source.match(/(?:src|scripts|tests|supabase)\/[\w/.[\]()-]+\.(?:tsx?|sql|mjs)/g));
  assert.ok(paths.size > 25, "Keep a useful concrete file map");
  for (const path of paths) await assert.doesNotReject(stat(join(root, path)), `Missing documented source: ${path}`);
});

test("legacy guide outputs, old screenshots and renderer hooks are retired", async () => {
  for (const path of [
    "docs/USER_GUIDE.md", "docs/USER_GUIDE.html",
    "docs/TECHNICAL_GUIDE.md", "docs/TECHNICAL_GUIDE.html",
    "docs/images/user-guide", "public/user-guide.html",
    "scripts/docs/render.mjs", "scripts/docs/render.test.mjs",
  ]) await assert.rejects(stat(join(root, path)), { code: "ENOENT" });
  const scripts = JSON.parse(await read("package.json")).scripts;
  assert.equal(scripts.predev, undefined);
  assert.equal(scripts.prebuild, undefined);
  const shell = await read("src/components/ui/app-shell.tsx");
  assert.ok(shell.includes('href="/user-guide"'));
  assert.ok(!shell.includes("/tech-guide"));
});

test("README and repository docs introduce no broken local links or Markdown anchors", async (t) => {
  const files = ["README.md", ...(await readdir(join(root, "docs"))).filter((file) => file.endsWith(".md")).map((file) => `docs/${file}`)];
  function anchors(source) {
    const seen = new Map();
    return new Set([...source.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => {
      const base = match[1].trim().toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count ? `${base}-${count}` : base;
    }));
  }
  for (const file of files) {
    const source = await read(file);
    for (const [, target] of source.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:|^\//i.test(target)) continue;
      const [path, fragment] = target.split("#");
      const resolved = path ? resolve(root, dirname(file), decodeURIComponent(path)) : join(root, file);
      await assert.doesNotReject(stat(resolved), `${file}: missing ${target}`);
      if (fragment && resolved.endsWith(".md")) {
        const anchor = decodeURIComponent(fragment);
        if (!anchors(await readFile(resolved, "utf8")).has(anchor)) {
          const baseline = (path) => execFileSync("git", ["--no-pager", "show", `HEAD:${relative(root, path).split(sep).join("/")}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
          assert.ok(baseline(join(root, file)).includes(`](${target})`) && !anchors(baseline(resolved)).has(anchor), `${file}: new missing anchor ${target}`);
          t.diagnostic(`Unchanged pre-existing broken anchor: ${file} → ${target}`);
        }
      }
    }
  }
});
