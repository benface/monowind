/**
 * The image stories' pictures, drawn by code so they are small, exact
 * and the same on every machine: `node generate.mjs` writes them.
 */
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

/** A PNG of `width` × `height` RGB pixels from `pixel(x, y, width, height)`. */
function png(width, height, pixel) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([head, Buffer.from(type), data, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y, width, height).map((c) =>
        Math.max(0, Math.min(255, Math.round(c))),
      );
      rows.set([r, g, b], y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

/** A sunset over hills and water. */
function sunset(x, y, width, height) {
  const u = x / width;
  const v = y / height;
  const horizon = 0.62;
  const sky = (t) =>
    t < 0.5
      ? mix([28, 30, 92], [168, 72, 120], smooth(t / 0.5))
      : mix([168, 72, 120], [250, 170, 80], smooth((t - 0.5) / 0.5));
  const sun = [0.68, 0.5];
  const near = (vy) => Math.hypot((u - sun[0]) * (width / height), vy - sun[1]);
  if (v < horizon) {
    let color = sky(v / horizon);
    const d = near(v);
    color = mix(color, [255, 236, 170], clamp01((0.2 - d) / 0.2) ** 2 * 0.6);
    if (d < 0.07) color = [255, 246, 214];
    const far = horizon - 0.12 - 0.05 * Math.sin(u * 7.1) - 0.03 * Math.sin(u * 17.3 + 1);
    const close = horizon - 0.05 - 0.07 * Math.sin(u * 4.3 + 2) * Math.sin(u * 2.1);
    if (v > close) return [44, 24, 62];
    if (v > far) return mix([96, 52, 104], color, 0.25);
    return color;
  }
  const depth = (v - horizon) / (1 - horizon);
  let color = mix(sky(1 - depth * 0.9), [18, 20, 60], depth * 0.8);
  const glint = Math.abs(u - sun[0]) < 0.06 * (1 - depth * 0.5) && Math.sin(v * 180) > 0.2;
  if (glint) color = mix(color, [255, 226, 150], 0.7 * (1 - depth));
  return color;
}

/** Hue across, lightness down, and a gray ramp along the bottom. */
function card(x, y, width, height) {
  const ramp = height * 0.8;
  if (y >= ramp) return Array(3).fill((x / (width - 1)) * 255);
  const h = (x / width) * 6;
  const k = (n) => clamp01(Math.abs(((h + n) % 6) - 3) - 1);
  const hue = [k(0), k(4), k(2)].map((c) => c * 255);
  const t = y / ramp;
  return t < 0.5 ? mix([255, 255, 255], hue, t * 2) : mix(hue, [0, 0, 0], (t - 0.5) * 2);
}

/** An animated GIF of `frames`, each `[delay in 10 ms, pixel(x, y) → 0–3]`
 * over a 4-color table, its LZW codes uncompressed: a clear before
 * each pixel keeps the table, and the code size, from growing. */
function gif(width, height, colors, frames) {
  const bytes = [
    ...Buffer.from("GIF89a"),
    width & 255,
    width >> 8,
    height & 255,
    height >> 8,
    0xf1,
    0,
    0,
  ];
  bytes.push(...colors.flat());
  bytes.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0);
  for (const [delay, pixel] of frames) {
    bytes.push(0x21, 0xf9, 4, 0, delay & 255, delay >> 8, 0, 0);
    bytes.push(0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0);
    const codes = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) codes.push(4, pixel(x, y));
    codes.push(5);
    const data = [];
    let bits = 0;
    let pending = 0;
    for (const code of codes) {
      pending |= code << bits;
      bits += 3;
      while (bits >= 8) {
        data.push(pending & 255);
        pending >>= 8;
        bits -= 8;
      }
    }
    if (bits > 0) data.push(pending & 255);
    bytes.push(2);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.slice(i, i + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

writeFileSync(new URL("sunset.png", import.meta.url), png(320, 200, sunset));
writeFileSync(new URL("card.png", import.meta.url), png(256, 160, card));
// A bar sweeping across, a frame a quarter of the way each.
writeFileSync(
  new URL("sweep.gif", import.meta.url),
  gif(
    32,
    16,
    [
      [16, 16, 48],
      [250, 200, 60],
      [60, 180, 250],
      [0, 0, 0],
    ],
    [0, 1, 2, 3].map((frame) => [12, (x) => (Math.floor(x / 8) === frame ? 1 + (frame % 2) : 0)]),
  ),
);
