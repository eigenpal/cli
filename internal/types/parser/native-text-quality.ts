import { z } from 'zod';

/**
 * Per-page diagnosis of PDF native (embedded) text.
 *
 * Identifies detectable textual anomalies in the extracted Unicode string
 * (empty pages, U+FFFD, lone UTF-16 surrogates, forbidden controls,
 * unassigned/noncharacter code points, heavy private-use). It cannot prove that valid-looking glyph
 * mappings are semantically correct, and it never treats a literal '?'
 * (U+003F) as a decoding failure. Reasons never claim a missing ToUnicode
 * CMap — that is not observable from the Unicode text after extraction.
 */

export const NativeTextQualityStatusSchema = z.enum(['clean', 'empty', 'suspect']);
export type NativeTextQualityStatus = z.infer<typeof NativeTextQualityStatusSchema>;

export const NativeTextQualityReasonSchema = z.enum([
  'empty',
  'replacement-character',
  'lone-surrogate',
  'forbidden-control',
  'unassigned',
  'noncharacter',
  'private-use',
]);
export type NativeTextQualityReason = z.infer<typeof NativeTextQualityReasonSchema>;

export const NativeTextQualityCountsSchema = z.object({
  codePoints: z.number().int().nonnegative(),
  nonWhitespace: z.number().int().nonnegative(),
  replacement: z.number().int().nonnegative(),
  loneSurrogate: z.number().int().nonnegative(),
  forbiddenControl: z.number().int().nonnegative(),
  unassigned: z.number().int().nonnegative(),
  noncharacter: z.number().int().nonnegative(),
  privateUse: z.number().int().nonnegative(),
});
export type NativeTextQualityCounts = z.infer<typeof NativeTextQualityCountsSchema>;

export const NativeTextQualityProfileSchema = z.object({
  replacementRatio: z.number().nonnegative(),
  loneSurrogateRatio: z.number().nonnegative(),
  forbiddenControlRatio: z.number().nonnegative(),
  unassignedRatio: z.number().nonnegative(),
  noncharacterRatio: z.number().nonnegative(),
  privateUseRatio: z.number().nonnegative(),
});
export type NativeTextQualityProfile = z.infer<typeof NativeTextQualityProfileSchema>;

export const NativeTextQualitySchema = z.object({
  status: NativeTextQualityStatusSchema,
  reasons: z.array(NativeTextQualityReasonSchema),
  counts: NativeTextQualityCountsSchema,
  profile: NativeTextQualityProfileSchema,
});
export type NativeTextQuality = z.infer<typeof NativeTextQualitySchema>;

const REPLACEMENT = 0xfffd;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const UNASSIGNED = /\p{Cn}/u;
const PRIVATE_USE = /\p{Co}/u;
const WHITESPACE = /\s/u;

/** C0 (except TAB/LF/CR), DEL, and C1 controls. */
function isForbiddenControl(codePoint: number): boolean {
  if (codePoint === TAB || codePoint === LF || codePoint === CR) return false;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/** Unicode noncharacters: U+FDD0–U+FDEF and any plane's U+nFFFE / U+nFFFF. */
function isNoncharacter(codePoint: number): boolean {
  if (codePoint >= 0xfdd0 && codePoint <= 0xfdef) return true;
  const low = codePoint & 0xffff;
  return low === 0xfffe || low === 0xffff;
}

function isSurrogateCodeUnit(codePoint: number): boolean {
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Diagnose one page of native-extracted text by iterating Unicode code points.
 *
 * Empty: no non-whitespace code points (and no other suspect signals).
 * Suspect: any U+FFFD, lone UTF-16 surrogate, forbidden C0/C1 control (except
 * TAB/LF/CR), category Cn, or noncharacter. Private-use (Co) is suspect only when there are at least 4
 * PUA code points and they are at least 5% of non-whitespace.
 *
 * A literal ASCII '?' is a valid code point and is not a replacement-character
 * signal. Valid-looking but wrong CMap mappings (including Identity-H lucky
 * hits) cannot be distinguished from legitimate text and are reported clean.
 */
export function assessNativeTextQuality(text: string): NativeTextQuality {
  let codePoints = 0;
  let nonWhitespace = 0;
  let replacement = 0;
  let loneSurrogate = 0;
  let forbiddenControl = 0;
  let unassigned = 0;
  let noncharacter = 0;
  let privateUse = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    codePoints += 1;
    if (codePoint === REPLACEMENT) replacement += 1;
    if (isSurrogateCodeUnit(codePoint)) loneSurrogate += 1;
    if (isForbiddenControl(codePoint)) forbiddenControl += 1;
    if (UNASSIGNED.test(char)) unassigned += 1;
    if (isNoncharacter(codePoint)) noncharacter += 1;
    if (PRIVATE_USE.test(char)) privateUse += 1;
    if (!WHITESPACE.test(char)) nonWhitespace += 1;
  }

  const privateUseSuspect = privateUse >= 4 && privateUse * 20 >= nonWhitespace;
  const reasons: NativeTextQualityReason[] = [];
  if (nonWhitespace === 0) reasons.push('empty');
  if (replacement > 0) reasons.push('replacement-character');
  if (loneSurrogate > 0) reasons.push('lone-surrogate');
  if (forbiddenControl > 0) reasons.push('forbidden-control');
  if (unassigned > 0) reasons.push('unassigned');
  if (noncharacter > 0) reasons.push('noncharacter');
  if (privateUseSuspect) reasons.push('private-use');

  const suspect =
    replacement > 0 ||
    loneSurrogate > 0 ||
    forbiddenControl > 0 ||
    unassigned > 0 ||
    noncharacter > 0 ||
    privateUseSuspect;

  const status: NativeTextQualityStatus = suspect
    ? 'suspect'
    : nonWhitespace === 0
      ? 'empty'
      : 'clean';

  return {
    status,
    reasons,
    counts: {
      codePoints,
      nonWhitespace,
      replacement,
      loneSurrogate,
      forbiddenControl,
      unassigned,
      noncharacter,
      privateUse,
    },
    profile: {
      replacementRatio: ratio(replacement, nonWhitespace),
      loneSurrogateRatio: ratio(loneSurrogate, nonWhitespace),
      forbiddenControlRatio: ratio(forbiddenControl, codePoints),
      unassignedRatio: ratio(unassigned, nonWhitespace),
      noncharacterRatio: ratio(noncharacter, nonWhitespace),
      privateUseRatio: ratio(privateUse, nonWhitespace),
    },
  };
}

export function pageNeedsOcrFallback(quality: NativeTextQuality): boolean {
  return quality.status === 'empty' || quality.status === 'suspect';
}
