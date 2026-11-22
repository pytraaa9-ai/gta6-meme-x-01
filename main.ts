// GTA 6 meme — the entry program (Node 22, standard library only).
// The meme is drawn from scratch, in code: a Vice City sunset, the white
// make.fun ghost mascot holding a money bag, and the joke in big bitmap
// type. No network, no installs, no assets: the PNG encoder, the 5x7 font
// and every shape live in this file, so the output is byte-identical on
// every run.
//
// Run it:  node main.ts            (writes /output/meme.png)
//   or:    MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The joke: GTA 6 took 13 years to arrive (GTA V, 2013 -> GTA 6, 2026).
// While everyone waited, an AI agent on make.fun was already earning real
// money. The ghost is make.fun's mascot; its name is in the picture and in
// the bottom line, as the bounty requires.

import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1200;
const H = 675;

// ---------------------------------------------------------------------------
// Pixel buffer (RGB) and drawing primitives
// ---------------------------------------------------------------------------

const px = new Uint8Array(W * H * 3);

type RGB = [number, number, number];

function setPixel(x: number, y: number, c: RGB): void {
  const xi = x | 0;
  const yi = y | 0;
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = (yi * W + xi) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x | 0);
  const y0 = Math.max(0, y | 0);
  const x1 = Math.min(W, (x + w) | 0);
  const y1 = Math.min(H, (y + h) | 0);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPixel(xx, yy, c);
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(x, y, c);
    }
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPixel(x, y, c);
    }
  }
}

// Thick line (Bresenham + disc brush).
function drawLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const r = Math.max(1, w / 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(x0 + dx * t, y0 + dy * t, r, c);
  }
}

// Scanline polygon fill (even-odd rule).
function fillPolygon(points: Array<[number, number]>, c: RGB): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(H - 1, Math.floor(maxY)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) setPixel(x, y, c);
    }
  }
}

function strokePolygon(points: Array<[number, number]>, w: number, c: RGB): void {
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    drawLine(x0, y0, x1, y1, w, c);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(c0: RGB, c1: RGB, t: number): RGB {
  return [Math.round(lerp(c0[0], c1[0], t)), Math.round(lerp(c0[1], c1[1], t)), Math.round(lerp(c0[2], c1[2], t))];
}

// Vertical gradient over [y0, y1] through colour stops.
function vGradient(y0: number, y1: number, stops: Array<[number, RGB]>): void {
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / (y1 - y0);
    let c: RGB = stops[stops.length - 1][1];
    for (let s = 0; s < stops.length - 1; s++) {
      const [t0, c0] = stops[s];
      const [t1, c1] = stops[s + 1];
      if (t >= t0 && t <= t1) {
        c = lerpColor(c0, c1, (t - t0) / (t1 - t0));
        break;
      }
    }
    for (let x = 0; x < W; x++) setPixel(x, y, c);
  }
}

// Deterministic pseudo-random (fixed seed): skyline + windows.
let seed = 20261122;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font. Each glyph is 7 rows of 5 bits (MSB = leftmost column).
// ---------------------------------------------------------------------------

const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 6, 8, 16, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '?': [14, 17, 1, 6, 4, 0, 4],
  '!': [4, 4, 4, 4, 4, 0, 4],
  '.': [0, 0, 0, 0, 0, 12, 12],
  ',': [0, 0, 0, 0, 12, 4, 8],
  "'": [4, 4, 8, 0, 0, 0, 0],
  $: [4, 15, 20, 14, 5, 30, 4],
  ':': [0, 12, 12, 0, 12, 12, 0],
  '/': [1, 2, 2, 4, 8, 8, 16],
  '-': [0, 0, 0, 14, 0, 0, 0],
  '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8],
  '%': [25, 26, 2, 4, 8, 11, 19],
};

function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale; // 5px glyph + 1px gap, no trailing gap
}

function drawGlyph(ch: string, x: number, y: number, scale: number, c: RGB): void {
  const rows = FONT[ch] ?? FONT['?'];
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 5; col++) {
      if (rows[r] & (1 << (4 - col))) {
        fillRect(x + col * scale, y + r * scale, scale, scale, c);
      }
    }
  }
}

// Draw text centred on cx, with a dark outline (classic meme type).
function drawTextCentred(text: string, cx: number, y: number, scale: number, fill: RGB, outline: RGB): void {
  const w = textWidth(text, scale);
  const x0 = Math.round(cx - w / 2);
  const o = Math.max(2, Math.round(scale / 3));
  for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]] as const) {
    let x = x0;
    for (const ch of text) {
      drawGlyph(ch, x + dx, y + dy, scale, outline);
      x += 6 * scale;
    }
  }
  let x = x0;
  for (const ch of text) {
    drawGlyph(ch, x, y, scale, fill);
    x += 6 * scale;
  }
}

// ---------------------------------------------------------------------------
// PNG encoder (RGB, non-interlaced, filter 0). Standard library only.
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc);
  return out;
}

function encodePNG(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scene: Vice City sunset, make.fun ghost, the joke
// ---------------------------------------------------------------------------

const SKY_STOPS: Array<[number, RGB]> = [
  [0, [22, 10, 46]],
  [0.35, [91, 42, 134]],
  [0.62, [193, 59, 138]],
  [0.85, [255, 122, 61]],
  [1, [255, 179, 71]],
];

function skyColorAt(y: number): RGB {
  const t = Math.min(1, Math.max(0, y / 520));
  for (let s = 0; s < SKY_STOPS.length - 1; s++) {
    const [t0, c0] = SKY_STOPS[s];
    const [t1, c1] = SKY_STOPS[s + 1];
    if (t >= t0 && t <= t1) return lerpColor(c0, c1, (t - t0) / (t1 - t0));
  }
  return SKY_STOPS[SKY_STOPS.length - 1][1];
}

const DARK: RGB = [26, 11, 46];
const BLACK: RGB = [17, 17, 17];
const WHITE: RGB = [255, 255, 255];
const GOLD: RGB = [255, 217, 59];

function drawSun(cx: number, cy: number, r: number): void {
  // Banded disc: yellow core, orange rim.
  fillCircle(cx, cy, r, [255, 167, 81]);
  fillCircle(cx, cy, Math.round(r * 0.62), [255, 226, 89]);
  // Synthwave slits across the lower half, in the sky's own colour.
  const slits: Array<[number, number]> = [[0.18, 7], [0.38, 9], [0.58, 11]];
  for (const [frac, h] of slits) {
    const y = cy + r * frac;
    const half = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
    fillRect(Math.round(cx - half), Math.round(y - h / 2), Math.round(half * 2), h, skyColorAt(y));
  }
}

function drawSkyline(): void {
  let x = -10;
  while (x < W) {
    const w = 42 + rnd() * 42;
    const h = 55 + rnd() * 115;
    const top = 520 - h;
    fillRect(Math.round(x), Math.round(top), Math.round(w), Math.round(h), DARK);
    // Antenna on some towers.
    if (rnd() < 0.3) {
      drawLine(x + w / 2, top, x + w / 2, top - 22, 3, DARK);
      fillCircle(x + w / 2, top - 24, 3, [255, 60, 60]);
    }
    // Lit windows.
    const cols = Math.floor(w / 14);
    const rows = Math.floor(h / 20);
    for (let cxi = 0; cxi < cols; cxi++) {
      for (let ryi = 0; ryi < rows; ryi++) {
        if (rnd() < 0.35) {
          fillRect(Math.round(x + 6 + cxi * 14), Math.round(top + 10 + ryi * 20), 5, 7, [255, 217, 120]);
        }
      }
    }
    x += w + 6 + rnd() * 18;
  }
}

function drawSea(): void {
  for (let y = 520; y < H; y++) {
    const t = (y - 520) / (H - 520);
    const c = lerpColor([36, 27, 77], [18, 8, 46], t);
    for (let x = 0; x < W; x++) setPixel(x, y, c);
  }
}

function drawPalm(baseX: number, topX: number, flip: boolean): void {
  drawLine(baseX, H, topX, 395, 15, [18, 8, 46]);
  fillCircle(topX, 395, 11, [18, 8, 46]); // crown anchoring the fronds
  // Each frond is a quadratic curve: out from the crown, then drooping down.
  const fronds: Array<[[number, number], [number, number]]> = flip
    ? [[[1030, 300], [1005, 360]], [[1085, 285], [1075, 350]], [[1140, 290], [1150, 355]], [[1190, 310], [1200, 365]], [[1200, 345], [1195, 405]]]
    : [[[170, 300], [195, 360]], [[115, 285], [125, 350]], [[60, 290], [50, 355]], [[10, 310], [0, 365]], [[0, 345], [5, 405]]];
  for (const [[cx, cy], [ex, ey]] of fronds) {
    let px0 = topX;
    let py0 = 395;
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      const x = (1 - t) * (1 - t) * topX + 2 * (1 - t) * t * cx + t * t * ex;
      const y = (1 - t) * (1 - t) * 395 + 2 * (1 - t) * t * cy + t * t * ey;
      drawLine(px0, py0, x, y, 10, [18, 8, 46]);
      px0 = x;
      py0 = y;
    }
  }
}

function ghostOutline(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  // Dome: left to right over the top (centre 600,310, radius 100).
  for (let a = 180; a >= 0; a -= 6) {
    const rad = (a * Math.PI) / 180;
    pts.push([600 + 100 * Math.cos(rad), 310 - 100 * Math.sin(rad)]);
  }
  // Right side down, wavy hem, left side up.
  pts.push([700, 440]);
  const hem: Array<[number, number]> = [
    [675, 466], [650, 440], [625, 466], [600, 440], [575, 466], [550, 440], [525, 466], [500, 440],
  ];
  pts.push(...hem);
  return pts;
}

function drawGhost(): void {
  const body = ghostOutline();
  fillPolygon(body, WHITE);
  strokePolygon(body, 4, [43, 16, 85]);
  // Eyes.
  fillEllipse(565, 305, 13, 19, BLACK);
  fillEllipse(635, 305, 13, 19, BLACK);
  // Smile: lower arc of small discs.
  for (let a = 25; a <= 155; a += 6) {
    const rad = (a * Math.PI) / 180;
    fillCircle(600 + 26 * Math.cos(rad), 338 + 26 * Math.sin(rad), 4, BLACK);
  }
  // Cheeks.
  fillCircle(540, 342, 11, [255, 179, 199]);
  fillCircle(660, 342, 11, [255, 179, 199]);
}

function drawCoin(cx: number, cy: number, r: number): void {
  fillCircle(cx, cy, r, [200, 155, 30]);
  fillCircle(cx, cy, r - 2, GOLD);
  // Plain glyph, no outline: an outlined $ at this size fattens into a blob.
  drawGlyph('$', cx - 5, cy - 7, 2, [122, 91, 0]);
}

function drawMoneyBag(): void {
  // Tied neck, then the sack.
  fillPolygon([[738, 388], [772, 388], [762, 414], [748, 414]], [30, 122, 61]);
  fillCircle(755, 452, 52, [47, 174, 95]);
  fillCircle(755, 452, 44, [47, 174, 95]);
  drawGlyph('$', 745, 438, 4, WHITE);
}

function drawScene(): void {
  vGradient(0, 520, SKY_STOPS);
  drawSun(320, 280, 95);
  drawSkyline();
  drawSea();
  drawPalm(60, 115, false);
  drawPalm(1140, 1085, true);
  drawGhost();
  drawMoneyBag();
  drawCoin(472, 462, 16);
  drawCoin(838, 488, 15);
  drawTextCentred('WAITED 13 YEARS FOR GTA 6?', 600, 36, 7, WHITE, BLACK);
  drawTextCentred("MY AGENT'S ALREADY EARNING", 600, 520, 7, WHITE, BLACK);
  drawTextCentred('ON MAKE.FUN', 600, 585, 9, GOLD, BLACK);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(out, { recursive: true });
drawScene();
const png = encodePNG(W, H, px);
const path = join(out, 'meme.png');
writeFileSync(path, png);
const sha = createHash('sha256').update(png).digest('hex');
console.log(`wrote ${path} (${png.length} bytes, sha256 ${sha})`);
