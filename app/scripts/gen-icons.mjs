// Generates PNG icons with no external dependencies: a custom rasterizer + zlib.
// Run: npm run icons. The output goes to public/ and is committed as is.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// "F" glyph in a unit square; the icon is full-bleed, the glyph stays inside the maskable safe zone.
const WHITE = [245, 247, 250];
const GREEN = [48, 209, 88];
const SHAPES = [
  { x0: 0.33, y0: 0.25, x1: 0.445, y1: 0.75, r: 0.035, color: WHITE }, // stem
  { x0: 0.33, y0: 0.25, x1: 0.69, y1: 0.36, r: 0.035, color: WHITE }, // top bar
  { x0: 0.33, y0: 0.455, x1: 0.61, y1: 0.555, r: 0.035, color: GREEN }, // middle bar
];
const BG_TOP = [22, 30, 42];
const BG_BOTTOM = [8, 11, 16];

function inRoundRect(px, py, s) {
  if (px < s.x0 || px > s.x1 || py < s.y0 || py > s.y1) return false;
  const cx = Math.min(Math.max(px, s.x0 + s.r), s.x1 - s.r);
  const cy = Math.min(Math.max(py, s.y0 + s.r), s.y1 - s.r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= s.r * s.r;
}

function render(size) {
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const bg = BG_TOP.map((c, i) => c + (BG_BOTTOM[i] - c) * t);
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;
          let c = bg;
          for (const s of SHAPES) if (inRoundRect(px, py, s)) c = s.color;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      rgba[o] = Math.round(r / n);
      rgba[o + 1] = Math.round(g / n);
      rgba[o + 2] = Math.round(b / n);
      rgba[o + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg() {
  const rects = SHAPES.map((s) => {
    const k = 64;
    const fill = `rgb(${s.color.join(',')})`;
    return `<rect x="${s.x0 * k}" y="${s.y0 * k}" width="${(s.x1 - s.x0) * k}" height="${(s.y1 - s.y0) * k}" rx="${s.r * k}" fill="${fill}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${BG_TOP.join(',')})"/><stop offset="1" stop-color="rgb(${BG_BOTTOM.join(',')})"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/>${rects}</svg>\n`;
}

function write(rel, data) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log('wrote', rel, data.length, 'bytes');
}

write('icons/icon-192.png', render(192));
write('icons/icon-512.png', render(512));
write('apple-touch-icon.png', render(180));
write('favicon.svg', svg());
