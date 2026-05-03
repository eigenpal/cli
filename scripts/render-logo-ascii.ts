#!/usr/bin/env bun
/**
 * One-shot: rasterize the Eigenpal logo SVG paths into halfblock ASCII
 * art. Run once, paste the output into `src/lib/logo.ts`. Not part of
 * the build — invoked manually if the brand mark changes.
 *
 *   bun packages/cli/scripts/render-logo-ascii.ts [--cells <width>]
 */

import { Canvas, Path2D } from '@napi-rs/canvas';

const LOGO_PATHS = [
  'M32.364 45.8825C35.29 47.5714 37.0926 50.6931 37.0926 54.0715V68.5491C37.0926 71.1596 34.9756 73.276 32.3651 73.2766C29.7542 73.2766 27.6376 71.16 27.6376 68.5491V46.5581C27.6376 45.7883 26.8043 45.3072 26.1376 45.6921L7.09088 56.6887C4.83001 57.9931 1.9397 57.218 0.6344 54.9574C-0.670978 52.6965 0.10259 49.8042 2.36336 48.4986L14.8956 41.2595C17.8209 39.5698 21.4254 39.5692 24.3513 41.2579L32.364 45.8825Z',
  'M0.6344 18.3191C1.93969 16.0585 4.82996 15.2833 7.09088 16.5879L27.6376 28.4482V28.4436L41.8202 36.6337L41.8178 36.636L62.3623 48.4986C64.6233 49.8041 65.3989 52.6963 64.0935 54.9574C63.0062 56.8407 60.8194 57.6884 58.812 57.1665L1.35922 23.9954C-0.0945812 22.5178 -0.452422 20.2016 0.6344 18.3191Z',
  'M32.3651 0C34.9756 0.000564347 37.0926 2.11693 37.0926 4.72752V26.7138C37.0926 27.4836 37.926 27.9647 38.5927 27.5798L51.4483 20.1566L50.4788 18.4784C49.7749 17.2591 50.6015 15.7268 52.007 15.6461L66.8959 14.7943C68.423 14.707 69.4171 16.3738 68.6133 17.6751L60.661 30.5419C59.9089 31.7588 58.1308 31.7322 57.4154 30.4934L56.1758 28.3467L50.7688 31.4665C47.8438 33.1542 44.2407 33.1537 41.3161 31.4653L32.3653 26.2978C29.4398 24.6088 27.6376 21.4874 27.6376 18.1094V4.72752C27.6376 2.11658 29.7542 0 32.3651 0Z',
];

const SVG_W = 69;
const SVG_H = 74;

const cellsArg = process.argv.indexOf('--cells');
const cellsW = cellsArg >= 0 ? Number(process.argv[cellsArg + 1]) : 18;
const rowsArg = process.argv.indexOf('--rows');
const cellsH = rowsArg >= 0 ? Number(process.argv[rowsArg + 1]) : null;

// Pixel grid: 1 char-col = 1 pixel wide, 1 char-row = 2 pixels tall (halfblock).
// Terminal cells are ~2:1 (h:w) — without compensation, output reads as 2x too
// tall. To preserve original SVG aspect visually, default rows = cellsW * (H/W) / 2.
const pxW = cellsW * 2; // 2× supersample for sharper edges
const visualRows = cellsH ?? Math.round((SVG_H / SVG_W) * cellsW * 0.5);
const pxH = visualRows * 4; // 2× supersample × 2 pixels per cell-row

const canvas = new Canvas(pxW, pxH);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, pxW, pxH);
ctx.scale(pxW / SVG_W, pxH / SVG_H);
ctx.fillStyle = '#000000';
for (const d of LOGO_PATHS) ctx.fill(new Path2D(d));

const { data } = ctx.getImageData(0, 0, pxW, pxH);
const isFilled = (x: number, y: number): boolean => {
  if (x < 0 || y < 0 || x >= pxW || y >= pxH) return false;
  const idx = (y * pxW + x) * 4;
  // Path is filled black on white background; treat dark pixels as filled.
  return data[idx] < 128;
};

// Downsample the supersampled pixel grid into character cells: each cell is
// 2 (px wide) × 4 (px tall). Top half-pixel = 2x2 block, bottom half = same.
// A half is "filled" if ≥2 of its 4 sub-pixels are filled.
const samplePx = 2;
let out = '';
for (let row = 0; row < pxH; row += samplePx * 2) {
  let line = '';
  for (let col = 0; col < pxW; col += samplePx) {
    const countFilled = (rOffset: number): number => {
      let n = 0;
      for (let dy = 0; dy < samplePx; dy++) {
        for (let dx = 0; dx < samplePx; dx++) {
          if (isFilled(col + dx, row + rOffset + dy)) n++;
        }
      }
      return n;
    };
    const topFilled = countFilled(0) >= 2;
    const botFilled = countFilled(samplePx) >= 2;
    if (topFilled && botFilled) line += '█';
    else if (topFilled) line += '▀';
    else if (botFilled) line += '▄';
    else line += ' ';
  }
  out += line.replace(/\s+$/, '') + '\n';
}

process.stdout.write(out);
