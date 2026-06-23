import { sha256 } from '@noble/hashes/sha2.js';

const UNIT_INTERVAL_DENOMINATOR = BigInt(1) << BigInt(53);

/**
 * Map any string to a deterministic pseudo-random value in [0, 1).
 *
 * Uses SHA-256 (first 53 bits / 2^53) so nearby or sequential ids do not
 * cluster in the unit interval.
 */
export function stringToUnitInterval(value: string): number {
  const digest = sha256(new TextEncoder().encode(value));
  const n =
    (BigInt(digest[0]!) << BigInt(45)) |
    (BigInt(digest[1]!) << BigInt(37)) |
    (BigInt(digest[2]!) << BigInt(29)) |
    (BigInt(digest[3]!) << BigInt(21)) |
    (BigInt(digest[4]!) << BigInt(13)) |
    (BigInt(digest[5]!) << BigInt(5)) |
    (BigInt(digest[6]!) >> BigInt(3));
  return Number(n) / Number(UNIT_INTERVAL_DENOMINATOR);
}

/** Stable per-tenant sampling rank for a run. Same run always gets the same rank. */
export function runSampleRank(tenantId: string, runId: string): number {
  return stringToUnitInterval(`${tenantId}:${runId}`);
}

/** True when `sampleRate` is unset (review all) or the run rank falls below the threshold. */
export function isRunInSampleRank(sampleRank: number, sampleRate: number | null): boolean {
  if (sampleRate == null) return true;
  return sampleRank < sampleRate;
}
