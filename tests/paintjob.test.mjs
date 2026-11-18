import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createPaintjob } = require('../electron/create-paintjob.cjs');
const models = require('../electron/coach-models.json');
const resources = fileURLToPath(new URL('../resources/', import.meta.url));
const body = Buffer.alloc(128);
body.write('DDS ');
body.writeUInt32LE(4096, 16);
body.writeUInt32LE(2048, 12);

test('each coach exports its own cabin and paint namespace', () => {
  const vehicles = {
    'scania-129': '129h4.scania.touring_23',
    'scania-137': '137h6.scania.touring_23',
    'volvo': '143d6.volvo.9700_23',
    'man-121': '121h4.man.lions_24',
    'man-139': '139h6.man.lions_24'
  };
  for (const model of Object.values(models).flat()) {
    const { zip } = createPaintjob(model, 'Custom Paint.png', body, null, resources);
    const definition = zip.getEntries().find(entry => entry.entryName.includes('/paint_job/')).getData().toString();
    assert.ok(definition.includes(`suitable_for[]: "${vehicles[model.id]}.cabin"`));
    assert.ok(!definition.includes('overrides[]'));
    assert.equal(zip.getEntries().filter(entry => entry.entryName.endsWith('.dds')).length, 1);
  }
});

test('different glass liveries have separate textures and model material paths', () => {
  const model = models.scania.find(model => model.id === 'scania-137');
  const first = createPaintjob(model, 'First Paint.png', body, body, resources);
  const second = createPaintjob(model, 'Second Paint.png', body, body, resources);
  const paths = zip => zip.getEntries().map(entry => entry.entryName);
  assert.equal(paths(first.zip).filter(name => paths(second.zip).includes(name)).filter(name => name !== 'manifest.sii' && name !== 'description.txt').length, 0);
  for (const { zip } of [first, second]) {
    const names = new Set(paths(zip));
    for (const entry of zip.getEntries()) {
      if (!/\.(sii|pmd|tobj|mat)$/.test(entry.entryName)) continue;
      const content = entry.getData().toString('latin1');
      for (const [, dependency] of content.matchAll(/\/(automat\/[\w/]+\.mat|vehicle\/bus\/upgrade\/css[\w/]+\.(?:pmd|tobj|dds)|def\/vehicle\/[\w./]+\.sii)/g)) {
        assert.ok(names.has(dependency), `${entry.entryName} references missing ${dependency}`);
      }
    }
    const tobj = zip.getEntries().find(entry => entry.entryName.endsWith('/nca137_body.tobj')).getData();
    assert.equal(tobj.readUInt32LE(40), tobj.length - 48);
    assert.ok(names.has(tobj.subarray(49).toString()));
  }
});
