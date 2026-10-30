import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { once } from "node:events";

/*
 * Authenticated file encryption for off-site backups: AES-256-GCM with a fresh
 * random 96-bit IV per file and the format header authenticated as AAD. Layout:
 *   "CPBK1\n" | iv (12) | ciphertext | tag (16)
 * Any change to the file, the header or the key fails decryption; a partial
 * output is deleted rather than left behind. The key lives outside the database
 * and outside the backup location (docs/OPERATIONS.md).
 */
const MAGIC = Buffer.from("CPBK1\n");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;

async function closeStream(out: WriteStream): Promise<void> {
  if (!out.closed) {
    // Not events.once(): a pending write failing with "destroyed" emits "error" first.
    await new Promise<void>((resolve) => {
      out.once("close", () => resolve());
      out.destroy();
    });
  }
}

export function parseKey(hex: string | undefined): Buffer {
  if (!hex || !/^[0-9a-f]{64}$/iu.test(hex)) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes).",
    );
  }
  return Buffer.from(hex, "hex");
}

export function generateKeyHex(): string {
  return randomBytes(32).toString("hex");
}

export async function encryptStream(
  source: AsyncIterable<Buffer | Uint8Array>,
  destination: string,
  key: Buffer,
): Promise<{ bytes: number; sha256: string }> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const hash = createHash("sha256");
  // "wx": never overwrite an existing backup; owner-only permissions.
  const out = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  // A failed write is reported by the surrounding code; a late stream error must not escape.
  out.on("error", () => undefined);
  let bytes = 0;
  let opened = false;

  const write = async (chunk: Buffer) => {
    if (chunk.length === 0) {
      return;
    }
    hash.update(chunk);
    bytes += chunk.length;
    if (!out.write(chunk)) {
      await once(out, "drain");
    }
  };

  try {
    // Fail at once if the file already exists or cannot be created (and then never delete it).
    await once(out, "open");
    opened = true;
    await write(Buffer.concat([MAGIC, iv]));
    for await (const chunk of source) {
      await write(cipher.update(Buffer.from(chunk)));
    }
    await write(cipher.final());
    await write(cipher.getAuthTag());
    out.end();
    await once(out, "finish");
    return { bytes, sha256: hash.digest("hex") };
  } catch (error) {
    await closeStream(out);
    if (opened) {
      await rm(destination, { force: true });
    }
    throw error;
  }
}

export async function encryptBytes(
  data: Buffer,
  destination: string,
  key: Buffer,
) {
  return encryptStream(
    (async function* () {
      yield data;
    })(),
    destination,
    key,
  );
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export async function decryptFile(
  source: string,
  destination: string,
  key: Buffer,
): Promise<void> {
  const handle = await open(source, "r");
  try {
    const { size } = await handle.stat();
    if (size < HEADER_BYTES + TAG_BYTES) {
      throw new Error("The backup file is too short to be valid.");
    }
    const header = Buffer.alloc(HEADER_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("This is not a Civic Pulse backup file.");
    }
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(MAGIC.length),
    );
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(tag);

    const out = createWriteStream(destination, { flags: "wx", mode: 0o600 });
    out.on("error", () => undefined);
    await once(out, "open").catch(async (error: unknown) => {
      await closeStream(out);
      throw error;
    });
    try {
      const body = createReadStream(source, {
        start: HEADER_BYTES,
        end: size - TAG_BYTES - 1,
      });
      for await (const chunk of body) {
        const plain = decipher.update(chunk as Buffer);
        if (!out.write(plain)) {
          await once(out, "drain");
        }
      }
      out.write(decipher.final());
      out.end();
      await once(out, "finish");
    } catch {
      await closeStream(out);
      await rm(destination, { force: true });
      throw new Error(
        "The backup could not be decrypted: wrong key or the file was altered.",
      );
    }
  } finally {
    await handle.close();
  }
}
