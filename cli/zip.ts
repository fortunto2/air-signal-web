/**
 * Just enough zip to stream one entry.
 *
 * Node has no zip reader, and both files this project ingests — the Sensor.Community monthly
 * archive and the GeoNames city dumps — hold exactly one entry. A dependency for that is not worth
 * it; getting the boundaries right is.
 *
 * The boundaries are the whole difficulty, and they have to come from the **central directory**
 * rather than the local file header. A local header may legitimately carry nothing:
 *
 *   - GeoNames sets flag bit 3, "data descriptor", which means the sizes are written *after* the
 *     compressed data and the local header holds zeroes. Reading them there yields a range whose
 *     start is past its end.
 *   - Sensor.Community's archives are zip64, because a month of SDS011 is 28 GB open, so the
 *     32-bit fields hold 0xFFFFFFFF and the real numbers live in an extra record.
 *
 * The central directory is authoritative in both cases, which is why this reads it and not the
 * other one. Reading to EOF instead of using a length is not an option either: that feeds inflate
 * the trailing central directory and it rejects it as `unexpected end of file` — thrown after the
 * entire file has been read correctly, which looks exactly like a truncated download.
 */

import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import { createInterface } from "node:readline";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD = 0x06054b50;
const ZIP64_EOCD_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;

export interface Extent {
  /** First byte of the deflate stream. */
  start: number;
  /** Last byte of it, inclusive. */
  end: number;
}

/** Where the single entry's compressed data begins and ends. */
export async function entryExtent(path: string): Promise<Extent> {
  const fh = await open(path, "r");
  try {
    const size = (await fh.stat()).size;

    // The EOCD is at the very end, after a comment of up to 64 KB. Nothing here writes comments,
    // but scanning backwards costs one read and removes the assumption.
    const tailLen = Math.min(size, 66_000);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);

    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error(`${path}: no end-of-central-directory record`);

    let centralOffset = tail.readUInt32LE(eocd + 16);

    // Zip64: the 32-bit offset is saturated and the real one is in a separate record, found via a
    // locator that sits immediately before the EOCD.
    if (centralOffset === 0xffffffff) {
      let locator = -1;
      for (let i = eocd - 20; i >= 0; i--) {
        if (tail.readUInt32LE(i) === ZIP64_EOCD_LOCATOR) {
          locator = i;
          break;
        }
      }
      if (locator < 0) throw new Error(`${path}: zip64 offset with no locator`);
      const z64At = Number(tail.readBigUInt64LE(locator + 8));
      const z64 = Buffer.alloc(56);
      await fh.read(z64, 0, 56, z64At);
      if (z64.readUInt32LE(0) !== ZIP64_EOCD) throw new Error(`${path}: bad zip64 record`);
      centralOffset = Number(z64.readBigUInt64LE(48));
    }

    // First central directory entry. These files hold one; if that ever changes this is the line
    // that has to grow a loop, and it will fail loudly rather than read the wrong entry.
    const central = Buffer.alloc(46);
    await fh.read(central, 0, 46, centralOffset);
    if (central.readUInt32LE(0) !== CENTRAL_HEADER) {
      throw new Error(`${path}: central directory not where the EOCD says`);
    }
    if (central.readUInt16LE(10) !== 8) throw new Error(`${path}: entry is not deflated`);

    let compressed = central.readUInt32LE(20);
    let localAt = central.readUInt32LE(42);

    if (compressed === 0xffffffff || localAt === 0xffffffff) {
      const nameLen = central.readUInt16LE(28);
      const extraLen = central.readUInt16LE(30);
      const extra = Buffer.alloc(extraLen);
      await fh.read(extra, 0, extraLen, centralOffset + 46 + nameLen);
      // In a zip64 extra the fields appear only when their 32-bit counterpart was saturated, and
      // always in this order: uncompressed, compressed, local header offset.
      let at = 0;
      while (at + 4 <= extraLen) {
        if (extra.readUInt16LE(at) === 0x0001) {
          let cursor = at + 4;
          if (central.readUInt32LE(24) === 0xffffffff) cursor += 8; // uncompressed
          if (compressed === 0xffffffff) {
            compressed = Number(extra.readBigUInt64LE(cursor));
            cursor += 8;
          }
          if (localAt === 0xffffffff) localAt = Number(extra.readBigUInt64LE(cursor));
          break;
        }
        at += 4 + extra.readUInt16LE(at + 2);
      }
    }

    // The data start is only in the local header: name and extra lengths there may differ from the
    // central directory's, and routinely do.
    const local = Buffer.alloc(30);
    await fh.read(local, 0, 30, localAt);
    if (local.readUInt32LE(0) !== LOCAL_HEADER) throw new Error(`${path}: bad local header`);
    const start = localAt + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);

    return { start, end: start + compressed - 1 };
  } finally {
    await fh.close();
  }
}

/** The entry's contents, a line at a time. */
export async function* zipLines(path: string): AsyncGenerator<string> {
  const { start, end } = await entryExtent(path);
  const stream = createReadStream(path, { start, end }).pipe(createInflateRaw());
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    yield line;
  }
}
