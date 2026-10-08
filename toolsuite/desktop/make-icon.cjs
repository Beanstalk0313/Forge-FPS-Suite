/**
 * Generates build/icon.ico for the packaged suite.
 *
 * electron-builder needs a real .ico to stamp icon and version metadata into
 * the executable, and the repo deliberately has no binary art. The mark is
 * rasterised here (the suite's F monogram inside a broken ring, in the accent
 * green over the dark UI background) and wrapped in an ICO container that
 * embeds PNG per size, which Windows has supported since Vista.
 * Run: node toolsuite/desktop/make-icon.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// --- PNG encoding -------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  // Each scanline is prefixed with filter type 0 (none); the image is small
  // enough that a smarter filter is not worth the bytes.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- the mark -----------------------------------------------------------
const BG = [11, 16, 20];        // matches the suite's --bg surface
const EDGE = [26, 38, 44];
const ACCENT = [126, 224, 192]; // the teal used by the HUD style templates

/** 1 inside the shape, 0 outside; supersampled so the small sizes stay clean. */
function sample(x, y) {
  const r = Math.hypot(x, y);
  const box = Math.max(Math.abs(x), Math.abs(y));
  // rounded-square plate
  const corner = 0.30;
  const dx = Math.max(Math.abs(x) - (0.86 - corner), 0);
  const dy = Math.max(Math.abs(y) - (0.86 - corner), 0);
  const plate = box <= 0.86 && Math.hypot(dx, dy) <= corner;
  // The F: a bold stem with two arms, matching the FORGE wordmark. The broken
  // ring around it keeps the marksman identity of the earlier reticle mark.
  const stem = Math.abs(x + 0.18) < 0.11 && Math.abs(y) < 0.44;
  // Raster Y grows downward, so the top arm uses a negative Y coordinate.
  const topArm = Math.abs(y + 0.36) < 0.10 && x > -0.20 && x < 0.40;
  const midArm = Math.abs(y + 0.02) < 0.09 && x > -0.20 && x < 0.28;
  const ring = Math.abs(r - 0.68) < 0.035;
  const gap = Math.abs(((Math.atan2(y, x) + Math.PI) % (Math.PI / 2)) - Math.PI / 4) > 0.55;
  return { plate, mark: stem || topArm || midArm || (ring && gap) };
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3; // supersampling factor per axis
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let plateHits = 0, markHits = 0, total = SS * SS;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / SS) / size) * 2 - 1;
          const s = sample(x, y);
          if (s.plate) plateHits++;
          if (s.mark) markHits++;
        }
      }
      const plateA = plateHits / total;
      const markA = (markHits / total) * plateA;
      // plate is a soft vertical gradient rather than one flat fill
      const t = py / (size - 1);
      let r = BG[0] + (EDGE[0] - BG[0]) * t;
      let g = BG[1] + (EDGE[1] - BG[1]) * t;
      let b = BG[2] + (EDGE[2] - BG[2]) * t;
      r += (ACCENT[0] - r) * markA;
      g += (ACCENT[1] - g) * markA;
      b += (ACCENT[2] - b) * markA;
      const o = (py * size + px) * 4;
      rgba[o] = Math.round(r);
      rgba[o + 1] = Math.round(g);
      rgba[o + 2] = Math.round(b);
      rgba[o + 3] = Math.round(plateA * 255);
    }
  }
  return rgba;
}

// --- ICO container ------------------------------------------------------
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildIco() {
  const images = SIZES.map(size => encodePng(size, render(size)));
  const header = Buffer.alloc(6 + SIZES.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(SIZES.length, 4);
  let offset = header.length;
  SIZES.forEach((size, i) => {
    const at = 6 + i * 16;
    header[at] = size >= 256 ? 0 : size; // 0 means 256
    header[at + 1] = size >= 256 ? 0 : size;
    header[at + 2] = 0;                    // palette size
    header[at + 3] = 0;                    // reserved
    header.writeUInt16LE(1, at + 4);       // colour planes
    header.writeUInt16LE(32, at + 6);      // bits per pixel
    header.writeUInt32LE(images[i].length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

const out = path.join(__dirname, '..', '..', 'build', 'icon.ico');
fs.mkdirSync(path.dirname(out), { recursive: true });
const ico = buildIco();
fs.writeFileSync(out, ico);
// The editor imports the same mark from the unpacked toolsuite scaffold.
fs.writeFileSync(path.join(__dirname, '..', 'icon.ico'), ico);
process.stdout.write(`Wrote ${out} (${ico.length} bytes, sizes ${SIZES.join(', ')})\n`);
