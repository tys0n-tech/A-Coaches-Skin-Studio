import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { convertTextureDDS, isLiverySize } = require('../electron/texture-conversion.cjs');
const tool = fileURLToPath(new URL('../resources/tools/texconv.exe', import.meta.url));

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

test('PNG sRGB metadata and canvas PNG both preserve paint colors when encoded to DDS', { skip: process.platform !== 'win32' }, async () => {
  const colors = [[0,100,159],[186,21,82],[71,183,223],[148,17,70]];
  for (const fixture of ['palette-srgb.png', 'palette-plain.png']) {
    const source = fileURLToPath(new URL('fixtures/' + fixture, import.meta.url));
    const dds = await convertTextureDDS(source, null, tool);
    for (const [index, expected] of colors.entries()) {
      const actual = pixelBC3(dds, index*32+16, 24);
      assert.ok(actual.every((v,k) => Math.abs(v-expected[k]) <= 5), `${fixture}: ${actual} differs from ${expected}`);
    }
  }
  const generated = fs.readFileSync(new URL('fixtures/palette-plain.png', import.meta.url));
  const dds = await convertTextureDDS(null, generated, tool);
  assert.ok(pixelBC3(dds, 16, 24).every((v,k) => Math.abs(v-colors[0][k]) <= 5));
});

test('4K and 8K use the same full-frame aspect ratio; incompatible frames are rejected', () => {
  assert.equal(isLiverySize(4096,2048),true);
  assert.equal(isLiverySize(8192,4096),true);
  for (const [w,h] of [[8192,2048],[4096,4096],[2048,1024],[16384,8192]]) assert.equal(isLiverySize(w,h),false);
});
