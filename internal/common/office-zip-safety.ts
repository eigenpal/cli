import { inflateRawSync } from 'node:zlib';

export const MAX_TEMPLATE_INFLATED_BYTES = 100 * 1024 * 1024;
export const MAX_TEMPLATE_ZIP_ENTRIES = 10_000;
/**
 * Per-entry compression-ratio ceiling.
 *
 * This is set just above DEFLATE's own maximum, not at a hand-picked "looks
 * suspicious" number. A deflate stream cannot exceed roughly 1032:1 (measured
 * here: 4 MiB of zeros compresses to 4080 bytes, 1028:1), so anything above
 * that is arithmetically impossible rather than merely unusual, and the check
 * becomes a statement about the format instead of a guess about content.
 *
 * The previous value of 200:1 was well inside the range ordinary Office files
 * reach. Repetitive Word and Excel XML measures 157:1 and 171:1 on modest
 * samples and climbs past 200:1 on larger ones, so real customer documents were
 * being refused.
 *
 * Relaxing this does not widen the work an attacker can buy. Total inflation is
 * still capped by MAX_TEMPLATE_INFLATED_BYTES, and pass 2 inflates every entry
 * under `maxOutputLength` set to its declared size, so a lie is caught by
 * measurement rather than by this heuristic.
 */
const MAX_TEMPLATE_COMPRESSION_RATIO = 1100;
/**
 * Constant term of the pre-filter bound in {@link maxPlausibleDeflatedSize},
 * covering block framing on a tiny entry. The proportional term lives there;
 * see that comment for why the bound is deliberately loose.
 */
const MAX_TEMPLATE_DEFLATE_EXPANSION_SLACK_BYTES = 1024;
/**
 * Upper bound on plausible deflate output, used only as a cheap pre-filter.
 *
 * Understating the uncompressed size is the free bypass of the forward ratio
 * check, so an entry whose compressed size dwarfs its declared size is
 * suspicious. But this check is NOT the real defence: pass 2 inflates every
 * entry with `maxOutputLength` set to the declared size, so a lie is caught
 * there regardless of what this allows. Verified by forging a 40 MiB payload
 * declared as 900 KB, which passes every pass 1 check and is still rejected by
 * pass 2.
 *
 * It is therefore deliberately generous. Deflate's expansion on incompressible
 * input depends on the producer's level and memLevel: zlib at the default
 * level 6 adds about 0.03 percent, but level 1 (what .NET's
 * `CompressionLevel.Fastest` selects) adds over 5 percent. A tight bound tuned
 * to zlib's defaults rejected real files from those producers. Deflate never
 * comes close to doubling its input, so 2x plus a small constant cannot
 * false-reject a legitimate entry while still catching the gross case.
 */
function maxPlausibleDeflatedSize(inflated: number): number {
  return inflated * 2 + MAX_TEMPLATE_DEFLATE_EXPANSION_SLACK_BYTES;
}
/**
 * Upper bound on the scratch buffer a single verification inflate may
 * allocate. Sizing the chunk to the expected output lets zlib fill one buffer
 * instead of stitching 16 KiB chunks together (measured ~1.4x faster on a
 * 5 MiB entry), while the cap keeps a lying entry from turning a small
 * compressed payload into a large allocation.
 */
const VERIFY_CHUNK_CAP_BYTES = 256 * 1024;
const VERIFY_CHUNK_FLOOR_BYTES = 16 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x0001;

export type OfficeZipEntry = {
  path: string;
  compressed: number;
  inflated: number;
  /** ZIP compression method from the central directory (0 store, 8 deflate). */
  method: number;
};

export type OfficeZipInspection = {
  entries: OfficeZipEntry[];
};

export function isOfficeZipContainer(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === LOCAL_FILE_SIGNATURE;
}

function assertSafeZipPath(path: string): void {
  if (!path || path.includes('\0') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) {
    throw new Error('Office ZIP entry path is not safe');
  }
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('Office ZIP entry path is not safe');
  }
}

/**
 * Locate an entry's compressed payload from its local file header.
 *
 * The local header's own size fields are deliberately ignored: entries written
 * with a data descriptor (general-purpose flag bit 3) carry zeros there and
 * the real sizes only in the central directory. The name and extra-field
 * lengths must still be read locally because they routinely differ from the
 * central-directory copies.
 */
function locateEntryPayload(bytes: Buffer, compressed: number, localOffset: number): Buffer {
  if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error('Invalid Office ZIP local file header');
  }
  const localNameLength = bytes.readUInt16LE(localOffset + 26);
  const localExtraLength = bytes.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + compressed;
  if (dataEnd > bytes.length) {
    throw new Error('Invalid Office ZIP local file header');
  }
  return bytes.subarray(dataStart, dataEnd);
}

/**
 * Confirm one entry really inflates to the size the central directory claims.
 *
 * Why this cannot be skipped for "big" entries, or replaced by a cheaper
 * heuristic: the declared `uncompressedSize` is attacker-written, and the two
 * free checks in {@link inspectSafeOfficeZip} only constrain it loosely.
 * Declare D bytes for a payload of C compressed bytes with D just above C and
 * D under 1 MiB, and both free checks pass (the forward ratio check only
 * applies above 1 MiB, and the inverted check only fires when C exceeds D).
 * DEFLATE tops out near 1032:1, so that entry can really expand to ~1032 * C
 * while declaring C. Repeat it until the declared total reaches the 100 MB
 * budget and an accepted archive expands to roughly 100 GB inside PizZip,
 * which calls `pako.inflateRaw` with no output bound at all.
 *
 * The verification is therefore mandatory for every deflated entry, and its
 * cost is bounded by the *declared* size, not the real one: `maxOutputLength`
 * makes zlib stop and throw the moment output passes what the entry claims.
 * An archive can never make this preflight do more inflation than the budget
 * it declares (and that {@link inspectSafeOfficeZip} has already accepted), so
 * it is not an amplifier: a bomb is rejected after inflating only its small
 * declared size, and an honest document costs the same inflation the caller is
 * about to perform anyway.
 */
function assertDeclaredSizeIsReal(bytes: Buffer, entry: OfficeZipEntry, localOffset: number): void {
  const payload = locateEntryPayload(bytes, entry.compressed, localOffset);

  if (entry.method === METHOD_STORE) {
    // Stored entries are copied verbatim, so any disagreement is a lie.
    if (entry.compressed !== entry.inflated) {
      throw new Error('Office ZIP entry size does not match its stored payload');
    }
    return;
  }

  if (entry.compressed === 0 && entry.inflated === 0) return;

  try {
    const inflated = inflateRawSync(payload, {
      // zlib requires >= 1; a declared-zero entry that emits anything still
      // fails the length equality below.
      maxOutputLength: Math.max(entry.inflated, 1),
      chunkSize: verifyChunkSize(entry),
    });
    if (inflated.length !== entry.inflated) {
      throw new Error('Office ZIP entry size does not match its compressed payload');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not match')) throw error;
    throw new Error('Office ZIP entry inflates beyond its declared uncompressed size');
  }
}

/**
 * Scratch-buffer size for one verification inflate. Bounded by the declared
 * size (never allocate more than the entry claims) and by the cap, so a
 * small payload declaring 100 MB cannot turn into a 100 MB allocation.
 */
function verifyChunkSize(entry: OfficeZipEntry): number {
  const wanted = Math.min(entry.inflated + 1, VERIFY_CHUNK_CAP_BYTES);
  return Math.max(wanted, VERIFY_CHUNK_FLOOR_BYTES);
}

type CentralEntry = { entry: OfficeZipEntry; localOffset: number };

/**
 * Parse and range-check the central directory. Every check here is free (it
 * reads fixed header fields only), so the whole archive is screened before
 * {@link inspectSafeOfficeZip} inflates a single byte.
 */
const ZIP64_EXTRA_HEADER_ID = 0x0001;
const ZIP32_SENTINEL = 0xffffffff;
const ZIP16_SENTINEL = 0xffff;

/**
 * Resolve an entry's sizes and local-header offset, following the ZIP64 extra
 * field when the 32-bit fields carry the 0xFFFFFFFF sentinel.
 *
 * The ZIP64 record packs only the fields that actually overflowed, in a fixed
 * order (uncompressed size, compressed size, local-header offset, disk number),
 * so which 8-byte slot means what depends on which 32-bit fields were
 * sentinels. Reading them positionally without that check is the classic way to
 * mis-parse this structure.
 *
 * Values are read as BigInt and rejected if they exceed the archive's own byte
 * length, which keeps everything downstream in safe integer range.
 */
function resolveEntrySizes(
  bytes: Buffer,
  recordOffset: number,
  extraStart: number,
  extraLength: number
): { compressed: number; inflated: number; localOffset: number } {
  let compressed = bytes.readUInt32LE(recordOffset + 20);
  let inflated = bytes.readUInt32LE(recordOffset + 24);
  let localOffset = bytes.readUInt32LE(recordOffset + 42);
  const diskStart = bytes.readUInt16LE(recordOffset + 34);

  const needsZip64 =
    compressed === ZIP32_SENTINEL ||
    inflated === ZIP32_SENTINEL ||
    localOffset === ZIP32_SENTINEL ||
    diskStart === ZIP16_SENTINEL;
  if (!needsZip64) return { compressed, inflated, localOffset };

  let cursor = extraStart;
  const extraEnd = extraStart + extraLength;
  while (cursor + 4 <= extraEnd) {
    const headerId = bytes.readUInt16LE(cursor);
    const size = bytes.readUInt16LE(cursor + 2);
    const body = cursor + 4;
    if (body + size > extraEnd) break;
    if (headerId !== ZIP64_EXTRA_HEADER_ID) {
      cursor = body + size;
      continue;
    }

    let field = body;
    const takeUInt64 = (): number => {
      if (field + 8 > body + size) {
        throw new Error('Invalid Office ZIP central directory: truncated ZIP64 extra field');
      }
      const value = bytes.readBigUInt64LE(field);
      field += 8;
      if (value > BigInt(bytes.length)) {
        throw new Error('Office ZIP exceeds safe archive bounds');
      }
      return Number(value);
    };

    if (inflated === ZIP32_SENTINEL) inflated = takeUInt64();
    if (compressed === ZIP32_SENTINEL) compressed = takeUInt64();
    if (localOffset === ZIP32_SENTINEL) localOffset = takeUInt64();
    return { compressed, inflated, localOffset };
  }

  throw new Error('Invalid Office ZIP central directory: missing ZIP64 extra field');
}

function readCentralDirectory(bytes: Buffer): CentralEntry[] {
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid Office ZIP: end directory not found');
  const entries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (entries > MAX_TEMPLATE_ZIP_ENTRIES || centralOffset + centralSize > bytes.length) {
    throw new Error('Office ZIP exceeds safe archive bounds');
  }

  const parsed: CentralEntry[] = [];
  let offset = centralOffset;
  let inflatedTotal = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('Invalid Office ZIP central directory');
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const filenameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const extraStart = offset + 46 + filenameLength;
    if (extraStart + extraLength > bytes.length) {
      throw new Error('Invalid Office ZIP central directory');
    }
    // A 0xFFFFFFFF field is a ZIP64 sentinel meaning "the real value lives in
    // the ZIP64 extra field". These used to be rejected outright, which is
    // wrong: the spec permits ZIP64 for any archive, and some producers emit it
    // unconditionally, so perfectly ordinary small Office files were refused.
    const sizes = resolveEntrySizes(bytes, offset, extraStart, extraLength);
    const { compressed, inflated, localOffset } = sizes;
    if ((flags & FLAG_ENCRYPTED) !== 0) {
      throw new Error('Encrypted Office templates are not supported');
    }
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
      throw new Error(`Unsupported Office ZIP compression method ${method}`);
    }
    inflatedTotal += inflated;
    if (
      inflatedTotal > MAX_TEMPLATE_INFLATED_BYTES ||
      (inflated > 1024 * 1024 &&
        compressed > 0 &&
        inflated / compressed > MAX_TEMPLATE_COMPRESSION_RATIO)
    ) {
      throw new Error('Office ZIP exceeds safe inflated-size bounds');
    }
    // Inverted ratio: understating the uncompressed size is the free bypass of
    // the forward ratio check above, so reject it outright before inflating.
    if (compressed > maxPlausibleDeflatedSize(inflated)) {
      throw new Error('Office ZIP declares an implausibly small uncompressed size');
    }
    const nameStart = offset + 46;
    const nameEnd = nameStart + filenameLength;
    if (nameEnd > bytes.length) {
      throw new Error('Invalid Office ZIP central directory');
    }
    const path = new TextDecoder().decode(bytes.subarray(nameStart, nameEnd));
    assertSafeZipPath(path);
    parsed.push({ entry: { path, compressed, inflated, method }, localOffset });
    offset = nameEnd + extraLength + commentLength;
  }

  // Everything above trusts the EOCD entry count to decide how many records to
  // validate. PizZip does not: it walks consecutive central-directory records
  // and tolerates a count that disagrees. So an archive declaring one entry
  // while carrying two had its second entry validated by nobody and extracted
  // by PizZip anyway, which is a complete bypass of the size bounds.
  //
  // Both halves are needed. The attacker controls the declared size as well as
  // the count, so requiring the region to be consumed exactly is not enough on
  // its own; the record that matters is whichever one sits at `offset`.
  if (offset !== centralOffset + centralSize) {
    throw new Error('Invalid Office ZIP central directory: declared size does not match entries');
  }
  if (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === CENTRAL_SIGNATURE) {
    throw new Error('Invalid Office ZIP central directory: more entries than declared');
  }

  return parsed;
}

/**
 * Bound ZIP inflation and inspect central-directory names before any XML parser
 * expands an Office archive. ZIP64 entries are followed into their extra field
 * rather than refused, since the spec permits ZIP64 at any size and some
 * producers emit it unconditionally.
 *
 * Two passes, in this order:
 *
 * 1. {@link readCentralDirectory} applies every check that costs nothing —
 *    entry count, encryption, compression method, path safety, the 100 MB
 *    declared-total budget, and both compression-ratio checks. An archive that
 *    fails any of them is rejected without inflating a byte.
 * 2. {@link assertDeclaredSizeIsReal} then proves each surviving deflated entry
 *    really produces the size it declared, so the budget enforced in pass 1 is
 *    a budget on bytes that can actually be produced rather than on numbers the
 *    uploader chose. Pass 1 has already capped the declared total, so the total
 *    inflation performed here can never exceed {@link MAX_TEMPLATE_INFLATED_BYTES}.
 */
export function inspectSafeOfficeZip(bytes: Buffer): OfficeZipInspection {
  const parsed = readCentralDirectory(bytes);
  for (const { entry, localOffset } of parsed) {
    assertDeclaredSizeIsReal(bytes, entry, localOffset);
  }
  return { entries: parsed.map(({ entry }) => entry) };
}

export function assertSafeOfficeZip(bytes: Buffer): OfficeZipInspection {
  return inspectSafeOfficeZip(bytes);
}
