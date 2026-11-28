import './style.css';
import coachModels from '../electron/coach-models.json';
import truckModels from '../electron/truck-models.json';
import { CoachViewport, COACHES, windowArtwork, bodyArtwork } from './scene.js';
import { initAppleSelects } from './apple-select.js';
import { initAppleColorPickers } from './apple-color-picker.js';

const $ = id => document.getElementById(id);
const api = window.studioAPI;
const DEFAULT_TRUCK_ID = Object.keys(truckModels)[0] || 'scania';
const DEFAULT_ACCESSORY_COLOR = '#f2f4f7';
const state = { vehicleMode: 'coach', coachId: 'scania', truckId: DEFAULT_TRUCK_ID, localModel: null, texturePath: '', modelPath: '', templatePath: '', ddsInfo: {}, mappingMode: 'original', mappings: [], slots: [], wireframe: false, texture: null, accessories: {}, accessoryColor: '', skinPack: [], exporting: false };
let toastTimeout = null;
let applySequence = 0;
let modelSequence = 0;
let modelLoadQueue = Promise.resolve();
const viewport = new CoachViewport($('sceneCanvas'));
let glassRequest = 0;

function updateWorkflow() {
  const entry = state.localModel;
  const ready = Boolean(state.modelPath && !state.loading);
  $('sceneLoading').hidden = !state.loading && !state.loadError;
  $('sceneLoadingText').textContent = state.loadError || ('กำลังโหลด ' + (entry?.label || 'โมเดลรถ'));
  $('retryModel').hidden = !state.loadError;
  $('importTexture').disabled = Boolean(state.loading);
  $('sceneCanvas').setAttribute('aria-busy', String(Boolean(state.loading)));
  const glassSupported = ready && Boolean(entry?.glass) && state.vehicleMode === 'coach';
  const modelAccessories = getModelAccessories(entry);
  const truckAccessorySupported = ready && state.vehicleMode === 'truck' && Boolean(entry);
  const activeAcc = getActiveAccessoryDef(entry);
  $('glassTools').hidden = !glassSupported;
  $('truckAccessoryTools').hidden = !truckAccessorySupported;
  $('accessorySlotSelect').disabled = !modelAccessories.length;
  $('chooseSideskirt').disabled = !activeAcc;
  $('saveSideskirtTemplate').disabled = !activeAcc?.template;
  $('clearSideskirt').disabled = !activeAcc || !state.accessories[activeAcc.key];
  $('truckUVTools').hidden = state.vehicleMode !== 'truck' || !ready;
  $('exportModelUV').disabled = !ready || !state.mappings.length || !state.ddsInfo[$('ddsSelect').value];
  $('modelStatus').textContent = ready ? 'พร้อม · ' + (entry?.label || 'โมเดลรถบรรทุก') : 'กำลังเตรียมโมเดล';
  $('designStatus').textContent = state.texture ? state.texture.filename : 'บันทึกเทมเพลตแล้วใส่ PNG ของคุณ';
  $('reviewStatus').textContent = ready ? 'ดูด้านซ้ายและขวา แล้วตรวจรอยต่อ' : 'รอโมเดล';
  $('exportStatus').textContent = state.texture && ready ? 'พร้อมสร้างไฟล์ .scs' : 'เลือกรถและเพิ่มลายก่อน';
  $('saveTemplate').disabled = !ready || !entry?.template;
  const hasModTarget = Boolean(state.templatePath && $('ddsSelect').value);
  const hasBuiltinModel = Boolean(ready && entry);
  const packCount = state.skinPack.length;
  const glassBusy = $('glassPreviewStatus').textContent === 'กำลังโหลดลายกระจก';
  const exportReady = packCount > 0 || (state.texture && (state.vehicleMode === 'truck'
    ? (hasBuiltinModel && !state.templatePath) || (ready && hasModTarget)
    : ready || hasModTarget));
  $('addToPackBtn').disabled = !hasBuiltinModel || !state.texture || glassBusy || Boolean(state.templatePath);
  $('bulkAddPackBtn').disabled = !hasBuiltinModel || glassBusy || Boolean(state.templatePath);
  $('exportBtn').disabled = state.exporting || !exportReady || glassBusy;
  if (!state.exporting) {
    $('exportBtn').innerHTML = packCount > 0
      ? `Export แพ็กรวม .scs (${packCount} ลาย) <span>↗</span>`
      : 'Export .scs <span>↗</span>';
  }
  $('exportStatus').textContent = packCount > 0
    ? `แพ็กรวม ${packCount} ลาย · พร้อมส่งออก`
    : (state.texture && ready ? 'พร้อมสร้างไฟล์ .scs' : 'เลือกรถและเพิ่มลายก่อน');
  $('vehicleSupport').textContent = ready
    ? (state.vehicleMode === 'truck'
      ? (entry?.templateSize ? `ตัวถัง ${entry.templateSize}${modelAccessories.length ? ` · ของแต่ง ${modelAccessories.length} ชิ้น` : ''}` : 'โมเดลรถบรรทุก · UV จริง')
      : 'ตัวถัง 4K / 8K' + (glassSupported ? ' · ลายกระจกข้าง' : ''))
    : (state.vehicleMode === 'truck' ? 'กำลังโหลดรุ่นรถบรรทุก' : 'กำลังโหลดรุ่นรถ');
  $('propertyTarget').textContent = state.vehicleMode === 'truck' ? 'ETS2 · Truck skin mod' : 'ETS2 · Coaches DLC';
  $('exportDescription').textContent = packCount > 0
    ? `รวมทั้ง ${packCount} ลายในแพ็กเป็นไฟล์ .scs เดียว (คละรุ่นรถบัสและรถบรรทุกได้)`
    : (state.vehicleMode === 'truck'
      ? (state.templatePath || !entry
        ? 'ใช้แพ็กลายรถ .scs เดิมของรุ่นที่ตรงกัน เลือก DDS ตัวถัง แล้วแทนที่ลายโดยรักษาไฟล์และนิยามอื่นในแพ็กไว้'
        : `ใส่ PNG หรือ DDS ขนาด ${entry.templateSize || '4096 × 4096'} ตามเทมเพลตรุ่นนี้ แล้วสร้างมอด .scs หรือเพิ่มหลายลายเข้าแพ็กรวมได้ทันที`)
      : 'ใส่ PNG ขนาด 4096 × 2048 หรือ 8192 × 4096 (Figma 2x) แล้วสร้างมอดเดี่ยว หรือเพิ่มหลายลายเข้าแพ็กรวมในไฟล์ .scs เดียว');
}

async function showGlass() {
  const request = ++glassRequest;
  const model = modelSequence;
  const supported = Boolean(state.vehicleMode === 'coach' && state.localModel?.glass && state.modelPath && viewport.windowProfile);
  const isCurrent = () => request === glassRequest && model === modelSequence;
  state.generatedGlass = null;
  const restoreBody = Boolean(state.generatedBody || state.bodyOverlayActive);
  state.generatedBody = null;
  let file = state.glass;
  const useBodyTexture = !file && $('glassFromBody').checked && /\.png$/i.test(state.texture?.filename || '');
  $('glassPreviewStatus').textContent = supported && (file || useBodyTexture) ? 'กำลังโหลดลายกระจก' : '';
  $('exportBtn').disabled = true;
  try {
    if (supported && (file || useBodyTexture)) {
      const dataUrl = await windowArtwork(file || state.texture, viewport.windowProfile, state.localModel.id === 'scania-137');
      if (!isCurrent()) return;
      state.generatedGlass = dataUrl;
      if (dataUrl) file = { filename: state.localModel.windowModel + '.png', base64: dataUrl.split(',')[1] };
    }
    if (supported && state.glass?.bodyLayout && state.texture) {
      const base = /\.dds$/i.test(state.texture.filename) ? await invoke('readCompositionTexture') : state.texture;
      if (!isCurrent()) return;
      const png = await bodyArtwork(base, state.glass, viewport.windowProfile);
      if (!isCurrent()) return;
      state.bodyOverlayActive = true;
      await viewport.updateTexture({filename:'seam-body.png',base64:png.split(',')[1]});
      if (!isCurrent()) return;
      state.generatedBody = png;
      applyMappings();
    } else if (restoreBody && state.texture) {
      await viewport.updateTexture(state.texture);
      if (!isCurrent()) return;
      state.bodyOverlayActive = false;
      applyMappings();
    }
    const shown = await viewport.setGlassArtwork(file, isCurrent, supported);
    if (isCurrent()) {
      $('glassPreviewStatus').textContent = shown ? (useBodyTexture ? 'ใช้ลาย PNG เดิมบนกระจกข้าง' : (state.generatedBody ? 'ต่อลายกระจกลงตัวถังแล้ว' : 'กำลังแสดงบนกระจกข้าง')) :
        file ? 'เลือกรุ่นรถให้ตรงกับผังกระจก' : '';
    }
  } catch (error) {
    if (isCurrent()) $('glassPreviewStatus').textContent = '';
    throw error;
  } finally {
    if (request === glassRequest) updateWorkflow();
  }
}

async function chooseGlass() {
  try {
    const request = modelSequence;
    const file = await invoke('openGlassTexture');
    if (!file || request !== modelSequence) return;
    state.glass = file;
    $('glassTextureLabel').textContent = file.filename;
    await showGlass();
  } catch (error) { displayError(error); }
}

function getModelAccessories(model) {
  if (!model) return [];
  if (Array.isArray(model.accessories) && model.accessories.length) return model.accessories;
  if (model.sideskirtTemplate) {
    return [{
      key: 'sideskirt',
      label: 'สเกิร์ตข้าง (Sideskirt)',
      template: model.sideskirtTemplate,
      templateSize: model.sideskirtTemplateSize || '',
      accList: model.sideskirtAccList || []
    }];
  }
  return [];
}

function getActiveAccessoryDef(model = state.localModel) {
  const list = getModelAccessories(model);
  if (!list.length) return null;
  const selectedKey = $('accessorySlotSelect')?.value;
  return list.find(item => item.key === selectedKey) || list[0];
}

function updateAccessoryUI() {
  const list = getModelAccessories(state.localModel);
  const active = getActiveAccessoryDef();
  const loaded = active ? state.accessories[active.key] : null;
  if (loaded) {
    $('sideskirtTextureLabel').textContent = `${active.label}: ${loaded.filename}${loaded.width && loaded.height ? ` (${loaded.width} × ${loaded.height})` : ''}`;
  } else if (active) {
    $('sideskirtTextureLabel').textContent = active.templateSize
      ? `${active.label} · เทมเพลต ${active.templateSize}`
      : `${active.label} · ใส่ลาย PNG / DDS`;
  } else {
    $('sideskirtTextureLabel').textContent = 'รุ่นนี้รองรับปรับสีพื้นของแต่งด้านล่าง';
  }
  const loadedEntries = list.filter(item => state.accessories[item.key]);
  $('accessoryLoadedList').hidden = loadedEntries.length === 0;
  $('accessoryLoadedList').textContent = loadedEntries.length
    ? `ใส่ลายของแต่งแล้ว (${loadedEntries.length}): ${loadedEntries.map(item => item.label.split(' (')[0]).join(', ')}`
    : '';
  updateWorkflow();
}

function populateAccessorySlots(model = null) {
  const list = getModelAccessories(model);
  const select = $('accessorySlotSelect');
  if (!list.length) {
    select.replaceChildren(new Option('ไม่มีชิ้นส่วนแยกเทมเพลต', ''));
    select.disabled = true;
  } else {
    select.replaceChildren(...list.map(item => new Option(
      item.templateSize ? `${item.label} (${item.templateSize})` : item.label,
      item.key
    )));
    select.disabled = false;
  }
  updateAccessoryUI();
}

function resetTruckAccessoriesUI(model = null) {
  state.accessories = {};
  state.accessoryColor = DEFAULT_ACCESSORY_COLOR;
  viewport.clearAllAccessoryTextures(false);
  viewport.setAccessoryColor(null);
  $('accessoryColor').value = DEFAULT_ACCESSORY_COLOR;
  $('accessoryColorValue').textContent = DEFAULT_ACCESSORY_COLOR.toUpperCase();
  $('useAccessoryColor').checked = true;
  populateAccessorySlots(model);
}

async function applyAccessoryFile(slotKey, file, automatic = false) {
  const key = slotKey || getActiveAccessoryDef()?.key || 'sideskirt';
  const def = getModelAccessories(state.localModel).find(item => item.key === key);
  const label = def ? def.label.split(' (')[0] : key;
  if (!file) {
    delete state.accessories[key];
    viewport.clearAccessoryTexture(key, true);
    updateAccessoryUI();
    return;
  }
  const request = modelSequence;
  const res = await viewport.setAccessoryTexture(key, file);
  if (!res || request !== modelSequence) return;
  state.accessories[key] = { ...file, width: res.width, height: res.height };
  updateAccessoryUI();
  toast(automatic ? `อัปเดตลาย${label}อัตโนมัติแล้ว · ${file.filename}` : `นำเข้าลาย${label}แล้ว · ${file.filename}`);
}

async function chooseAccessory() {
  try {
    const active = getActiveAccessoryDef();
    if (!active) return;
    const request = modelSequence;
    const file = await invoke('openAccessoryTexture', active.key);
    if (!file || request !== modelSequence) return;
    await applyAccessoryFile(active.key, file);
  } catch (error) { displayError(error); }
}

function toast(message, error = false) {
  updateWorkflow();
  clearTimeout(toastTimeout);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').classList.add('show');
  toastTimeout = setTimeout(() => $('toast').classList.remove('show'), 4500);
}
async function invoke(name, ...args) {
  if (!api) throw new Error('โปรแกรมต้องเปิดผ่าน Electron: ดับเบิลคลิก RUN_WINDOWS.bat');
  const fn = api[name];
  if (typeof fn !== 'function') throw new Error(`Unsupported action: ${name}`);
  const result = await fn(...args);
  if (!result?.ok) throw new Error(result?.error || 'Operation failed');
  return result.data;
}
function displayError(e) {
  console.error(e);
  toast(e?.message || String(e), true);
}
function renderTextureSource() {
  if (state.texture) return;
  const skin = state.localModel?.skin;
  const label = skin || 'ยังไม่ได้เลือกลาย';
  $('textureDisplay').innerHTML = '<div class="default-texture"><span>ลากไฟล์ลายมาวาง<br/><b>หรือกดปุ่มด้านล่าง</b></span></div>';
  $('textureFileName').textContent = label;
  $('propertyFile').textContent = label;
  $('fileDetail').textContent = skin ? `ลายในโมเดล · ${skin}` : label;
  $('propertyFile').title = $('fileDetail').title = '';
  $('resolution').textContent = skin ? 'ลายใน GLB' : '—';
}

function clearTexture() {
  ++applySequence;
  state.texture = null;
  state.generatedGlass = null;
  state.generatedBody = null;
  state.bodyOverlayActive = false;
  if (state.texturePath && api) invoke('readTextureAt', '').catch(() => {});
  state.texturePath = '';
  $('paintNameInput').value = '';
  $('paintNameInput').dataset.edited = '';
  viewport.clearTexture();
  renderTextureSource();
}

function showVariants(id) {
  if (state.vehicleMode !== 'coach') {
    $('coachVariant').hidden = true;
    return;
  }
  const variants = coachModels[id] || [];
  $('coachVariant').hidden = variants.length < 2;
  const select = $('coachVariantSelect');
  select.replaceChildren(...variants.map(model => new Option(model.label || '', model.id)));
  if (state.localModel) select.value = state.localModel.id;
}

function showTruckVariants(id) {
  if (state.vehicleMode !== 'truck') {
    $('truckVariant').hidden = true;
    return;
  }
  const variants = truckModels[id] || [];
  $('truckVariant').hidden = variants.length < 1;
  const select = $('truckVariantSelect');
  select.replaceChildren(...variants.map(model => new Option(model.label || '', model.id)));
  if (state.localModel && variants.some(v => v.id === state.localModel.id)) select.value = state.localModel.id;
}

function triggerAnimClass(el, className, durationMs = 650) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  clearTimeout(el._animTimer);
  el._animTimer = setTimeout(() => el.classList.remove(className), durationMs);
}

function selectCoach(id, { loadLocalModel = true, variantId } = {}) {
  const modeChanged = state.vehicleMode !== 'coach';
  $('modelNotice').hidden = true;
  $('modelNotice').textContent = '';
  state.vehicleMode = 'coach';
  $('coachModeBtn').parentElement?.classList.remove('is-truck');
  $('coachModeBtn').classList.add('selected');
  $('coachModeBtn').setAttribute('aria-pressed', 'true');
  $('truckModeBtn').classList.remove('selected');
  $('truckModeBtn').setAttribute('aria-pressed', 'false');
  $('coachList').hidden = false;
  $('truckList').hidden = true;
  if (modeChanged) triggerAnimClass($('coachList'), 'cascade-in', 520);
  $('coachVariant').hidden = false;
  $('truckVariant').hidden = true;
  $('truckModeHelp').hidden = true;
  $('vehicleSupport').hidden = false;
  $('coachList').previousElementSibling.hidden = false;
  state.templatePath = '';
  state.ddsInfo = {};
  $('templateLabel').textContent = 'สร้างลายใหม่จากรุ่นที่เลือก';
  $('truckTemplateStatus').textContent = 'สร้างมอดใหม่จากรุ่นที่เลือก';
  $('ddsSelect').replaceChildren(new Option('สร้างลายใหม่จากรุ่นที่เลือก', ''));
  $('ddsSelect').disabled = true;
  $('glassDDS').replaceChildren(new Option('เฉพาะลายตัวถัง', ''));
  $('glassDDS').disabled = true;
  const request = ++modelSequence;
  state.localModel = null;
  state.loading = true;
  state.loadError = '';
  state.glass = null;
  state.slots = [];
  state.mappings = [];
  state.mappingMode = 'original';
  invoke('readGlassTextureAt', '').catch(() => {});
  invoke('readAccessoryTextureAt', '', '').catch(() => {});
  resetTruckAccessoriesUI();
  $('glassTextureLabel').textContent = 'PNG เฟรมเต็ม 4K หรือ 8K ตามผังรุ่นที่เลือก';
  clearTexture();
  const c = viewport.setCoach(id);
  $('glassPreviewStatus').textContent = '';
  $('exportGlassUV').disabled = true;
  const variants = coachModels[c.id] || [];
  const model = variants.find(item => item.id === variantId) || variants[0];
  state.localModel = loadLocalModel ? model : null;
  showVariants(c.id);
  state.coachId = c.id;
  state.modelPath = '';
  updateWorkflow();
  state.slots = [];
  state.mappings = [];
  state.mappingMode = 'original';
  state.wireframe = false;
  document.querySelectorAll('.coach-option[data-coach]').forEach(b => b.classList.toggle('selected', b.dataset.coach === id));
  $('vehicleTitle').textContent = c.name;
  $('propertyModel').textContent = c.name;
  $('vehicleSubtitle').textContent = 'กำลังโหลดโมเดลพร้อมผัง UV ของรุ่นที่เลือก';
  $('propertySource').textContent = 'กำลังโหลด';
  $('sceneSource').textContent = 'LOADING MODEL';
  $('previewBadge').textContent = 'LOADING MODEL';
  $('modeText').textContent = 'กำลังโหลดโมเดล';
  $('meshSelect').replaceChildren(new Option('นำเข้า GLB ก่อน', ''));
  $('meshSelect').disabled = true;
  $('meshHelp').textContent = 'เลือกวัสดุและ UV ได้หลังโหลดโมเดลเสร็จ';
  $('mappingStatus').textContent = 'กำลังเตรียมวัสดุ';
  $('mappingRows').hidden = true;
  $('mappingRows').replaceChildren();
  if (loadLocalModel && api && model) {
    modelLoadQueue = modelLoadQueue.catch(() => {}).then(async () => {
      if (request !== modelSequence) return;
      await invoke('readGlassTextureAt', '');
      const file = await invoke('readCoachModel', model.id);
      if (request !== modelSequence) return;
      if (!file) throw new Error('ไม่พบโมเดล ' + model.file);
      await useModel(file, request);
    }).catch(error => {
      if (request !== modelSequence) return;
      state.loading = false;
      state.loadError = error.message;
      displayError(error);
    });
  }
}

function selectTruck(id = state.truckId || DEFAULT_TRUCK_ID, { loadLocalModel = true, variantId } = {}) {
  const modeChanged = state.vehicleMode !== 'truck';
  const brandId = truckModels[id] ? id : DEFAULT_TRUCK_ID;
  const variants = truckModels[brandId] || [];
  const model = variants.find(item => item.id === variantId) || variants[0] || null;
  const request = ++modelSequence;
  state.vehicleMode = 'truck';
  state.truckId = brandId;
  state.localModel = loadLocalModel ? model : null;
  state.modelPath = '';
  state.templatePath = '';
  state.ddsInfo = {};
  state.loading = Boolean(loadLocalModel && api && model);
  state.loadError = '';
  state.glass = null;
  state.slots = [];
  state.mappings = [];
  state.mappingMode = 'original';
  state.wireframe = false;
  invoke('readGlassTextureAt', '').catch(() => {});
  invoke('readAccessoryTextureAt', '', '').catch(() => {});
  resetTruckAccessoriesUI(model);
  clearTexture();
  viewport.detachModel();
  $('modelNotice').hidden = true;
  $('modelNotice').textContent = '';
  viewport.windowProfile = null;
  viewport.currentMode = 'empty';
  $('coachModeBtn').parentElement?.classList.add('is-truck');
  $('coachModeBtn').classList.remove('selected');
  $('coachModeBtn').setAttribute('aria-pressed', 'false');
  $('truckModeBtn').classList.add('selected');
  $('truckModeBtn').setAttribute('aria-pressed', 'true');
  $('coachList').hidden = true;
  $('coachVariant').hidden = true;
  $('truckList').hidden = false;
  if (modeChanged) triggerAnimClass($('truckList'), 'cascade-in', 560);
  showTruckVariants(brandId);
  $('truckModeHelp').hidden = false;
  $('vehicleSupport').hidden = false;
  $('coachList').previousElementSibling.hidden = false;
  document.querySelectorAll('.coach-option[data-truck]').forEach(b => b.classList.toggle('selected', b.dataset.truck === brandId));
  const truckTitle = model ? (model.title || `${model.name} · ${model.label}`) : 'รถบรรทุก · นำเข้าโมเดล';
  $('vehicleTitle').textContent = truckTitle;
  $('propertyModel').textContent = model ? truckTitle : 'ยังไม่ได้เลือกโมเดล';
  $('propertySource').textContent = state.loading ? 'กำลังโหลด' : 'รอ GLB';
  $('propertyFile').textContent = 'ยังไม่ได้เลือกลาย';
  $('sceneSource').textContent = state.loading ? 'LOADING MODEL' : 'IMPORT TRUCK GLB';
  $('previewBadge').textContent = state.loading ? 'LOADING MODEL' : 'TRUCK MODEL PREVIEW';
  $('vehicleSubtitle').textContent = model ? 'กำลังโหลดโมเดลพร้อมผัง UV ของรุ่นที่เลือก' : 'นำเข้า GLB จากรถรุ่นเดียวกับแพ็กลาย .scs';
  $('modeText').textContent = 'Truck skin mode';
  $('meshSelect').replaceChildren(new Option('นำเข้า GLB ก่อน', ''));
  $('meshSelect').disabled = true;
  $('mappingRows').hidden = true;
  $('mappingRows').replaceChildren();
  $('meshHelp').textContent = 'เลือกวัสดุและ UV ได้หลังโหลดโมเดลเสร็จ';
  $('mappingStatus').textContent = state.loading ? 'กำลังเตรียมวัสดุ' : 'นำเข้าโมเดลรถบรรทุก GLB';
  $('exportModelUV').disabled = true;
  $('truckTemplateStatus').textContent = 'สร้างมอดใหม่จากรุ่นที่เลือก';
  $('templateLabel').textContent = 'สร้างลายใหม่จากรุ่นที่เลือก';
  $('ddsSelect').replaceChildren(new Option('สร้างลายใหม่จากรุ่นที่เลือก', ''));
  $('ddsSelect').disabled = true;
  $('glassDDS').replaceChildren(new Option('เฉพาะลายตัวถัง', ''));
  $('glassDDS').disabled = true;
  updateWorkflow();
  if (loadLocalModel && api && model) {
    modelLoadQueue = modelLoadQueue.catch(() => {}).then(async () => {
      if (request !== modelSequence) return;
      const file = await invoke('readCoachModel', model.id);
      if (request !== modelSequence) return;
      if (!file) throw new Error('ไม่พบโมเดล ' + model.file);
      await useModel(file, request);
    }).catch(error => {
      if (request !== modelSequence) return;
      state.loading = false;
      state.loadError = error.message;
      displayError(error);
    });
  }
  return request;
}

async function useTexture(file, automatic = false) {
  if (!file) return;
  if (file.error) throw new Error(file.error);
  const sequence = ++applySequence;
  ++glassRequest;
  state.generatedBody = null;
  state.bodyOverlayActive = false;
  const res = await viewport.updateTexture(file);
  if (!res || sequence !== applySequence) return;
  state.texture = file;
  state.texturePath = file.path;
  if (!automatic) {
    const clean = file.filename.replace(/\.[^.]+$/, '').trim();
    if (!$('paintNameInput').dataset.edited || !$('paintNameInput').value.trim()) {
      $('paintNameInput').value = clean ? `★ ${clean}` : '';
    }
  }
  applyMappings();
  await showGlass();
  if (sequence !== applySequence) return;
  $('fileDetail').textContent = file.path;
  $('fileDetail').title = file.path;
  $('textureFileName').textContent = file.filename;
  $('propertyFile').textContent = file.filename;
  $('propertyFile').title = file.path;
  $('resolution').textContent = res.width && res.height ? `${res.width} × ${res.height}` : res.ext.toUpperCase();
  const preview = $('textureDisplay');
  preview.replaceChildren();
  if (/\.(png|jpg|jpeg|webp)$/i.test(file.filename)) {
    const image = document.createElement('img');
    image.alt = 'Imported UV skin image';
    const ext = file.filename.split('.').pop().toLowerCase();
    image.src = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${file.base64}`;
    preview.append(image);
  } else {
    preview.innerHTML = '<div class="default-texture"><span>DDS TEXTURE<br><b>3D PREVIEW ACTIVE</b></span></div>';
  }
  triggerAnimClass(preview, 'flash-sheen', 700);
  toast(automatic ? `อัปเดตลายอัตโนมัติแล้ว · ${file.filename}` : `นำเข้าลายแล้ว · ${file.filename}`);
}

function defaultMappings() {
  return state.slots.flatMap(slot => slot.defaultChannel === null ? [] : [{ id: slot.id, channel: slot.defaultChannel }]);
}

function applyMappings() {
  const mappings = state.mappingMode === 'recommended' ? defaultMappings()
    : state.mappingMode === 'custom' ? state.mappings : [];
  viewport.applyMappings(mappings, Boolean(state.texture));
  if (!state.modelPath) return;
  const active = viewport.mappings.length;
  $('mappingStatus').textContent = active && state.texture
    ? `ลงลายอยู่ ${active} วัสดุ`
    : state.localModel?.skin
      ? 'แสดงลายที่ฝังในโมเดล'
      : active ? `เลือกไว้ ${active} วัสดุ · เพิ่มไฟล์ลายเพื่อดูผล` : 'ใช้วัสดุต้นฉบับ';
}

function showMapping() {
  $('meshSelect').value = state.mappingMode;
  const rows = $('mappingRows');
  rows.hidden = state.mappingMode !== 'custom';
  rows.replaceChildren();
  if (!rows.hidden) {
    const selected = new Map(state.mappings.map(({id, channel}) => [id, channel]));
    for (const slot of state.slots) {
      const row = document.createElement('label');
      row.className = 'mapping-slot';
      const text = document.createElement('span');
      text.textContent = text.title = slot.name;
      const select = document.createElement('select');
      select.setAttribute('aria-label', slot.name);
      select.add(new Option('วัสดุเดิม', ''));
      for (const channel of slot.channels) select.add(new Option(`UV_${channel}`, String(channel)));
      select.value = selected.get(slot.id)?.toString() ?? '';
      select.addEventListener('change', () => {
        state.mappings = state.mappings.filter(mapping => mapping.id !== slot.id);
        if (select.value !== '') state.mappings.push({ id: slot.id, channel: Number(select.value) });
        applyMappings();
        updateWorkflow();
      });
      row.append(text, select);
      rows.append(row);
    }
  }
  applyMappings();
  updateWorkflow();
}

async function useModel(file, request) {
  if (!file || request !== modelSequence) return;
  const legacyVolvo = state.coachId === 'volvo' && /^Volvo[_ -]9700/i.test(file.filename);
  const slots = await viewport.importGLB(file.base64, () => request === modelSequence, legacyVolvo, state.vehicleMode === 'truck');
  if (!slots) return;
  viewport.windowProfile = state.vehicleMode === 'coach' ? file.windowProfile || null : null;
  state.modelPath = file.path;
  state.localModel = state.vehicleMode === 'coach'
    ? (coachModels[state.coachId] || []).find(model => model.file === file.filename) || null
    : Object.values(truckModels).flat().find(model => model.file === file.filename) || null;
  if (state.vehicleMode === 'truck' && state.localModel?.brand) {
    state.truckId = state.localModel.brand;
    document.querySelectorAll('.coach-option[data-truck]').forEach(b => b.classList.toggle('selected', b.dataset.truck === state.truckId));
  }
  $('exportGlassUV').disabled = !viewport.windowProfile;
  if (state.vehicleMode === 'coach') showVariants(state.coachId);
  else {
    showTruckVariants(state.truckId);
    populateAccessorySlots(state.localModel);
  }
  renderTextureSource();
  const coach = COACHES.find(item => item.id === state.coachId);
  const previewInfo = viewport.modelPreviewInfo;
  const truckPartLabels = { cab_s_high: 'Scania S 2016 · High Roof Cab', cab_s_high_8x4: 'Scania S 2016 · High Roof Cab 8×4' };
  const title = state.vehicleMode === 'coach'
    ? (state.localModel?.label ? `${coach.name} · ${state.localModel.label}` : coach?.name || file.filename)
    : (state.localModel ? (state.localModel.title || `${state.localModel.name} · ${state.localModel.label}`) : (truckPartLabels[previewInfo?.rootName] || file.filename.replace(/\.glb$/i, '')));
  $('vehicleTitle').textContent = $('propertyModel').textContent = title;
  triggerAnimClass($('vehicleTitle').closest('.stage-title-card'), 'refresh-pop', 420);
  state.slots = slots;
  state.mappings = [];
  const defaults = defaultMappings();
  state.mappingMode = defaults.length ? 'recommended' : 'original';
  $('propertySource').textContent = 'Imported GLB';
  $('sceneSource').textContent = file.filename;
  $('vehicleSubtitle').textContent = state.vehicleMode === 'truck'
    ? (previewInfo?.cabOnly ? 'พรีวิวเฉพาะห้องโดยสาร · GLB นี้ไม่มีแชสซีและล้อ' : 'โมเดลรถบรรทุก GLB · ใช้ UV จากโมเดล')
    : 'โมเดล GLB · ใช้ผัง UV ของโมเดล';
  const notices = [];
  if (previewInfo?.cabOnly) notices.push('ไฟล์นี้เป็นเฉพาะชิ้นห้องโดยสาร ไม่ใช่รถทั้งคัน จึงไม่มีแชสซีและล้อให้แสดง');
  if (previewInfo?.missingTextures) notices.push('GLB ไม่มีภาพ texture ฝังมา · พรีวิวใช้สีวัสดุสำรอง ภาพลาย UV ยังใช้งานได้');
  $('modelNotice').textContent = notices.join('  •  ');
  $('modelNotice').hidden = notices.length === 0;
  $('previewBadge').textContent = 'IMPORTED GLB · UV PREVIEW';
  $('modeText').textContent = state.vehicleMode === 'truck' ? 'Truck skin mode' : 'Custom GLB mode';
  $('meshSelect').replaceChildren(new Option('วัสดุต้นฉบับ', 'original'));
  if (defaults.length) $('meshSelect').add(new Option(`วัสดุตัวถังที่กำหนดไว้ (${defaults.length})`, 'recommended'));
  $('meshSelect').add(new Option('กำหนดวัสดุและ UV เอง', 'custom'));
  $('meshSelect').disabled = !slots.length;
  $('meshHelp').textContent = 'เลือกวัสดุได้หลายรายการพร้อมกัน และเลือก UV ให้แต่ละรายการ';
  showMapping();
  await showGlass();
  if (request !== modelSequence) return;
  state.loading = false;
  state.loadError = '';
  toast(`โหลดโมเดลแล้ว · ${file.filename}`);
}

async function chooseTexture() { try { await useTexture(await invoke('openTexture')); } catch (e) { displayError(e); } }
async function chooseModel() {
  try {
    const file = await invoke('openModel');
    if (!file) return;
    const request = ++modelSequence;
    state.loading = true;
    state.loadError = '';
    clearTexture();
    state.glass = null;
    updateWorkflow();
    modelLoadQueue = modelLoadQueue.catch(() => {}).then(() => useModel(file, request)).catch(error => {
      if (request !== modelSequence) return;
      state.loading = false;
      state.loadError = error.message;
      displayError(error);
    });
  } catch (error) { displayError(error); }
}

async function chooseTemplate(filePath = '') {
  try {
    const data = filePath ? await invoke('openTemplateAt', filePath) : await invoke('openTemplate');
    if (!data) return;
    state.templatePath = data.path;
    state.ddsInfo = data.ddsInfo || {};
    $('templateLabel').textContent = data.path.split(/[\\/]/).pop();
    $('templateLabel').title = data.path;
    $('truckTemplateStatus').textContent = `เลือกแล้ว · ${data.path.split(/[\\/]/).pop()}`;
    const select = $('ddsSelect');
    const glassSelect = $('glassDDS');
    glassSelect.replaceChildren(new Option('เฉพาะลายตัวถัง', ''));
    glassSelect.disabled = true;
    select.replaceChildren();
    if (!data.ddsFiles.length) {
      select.add(new Option('ไม่พบไฟล์ .dds ในม็อดนี้', ''));
      select.disabled = true;
      toast('เทมเพลตนี้ไม่มีไฟล์ DDS ให้แทนที่', true);
      return;
    }
    for (const file of data.ddsFiles) {
      const size = state.ddsInfo[file];
      select.add(new Option(size ? `${size.width} × ${size.height} · ${file}` : file, file));
    }
    select.disabled = false;
    for (const file of data.ddsFiles) glassSelect.add(new Option(file, file));
    const windowEntry = data.ddsFiles.find(file => /\/(?:scania137_window|windows_[\w_]+)\.dds$/.test(file));
    if (windowEntry) {
      glassSelect.value = windowEntry;
      const bodyEntry = data.ddsFiles.find(file => file.endsWith('/nca137_body.dds'));
      if (bodyEntry) select.value = bodyEntry;
    }
    glassSelect.disabled = false;
    updateWorkflow();
    toast(`โหลดเทมเพลตแล้ว · พบ ${data.ddsFiles.length} DDS texture`);
  } catch (e) { displayError(e); }
}
async function chooseTexconv() {
  try {
    const info = await invoke('openTexconv');
    if (!info) return;
    $('texconvLabel').textContent = info.path.split(/[\\/]/).pop() + ' · ready';
    $('texconvLabel').title = info.path;
    toast('ตั้งค่า Texconv แล้ว');
  } catch (e) { displayError(e); }
}
async function makeBulkShopIcon(file, badgeText = 'SKIN') {
  const out = document.createElement('canvas');
  out.width = 256;
  out.height = 64;
  const ctx = out.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 256, 64);
  bg.addColorStop(0, '#0d1b34');
  bg.addColorStop(0.55, '#193561');
  bg.addColorStop(1, '#0c203d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 64);
  if (file?.base64 && /\.(png|jpg|jpeg|webp)$/i.test(file.filename || '')) {
    try {
      const ext = file.filename.split('.').pop().toLowerCase();
      const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }));
      const ratio = Math.min(168 / bmp.width, 52 / bmp.height);
      const dw = bmp.width * ratio, dh = bmp.height * ratio;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(78 + (168 - dw) / 2, (64 - dh) / 2, dw, dh, 5);
      ctx.clip();
      ctx.drawImage(bmp, 78 + (168 - dw) / 2, (64 - dh) / 2, dw, dh);
      ctx.restore();
      bmp.close();
    } catch {}
  }
  ctx.fillStyle = '#0071e3';
  ctx.beginPath();
  ctx.roundRect(10, 11, 56, 17, 4);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 9.5px "SF Pro", "SF Pro TH", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, 38, 20);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '700 10.5px "SF Pro", "SF Pro TH", sans-serif';
  ctx.fillText('CUSTOM', 11, 41);
  ctx.fillStyle = 'rgba(255,255,255,0.68)';
  ctx.font = '600 9px "SF Pro", "SF Pro TH", sans-serif';
  ctx.fillText('SKIN STUDIO', 11, 53);
  return out.toDataURL('image/png');
}

function renderSkinPack() {
  const list = state.skinPack;
  const card = $('skinPackCard');
  card.hidden = list.length === 0;
  $('skinPackCount').textContent = `${list.length} ลาย`;
  const container = $('skinPackList');
  container.replaceChildren();
  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'pack-item';
    const img = document.createElement('img');
    img.className = 'pack-thumb';
    img.alt = item.customName;
    if (item.iconArtwork) img.src = item.iconArtwork;
    const info = document.createElement('div');
    info.className = 'pack-item-info';
    const title = document.createElement('strong');
    title.textContent = item.customName;
    title.title = `${item.customName} · ${item.filename}`;
    const meta = document.createElement('small');
    const extras = [];
    if (item.vehicleMode === 'truck') {
      const accCount = Object.keys(item.accessoryPaths || {}).length;
      if (accCount) extras.push(`ของแต่ง ${accCount} ชิ้น`);
      if (item.accessoryColor) extras.push(item.accessoryColor.toUpperCase());
    } else if (item.includeGlass) {
      extras.push('ลายกระจก');
    }
    meta.textContent = [item.modelLabel, ...extras].filter(Boolean).join(' · ');
    info.append(title, meta);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'pack-remove-btn';
    removeBtn.title = 'ลบออกจากแพ็ก';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      state.skinPack = state.skinPack.filter(entry => entry.uid !== item.uid);
      renderSkinPack();
      toast(`ลบ "${item.customName}" ออกจากแพ็กแล้ว`);
    });
    row.append(img, info, removeBtn);
    container.append(row);
  }
  updateWorkflow();
}

function addCurrentToPack() {
  try {
    if (!state.localModel || !state.modelPath) throw new Error('กรุณาเลือกรุ่นรถก่อน');
    if (!state.texturePath || !state.texture) throw new Error('กรุณาเลือกลาย PNG หรือ DDS ก่อน');
    if (state.templatePath) throw new Error('โหมดแพ็กรวมใช้กับรุ่นรถในโปรแกรม (กดล้างแพ็ก .scs เดิมก่อน)');
    const clean = state.texture.filename.replace(/\.[^.]+$/, '').trim();
    const customName = $('paintNameInput').value.trim() || (clean ? `★ ${clean}` : state.localModel.id);
    const includeGlass = state.vehicleMode === 'coach' && Boolean(state.localModel.glass && (state.glass || state.generatedGlass));
    const accessoryPaths = state.vehicleMode === 'truck'
      ? Object.fromEntries(Object.entries(state.accessories).filter(([, f]) => f?.path).map(([k, f]) => [k, f.path]))
      : {};
    const accessoryColor = state.vehicleMode === 'truck' && $('useAccessoryColor').checked
      ? (state.accessoryColor || $('accessoryColor').value) : '';
    let iconArtwork = null;
    try { iconArtwork = viewport.captureShopIcon(state.vehicleMode === 'truck' ? 'TRUCK' : 'COACH'); } catch {}
    const modelLabel = state.vehicleMode === 'truck'
      ? (state.localModel.title || `${state.localModel.name} · ${state.localModel.label}`)
      : `${COACHES.find(c => c.id === state.coachId)?.name || state.localModel.id} · ${state.localModel.label || ''}`.replace(/\s·\s$/, '');
    state.skinPack.push({
      uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      vehicleMode: state.vehicleMode,
      modelId: state.localModel.id,
      modelLabel,
      customName,
      filename: state.texture.filename,
      texturePath: state.texturePath,
      includeGlass,
      glassTexturePath: includeGlass && state.glass?.path ? state.glass.path : '',
      bodyArtwork: state.vehicleMode === 'coach' ? (state.generatedBody || null) : null,
      glassArtwork: includeGlass ? (state.generatedGlass || null) : null,
      accessoryPaths,
      accessoryColor,
      iconArtwork
    });
    renderSkinPack();
    triggerAnimClass($('skinPackCount'), 'pop', 350);
    $('skinPackCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast(`เพิ่ม "${customName}" เข้าแพ็กแล้ว (รวม ${state.skinPack.length} ลาย)`);
  } catch (e) { displayError(e); }
}

async function bulkAddToPack() {
  try {
    if (!state.localModel || !state.modelPath) throw new Error('กรุณาเลือกรุ่นรถก่อน');
    if (state.templatePath) throw new Error('โหมดแพ็กรวมใช้กับรุ่นรถในโปรแกรม');
    const files = await invoke('openMultipleTextures');
    if (!Array.isArray(files) || !files.length) return;
    const isTruck = state.vehicleMode === 'truck';
    const model = state.localModel;
    const modelLabel = isTruck
      ? (model.title || `${model.name} · ${model.label}`)
      : `${COACHES.find(c => c.id === state.coachId)?.name || model.id} · ${model.label || ''}`.replace(/\s·\s$/, '');
    const accessoryPaths = isTruck
      ? Object.fromEntries(Object.entries(state.accessories).filter(([, f]) => f?.path).map(([k, f]) => [k, f.path]))
      : {};
    const accessoryColor = isTruck && $('useAccessoryColor').checked
      ? (state.accessoryColor || $('accessoryColor').value) : '';
    const autoGlass = !isTruck && Boolean(model.glass && viewport.windowProfile && $('glassFromBody').checked);

    for (const file of files) {
      const clean = file.filename.replace(/\.[^.]+$/, '').trim();
      const customName = clean ? `★ ${clean}` : model.id;
      let glassArtwork = null;
      if (autoGlass && /\.png$/i.test(file.filename)) {
        try {
          glassArtwork = await windowArtwork(file, viewport.windowProfile, model.id === 'scania-137');
        } catch {}
      }
      const iconArtwork = await makeBulkShopIcon(file, isTruck ? 'TRUCK' : 'COACH');
      state.skinPack.push({
        uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        vehicleMode: state.vehicleMode,
        modelId: model.id,
        modelLabel,
        customName,
        filename: file.filename,
        texturePath: file.path,
        includeGlass: Boolean(glassArtwork),
        glassTexturePath: '',
        bodyArtwork: null,
        glassArtwork,
        accessoryPaths: { ...accessoryPaths },
        accessoryColor,
        iconArtwork
      });
    }
    renderSkinPack();
    triggerAnimClass($('skinPackCount'), 'pop', 350);
    $('skinPackCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast(`เพิ่ม ${files.length} ลายเข้าแพ็กแล้ว (รวมทั้งหมด ${state.skinPack.length} ลาย)`);
  } catch (e) { displayError(e); }
}

async function exportMod() {
  try {
    if (state.skinPack.length > 0) {
      state.exporting = true;
      $('exportBtn').disabled = true;
      $('exportBtn').innerHTML = `กำลังสร้างแพ็ก (${state.skinPack.length} ลาย)...`;
      const packName = $('packNameInput').value.trim();
      const output = await invoke('exportPack', {
        packName,
        items: state.skinPack.map(item => ({
          modelId: item.modelId,
          customName: item.customName,
          texturePath: item.texturePath,
          includeGlass: item.includeGlass,
          glassTexturePath: item.glassTexturePath,
          bodyArtwork: item.bodyArtwork,
          glassArtwork: item.glassArtwork,
          accessoryPaths: item.accessoryPaths,
          accessoryColor: item.accessoryColor,
          iconArtwork: item.iconArtwork
        }))
      });
      if (output) toast(`ส่งออกแพ็กรวม ${output.count} ลายสำเร็จ: ${output.path} · วางใน mod แล้วเปิดใน Mod Manager ได้เลย`);
      return;
    }
    if (!state.texturePath) throw new Error('กรุณาเลือกลาย PNG หรือ DDS ก่อน');
    if (state.vehicleMode === 'truck' && !state.localModel && (!state.modelPath || !state.templatePath)) throw new Error('รถบรรทุกที่นำเข้าเองต้องเลือกแพ็กลาย .scs ของรุ่นเดียวกันก่อน');
    if (!state.templatePath && (!state.localModel || !state.modelPath)) throw new Error('กรุณาเลือกรุ่นรถก่อน');
    state.exporting = true;
    $('exportBtn').disabled = true;
    if (!state.templatePath) {
      const includeGlass = Boolean(state.localModel.glass && (state.glass || state.generatedGlass));
      const accessoryKeys = state.vehicleMode === 'truck' ? Object.keys(state.accessories) : [];
      const includeSideskirt = accessoryKeys.includes('sideskirt');
      const accessoryColor = state.vehicleMode === 'truck' && $('useAccessoryColor').checked
        ? (state.accessoryColor || $('accessoryColor').value) : '';
      const customName = $('paintNameInput').value.trim();
      let iconArtwork = null;
      try { iconArtwork = viewport.captureShopIcon(state.vehicleMode === 'truck' ? 'TRUCK' : 'COACH'); } catch {}
      const output = await invoke('exportCoach', {
        modelId: state.localModel.id, includeGlass, bodyArtwork: state.generatedBody,
        glassArtwork: includeGlass ? state.generatedGlass : null,
        includeSideskirt, accessoryKeys, accessoryColor, customName, iconArtwork
      });
      if (output) toast(`ส่งออกสำเร็จ: ${output.path} · วางไฟล์ใน Documents/Euro Truck Simulator 2/mod แล้วเปิดใน Mod Manager`);
      return;
    }
    if (!$('ddsSelect').value) throw new Error('กรุณาเลือกไฟล์ DDS ที่ต้องการแทนที่');
    const glassTargetDDS = $('glassDDS').value;
    const hasSeparateGlass = state.glass && !state.glass.bodyLayout;
    if (glassTargetDDS && !hasSeparateGlass && !state.generatedGlass) throw new Error('กรุณาเลือกไฟล์ PNG โปร่งใสหรือ DDS สำหรับกระจก');
    const output = await invoke('exportMod', { bodyArtwork: state.generatedBody, targetDDS: $('ddsSelect').value, glassTargetDDS,
      glassArtwork: glassTargetDDS ? state.generatedGlass : null });
    if (output) toast(`ส่งออกสำเร็จ: ${output.path} · ต้องทดสอบในเกมก่อนใช้งานจริง`);
  } catch (e) { displayError(e); }
  finally { state.exporting = false; updateWorkflow(); }
}
async function saveProject() {
  try {
    const accessoryColor = state.vehicleMode === 'truck' && $('useAccessoryColor').checked ? (state.accessoryColor || $('accessoryColor').value) : '';
    const result = await invoke('saveProject', { vehicleMode: state.vehicleMode, coachId: state.coachId, truckId: state.truckId, variantId: state.localModel?.id || '', accessoryColor, mapping: { mode: state.mappingMode, slots: state.mappings }, modelPath: state.modelPath, texturePath: state.texturePath, templatePath: state.templatePath });
    if (result) toast(`บันทึกโปรเจ็กต์แล้ว: ${result.path}`);
  } catch (e) { displayError(e); }
}
async function openProject() {
  try {
    const p = await invoke('openProject');
    if (!p) return;
    state.glass = null;
    $('glassTextureLabel').textContent = 'ยังไม่ได้เลือก';
    const request = p.vehicleMode === 'truck'
      ? selectTruck(truckModels[p.truckId] ? p.truckId : DEFAULT_TRUCK_ID, { loadLocalModel: false, variantId: p.variantId })
      : (selectCoach(COACHES.find(c => c.id === p.coachId) ? p.coachId : 'scania', { loadLocalModel: false, variantId: p.variantId }), modelSequence);
    const errors = [];
    try {
      const localModel = state.vehicleMode === 'coach'
        ? (coachModels[state.coachId]?.find(m => m.id === p.variantId) || coachModels[state.coachId]?.[0])
        : (truckModels[state.truckId]?.find(m => m.id === p.variantId) || truckModels[state.truckId]?.[0]);
      const model = p.model ? await invoke('readModelAt', p.model)
        : localModel ? await invoke('readCoachModel', localModel.id) : null;
      await useModel(model, request);
    } catch (e) {
      if (request !== modelSequence) return;
      state.loading = false;
      state.loadError = e.message;
      errors.push(`โหลดโมเดลไม่สำเร็จ ${e.message}`);
    }
    if (request !== modelSequence) return;
    if (p.templatePath) await chooseTemplate(p.templatePath);
    if (p.glassTexture) {
      try {
        state.glass = await invoke('readGlassTextureAt', p.glassTexture);
        $('glassTextureLabel').textContent = state.glass.filename;
        if (state.localModel?.glass) await showGlass();
      } catch (e) { errors.push(`โหลดลายกระจกไม่สำเร็จ ${e.message}`); }
    }
    if (p.accessoryColor && /^#[0-9a-f]{6}$/i.test(p.accessoryColor)) {
      state.accessoryColor = p.accessoryColor;
      $('accessoryColor').value = p.accessoryColor;
      $('accessoryColorValue').textContent = p.accessoryColor.toUpperCase();
      $('useAccessoryColor').checked = true;
      viewport.setAccessoryColor(p.accessoryColor);
    }
    const savedAccs = (p.accessoryTextures && typeof p.accessoryTextures === 'object') ? { ...p.accessoryTextures } : {};
    if (p.sideskirtTexture && !savedAccs.sideskirt) savedAccs.sideskirt = p.sideskirtTexture;
    for (const [slotKey, accPath] of Object.entries(savedAccs)) {
      try {
        const accFile = await invoke('readAccessoryTextureAt', slotKey, accPath);
        if (accFile) await applyAccessoryFile(slotKey, accFile);
      } catch (e) { errors.push(`โหลดลายชิ้นส่วน ${slotKey} ไม่สำเร็จ ${e.message}`); }
    }
    if (p.texture) {
      try { await useTexture(await invoke('readTextureAt', p.texture)); }
      catch (e) { errors.push(`โหลดลายไม่สำเร็จ ${e.message}`); }
    }
    if (request !== modelSequence) return;
    if (state.modelPath && p.mapping) {
      state.mappingMode = [...$('meshSelect').options].some(option => option.value === p.mapping.mode)
        ? p.mapping.mode : 'original';
      state.mappings = Array.isArray(p.mapping.slots) ? p.mapping.slots.filter(slot =>
        state.slots.some(entry => entry.id === slot?.id && entry.channels.includes(slot.channel))) : [];
      showMapping();
    } else if (p.meshName) {
      const slot = state.slots.find(entry => entry.id === p.meshName);
      if (slot) {
        state.mappingMode = 'custom';
        state.mappings = [{ id: slot.id, channel: slot.defaultChannel ?? 0 }];
        showMapping();
      }
    }
    if (p.version === 1 && state.modelPath && !p.meshName) {
      state.mappingMode = 'original';
      showMapping();
    }
    if (errors.length) return toast(errors.join(' · '), true);
    toast('เปิดโปรเจ็กต์แล้ว');
  } catch (e) { displayError(e); }
}
async function scanGame() {
  try {
    const game = await invoke('openGameFolder');
    if (!game) return;
    const matches = game.candidates.filter(name => /coach|bus|truck/i.test(name));
    $('gameResult').textContent = `${game.path}\n${matches.length ? 'ไฟล์ที่เกี่ยวกับรถ: ' + matches.join(', ') : 'ไม่พบชื่อไฟล์รถในระดับโฟลเดอร์นี้ (อาจอยู่ภายใน archive หรือชื่ออื่น)'}`;
    $('gameResult').style.whiteSpace = 'pre-line';
    toast('ตรวจโฟลเดอร์เกมแล้ว · ไม่ได้ดึงไฟล์หรือโมเดลออกจากเกม');
  } catch (e) { displayError(e); }
}
function syncColorSwatches(hex) {
  const norm = String(hex || '').toLowerCase();
  document.querySelectorAll('#colorSwatches .swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color?.toLowerCase() === norm);
  });
}

const WELCOME_STORAGE_KEY = 'css_onboarding_seen_v1';

function showHelp(isFirstLaunch = false) {
  const existing = document.getElementById('helpModal');
  if (existing) {
    if (!isFirstLaunch) existing.remove();
    return;
  }
  const overlay = document.createElement('div');
  overlay.id = 'helpModal';
  overlay.className = 'help-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'วิธีใช้งาน Skin Studio');
  overlay.innerHTML = `
    <div class="help-modal-card">
      <div class="welcome-hero">
        <img class="welcome-icon" src="./branding/app.png" alt="Skin Studio" />
        <h2>${isFirstLaunch ? 'ยินดีต้อนรับสู่ Skin Studio' : 'วิธีใช้งาน Skin Studio'}</h2>
        <p>ออกแบบลายรถบัสและรถบรรทุก ETS2 เห็นผลแบบ 3D ทันที พร้อมส่งออกเป็นมอดในไม่กี่คลิก</p>
      </div>

      <div class="welcome-steps">
        <div class="welcome-step">
          <div class="welcome-badge blue">
            <svg viewBox="0 0 24 24"><path d="M5 17H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11l4 4v6a2 2 0 0 1-2 2h-1"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/></svg>
          </div>
          <div class="welcome-step-copy">
            <strong>1. เลือกรถ แล้วโหลดผังไปวาดลาย</strong>
            <span>เลือกโหมด <b>รถบัส</b> หรือ <b>รถบรรทุก</b> ทางซ้าย เลือกยี่ห้อและรุ่นแชสซีที่ต้องการ แล้วกดปุ่ม <b>บันทึกเทมเพลต (.png)</b> เพื่อนำไปเปิดวาดลายใน Figma หรือ Photoshop</span>
          </div>
        </div>

        <div class="welcome-step">
          <div class="welcome-badge green">
            <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/><path d="m9 12 2 2 4-4"/></svg>
          </div>
          <div class="welcome-step-copy">
            <strong>2. ลากรูปมาวางบนรถ — แก้แล้วรีโหลดให้เอง</strong>
            <span>ลากไฟล์ลาย (PNG / DDS) มาวางบนจอ 3D เพื่อเช็กลายรอบคันได้เลย หากกลับไปแก้ลายแล้วเซฟทับ โปรแกรมจะอัปเดตภาพ 3D ให้อัตโนมัติทั้งตัวถัง ของแต่ง และกระจก</span>
          </div>
        </div>

        <div class="welcome-step">
          <div class="welcome-badge purple">
            <svg viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 22a10 10 0 1 1 10-10c0 2.5-1.5 3.5-3.5 3.5h-1.8a2.2 2.2 0 0 0-2.2 2.2c0 .6.2 1.1.6 1.5.4.4.6.9.6 1.5A1.3 1.3 0 0 1 14.4 22H12Z"/></svg>
          </div>
          <div class="welcome-step-copy">
            <strong>3. ใส่ของแต่ง ดูดสีจากรถ และลายกระจก</strong>
            <span>รถบรรทุกโหลดเทมเพลตของแต่งแยกชิ้น (สเกิร์ตข้าง บังแดด กันชน ฯลฯ) และกดวงแหวนสีรุ้งเพื่อเลือกหรือ<b>ดูดสีจากลายรถ 3D</b> ได้เลย ส่วนรถบัสต่อลายขึ้นกระจกข้างให้แบบอัตโนมัติ</span>
          </div>
        </div>

        <div class="welcome-step">
          <div class="welcome-badge orange">
            <svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>
          </div>
          <div class="welcome-step-copy">
            <strong>4. ส่งออก .scs เดี่ยว หรือรวมหลายลายในไฟล์เดียว</strong>
            <span>ตั้งชื่อลายแล้วกด <b>Export .scs</b> ได้เลย หรือกด <b>+ เพิ่มเข้าแพ็ก</b> / <b>เพิ่มหลายไฟล์</b> เพื่อรวมหลายลาย (คละรถบัสและรถบรรทุกได้) เป็นไฟล์ .scs เดียวแล้ววางในโฟลเดอร์ mod ของ ETS2</span>
          </div>
        </div>

        <div class="welcome-step">
          <div class="welcome-badge teal">
            <svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
          </div>
          <div class="welcome-step-copy">
            <strong>5. บันทึกงานค้างไว้ &amp; เครื่องมือขั้นสูง</strong>
            <span>กด <b>บันทึก / เปิดโปรเจ็กต์ (.cssproj)</b> มุมขวาบนเพื่อกลับมาแก้ต่อทีหลังได้ และเปิด <b>เครื่องมือขั้นสูง</b> ทางซ้ายเพื่อนำเข้าไฟล์ .glb เองหรือแทนที่ลายในแพ็ก .scs เดิม</span>
          </div>
        </div>
      </div>

      <div class="welcome-keys">
        <div class="welcome-keys-row welcome-keys-mouse">
          <span><b>เมาส์:</b> คลิกซ้ายลากหมุน · ลูกกลิ้งซูม · คลิกขวาเลื่อนมุม · ปรับความสว่างแสงได้ที่แถบด้านล่าง</span>
        </div>
        <div class="welcome-keys-row">
          <span><kbd>1</kbd>ซ้าย</span>
          <span><kbd>2</kbd>ขวา</span>
          <span><kbd>3</kbd>หน้า</span>
          <span><kbd>4</kbd>ท้าย</span>
          <span><kbd>R</kbd>รีเซ็ตมุม</span>
          <span><kbd>W</kbd>เส้นโครง</span>
          <span><kbd>Ctrl+S</kbd>บันทึก</span>
          <span><kbd>Ctrl+O</kbd>เปิด</span>
        </div>
      </div>

      <div class="welcome-footer">
        <button type="button" id="dismissHelp" class="blue-btn welcome-cta">${isFirstLaunch ? 'เริ่มใช้งานเลย' : 'เข้าใจแล้ว'}</button>
        <span class="welcome-hint">เปิดดูคู่มือนี้ใหม่ได้ทุกเมื่อที่ปุ่ม <b>?</b> มุมขวาบน</span>
      </div>
    </div>
  `;

  const closeModal = () => {
    try { localStorage.setItem(WELCOME_STORAGE_KEY, '1'); } catch {}
    window.removeEventListener('keydown', onEsc, true);
    overlay.classList.remove('visible');
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 220);
  };
  const onEsc = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
    }
  };
  window.addEventListener('keydown', onEsc, true);
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('#dismissHelp')) closeModal();
  });
  document.body.append(overlay);
  void overlay.offsetWidth;
  overlay.classList.add('visible');
}

$('retryModel').addEventListener('click', () => state.vehicleMode === 'truck'
  ? selectTruck(state.truckId, { variantId: state.localModel?.id })
  : selectCoach(state.coachId, { variantId: state.localModel?.id }));
document.querySelectorAll('.coach-option[data-coach]').forEach(button => button.addEventListener('click', () => selectCoach(button.dataset.coach)));
document.querySelectorAll('.coach-option[data-truck]').forEach(button => button.addEventListener('click', () => selectTruck(button.dataset.truck)));
$('coachModeBtn').addEventListener('click', () => selectCoach(state.coachId));
$('truckModeBtn').addEventListener('click', () => selectTruck(state.truckId));
$('truckChooseTemplate').addEventListener('click', () => chooseTemplate());
$('ddsSelect').addEventListener('change', updateWorkflow);
$('exportModelUV').addEventListener('click', async () => {
  try {
    const size = state.ddsInfo[$('ddsSelect').value];
    if (!size) throw new Error('เลือก DDS ตัวถังในแพ็กลายก่อน');
    const name = `${state.modelPath.split(/[\\/]/).pop().replace(/\.glb$/i, '')}_UV_${size.width}x${size.height}.png`;
    const result = await invoke('exportPng', viewport.exportModelUV(size.width, size.height), name);
    if (result) toast(`บันทึกผัง UV ${size.width} × ${size.height} แล้ว · ${result.path}`);
  } catch (error) { displayError(error); }
});
$('saveTemplate').addEventListener('click', async () => {
  try {
    const output = await invoke('saveCoachTemplate', state.localModel.id);
    if (output) toast(`บันทึกเทมเพลต ${state.localModel.templateSize || '4096 × 2048'} แล้ว · ${output.path}`);
  } catch (error) { displayError(error); }
});
$('useBuiltin').addEventListener('click', () => {
  state.templatePath = '';
  $('templateLabel').textContent = 'สร้างลายใหม่จากรุ่นที่เลือก';
  $('truckTemplateStatus').textContent = 'สร้างมอดใหม่จากรุ่นที่เลือก';
  $('ddsSelect').replaceChildren(new Option('เลือกให้อัตโนมัติ', ''));
  $('ddsSelect').disabled = true;
  $('glassDDS').replaceChildren(new Option('เลือกให้อัตโนมัติ', ''));
  $('glassDDS').disabled = true;
  updateWorkflow();
  toast('ใช้การสร้างมอดจากรุ่นรถที่เลือก');
});
for (const direction of ['left', 'right', 'front', 'rear']) {
  const btn = document.querySelector(`[data-view="${direction}"]`);
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-buttons button').forEach(b => b.classList.toggle('active', b === btn));
    viewport.setView(direction);
  });
}
$('coachVariantSelect').addEventListener('change', event => selectCoach(state.coachId, { variantId: event.target.value }));
$('truckVariantSelect').addEventListener('change', event => selectTruck(state.truckId, { variantId: event.target.value }));
$('importTexture').addEventListener('click', chooseTexture);
$('chooseGlass').addEventListener('click', chooseGlass);
$('glassFromBody').addEventListener('change', () => showGlass().catch(displayError));
$('exportGlassUV').addEventListener('click', async () => {
  try {
    const result = await invoke('exportPng', viewport.exportSideWindowUV(), state.localModel.id + '_Glass_Body_UV_4096x2048.png');
    if (result) toast('บันทึกผังกระจกแล้ว');
  } catch (error) { displayError(error); }
});
$('clearGlass').addEventListener('click', async () => {
  try {
    await invoke('readGlassTextureAt', '');
    state.glass = null;
    $('glassTextureLabel').textContent = 'ยังไม่ได้เลือก';
    await showGlass();
  } catch (error) { displayError(error); }
});
$('accessorySlotSelect').addEventListener('change', updateAccessoryUI);
$('chooseSideskirt').addEventListener('click', chooseAccessory);
$('saveSideskirtTemplate').addEventListener('click', async () => {
  try {
    const active = getActiveAccessoryDef();
    if (!active) return;
    const output = await invoke('saveAccessoryTemplate', state.localModel.id, active.key);
    if (output) toast(`บันทึกเทมเพลต${active.label.split(' (')[0]} ${active.templateSize || ''} แล้ว · ${output.path}`);
  } catch (error) { displayError(error); }
});
$('clearSideskirt').addEventListener('click', async () => {
  try {
    const active = getActiveAccessoryDef();
    if (!active) return;
    await invoke('readAccessoryTextureAt', active.key, '');
    await applyAccessoryFile(active.key, null);
    toast(`ล้างลาย${active.label.split(' (')[0]}แล้ว`);
  } catch (error) { displayError(error); }
});
$('accessoryColor').addEventListener('input', event => {
  const hex = event.target.value;
  state.accessoryColor = hex;
  $('accessoryColorValue').textContent = hex.toUpperCase();
  $('useAccessoryColor').checked = true;
  syncColorSwatches(hex);
  viewport.setAccessoryColor(hex);
});
document.querySelectorAll('#colorSwatches .swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    const hex = btn.dataset.color;
    state.accessoryColor = hex;
    $('accessoryColor').value = hex;
    $('accessoryColorValue').textContent = hex.toUpperCase();
    $('useAccessoryColor').checked = true;
    syncColorSwatches(hex);
    viewport.setAccessoryColor(hex);
  });
});
$('useAccessoryColor').addEventListener('change', event => {
  const active = event.target.checked;
  const hex = $('accessoryColor').value;
  state.accessoryColor = active ? hex : '';
  viewport.setAccessoryColor(active ? hex : null);
});
$('resetAccessoryColor').addEventListener('click', () => {
  state.accessoryColor = DEFAULT_ACCESSORY_COLOR;
  $('accessoryColor').value = DEFAULT_ACCESSORY_COLOR;
  $('accessoryColorValue').textContent = DEFAULT_ACCESSORY_COLOR.toUpperCase();
  $('useAccessoryColor').checked = true;
  syncColorSwatches(DEFAULT_ACCESSORY_COLOR);
  viewport.setAccessoryColor(null);
});
$('paintNameInput').addEventListener('input', event => {
  event.target.dataset.edited = event.target.value.trim() ? '1' : '';
});
$('importModel').addEventListener('click', chooseModel);
$('chooseTemplate').addEventListener('click', chooseTemplate);
$('chooseTexconv').addEventListener('click', chooseTexconv);
$('exportBtn').addEventListener('click', exportMod);
$('addToPackBtn').addEventListener('click', addCurrentToPack);
$('bulkAddPackBtn').addEventListener('click', bulkAddToPack);
$('clearPackBtn').addEventListener('click', () => {
  if (!state.skinPack.length) return;
  state.skinPack = [];
  renderSkinPack();
  toast('ล้างรายการแพ็กรวมแล้ว');
});
$('saveProject').addEventListener('click', saveProject);
$('openProject').addEventListener('click', openProject);
$('scanGame').addEventListener('click', scanGame);
$('helpBtn').addEventListener('click', () => showHelp(false));
$('resetCamera').addEventListener('click', () => {
  document.querySelectorAll('.view-buttons button').forEach(b => b.classList.remove('active'));
  triggerAnimClass($('resetCamera'), 'spinning', 520);
  viewport.resetCamera();
});
$('toggleWire').addEventListener('click', () => {
  state.wireframe = !state.wireframe;
  viewport.setWireframe(state.wireframe);
  $('toggleWire').style.background = state.wireframe ? 'rgba(0, 113, 227, 0.16)' : '';
  $('toggleWire').style.color = state.wireframe ? '#0071e3' : '';
});
$('meshSelect').addEventListener('change', e => {
  if (e.target.value === 'custom' && state.mappingMode === 'recommended' && !state.mappings.length) {
    state.mappings = defaultMappings();
  }
  state.mappingMode = e.target.value;
  showMapping();
});
$('brightness').addEventListener('input', e => { $('brightnessValue').textContent = e.target.value; viewport.setLighting(e.target.value); });

// Direct Drag & Drop skin files onto 3D viewport
let dragDepth = 0;
const dropZone = $('sceneDropZone');
const dropOverlay = $('dropOverlay');
dropZone.addEventListener('dragenter', e => {
  e.preventDefault();
  dragDepth++;
  dropOverlay.hidden = false;
});
dropZone.addEventListener('dragover', e => { e.preventDefault(); });
dropZone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const dropped = e.dataTransfer?.files?.[0];
  if (!dropped) return;
  try {
    if (dropped.path && /\.(png|jpg|jpeg|webp|dds)$/i.test(dropped.name)) {
      await useTexture(await invoke('readTextureAt', dropped.path));
    } else if (dropped.path && /\.glb$/i.test(dropped.name)) {
      const request = ++modelSequence;
      state.loading = true;
      state.loadError = '';
      clearTexture();
      updateWorkflow();
      await useModel(await invoke('readModelAt', dropped.path), request);
    } else {
      toast('รองรับเฉพาะไฟล์ PNG, JPG, WebP, DDS หรือ GLB', true);
    }
  } catch (err) { displayError(err); }
});

window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); openProject(); return; }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const viewKey = { '1': 'left', '2': 'right', '3': 'front', '4': 'rear' }[e.key];
  if (viewKey) {
    document.querySelector(`[data-view="${viewKey}"]`)?.click();
  } else if (e.key.toLowerCase() === 'r') {
    $('resetCamera').click();
  } else if (e.key.toLowerCase() === 'w') {
    $('toggleWire').click();
  }
});
initAppleSelects();
initAppleColorPickers();
if (api) {
  api.onTextureChanged(file => {
    if (!state.texturePath) return;
    if (file.error) return toast(`รีโหลดลายตัวถังไม่สำเร็จ: ${file.error}`, true);
    if (file.path === state.texturePath) useTexture(file, true).catch(displayError);
  });
  api.onGlassTextureChanged(file => {
    if (!state.glass?.path) return;
    if (file.error) return toast(`รีโหลดลายกระจกไม่สำเร็จ: ${file.error}`, true);
    if (file.path === state.glass.path) {
      state.glass = file;
      $('glassTextureLabel').textContent = file.filename;
      showGlass()
        .then(() => toast(`อัปเดตลายกระจกอัตโนมัติแล้ว · ${file.filename}`))
        .catch(displayError);
    }
  });
  api.onAccessoryTextureChanged(file => {
    const slotKey = file?.slotKey;
    const current = slotKey ? state.accessories[slotKey] : null;
    if (!current?.path) return;
    if (file.error) return toast(`รีโหลดลายของแต่งไม่สำเร็จ: ${file.error}`, true);
    if (file.path === current.path) applyAccessoryFile(slotKey, file, true).catch(displayError);
  });
  selectCoach('scania');
  modelLoadQueue.finally(() => {
    try {
      if (!localStorage.getItem(WELCOME_STORAGE_KEY)) {
        setTimeout(() => showHelp(true), 220);
      }
    } catch {}
  });
} else toast('เปิดไฟล์ด้วย RUN_WINDOWS.bat เพื่อใช้งานปุ่มนำเข้า / Export', true);
