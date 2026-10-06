const fs = require('fs'), zlib = require('zlib');
const buf = fs.readFileSync('build/icon-preview.png');
let off = 8, idat = [], w = 0, h = 0;
while (off < buf.length) {
  const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.slice(off + 8, off + 8 + len);
  if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
  if (type === 'IDAT') idat.push(data);
  off += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = w * 4, px = Buffer.alloc(stride * h);
for (let y = 0; y < h; y++) {
  const f = raw[y * (stride + 1)];
  if (f !== 0) throw new Error('unexpected filter ' + f);
  raw.copy(px, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
}
console.log(`decoded ${w}x${h}`);
// corner should be transparent, centre opaque, ring accent-tinted
const at = (x, y) => { const o = (y * w + x) * 4; return [px[o], px[o+1], px[o+2], px[o+3]]; };
const alphaAt = (x, y) => at(x, y)[3];
console.log('corner(2,2)      alpha', alphaAt(2, 2));
console.log('plate(128,200)   alpha', alphaAt(128, 200));
console.log('centre dot(128,128) rgba', at(128, 128).join(','));
console.log('ring left(45,128) rgba', at(45, 128).join(','));
// ASCII art so the mark is visible in the log
const ramp = ' .:-=+*#%@';
let art = '';
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    const [r, g, b, a] = at(Math.floor(x * w / 32), Math.floor(y * h / 32));
    const lum = a < 40 ? 0 : (r * 0.3 + g * 0.6 + b * 0.1) / 255;
    art += ramp[Math.min(9, Math.floor(lum * 10))];
  }
  art += '\n';
}
console.log(art);
