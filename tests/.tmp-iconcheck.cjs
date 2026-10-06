const fs = require('fs');
const zlib = require('zlib');
const ico = fs.readFileSync('build/icon.ico');
const count = ico.readUInt16LE(4);
console.log('ICO type', ico.readUInt16LE(2), 'sizes', count);
const sizes = [];
for (let i = 0; i < count; i++) {
  const at = 6 + i * 16;
  const w = ico[at] || 256, h = ico[at + 1] || 256;
  const len = ico.readUInt32LE(at + 8), off = ico.readUInt32LE(at + 12);
  const sig = ico.slice(off, off + 8).toString('hex');
  console.log(`  ${w}x${h}  ${len} bytes  png=${sig === '89504e470d0a1a0a'}`);
  sizes.push({ w, len, off });
}
// decode the 256 entry and re-emit as a standalone PNG for visual inspection
const big = sizes.find(s => s.w === 256);
const png = ico.slice(big.off, big.off + big.len);
fs.writeFileSync('build/icon-preview.png', png);
console.log('preview written, bytes', png.length);
