const assert = require('node:assert/strict');
function pixelBC3(dds, x, y) {
  assert.equal(dds.toString('ascii', 84, 88), 'DXT5');
  const offset = 128 + (Math.floor(y / 4) * (dds.readUInt32LE(16) / 4) + Math.floor(x / 4)) * 16;
  const rgb = value => [((value >> 11) & 31) * 255 / 31, ((value >> 5) & 63) * 255 / 63, (value & 31) * 255 / 31];
  const a = rgb(dds.readUInt16LE(offset + 8));
  const b = rgb(dds.readUInt16LE(offset + 10));
  const palette = [a, b, a.map((v, k) => (2*v+b[k])/3), a.map((v, k) => (v+2*b[k])/3)];
  const index = (y % 4)*4 + x % 4;
  return palette[(dds.readUInt32LE(offset + 12) >>> (2 * index)) & 3];
}

module.exports={pixelBC3};
