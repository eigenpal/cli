/**
 * Eigenpal brand mark + wordmark, hand-rendered to halfblock ASCII once and
 * inlined here. Deps-free — printed verbatim by `eigenpal` (no args).
 * Tinted via picocolors when stdout is a TTY; respects `NO_COLOR`
 * automatically.
 *
 * To regenerate after a brand-mark change: run
 *   bun packages/cli/scripts/render-logo-ascii.ts --cells 18
 *   bun x figlet -f 'ANSI Shadow' EIGENPAL
 * and paste the output into the constants below.
 */

import { pc } from './ui';

// 22-cell × 12-line halfblock rendering of the Eigenpal mark — sits to
// the RIGHT of the wordmark on the banner. Halfblock characters (▀ ▄)
// preserve the curved/diagonal arms of the asterisk; the drop-shadow
// below adds visual depth without changing brand colour.
//
// Regenerated via:
//   bun packages/cli/scripts/render-logo-ascii.ts --cells 22
const LOGO_WIDTH = 22;
const LOGO_LINES: readonly string[] = [
  '         ██▄          ',
  '         ███          ',
  ' ▄▄      ███    ▄▄▄▄▄▄',
  '████▄▄   ███   ▄█████▀',
  '  ▀█████▄ ▀▀▄███████  ',
  '     ▀▀████▄▄▀▀▀      ',
  '    ▄▄▄▄▀▀█████▄      ',
  ' ▄▄████▀▀█▄ ▀█████▄▄  ',
  '████▀▀   ███   ▀▀████ ',
  ' ▀       ███       ▀  ',
  '         ███          ',
  '         ██▀          ',
];

// figlet "ANSI Shadow" font — gives the wordmark a clean 8-bit feel.
const WORDMARK_LINES: readonly string[] = [
  '███████╗██╗ ██████╗ ███████╗███╗   ██╗██████╗  █████╗ ██╗     ',
  '██╔════╝██║██╔════╝ ██╔════╝████╗  ██║██╔══██╗██╔══██╗██║     ',
  '█████╗  ██║██║  ███╗█████╗  ██╔██╗ ██║██████╔╝███████║██║     ',
  '██╔══╝  ██║██║   ██║██╔══╝  ██║╚██╗██║██╔═══╝ ██╔══██║██║     ',
  '███████╗██║╚██████╔╝███████╗██║ ╚████║██║     ██║  ██║███████╗',
  '╚══════╝╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝╚═╝     ╚═╝  ╚═╝╚══════╝',
];
const WORDMARK_WIDTH = WORDMARK_LINES[0].length;

const TAGLINE = 'AI workflows, evals, and experiments';
const LEFT_PAD = '  '; // breathing room before the wordmark
const GUTTER = '    '; // space between wordmark and logo columns

// "ANSI Shadow" treatment for the brand mark — same trick figlet uses on
// the wordmark. Each filled logo cell casts an outline shadow:
//   • bottom edge  → '═' at (r+1, c)
//   • right edge   → '║' at (r, c+1)
//   • bottom-right → '╝' at (r+1, c+1)
// Edges are only drawn where the fill terminates on that side (i.e. the
// cell that would receive the edge isn't itself a fill). When two edges
// intersect we promote to the appropriate corner so the trace reads as
// a continuous outline. Render area grows by 1 col and 1 row.
const SHADOW_DX = 1;
const SHADOW_DY = 1;
const RENDERED_LOGO_WIDTH = LOGO_WIDTH + SHADOW_DX;
const RENDERED_LOGO_ROWS = LOGO_LINES.length + SHADOW_DY;

type Cell = { ch: string; kind: 'fill' | 'shadow' | null };

function isFill(r: number, c: number): boolean {
  if (r < 0 || r >= LOGO_LINES.length) return false;
  const line = LOGO_LINES[r];
  if (c < 0 || c >= line.length) return false;
  const ch = line[c];
  return !!ch && ch !== ' ';
}

// Only full blocks cast an outline. Halfblocks (▀ ▄) only occupy half a
// terminal cell, so attaching a full-cell box-drawing edge to them looks
// detached. Gating on `█` keeps the trace flush against the chunky body
// of the brand mark and leaves the diagonal arms uncluttered.
function isFullBlock(r: number, c: number): boolean {
  if (r < 0 || r >= LOGO_LINES.length) return false;
  const line = LOGO_LINES[r];
  return c >= 0 && c < line.length && line[c] === '█';
}

// Merge two shadow chars sharing a cell into the corner they imply.
// Order of operands doesn't matter; missing combinations fall back to
// the last write.
function mergeShadow(a: string, b: string): string {
  const k = [a, b].sort().join('|');
  switch (k) {
    case '═|║':
      return '╝';
    case '═|╗':
      return '╗';
    case '═|╔':
      return '╦';
    case '║|╚':
      return '╠';
    case '═|╝':
    case '║|╝':
      return '╝';
    default:
      return b;
  }
}

function renderLogoWithShadow(): string[] {
  const grid: Cell[][] = Array.from({ length: RENDERED_LOGO_ROWS }, () =>
    Array.from({ length: RENDERED_LOGO_WIDTH }, () => ({ ch: ' ', kind: null }))
  );

  // Place fills first.
  for (let r = 0; r < LOGO_LINES.length; r++) {
    const line = LOGO_LINES[r];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (!ch || ch === ' ') continue;
      grid[r][c] = { ch, kind: 'fill' };
    }
  }

  // Then trace the shadow outline. Each fill emits up to three shadow
  // cells (bottom, right, bottom-right corner) — only when the
  // neighbour in that direction is empty.
  const setShadow = (r: number, c: number, ch: string) => {
    if (r < 0 || r >= RENDERED_LOGO_ROWS) return;
    if (c < 0 || c >= RENDERED_LOGO_WIDTH) return;
    const cur = grid[r][c];
    if (cur.kind === 'fill') return; // never overwrite the main mark
    if (cur.kind === 'shadow') {
      grid[r][c] = { ch: mergeShadow(cur.ch, ch), kind: 'shadow' };
    } else {
      grid[r][c] = { ch, kind: 'shadow' };
    }
  };

  const lastRow = LOGO_LINES.length - 1;
  for (let r = 0; r < LOGO_LINES.length; r++) {
    const line = LOGO_LINES[r];
    for (let c = 0; c < line.length; c++) {
      if (!isFullBlock(r, c)) continue;
      const below = isFill(r + 1, c);
      const right = isFill(r, c + 1);
      const diag = isFill(r + 1, c + 1);
      // Skip the bottom-edge trace when this fill is on the last row of
      // the logo — the bottom tip of the asterisk would otherwise cast an
      // orphan `══` into the synthesized extra row, detached from the
      // body of the mark.
      const onLastRow = r === lastRow;
      if (!below && !onLastRow) setShadow(r + 1, c, '═');
      if (!right) setShadow(r, c + 1, '║');
      if (!below && !right && !diag && !onLastRow) {
        setShadow(r + 1, c + 1, '╝');
      }
    }
  }

  return grid.map((row) => {
    // All logo cells (fill + shadow outline) render in green — this
    // mirrors the wordmark, where the figlet shadow chars share the
    // same colour as the fill.
    let out = '';
    let buf = '';
    let inGreen = false;
    const flush = () => {
      if (!buf) return;
      out += inGreen ? pc.green(buf) : buf;
      buf = '';
    };
    for (const cell of row) {
      const wantGreen = cell.kind !== null;
      if (wantGreen !== inGreen) {
        flush();
        inGreen = wantGreen;
      }
      buf += cell.ch;
    }
    flush();
    return out;
  });
}

/** Printable banner: WHITE wordmark on the left, GREEN logo with a soft
 *  GRAY drop-shadow on the right. The taller logo column (rows + 1 for
 *  shadow) sets the row count; the shorter wordmark is vertically
 *  centered against it. */
export function getBanner(): string {
  const logoRows = renderLogoWithShadow();
  const rowCount = logoRows.length;
  const wmTopPad = Math.floor((rowCount - WORDMARK_LINES.length) / 2);
  const blankWordmark = ' '.repeat(WORDMARK_WIDTH);
  const totalWidth = LEFT_PAD.length + WORDMARK_WIDTH + GUTTER.length + RENDERED_LOGO_WIDTH;

  const lines: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const wmIndex = i - wmTopPad;
    const wmLine =
      wmIndex >= 0 && wmIndex < WORDMARK_LINES.length ? WORDMARK_LINES[wmIndex] : blankWordmark;
    lines.push(LEFT_PAD + pc.white(wmLine) + GUTTER + logoRows[i]);
  }
  lines.push('');
  const taglinePad = Math.max(0, Math.floor((totalWidth - TAGLINE.length) / 2));
  lines.push(' '.repeat(taglinePad) + pc.dim(TAGLINE));
  return lines.join('\n');
}

/** Compact one-line variant for tight headers. */
export function getCompactBanner(): string {
  return `${pc.green('●')} ${pc.bold('EIGENPAL')} ${pc.dim('—')} ${pc.dim(TAGLINE)}`;
}
