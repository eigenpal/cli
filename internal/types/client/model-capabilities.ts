/** Shared capability inference used by native AI clients and parser configuration checks.
 * Custom endpoints still require a live document probe to verify image support.
 */
const NON_VISION_PATTERNS = [
  'gpt-3.5',
  'gpt-3',
  'davinci',
  'curie',
  'babbage',
  'ada',
  'text-',
  'code-',
  'claude-2.0',
  'claude-2.1',
  'claude-instant',
];
export function modelSupportsVision(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return !NON_VISION_PATTERNS.some((pattern) => lower.includes(pattern));
}
