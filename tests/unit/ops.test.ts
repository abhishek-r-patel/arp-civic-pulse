import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findOrphanAuthUsers,
  latestBackupAgeHours,
  pruneBackups,
  type Manifest,
} from "../../scripts/ops/backup.ts";
import {
  decryptFile,
  encryptBytes,
  generateKeyHex,
  parseKey,
} from "../../scripts/ops/crypto.ts";
import { isMaintenanceMode } from "@/server/maintenance";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cp-ops-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("backup encryption", () => {
  const key = parseKey(generateKeyHex());

  it("round-trips, never stores plaintext, and uses a fresh IV for every file", async () => {
    const secret = Buffer.from("Alice Rao | A-101 | Yes ".repeat(5000));
    const a = join(dir, "a.enc");
    const b = join(dir, "b.enc");
    await encryptBytes(secret, a, key);
    await encryptBytes(secret, b, key);

    const stored = await readFile(a);
    expect(stored.includes(Buffer.from("Alice Rao"))).toBe(false);
    expect(stored.equals(await readFile(b))).toBe(false);
    expect(stored.subarray(0, 6).toString()).toBe("CPBK1\n");

    const plain = join(dir, "a.plain");
    await decryptFile(a, plain, key);
    expect((await readFile(plain)).equals(secret)).toBe(true);
  });

  it("fails, and leaves no output, for a wrong key or any altered byte", async () => {
    const file = join(dir, "x.enc");
    await encryptBytes(Buffer.from("ballot data ".repeat(100)), file, key);

    await expect(
      decryptFile(file, join(dir, "wrong.plain"), parseKey(generateKeyHex())),
    ).rejects.toThrow(/wrong key or the file was altered/u);
    expect(await readdir(dir)).not.toContain("wrong.plain");

    const bytes = await readFile(file);
    for (const position of [8, 40, bytes.length - 3]) {
      const tampered = Buffer.from(bytes);
      tampered[position] = (tampered[position] ?? 0) ^ 0x01;
      const path = join(dir, `t${position}.enc`);
      await writeFile(path, tampered);
      await expect(
        decryptFile(path, join(dir, `t${position}.plain`), key),
      ).rejects.toThrow();
      expect(await readdir(dir)).not.toContain(`t${position}.plain`);
    }
    // A truncated file is refused too.
    await writeFile(join(dir, "short.enc"), bytes.subarray(0, 20));
    await expect(
      decryptFile(join(dir, "short.enc"), join(dir, "s.plain"), key),
    ).rejects.toThrow();
  });

  it("never overwrites an existing backup", async () => {
    const file = join(dir, "once.enc");
    await encryptBytes(Buffer.from("one"), file, key);
    await expect(encryptBytes(Buffer.from("two"), file, key)).rejects.toThrow();
  });

  it("rejects a malformed key", () => {
    for (const bad of [undefined, "", "abc", "z".repeat(64), "a".repeat(63)]) {
      expect(() => parseKey(bad)).toThrow(/64 hexadecimal/u);
    }
  });
});

describe("expiry", () => {
  async function fakeSet(
    stamp: string,
    createdAt: Date,
    retentionDays: number,
  ) {
    const files = [
      `${stamp}.app.enc`,
      `${stamp}.auth.enc`,
      `${stamp}.counts.enc`,
    ];
    for (const name of files) {
      await writeFile(join(dir, name), "x");
    }
    const manifest: Manifest = {
      formatVersion: 1,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + retentionDays * 86_400_000,
      ).toISOString(),
      retentionDays,
      serverVersion: "17",
      files: files.map((name) => ({
        role: "app",
        name,
        bytes: 1,
        sha256: "0",
      })),
    };
    await writeFile(
      join(dir, `${stamp}.manifest.json`),
      JSON.stringify(manifest),
    );
  }

  it("removes whole expired sets, keeps unexpired ones, and always keeps the newest", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    await fakeSet(
      "cp-backup-20260101T000000Z",
      new Date("2026-01-01T00:00:00Z"),
      30,
    );
    await fakeSet(
      "cp-backup-20260301T000000Z",
      new Date("2026-03-01T00:00:00Z"),
      30,
    );
    await fakeSet(
      "cp-backup-20260520T000000Z",
      new Date("2026-05-20T00:00:00Z"),
      30,
    );

    expect(await pruneBackups(dir, now)).toEqual([
      "cp-backup-20260101T000000Z.manifest.json",
      "cp-backup-20260301T000000Z.manifest.json",
    ]);
    expect((await readdir(dir)).sort()).toEqual([
      "cp-backup-20260520T000000Z.app.enc",
      "cp-backup-20260520T000000Z.auth.enc",
      "cp-backup-20260520T000000Z.counts.enc",
      "cp-backup-20260520T000000Z.manifest.json",
    ]);

    // Even when everything has expired, the newest set is never deleted: no backup is worse than a stale one.
    expect(await pruneBackups(dir, new Date("2030-01-01T00:00:00Z"))).toEqual(
      [],
    );
    expect((await readdir(dir)).length).toBe(4);
  });

  it("reports the age of the newest backup for monitoring", async () => {
    expect(await latestBackupAgeHours(dir)).toBeNull();
    await fakeSet(
      "cp-backup-20260520T000000Z",
      new Date("2026-05-20T00:00:00Z"),
      30,
    );
    expect(
      await latestBackupAgeHours(dir, new Date("2026-05-21T12:00:00Z")),
    ).toBe(36);
  });
});

describe("orphaned Auth identities", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const user = (id: string, hoursAgo: number) => ({
    id,
    created_at: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
  });

  it("lists only identities with no profile that are old enough for provisioning to be finished", () => {
    const orphans = findOrphanAuthUsers(
      [
        user("kept", 500),
        user("old-orphan", 500),
        user("fresh-orphan", 2),
        user("edge", 24),
      ],
      new Set(["kept"]),
      now,
    );
    expect(orphans).toEqual(["old-orphan", "edge"]);
  });
});

describe("maintenance mode", () => {
  it("is on only for the exact value 1", () => {
    expect(isMaintenanceMode({ MAINTENANCE_MODE: "1" })).toBe(true);
    for (const value of [undefined, "", "0", "true", "yes", " 1"]) {
      expect(isMaintenanceMode({ MAINTENANCE_MODE: value })).toBe(false);
    }
  });
});
