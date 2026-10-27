import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findOrphanAuthUsers,
  latestBackupAgeHours,
  pruneBackups,
  readCounts,
  restoreBackup,
  verifyBackup,
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
    const roles = ["app", "auth", "counts"] as const;
    const files = roles.map((role) => `${stamp}.${role}.enc`);
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
      files: roles.map((role) => ({
        role,
        name: `${stamp}.${role}.enc`,
        bytes: 1,
        sha256: "0".repeat(64),
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

  it("continues to accept existing format-v1 manifests with a blank server version", async () => {
    const stamp = "cp-backup-20260101T000000Z";
    await fakeSet(stamp, new Date("2026-01-01T00:00:00Z"), 30);
    const path = join(dir, `${stamp}.manifest.json`);
    const manifest = JSON.parse(await readFile(path, "utf8")) as Manifest;
    manifest.serverVersion = "";
    await writeFile(path, JSON.stringify(manifest));
    expect(
      await latestBackupAgeHours(dir, new Date("2026-01-02T00:00:00Z")),
    ).toBe(24);
  });

  it.each([
    "../outside.txt",
    "..\\outside.txt",
    "C:\\outside.txt",
    "/outside.txt",
    "cp-backup-20260520T000000Z.app.enc",
    "cp-backup-20260101T000000Z.app.enc:stream",
  ])(
    "rejects an unsafe manifest filename before deleting anything: %s",
    async (name) => {
      const backupDir = join(dir, "backups");
      await mkdir(backupDir);
      const outside = join(dir, "outside.txt");
      await writeFile(outside, "must survive");
      const stamp = "cp-backup-20260101T000000Z";
      const manifest = {
        formatVersion: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-31T00:00:00.000Z",
        retentionDays: 30,
        serverVersion: "17",
        files: ["app", "auth", "counts"].map((role) => ({
          role,
          name: role === "auth" ? name : `${stamp}.${role}.enc`,
          bytes: 1,
          sha256: "0".repeat(64),
        })),
      };
      const ownFile = join(backupDir, `${stamp}.app.enc`);
      await writeFile(ownFile, "must also survive");
      await writeFile(
        join(backupDir, `${stamp}.manifest.json`),
        JSON.stringify(manifest),
      );
      await writeFile(
        join(backupDir, "cp-backup-20260520T000000Z.manifest.json"),
        "{}",
      );

      await expect(
        pruneBackups(backupDir, new Date("2026-06-01")),
      ).rejects.toThrow(/manifest/iu);
      expect(await readFile(outside, "utf8")).toBe("must survive");
      expect(await readFile(ownFile, "utf8")).toBe("must also survive");
    },
  );

  it("rejects malformed manifests on every read/restore path before processing files or connecting", async () => {
    const manifestPath = join(dir, "cp-backup-20260101T000000Z.manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({ formatVersion: 1, files: [] }),
    );
    const key = parseKey(generateKeyHex());
    for (const action of [
      () => readCounts(manifestPath, key),
      () => verifyBackup({ manifestPath, key }),
      () =>
        restoreBackup({
          manifestPath,
          key,
          targetUrl: "postgres://operator@localhost/unused",
        }),
    ]) {
      await expect(action()).rejects.toThrow(/manifest/iu);
    }
  });

  it("rejects manifests larger than 64 KiB", async () => {
    const manifestPath = join(dir, "cp-backup-20260101T000000Z.manifest.json");
    await writeFile(manifestPath, " ".repeat(64 * 1024 + 1));

    await expect(
      readCounts(manifestPath, parseKey(generateKeyHex())),
    ).rejects.toThrow(/bounded regular file/iu);
  });

  it.each([
    "duplicate role",
    "missing file",
    "mismatched timestamp",
    "invalid hash",
    "invalid expiry",
    "unknown field",
  ])("rejects incomplete or inconsistent metadata: %s", async (fault) => {
    const stamp = "cp-backup-20260101T000000Z";
    await fakeSet(stamp, new Date("2026-01-01T00:00:00Z"), 30);
    const path = join(dir, `${stamp}.manifest.json`);
    const manifest = JSON.parse(await readFile(path, "utf8")) as Manifest;
    const first = manifest.files[0];
    if (!first) {
      throw new Error("Missing fixture file.");
    }
    if (fault === "duplicate role") manifest.files[1] = { ...first };
    if (fault === "missing file") manifest.files.pop();
    if (fault === "mismatched timestamp")
      manifest.createdAt = "2026-01-02T00:00:00Z";
    if (fault === "invalid hash") first.sha256 = "invalid";
    if (fault === "invalid expiry") manifest.expiresAt = "2099-01-01T00:00:00Z";
    await writeFile(
      path,
      JSON.stringify({
        ...manifest,
        ...(fault === "unknown field" && { unexpected: true }),
      }),
    );
    await expect(readCounts(path, parseKey(generateKeyHex()))).rejects.toThrow(
      /manifest/iu,
    );
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
