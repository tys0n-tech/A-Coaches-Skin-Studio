const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

function isLiverySize(width, height) {
  return (width === 4096 && height === 2048) || (width === 8192 && height === 4096);
}

function isTruckLiverySize(width, height) {
  return width === height && [2048, 4096, 8192].includes(width);
}

function isTruckAccessorySize(width, height) {
  const pow2 = n => Number.isInteger(n) && n >= 64 && n <= 8192 && (n & (n - 1)) === 0;
  return pow2(width) && pow2(height);
}

function isTruckSideskirtSize(width, height) {
  return isTruckAccessorySize(width, height);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, data, tail]);
}

function solidColorPNG(hex, size = 64) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) throw new Error('สีชิ้นส่วนแต่งไม่ถูกต้อง');
  const rgb = [parseInt(match[1].slice(0, 2), 16), parseInt(match[1].slice(2, 4), 16), parseInt(match[1].slice(4, 6), 16)];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

async function convertTextureDDS(source, generatedPNG, tool) {
  let result;
  if (source && path.extname(source).toLowerCase() === '.dds') {
    result = fs.readFileSync(source);
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coaches-skin-'));
    try {
      const input = source || path.join(tmp, 'generated-window.png');
      if (generatedPNG) fs.writeFileSync(input, generatedPNG);
      // Figma PNGs carry sRGB metadata. Preserve sRGB on output as required by
      // the game's color textures; linear output makes the paint too dark.
      const args = ['-f', 'BC3_UNORM', '-srgb', '-m', '0', '-y', '-o', tmp, input];
      await new Promise((resolve, reject) => {
        const child = spawn(tool, args, { windowsHide: true });
        let stderr = '';
        child.on('error', reject);
        child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 2000); });
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`texconv failed (${code}): ${stderr}`)));
      });
      result = fs.readFileSync(path.join(tmp, path.parse(input).name + '.dds'));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  if (result.length < 128 || result.subarray(0, 4).toString('ascii') !== 'DDS ') throw new Error('DDS output is invalid');
  return result;
}
async function convertIconDDS(pngBuffer, tool) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coaches-icon-'));
  try {
    const input = path.join(tmp, 'shop-icon.png');
    fs.writeFileSync(input, pngBuffer);
    const args = ['-f', 'B8G8R8A8_UNORM', '-srgb', '-m', '1', '-y', '-o', tmp, input];
    await new Promise((resolve, reject) => {
      const child = spawn(tool, args, { windowsHide: true });
      let stderr = '';
      child.on('error', reject);
      child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 2000); });
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`texconv icon failed (${code}): ${stderr}`)));
    });
    const result = fs.readFileSync(path.join(tmp, 'shop-icon.dds'));
    if (result.length < 128 || result.subarray(0, 4).toString('ascii') !== 'DDS ') throw new Error('Icon DDS output is invalid');
    return result;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { convertTextureDDS, convertIconDDS, isLiverySize, isTruckLiverySize, isTruckSideskirtSize, isTruckAccessorySize, solidColorPNG };
