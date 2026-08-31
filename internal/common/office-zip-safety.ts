export const MAX_TEMPLATE_INFLATED_BYTES = 100 * 1024 * 1024;
export const MAX_TEMPLATE_ZIP_ENTRIES = 10_000;
const MAX_TEMPLATE_COMPRESSION_RATIO = 200;

/**
 * Bound ZIP inflation before any XML parser expands an Office archive.
 * ZIP64 archives are rejected because their 64-bit sizes are not represented
 * in the fixed central-directory fields this preflight intentionally trusts.
 */
export function assertSafeOfficeZip(bytes: Buffer): void {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === eocdSignature) {
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

  let offset = centralOffset;
  let inflatedTotal = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== centralSignature) {
      throw new Error('Invalid Office ZIP central directory');
    }
    const compressed = bytes.readUInt32LE(offset + 20);
    const inflated = bytes.readUInt32LE(offset + 24);
    if (compressed === 0xffffffff || inflated === 0xffffffff) {
      throw new Error('ZIP64 Office templates are not supported');
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
    const filenameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    offset += 46 + filenameLength + extraLength + commentLength;
  }
}
