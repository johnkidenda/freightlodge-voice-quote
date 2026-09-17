import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

function readPngRgba(path) {
  const data = readFileSync(path);
  expect(data.subarray(0, 8).toString("binary")).toBe("\x89PNG\r\n\x1a\n");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  return { width, height, bitDepth, colorType, raw: inflateSync(Buffer.concat(idat)) };
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

function rgbaAt(png, x, y) {
  const bpp = 4;
  const stride = png.width * bpp;
  let prev = Buffer.alloc(stride);
  let i = 0;
  for (let row = 0; row <= y; row++) {
    const filt = png.raw[i];
    i += 1;
    const cur = Buffer.from(png.raw.subarray(i, i + stride));
    i += stride;
    if (filt === 1) {
      for (let c = 0; c < stride; c++) cur[c] = (cur[c] + (c >= bpp ? cur[c - bpp] : 0)) & 255;
    } else if (filt === 2) {
      for (let c = 0; c < stride; c++) cur[c] = (cur[c] + prev[c]) & 255;
    } else if (filt === 3) {
      for (let c = 0; c < stride; c++) {
        const left = c >= bpp ? cur[c - bpp] : 0;
        cur[c] = (cur[c] + ((left + prev[c]) >> 1)) & 255;
      }
    } else if (filt === 4) {
      for (let c = 0; c < stride; c++) {
        const left = c >= bpp ? cur[c - bpp] : 0;
        const up = prev[c];
        const ul = c >= bpp ? prev[c - bpp] : 0;
        cur[c] = (cur[c] + paeth(left, up, ul)) & 255;
      }
    } else if (filt !== 0) {
      throw new Error(`unsupported PNG filter ${filt}`);
    }
    if (row === y) return [cur[x * 4], cur[x * 4 + 1], cur[x * 4 + 2], cur[x * 4 + 3]];
    prev = cur;
  }
  throw new Error("row out of range");
}

describe("phone visual nits — logo B + powered-by", () => {
  it("header logo-b.png is RGBA with transparent corners (no baked white box)", () => {
    const png = readPngRgba("public/assets/logo-b.png");
    expect(png.colorType).toBe(6);
    expect(png.bitDepth).toBe(8);
    const corners = [
      [0, 0],
      [png.width - 1, 0],
      [0, png.height - 1],
      [png.width - 1, png.height - 1],
    ];
    for (const [x, y] of corners) {
      const [, , , a] = rgbaAt(png, x, y);
      expect(a).toBeLessThan(10);
    }
  });

  it("powered-by stays inside the ~390 viewport and SW cache is v4", () => {
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toMatch(/\.powered-by[\s\S]*max-width:\s*calc\(100vw/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*justify-content:\s*center/);
    expect(css).toMatch(/\.powered-logo img[\s\S]*max-width:\s*min\(6\.5rem/);
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toMatch(/freightlodge-quote-v4/);
    expect(sw).not.toMatch(/freightlodge-quote-v3/);
  });
});
