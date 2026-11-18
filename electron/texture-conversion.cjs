const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function isLiverySize(width, height) {
  return (width === 4096 && height === 2048) || (width === 8192 && height === 4096);
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
module.exports = { convertTextureDDS, isLiverySize };
