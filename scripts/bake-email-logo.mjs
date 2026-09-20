#!/usr/bin/env node
/**
 * Composite public/assets/logo-b.png onto an opaque cream plate for SMTP HTML.
 * Gmail dark mode inverts HTML through transparency; an RGB (no-alpha) plate
 * keeps “Lodge” readable. Run: node scripts/bake-email-logo.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EMAIL_LOGO_CREAM = [0xf5, 0xf0, 0xe8];
export const EMAIL_LOGO_PAD = 48;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePngRgba(path) {
  const data = readFileSync(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      if (chunk[8] !== 8 || chunk[9] !== 6) {
        throw new Error(`expected 8-bit RGBA PNG, got depth=${chunk[8]} type=${chunk[9]}`);
      }
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  let i = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filt = raw[i];
    i += 1;
    const cur = Buffer.from(raw.subarray(i, i + stride));
    i += stride;
    if (filt === 1) {
      for (let x = 0; x < stride; x++) cur[x] = (cur[x] + (x >= bpp ? cur[x - bpp] : 0)) & 255;
    } else if (filt === 2) {
      for (let x = 0; x < stride; x++) cur[x] = (cur[x] + prev[x]) & 255;
    } else if (filt === 3) {
      for (let x = 0; x < stride; x++) {
        const left = x >= bpp ? cur[x - bpp] : 0;
        cur[x] = (cur[x] + ((left + prev[x]) >> 1)) & 255;
      }
    } else if (filt === 4) {
      for (let x = 0; x < stride; x++) {
        const left = x >= bpp ? cur[x - bpp] : 0;
        const up = prev[x];
        const ul = x >= bpp ? prev[x - bpp] : 0;
        cur[x] = (cur[x] + paeth(left, up, ul)) & 255;
      }
    } else if (filt !== 0) {
      throw new Error(`unsupported PNG filter ${filt}`);
    }
    cur.copy(pixels, y * stride);
    prev = cur;
  }
  return { width, height, pixels };
}

function encodePngRgb(width, height, pixels) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunks = [
    Buffer.from("\x89PNG\r\n\x1a\n", "binary"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat(chunks);
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, crcBuf, crc]);
}

export function compositeOnCream(src, pad = EMAIL_LOGO_PAD, cream = EMAIL_LOGO_CREAM) {
  const width = src.width + pad * 2;
  const height = src.height + pad * 2;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = cream[0];
    pixels[i + 1] = cream[1];
    pixels[i + 2] = cream[2];
  }
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4;
      const a = src.pixels[si + 3] / 255;
      const di = ((y + pad) * width + (x + pad)) * 3;
      pixels[di] = Math.round(src.pixels[si] * a + cream[0] * (1 - a));
      pixels[di + 1] = Math.round(src.pixels[si + 1] * a + cream[1] * (1 - a));
      pixels[di + 2] = Math.round(src.pixels[si + 2] * a + cream[2] * (1 - a));
    }
  }
  return { width, height, pixels };
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const src = decodePngRgba(join(root, "public/assets/logo-b.png"));
  const baked = compositeOnCream(src);
  const out = join(root, "public/assets/logo-b-email.png");
  writeFileSync(out, encodePngRgb(baked.width, baked.height, baked.pixels));
  console.log(`wrote ${out} ${baked.width}x${baked.height} RGB cream plate`);
}
