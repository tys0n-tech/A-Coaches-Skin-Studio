import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createPaintjob, createTruckPaintjob, createMultiSkinPack } = require('../electron/create-paintjob.cjs');
const models = require('../electron/coach-models.json');
const truckModels = require('../electron/truck-models.json');
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

test('bundled truck models include GLB, template, and export valid ETS2 truck paintjob mods', () => {
  const truckDDS = Buffer.alloc(128);
  truckDDS.write('DDS ');
  truckDDS.writeUInt32LE(4096, 16);
  truckDDS.writeUInt32LE(4096, 12);
  const accDDS = Buffer.alloc(128);
  accDDS.write('DDS ');
  accDDS.writeUInt32LE(2048, 16);
  accDDS.writeUInt32LE(1024, 12);
  const allTrucks = Object.values(truckModels).flat();
  assert.equal(Object.keys(truckModels).length, 7);
  assert.equal(allTrucks.length, 33);
  const seenIds = new Set();
  const seenFiles = new Set();
  for (const model of allTrucks) {
    assert.ok(!seenIds.has(model.id), `duplicate model id ${model.id}`);
    assert.ok(!seenFiles.has(model.file), `duplicate model file ${model.file}`);
    seenIds.add(model.id);
    seenFiles.add(model.file);
    assert.ok(fs.existsSync(new URL('../resources/models/' + model.file, import.meta.url)), model.file);
    assert.ok(fs.existsSync(new URL('../resources/templates/' + model.template, import.meta.url)), model.template);
    assert.ok(Array.isArray(model.accessories) && model.accessories.length >= 1, `${model.id} missing accessories`);
    const seenAccKeys = new Set();
    const seenAccItems = new Set();
    for (const acc of model.accessories) {
      assert.ok(!seenAccKeys.has(acc.key), `duplicate accessory key ${model.id}.${acc.key}`);
      seenAccKeys.add(acc.key);
      assert.ok(fs.existsSync(new URL('../resources/templates/' + acc.template, import.meta.url)), acc.template);
      assert.ok(Array.isArray(acc.accList) && acc.accList.length >= 1, `${model.id}.${acc.key} missing accList`);
      for (const item of acc.accList) {
        assert.ok(!seenAccItems.has(item), `duplicate acc_list ${item} in ${model.id}.${acc.key}`);
        seenAccItems.add(item);
      }
    }
    const iconDDS = Buffer.alloc(128);
    iconDDS.write('DDS ');
    iconDDS.writeUInt32LE(256, 16);
    iconDDS.writeUInt32LE(64, 12);
    const chosenAccs = model.accessories.slice(0, 2).map(acc => ({ key: acc.key, dds: accDDS, accList: acc.accList }));
    const { zip } = createTruckPaintjob(model, 'Aurelis Livery.png', truckDDS, {
      customName: `★ Aurelis ${model.name}`,
      accessoryTextures: chosenAccs,
      sharedDDS: accDDS,
      accessoryColor: '#2465C0',
      iconDDS
    });
    const defEntry = zip.getEntries().find(entry => entry.entryName.includes('/paint_job/') && !entry.entryName.includes('/accessory/'));
    assert.ok(defEntry);
    const def = defEntry.getData().toString();
    assert.ok(def.includes(`suitable_for[]: "${model.cabin}.${model.vehicle}.cabin"`));
    assert.ok(def.includes(`alternate_uvset: ${Boolean(model.alternateUvset)}`));
    assert.ok(def.includes(`name: "★ Aurelis ${model.name}"`));
    // Accessory .sii filename MUST match the 12-char paint_job unit token so ETS2 loads it!
    const unitMatch = def.match(/accessory_paint_job_data\s*:\s*([a-z0-9_]+)\./);
    assert.ok(unitMatch);
    const unitToken = unitMatch[1];
    assert.equal(defEntry.entryName, `def/vehicle/truck/${model.vehicle}/paint_job/${unitToken}.sii`);
    const accEntry = zip.getEntry(`def/vehicle/truck/${model.vehicle}/paint_job/accessory/${unitToken}.sii`);
    assert.ok(accEntry, `missing accessory/${unitToken}.sii matching unit token`);
    const accDef = accEntry.getData().toString();
    for (const chosen of chosenAccs) {
      assert.ok(accDef.includes(`${chosen.key}.tobj`), `${model.id} missing ${chosen.key}.tobj`);
      assert.ok(accDef.includes(chosen.accList[0]), `${model.id} missing ${chosen.accList[0]}`);
    }
    if (model.vehicle === 'scania.s_2016') {
      assert.ok(accDef.includes('r_chs_cover.6xnl_p'));
    }
    assert.ok(def.includes(`icon: "${unitToken}"`));
    assert.ok(zip.getEntry(`material/ui/accessory/${unitToken}.mat`));
    assert.ok(zip.getEntry(`material/ui/accessory/${unitToken}.tobj`));
    assert.ok(zip.getEntry(`material/ui/accessory/${unitToken}.dds`));
    const manifest = zip.getEntry('manifest.sii').getData().toString();
    assert.ok(!manifest.includes('dlc_bus'));
    for (const [, unit] of def.matchAll(/^\w+\s*:\s*([.\w]+)\s*$/gm)) {
      assert.ok(unit.split('.').every(part => /^[a-z0-9_]{1,12}$/.test(part)), unit);
    }
    for (const tobjName of ['/paint.tobj', ...chosenAccs.map(c => `/${c.key}.tobj`), `/${unitToken}.tobj`]) {
      const tobj = zip.getEntries().find(entry => entry.entryName.endsWith(tobjName)).getData();
      assert.equal(tobj.readUInt32LE(40), tobj.length - 48);
      assert.ok(zip.getEntry(tobj.subarray(49).toString()));
    }
  }
});

test('multi-skin pack combines coaches and trucks into a single collision-free .scs archive', () => {
  const truckDDS = Buffer.alloc(128);
  truckDDS.write('DDS ');
  truckDDS.writeUInt32LE(4096, 16);
  truckDDS.writeUInt32LE(4096, 12);
  const accDDS = Buffer.alloc(128);
  accDDS.write('DDS ');
  accDDS.writeUInt32LE(2048, 16);
  accDDS.writeUInt32LE(1024, 12);
  const iconDDS = Buffer.alloc(128);
  iconDDS.write('DDS ');
  iconDDS.writeUInt32LE(256, 16);
  iconDDS.writeUInt32LE(64, 12);

  const coachModel = { ...models.scania[0], kind: 'coach' };
  const scaniaTruck = { ...truckModels.scania[0], kind: 'truck' };
  const volvoTruck = { ...truckModels.volvo[0], kind: 'truck' };

  // Truck-only pack should NOT require dlc_bus
  const truckOnly = createMultiSkinPack([
    {
      model: scaniaTruck,
      filename: 'SkinA.png',
      bodyDDS: truckDDS,
      customName: '★ Fleet One',
      accessoryTextures: [{ key: 'sideskirt', dds: accDDS, accList: scaniaTruck.accessories[0].accList }],
      sharedDDS: accDDS,
      accessoryColor: '#0071e3',
      iconDDS
    },
    {
      // Duplicate customName + same model -> must auto-salt to a distinct valid 12-char unitToken
      model: scaniaTruck,
      filename: 'SkinA.png',
      bodyDDS: truckDDS,
      customName: '★ Fleet One',
      sharedDDS: accDDS,
      accessoryColor: '#c91f28',
      iconDDS
    },
    {
      model: volvoTruck,
      filename: 'VolvoBlue.png',
      bodyDDS: truckDDS,
      customName: '★ Volvo Aero',
      accessoryTextures: [{ key: 'sideskirt', dds: accDDS, accList: volvoTruck.accessories[0].accList }],
      sharedDDS: accDDS,
      accessoryColor: '#1d1d1f',
      iconDDS
    }
  ], resources, { packName: '★ Thailand Truck Fleet' });

  assert.equal(truckOnly.count, 3);
  const truckManifest = truckOnly.zip.getEntry('manifest.sii').getData().toString();
  assert.ok(truckManifest.includes('display_name: "★ Thailand Truck Fleet"'));
  assert.ok(!truckManifest.includes('dlc_bus'));
  const truckPaintDefs = truckOnly.zip.getEntries().filter(e => /def\/vehicle\/truck\/[^/]+\/paint_job\/[^/]+\.sii$/.test(e.entryName));
  assert.equal(truckPaintDefs.length, 3);
  const seenUnits = new Set();
  for (const defEntry of truckPaintDefs) {
    const def = defEntry.getData().toString();
    const m = def.match(/accessory_paint_job_data\s*:\s*([a-z0-9_]+)\./);
    assert.ok(m);
    assert.ok(!seenUnits.has(m[1]), `duplicate unit token ${m[1]}`);
    seenUnits.add(m[1]);
    assert.ok(/^[a-z0-9_]{1,12}$/.test(m[1]));
    assert.ok(truckOnly.zip.getEntry(`material/ui/accessory/${m[1]}.dds`));
  }

  // Mixed Coach + Truck pack MUST include dlc_bus and keep coach glass + truck accessories intact
  const mixed = createMultiSkinPack([
    {
      model: coachModel,
      filename: 'CoachA.png',
      bodyDDS: body,
      glassDDS: body,
      customName: '★ Touring VIP',
      iconDDS
    },
    {
      model: volvoTruck,
      filename: 'VolvoVIP.png',
      bodyDDS: truckDDS,
      customName: '★ FH6 VIP',
      accessoryTextures: [{ key: 'sideskirt', dds: accDDS, accList: volvoTruck.accessories[0].accList }],
      sharedDDS: accDDS,
      accessoryColor: '#0071e3',
      iconDDS
    }
  ], resources, { packName: '★ Mixed VIP Pack' });

  assert.equal(mixed.count, 2);
  const mixedManifest = mixed.zip.getEntry('manifest.sii').getData().toString();
  assert.ok(mixedManifest.includes('dlc_dependencies[]: "dlc_bus"'));
  assert.ok(mixed.zip.getEntries().some(e => e.entryName.includes('def/vehicle/bus/scania.touring_23/paint_job/')));
  assert.ok(mixed.zip.getEntries().some(e => e.entryName.includes('def/vehicle/bus/scania.touring_23/accessory/warnsticker/')));
  assert.ok(mixed.zip.getEntries().some(e => e.entryName.includes('def/vehicle/truck/volvo.fh_2024/paint_job/')));
  assert.ok(mixed.zip.getEntries().some(e => e.entryName.includes('def/vehicle/truck/volvo.fh_2024/paint_job/accessory/')));
});
