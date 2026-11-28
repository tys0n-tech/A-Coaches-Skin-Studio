const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

function createPaintjob(model, filename, bodyDDS, glassDDS, resources, options = {}) {
  const { customName = '', iconDDS = null, tokenSalt = '' } = options || {};
  const fallbackName = path.parse(filename).name.replace(/[\x00-\x1f"\\]/g, ' ').trim().slice(0, 100) || 'Custom Coach Livery';
  const name = String(customName || '').replace(/[\x00-\x1f"\\]/g, ' ').trim().slice(0, 100) || fallbackName;
  const hashInput = tokenSalt ? `${model.id}/${fallbackName}#${tokenSalt}` : `${model.id}/${fallbackName}`;
  const token = 'css' + crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 10);
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
  let iconLine = '';
  if (iconDDS) {
    addShopIcon(zip, unitToken, iconDDS);
    iconLine = `    icon: "${unitToken}"\n`;
  }
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
${iconLine}    airbrush: true
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
  return { zip, name, token, unitToken, filename: `${token}-${model.id}.scs` };
}

const SCANIA_S_SHARED_ACCESSORIES = [
  // Front bumpers (stock + 40mm + Mighty Griffin)
  'f_bumper.low_p', 'f_bumper.mid_p', 'f_bumper.hgh_p',
  'f_bumper.low_40mm_p', 'f_bumper.mid_40mm_p', 'f_bumper.hgh_40mm_p',
  'f_bumper.mg01', 'f_bumper.mg02', 'f_bumper.mg03', 'f_bumper.mg04', 'f_bumper.mg05', 'f_bumper.mg06',
  // Front fenders (cab & chassis)
  'f_fender.stock_p', 'f_fender.stock_p_s', 'f_fender.stock_p_s2',
  'f_fender.hgh_p', 'f_fender.hgh_p_s', 'f_fender.hgh_p_s2',
  'f_fendr_chs.pnt',
  // Front lights, logo, equip, frame, mudflaps
  'f_light_bmp.covered_p',
  'f_light_chs.shape1_p', 'f_light_chs.shape2_p',
  'f_light_top.stock_p', 'f_light_top.stk_nrm_p', 'f_light_top.mod_pnt', 'f_light_top.mod_v8_pnt', 'f_light_top.mod_nrm_pnt', 'f_light_top.mod_nrm_v8p',
  'f_logo.painted', 'f_logo.mg01',
  'f_equip.super_hi_pnt', 'f_equip.super_md_pnt',
  'f_wnd_frame.paint',
  'f_mudflap.scania', 'f_mudflap.scaniah', 'f_mudflap.scanial',
  'f_mudflap.v8', 'f_mudflap.v8h', 'f_mudflap.v8l',
  'f_mudflap.kotr', 'f_mudflap.kotrh', 'f_mudflap.kotrl',
  'f_mudflap.scaniamg', 'f_mudflap.scaniamgh', 'f_mudflap.scaniamgl',
  // Door handles, mirrors, sunshields
  'doorhndl.stock_p',
  'mirror.painted', 'mirror.painted_f',
  's_mirror.painted', 'f_mirror.painted',
  'sunshld.stock', 'sunshld.sunshld_01', 'sunshld.sunshld_02', 'sunshld.sunshld_03', 'sunshld.sunshld_04', 'sunshld.sunshld_05', 'sunshld.sunshld_06',
  'sunshld.mg01', 'sunshld.mg02', 'sunshld.mg03', 'sunshld.mg04', 'sunshld.mg05', 'sunshld.mg06',
  // Rear fenders & tops
  'r_fender.4x2_p', 'r_fender.6x2_p', 'r_fender.6x2l_p', 'r_fender.8x4_p',
  'r_fendr_top.4x2_p', 'r_fendr_top.6x2_p', 'r_fendr_top.6x2l_p', 'r_fendr_top.8x4_p',
  'r_fendr_top.low_4x2_p', 'r_fendr_top.low_6x2_p', 'r_fendr_top.low_6x2l_p', 'r_fendr_top.low_8x4_p',
  // Rear bumper, chassis covers (catwalk), exhausts
  'r_bumper.stock_p', 'r_bumper.duty_p',
  'r_bumper.mg01', 'r_bumper.mg02', 'r_bumper.mg03', 'r_bumper.mg04', 'r_bumper.mg05', 'r_bumper.mg06',
  'r_chs_cover.4x2_p', 'r_chs_cover.6xn_p', 'r_chs_cover.6xnl_p', 'r_chs_cover.8x4_p',
  'exhaust_m.mg01', 'exhaust_m.mg02'
];

const SCANIA_S_ALL_SIDESKIRTS = [
  'sideskirt.4x2_p', 'sideskirt.4x2_p_1', 'sideskirt.4x2_p_2', 'sideskirt.4x2_p_v8', 'sideskirt.4x2_p_v8_1', 'sideskirt.4x2_p_v8_2', 'sideskirt.4x2_mg01',
  'sideskirt.6x2_p', 'sideskirt.6x2_p_1', 'sideskirt.6x2_p_2', 'sideskirt.6x2_p_v8', 'sideskirt.6x2_p_v8_1', 'sideskirt.6x2_p_v8_2', 'sideskirt.6x2_mg01',
  'sideskirt.6x2l_p', 'sideskirt.6x2l_p_1', 'sideskirt.6x2l_p_2', 'sideskirt.6x2l_p_v8', 'sideskirt.6x2l_p_v8_1', 'sideskirt.6x2l_p_v8_2', 'sideskirt.6x2l_mg01',
  'sideskirt.8x4_p'
];

function makeTobj(texture) {
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
  return Buffer.concat([header, Buffer.from(texture)]);
}

function makeUiTobj(texture) {
  const header = Buffer.alloc(48);
  header.writeUInt32LE(0x70b10a01, 0);
  header.writeUInt32LE(1, 20);
  header[24] = 2;
  header[26] = 1;
  header[27] = 1;
  header[28] = 2;
  header[30] = 2;
  header[31] = 2;
  header[37] = 1;
  header.writeUInt32LE(Buffer.byteLength(texture), 40);
  return Buffer.concat([header, Buffer.from(texture)]);
}

function addShopIcon(zip, unitToken, iconDDS) {
  const iconDdsPath = `/material/ui/accessory/${unitToken}.dds`;
  zip.addFile(`material/ui/accessory/${unitToken}.dds`, iconDDS);
  zip.addFile(`material/ui/accessory/${unitToken}.tobj`, makeUiTobj(iconDdsPath));
  zip.addFile(`material/ui/accessory/${unitToken}.mat`, Buffer.from(`effect : "ui.rfx" {
\ttexture : "texture" {
\t\tsource : "/material/ui/accessory/${unitToken}.tobj"
\t\tu_address : clamp
\t\tv_address : clamp
\t\tmip_filter : none
\t}
}
`));
}

function hexToLinearRGB(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return [1.0, 1.0, 1.0];
  return [0, 2, 4].map(offset => {
    const s = parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    return Number((s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4).toFixed(4));
  });
}

function createTruckPaintjob(model, filename, bodyDDS, options = {}) {
  const { customName = '', sideskirtDDS = null, accessoryTextures = [], sharedDDS = null, accessoryColor = null, iconDDS = null, tokenSalt = '' } = options || {};
  const fallbackName = path.parse(filename).name.replace(/[\x00-\x1f"\\]/g, ' ').trim().slice(0, 100) || 'Custom Truck Livery';
  const name = String(customName || '').replace(/[\x00-\x1f"\\]/g, ' ').trim().slice(0, 100) || fallbackName;
  const hashInput = tokenSalt ? `${model.id}/${name}#${tokenSalt}` : `${model.id}/${name}`;
  const token = 'css' + crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 10);
  const unitToken = 'cs' + token.slice(3);
  const definitionFolder = `def/vehicle/truck/${model.vehicle}`;
  const paintUnit = `${unitToken}.${model.vehicle}.paint_job`;
  const cabins = Array.isArray(model.suitableCabins) && model.suitableCabins.length ? model.suitableCabins : [model.cabin];
  for (const unit of [paintUnit, ...cabins.map(cabin => `${cabin}.${model.vehicle}.cabin`)]) {
    if (!unit.split('.').every(part => /^[a-z0-9_]{1,12}$/.test(part))) {
      throw new Error('Invalid SCS unit name: ' + unit);
    }
  }
  const zip = new AdmZip();
  const textureFolder = `vehicle/truck/upgrade/paintjob/coach_studio/${unitToken}`;
  const bodyName = 'paint';
  const texture = `/${textureFolder}/${bodyName}.dds`;
  zip.addFile(`${textureFolder}/${bodyName}.dds`, bodyDDS);
  zip.addFile(`${textureFolder}/${bodyName}.tobj`, makeTobj(texture));

  let iconLine = '';
  if (iconDDS) {
    addShopIcon(zip, unitToken, iconDDS);
    iconLine = `    icon: "${unitToken}"\n`;
  }

  // Merge legacy sideskirtDDS with generalized accessoryTextures array
  const customAccs = Array.isArray(accessoryTextures) ? [...accessoryTextures] : [];
  if (sideskirtDDS && !customAccs.some(item => item.key === 'sideskirt')) {
    const skirtSlot = Array.isArray(model.accessories) ? model.accessories.find(a => a.key === 'sideskirt') : null;
    const sideskirtList = skirtSlot?.accList || (Array.isArray(model.sideskirtAccList) && model.sideskirtAccList.length
      ? model.sideskirtAccList : SCANIA_S_ALL_SIDESKIRTS);
    customAccs.unshift({ key: 'sideskirt', dds: sideskirtDDS, accList: sideskirtList });
  }

  const ovrBlocks = [];
  const taken = new Set();
  for (const item of customAccs) {
    if (!item?.dds || !Array.isArray(item.accList) || !item.accList.length) continue;
    const safeKey = String(item.key || 'acc').replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 24) || 'acc';
    const accTex = `/${textureFolder}/${safeKey}.dds`;
    zip.addFile(`${textureFolder}/${safeKey}.dds`, item.dds);
    zip.addFile(`${textureFolder}/${safeKey}.tobj`, makeTobj(accTex));
    const uniqueAccs = item.accList.filter(acc => !taken.has(acc));
    for (const acc of uniqueAccs) taken.add(acc);
    if (uniqueAccs.length) {
      const list = uniqueAccs.map(acc => `    acc_list[]: "${acc}"`).join('\n');
      ovrBlocks.push(`simple_paint_job_data : .ovr${ovrBlocks.length}\n{\n    paint_job_mask: "/${textureFolder}/${safeKey}.tobj"\n${list}\n}`);
    }
  }

  if (sharedDDS) {
    const baseShared = Array.isArray(model.sharedAccList) && model.sharedAccList.length
      ? model.sharedAccList
      : (model.vehicle.startsWith('scania.') ? [...SCANIA_S_SHARED_ACCESSORIES, ...SCANIA_S_ALL_SIDESKIRTS] : []);
    // Also include accLists of any model.accessories not covered by a custom texture
    const fromSlots = Array.isArray(model.accessories) ? model.accessories.flatMap(a => a.accList || []) : [];
    const remaining = [...new Set([...baseShared, ...fromSlots])].filter(acc => !taken.has(acc));
    if (remaining.length) {
      const sharedTex = `/${textureFolder}/shared.dds`;
      zip.addFile(`${textureFolder}/shared.dds`, sharedDDS);
      zip.addFile(`${textureFolder}/shared.tobj`, makeTobj(sharedTex));
      const list = remaining.map(acc => `    acc_list[]: "${acc}"`).join('\n');
      ovrBlocks.push(`simple_paint_job_data : .ovr${ovrBlocks.length}\n{\n    paint_job_mask: "/${textureFolder}/shared.tobj"\n${list}\n}`);
    }
  }

  // IMPORTANT: ETS2 looks up paint_job/accessory/<unitToken>.sii matching the paint_job unit name!
  if (ovrBlocks.length) {
    zip.addFile(`${definitionFolder}/paint_job/accessory/${unitToken}.sii`, Buffer.from(`SiiNunit\n{\n${ovrBlocks.join('\n')}\n}\n`));
  }

  const [r, g, b] = hexToLinearRGB(accessoryColor);
  const altUv = Boolean(model.alternateUvset);
  const suitableLines = cabins.map(cabin => `    suitable_for[]: "${cabin}.${model.vehicle}.cabin"`).join('\n');
  zip.addFile(`${definitionFolder}/paint_job/${unitToken}.sii`, Buffer.from(`SiiNunit
{
accessory_paint_job_data : ${paintUnit}
{
    name: "${name}"
    price: 10
    unlock: 0
${iconLine}    airbrush: true
    base_color: (${r}, ${g}, ${b})
    base_color_locked: false
    alternate_uvset: ${altUv}
    stock: false
    part_type: aftermarket
    paint_job_mask: "/${textureFolder}/${bodyName}.tobj"
${suitableLines}
}
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
    description_file: "description.txt"
}
}
`));
  zip.addFile('description.txt', Buffer.from(`${name}\n${model.vehicle} · ${cabins.join(', ')}\nCreated with Coaches Skin Studio.\n`));
  return { zip, name, token, unitToken, filename: `${unitToken}-${model.id}.scs` };
}

function createMultiSkinPack(entries, resources, options = {}) {
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error('กรุณาเพิ่มอย่างน้อย 1 ลายลงในแพ็กก่อนส่งออก');
  }
  const rawPackName = String(options?.packName || '').replace(/[\x00-\x1f"\\]/g, ' ').trim().slice(0, 100);
  const packName = rawPackName || `Skin Studio Pack (${entries.length} ลาย)`;
  const packZip = new AdmZip();
  const usedUnitTokens = new Set();
  const usedPaths = new Set();
  const summaryLines = [];
  let hasCoach = false;

  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    const model = item.model;
    const isTruck = model.kind === 'truck';
    if (!isTruck) hasCoach = true;

    let attempt = 0;
    let built = null;
    while (attempt < 32) {
      const salt = attempt === 0 ? '' : `pack-${i}-${attempt}`;
      const candidate = isTruck
        ? createTruckPaintjob(model, item.filename, item.bodyDDS, {
            customName: item.customName,
            accessoryTextures: item.accessoryTextures || [],
            sharedDDS: item.sharedDDS || null,
            accessoryColor: item.accessoryColor || null,
            iconDDS: item.iconDDS || null,
            tokenSalt: salt
          })
        : createPaintjob(model, item.filename, item.bodyDDS, item.glassDDS || null, resources, {
            customName: item.customName,
            iconDDS: item.iconDDS || null,
            tokenSalt: salt
          });
      if (!usedUnitTokens.has(candidate.unitToken)) {
        built = candidate;
        usedUnitTokens.add(candidate.unitToken);
        break;
      }
      attempt++;
    }
    if (!built) throw new Error(`ไม่สามารถสร้างรหัสลายที่ไม่ซ้ำสำหรับ ${item.customName || item.filename}`);

    for (const entry of built.zip.getEntries()) {
      if (entry.isDirectory || entry.entryName === 'manifest.sii' || entry.entryName === 'description.txt') continue;
      if (usedPaths.has(entry.entryName)) {
        throw new Error(`ไฟล์ภายในแพ็กซ้ำกัน: ${entry.entryName}`);
      }
      usedPaths.add(entry.entryName);
      packZip.addFile(entry.entryName, entry.getData());
    }
    summaryLines.push(`${i + 1}. ${built.name} (${model.vehicle})`);
  }

  const dlcLine = hasCoach ? '    dlc_dependencies[]: "dlc_bus"\n' : '';
  packZip.addFile('manifest.sii', Buffer.from(`SiiNunit
{
mod_package : .package
{
    package_version: "1.0"
    display_name: "${packName}"
    author: "Coaches Skin Studio"
    category[]: "paint_job"
${dlcLine}    description_file: "description.txt"
}
}
`));
  packZip.addFile('description.txt', Buffer.from(`${packName}\nIncluded skins (${entries.length}):\n${summaryLines.join('\n')}\n\nCreated with Coaches Skin Studio.\n`));

  const packHash = crypto.createHash('sha256').update(packName + '/' + summaryLines.join('|')).digest('hex').slice(0, 8);
  const slug = packName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'skin-pack';
  return { zip: packZip, name: packName, count: entries.length, filename: `${slug}-${packHash}-${entries.length}skins.scs` };
}

module.exports = { createPaintjob, createTruckPaintjob, createMultiSkinPack };
