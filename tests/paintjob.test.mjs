import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
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
  for (const model of Object.values(models).flat()) {
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
  }
});

test('all five window profiles match their own cabin and include valid game models', () => {
  for (const model of Object.values(models).flat()) {
    assert.equal(model.glass, true);
    const profile = JSON.parse(fs.readFileSync(new URL('../resources/windows/' + model.windowProfile, import.meta.url)));
    assert.equal(profile.id, model.id);
    assert.equal(profile.width, 4096);
    assert.equal(profile.height, 2048);
    assert.equal(profile.position.length / 3, profile.uv.length / 2);
    assert.ok(profile.position.length > 900);
    assert.ok(profile.position.every(Number.isFinite));
    assert.ok(profile.uv.every(value => Number.isFinite(value) && value >= -.01 && value <= 1.01));
    for (const side of [-1, 1]) {
      assert.ok(profile.position.filter((value, index) => index % 3 === 0 && side * value > 1.13).length > 150);
    }
    if (model.id === 'volvo') {
      const height = profile.position.filter((value, index) => index % 3 === 1);
      assert.ok(height.some(y => y > 3.5) && height.some(y => y < 2));
    }
    const { zip } = createPaintjob(model, 'Window test.png', body, body, resources);
    assert.ok(zip.getEntries().some(entry => entry.entryName.endsWith('/' + model.windowModel + '.pmg')));
    const addon = zip.getEntries().find(entry => entry.entryName.includes('/warnsticker/')).getData().toString();
    assert.ok(addon.includes(`${model.cabin}.${model.vehicle}.cabin`));
    assert.ok(addon.includes(model.windowModel + '.pmd'));
  }
});

test('all exported unit declarations and suitability references follow SCS token grammar', () => {
  // Regression: css1860bb7f00 was 13 characters, so ETS2 rejected both definitions.
  for (const model of Object.values(models).flat()) {
    for (const glass of [null, body]) {
      const { zip } = createPaintjob(model, 'Scania-137h6-Lignite-Tour-949-16 2.png', body, glass, resources);
      const units = new Set();
      const references = [];
      for (const entry of zip.getEntries().filter(entry => entry.entryName.endsWith('.sii'))) {
        const definition = entry.getData().toString();
        for (const [, unit] of definition.matchAll(/^\w+\s*:\s*([.\w]+)\s*$/gm)) units.add(unit);
        for (const [, unit] of definition.matchAll(/suitable_for\[\]:\s*"([.\w]+)"/g)) references.push(unit);
      }
      for (const unit of [...units, ...references]) {
        assert.ok(unit.replace(/^\./, '').split('.').every(part => /^[a-z0-9_]{1,12}$/.test(part)), unit);
      }
      const paint = [...units].find(unit => unit.endsWith('.paint_job'));
      assert.ok(paint);
      if (glass) assert.ok(references.includes(paint));
    }
  }
});

test('corrected exports keep existing mod filenames and accessory paths', () => {
  const model = models.scania.find(model => model.id === 'scania-137');
  const result = createPaintjob(model, 'Scania-137h6-Lignite-Tour-949-16 2.png', body, body, resources);
  assert.equal(result.filename, 'css1860bb7f00-scania-137.scs');
  const file = result.zip.getEntry('def/vehicle/bus/scania.touring_23/paint_job/css1860bb7f00.sii');
  assert.ok(file);
  assert.ok(file.getData().toString().includes('cs1860bb7f00.scania.touring_23.paint_job'));
});

test('window faces point outward so opposite-side decals can be culled', () => {
  for (const model of Object.values(models).flat()) {
    const profile=JSON.parse(fs.readFileSync(new URL('../resources/windows/'+model.windowProfile,import.meta.url)));
    for(let index=0;index<profile.position.length;index+=9) {
      const p=profile.position.slice(index,index+9);
      const crossX=(p[4]-p[1])*(p[8]-p[2])-(p[5]-p[2])*(p[7]-p[1]);
      assert.ok(crossX*Math.sign((p[0]+p[3]+p[6])/3)>0,model.id+' has an inward window face');
    }
  }
});
