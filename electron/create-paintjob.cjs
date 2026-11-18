const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

function createPaintjob(model, filename, bodyDDS, glassDDS, resources) {
  const name = path.parse(filename).name.replace(/[\x00-\x1f"\\]/g, ' ').trim().slice(0, 100) || 'Custom Coach Livery';
  const token = 'css' + crypto.createHash('sha256').update(model.id + '/' + name).digest('hex').slice(0, 10);
  // SCS unit-name components allow at most 12 characters. Keep archive paths stable.
  const unitToken = 'cs' + token.slice(3);
  const definitionFolder = `def/vehicle/bus/${model.vehicle}`;
  const paintUnit = `${unitToken}.${model.vehicle}.paint_job`;
  for (const name of [paintUnit, `${unitToken}.${model.vehicle}.warnsticker`, `${model.cabin}.${model.vehicle}.cabin`]) {
    if (!name.split('.').every(part => /^[a-z0-9_]{1,12}$/.test(part))) {
      throw new Error('Invalid SCS unit name: ' + name);
    }
  }
  let zip = new AdmZip();
  let textureFolder = `vehicle/bus/upgrade/paintjob/coach_studio/${token}`;
  let overrides = '';
  if (glassDDS) {
    if (!model.glass) throw new Error('รถรุ่นนี้รองรับการส่งออกเฉพาะลายตัวถัง');
    const bundled = new AdmZip(path.join(resources, 'mod-templates', model.windowTemplate));
    const originalFolder = 'vehicle/bus/upgrade/tyson_nca_window';
    const renamedFolder = ('vehicle/bus/upgrade/' + token).padEnd(originalFolder.length, '_');
    const materialPaths = new Map();
    for (const entry of bundled.getEntries().filter(entry => entry.entryName.endsWith('.mat'))) {
      const id = crypto.createHash('sha256').update(token + entry.entryName).digest('hex').slice(0, 16);
      materialPaths.set(entry.entryName, `automat/${id.slice(0, 2)}/${id}.mat`);
    }
    const replacements = [[originalFolder, renamedFolder], ...materialPaths];
    for (const entry of bundled.getEntries()) {
      if (!entry.isDirectory && /\.(pmd|pmg|mat|tobj)$/.test(entry.entryName) &&
          entry.entryName !== originalFolder + '/nca137_body.tobj') {
        let content = entry.getData();
        let entryName = entry.entryName;
        for (const [before, after] of replacements) {
          if (before.length !== after.length) throw new Error('Invalid model reference size');
          entryName = entryName.replaceAll(before, after);
          content = Buffer.from(content.toString('latin1').replaceAll(before, after), 'latin1');
        }
        zip.addFile(entryName, content);
      }
    }
    textureFolder = renamedFolder;
    zip.addFile(renamedFolder + '/' + model.windowModel + '.dds', glassDDS);
    const addonPath = `${definitionFolder}/accessory/warnsticker/${token}.sii`;
    overrides = `    overrides[]: "/${addonPath}"\n`;
    zip.addFile(addonPath, Buffer.from(`SiiNunit
{
accessory_addon_data : ${unitToken}.${model.vehicle}.warnsticker
{
    name: "${name} - Window decals"
    price: 0
    unlock: 0
    part_type: aftermarket
    exterior_model: "/${renamedFolder}/${model.windowModel}.pmd"
    suitable_for[]: "${model.cabin}.${model.vehicle}.cabin"
    suitable_for[]: "${paintUnit}"
}
}
`));
  }
  const bodyName = glassDDS ? 'nca137_body' : 'paint';
  const texture = `/${textureFolder}/${bodyName}.dds`;
  const header = Buffer.alloc(48);
  header.writeUInt32LE(0x70b10a01, 0);
  header.writeUInt32LE(1, 20);
  header[24] = 2;
  header[26] = 1;
  header[27] = 1;
  header[28] = 1;
  header[30] = 2;
  header[31] = 2;
  header[37] = 1;
  header.writeUInt32LE(Buffer.byteLength(texture), 40);
  zip.addFile(`${textureFolder}/${bodyName}.dds`, bodyDDS);
  zip.addFile(`${textureFolder}/${bodyName}.tobj`, Buffer.concat([header, Buffer.from(texture)]));
  zip.addFile(`${definitionFolder}/paint_job/${token}.sii`, Buffer.from(`SiiNunit
{
accessory_paint_job_data : ${paintUnit}
{
    name: "${name}"
    price: 1000
    unlock: 0
    airbrush: true
    part_type: aftermarket
    paint_job_mask: "/${textureFolder}/${bodyName}.tobj"
    suitable_for[]: "${model.cabin}.${model.vehicle}.cabin"
${overrides}}
}
`));
  zip.addFile('manifest.sii', Buffer.from(`SiiNunit
{
mod_package : .package
{
    package_version: "1.0"
    display_name: "${name}"
    author: "Coaches Skin Studio"
    category[]: "paint_job"
    dlc_dependencies[]: "dlc_bus"
    description_file: "description.txt"
}
}
`));
  zip.addFile('description.txt', Buffer.from(`${name}\n${model.vehicle} · ${model.cabin}\nCreated with Coaches Skin Studio.\n`));
  return { zip, name, filename: `${token}-${model.id}.scs` };
}

module.exports = { createPaintjob };
