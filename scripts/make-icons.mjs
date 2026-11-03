import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = path.join(root, 'apps/desktop/resources');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

const BG = [77, 145, 240];
const FG = [255, 255, 255];

// Stroke geometry of the mark: a V drawn as two round-capped segments.
const stroke = 0.15;

function inRoundedRect(x, y, r) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  return clamp((r - Math.hypot(dx, dy)) * 40);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.min(1, Math.max(0, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

function markCoverage(x, y) {
  const half = stroke / 2;
  const d = Math.min(
    distanceToSegment(x, y, 0.27, 0.34, 0.5, 0.72),
    distanceToSegment(x, y, 0.5, 0.72, 0.76, 0.31),
  );
  return Math.min(1, Math.max(0, (half - d) * 512));
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 2x2 supersampling keeps the mark readable at 16 px.
      let bgA = 0;
      let fgA = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const u = (x + ox) / size;
        const v = (y + oy) / size;
        bgA += inRoundedRect(u, v, 0.22);
        fgA += markCoverage(u, v);
      }
      bgA /= 4;
      fgA /= 4;
      const alpha = bgA;
      const mix = alpha > 0 ? Math.min(1, (fgA * alpha) / alpha) : 0;
      const r = Math.round(BG[0] + (FG[0] - BG[0]) * mix);
      const g = Math.round(BG[1] + (FG[1] - BG[1]) * mix);
      const b = Math.round(BG[2] + (FG[2] - BG[2]) * mix);
      const i = (y * size + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, px);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

await mkdir(outDir, { recursive: true });
const rendered = new Map();
for (const size of SIZES) rendered.set(size, render(size));
await writeFile(path.join(outDir, 'icon.png'), rendered.get(512));
await writeFile(path.join(outDir, 'tray.png'), rendered.get(32));
await mkdir(path.join(outDir, 'icons'), { recursive: true });
await writeFile(path.join(outDir, 'icons/32x32.png'), rendered.get(32));
await writeFile(path.join(outDir, 'icon.ico'), encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: rendered.get(size) }))));
console.log('Pilot icons written to apps/desktop/resources');
