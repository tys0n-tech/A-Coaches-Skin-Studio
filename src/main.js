import './style.css';
import coachModels from '../electron/coach-models.json';
import truckModels from '../electron/truck-models.json';
import { CoachViewport, COACHES, windowArtwork, bodyArtwork } from './scene.js';

const $ = id => document.getElementById(id);
const api = window.studioAPI;
const state = { vehicleMode: 'coach', coachId: 'scania', localModel: null, texturePath: '', modelPath: '', templatePath: '', ddsInfo: {}, mappingMode: 'original', mappings: [], slots: [], wireframe: false, texture: null };
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
  $('glassTools').hidden = !glassSupported;
  $('truckUVTools').hidden = state.vehicleMode !== 'truck' || !ready;
  $('exportModelUV').disabled = !ready || !state.mappings.length || !state.ddsInfo[$('ddsSelect').value];
  $('modelStatus').textContent = ready ? 'พร้อม · ' + (entry?.label || 'โมเดลรถบรรทุก') : 'กำลังเตรียมโมเดล';
  $('designStatus').textContent = state.texture ? state.texture.filename : 'บันทึกเทมเพลตแล้วใส่ PNG ของคุณ';
  $('reviewStatus').textContent = ready ? 'ดูด้านซ้ายและขวา แล้วตรวจรอยต่อ' : 'รอโมเดล';
  $('exportStatus').textContent = state.texture && ready ? 'พร้อมสร้างไฟล์ .scs' : 'เลือกรถและเพิ่มลายก่อน';
  $('saveTemplate').disabled = !ready || state.vehicleMode === 'truck';
  const hasModTarget = Boolean(state.templatePath && $('ddsSelect').value);
  const exportReady = state.texture && (state.vehicleMode === 'truck'
    ? ready && hasModTarget
    : ready || hasModTarget);
  $('exportBtn').disabled = !exportReady || $('glassPreviewStatus').textContent === 'กำลังโหลดลายกระจก';
  $('vehicleSupport').textContent = ready
    ? (state.vehicleMode === 'truck' ? 'โมเดลรถบรรทุก · UV จริง' : 'ตัวถัง 4K / 8K' + (glassSupported ? ' · ลายกระจกข้าง' : ''))
    : (state.vehicleMode === 'truck' ? 'นำเข้าโมเดลรถบรรทุก GLB' : 'กำลังโหลดรุ่นรถ');
  $('propertyTarget').textContent = state.vehicleMode === 'truck' ? 'ETS2 · Truck skin mod' : 'ETS2 · Coaches DLC';
  $('exportDescription').textContent = state.vehicleMode === 'truck'
    ? 'ใช้แพ็กลายรถ .scs เดิมของรุ่นที่ตรงกัน เลือก DDS ตัวถัง แล้วแทนที่ลายโดยรักษาไฟล์และนิยามอื่นในแพ็กไว้'
    : 'ใส่ PNG ขนาด 4096 × 2048 หรือ 8192 × 4096 (Figma 2x) แล้วสร้างมอดสำหรับรุ่นที่เลือก รวมลายกระจกข้างได้ทั้ง 5 รุ่นในไฟล์เดียว';
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
  $('textureDisplay').replaceChildren();
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
  state.texturePath = '';
  viewport.clearTexture();
  renderTextureSource();
}

function showVariants(id) {
  const variants = coachModels[id] || [];
  $('coachVariant').hidden = variants.length < 2;
  const select = $('coachVariantSelect');
  select.replaceChildren(...variants.map(model => new Option(model.label || '', model.id)));
  if (state.localModel) select.value = state.localModel.id;
}

function selectCoach(id, { loadLocalModel = true, variantId } = {}) {
  state.vehicleMode = 'coach';
  $('coachModeBtn').classList.add('selected');
  $('coachModeBtn').setAttribute('aria-pressed', 'true');
  $('truckModeBtn').classList.remove('selected');
  $('truckModeBtn').setAttribute('aria-pressed', 'false');
  $('coachList').hidden = false;
  $('coachVariant').hidden = false;
  $('truckModeHelp').hidden = true;
  $('coachList').previousElementSibling.hidden = false;
  $('coachVariant').nextElementSibling.hidden = false;
  state.templatePath = '';
  state.ddsInfo = {};
  $('templateLabel').textContent = 'สร้างลายใหม่จากรุ่นที่เลือก';
  $('truckTemplateStatus').textContent = 'ยังไม่ได้เลือกแพ็กลาย';
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
  document.querySelectorAll('.coach-option').forEach(b => b.classList.toggle('selected', b.dataset.coach === id));
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

function selectTruckMode() {
  const request = ++modelSequence;
  state.vehicleMode = 'truck';
  state.localModel = null;
  state.modelPath = '';
  state.templatePath = '';
  state.ddsInfo = {};
  state.loading = false;
  state.loadError = '';
  state.glass = null;
  state.slots = [];
  state.mappings = [];
  state.mappingMode = 'original';
  invoke('readGlassTextureAt', '').catch(() => {});
  clearTexture();
  viewport.detachModel();
  viewport.windowProfile = null;
  viewport.currentMode = 'empty';
  $('coachModeBtn').classList.remove('selected');
  $('coachModeBtn').setAttribute('aria-pressed', 'false');
  $('truckModeBtn').classList.add('selected');
  $('truckModeBtn').setAttribute('aria-pressed', 'true');
  $('coachList').hidden = true;
  $('coachVariant').hidden = true;
  $('truckModeHelp').hidden = false;
  $('truckModelSelect').value = '';
  $('truckLoadBuiltin').disabled = true;
  $('coachList').previousElementSibling.hidden = true;
  $('coachVariant').nextElementSibling.hidden = true;
  $('sceneLoading').hidden = true;
  $('vehicleTitle').textContent = 'รถบรรทุก · นำเข้าโมเดล';
  $('propertyModel').textContent = 'ยังไม่ได้เลือกโมเดล';
  $('propertySource').textContent = 'รอ GLB';
  $('propertyFile').textContent = 'ยังไม่ได้เลือกลาย';
  $('sceneSource').textContent = 'IMPORT TRUCK GLB';
  $('previewBadge').textContent = 'TRUCK MODEL PREVIEW';
  $('vehicleSubtitle').textContent = 'นำเข้า GLB จากรถรุ่นเดียวกับแพ็กลาย .scs';
  $('modeText').textContent = 'Truck skin mode';
  $('meshSelect').replaceChildren(new Option('นำเข้า GLB ก่อน', ''));
  $('meshSelect').disabled = true;
  $('mappingRows').hidden = true;
  $('mappingRows').replaceChildren();
  $('meshHelp').textContent = 'โมเดลรถบรรทุกต้องตรงกับรุ่นและ UV ของ DDS ในแพ็กลายที่จะใช้';
  $('mappingStatus').textContent = 'นำเข้าโมเดลรถบรรทุก GLB';
  $('exportModelUV').disabled = true;
  $('truckTemplateStatus').textContent = 'ยังไม่ได้เลือกแพ็กลาย';
  $('templateLabel').textContent = 'เลือกแพ็กลายรถบรรทุก .scs';
  $('ddsSelect').replaceChildren(new Option('เลือกแพ็กลายก่อน', ''));
  $('ddsSelect').disabled = true;
  $('glassDDS').replaceChildren(new Option('เฉพาะลายตัวถัง', ''));
  $('glassDDS').disabled = true;
  updateWorkflow();
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
  const slots = await viewport.importGLB(file.base64, () => request === modelSequence, legacyVolvo);
  if (!slots) return;
  viewport.windowProfile = state.vehicleMode === 'coach' ? file.windowProfile || null : null;
  state.modelPath = file.path;
  state.localModel = state.vehicleMode === 'coach'
    ? (coachModels[state.coachId] || []).find(model => model.file === file.filename) || null
    : null;
  $('exportGlassUV').disabled = !viewport.windowProfile;
  showVariants(state.coachId);
  renderTextureSource();
  const coach = COACHES.find(item => item.id === state.coachId);
  const title = state.localModel?.label ? `${coach.name} · ${state.localModel.label}`
    : state.vehicleMode === 'truck' ? file.filename.replace(/\.glb$/i, '') : coach?.name || file.filename;
  $('vehicleTitle').textContent = $('propertyModel').textContent = title;
  state.slots = slots;
  state.mappings = [];
  const defaults = defaultMappings();
  state.mappingMode = defaults.length ? 'recommended' : 'original';
  $('propertySource').textContent = 'Imported GLB';
  $('sceneSource').textContent = file.filename;
  $('vehicleSubtitle').textContent = state.vehicleMode === 'truck'
    ? 'รถบรรทุก GLB · ใช้ UV จากโมเดล และแพ็กลาย .scs ที่เลือก'
    : 'โมเดล GLB · ใช้ผัง UV ของโมเดล';
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

async function loadBuiltinTruck() {
  const id = $('truckModelSelect').value;
  if (!id) return;
  const request = ++modelSequence;
  state.loading = true;
  state.loadError = '';
  clearTexture();
  $('sceneLoading').hidden = false;
  $('sceneLoadingText').textContent = 'กำลังโหลดโมเดลรถบรรทุก';
  updateWorkflow();
  try {
    const file = await invoke('readTruckModel', id);
    if (request !== modelSequence) return;
    await useModel(file, request);
  } catch (error) {
    if (request !== modelSequence) return;
    state.loading = false;
    state.loadError = error.message;
    displayError(error);
  }
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
async function exportMod() {
  try {
    if (!state.texturePath) throw new Error('กรุณาเลือกลาย PNG หรือ DDS ก่อน');
    if (state.vehicleMode === 'truck' && (!state.modelPath || !state.templatePath)) throw new Error('รถบรรทุกต้องนำเข้า GLB และเลือกแพ็กลาย .scs ของรุ่นเดียวกันก่อน');
    if (!state.templatePath && (!state.localModel || !state.modelPath)) throw new Error('กรุณาเลือกรุ่นรถก่อน');
    $('exportBtn').disabled = true;
    if (!state.templatePath) {
      const includeGlass = Boolean(state.localModel.glass && (state.glass || state.generatedGlass));
      const output = await invoke('exportCoach', {
        modelId: state.localModel.id, includeGlass, bodyArtwork: state.generatedBody,
        glassArtwork: includeGlass ? state.generatedGlass : null
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
  finally { updateWorkflow(); }
}
async function saveProject() {
  try {
    const result = await invoke('saveProject', { vehicleMode: state.vehicleMode, coachId: state.coachId, mapping: { mode: state.mappingMode, slots: state.mappings }, modelPath: state.modelPath, texturePath: state.texturePath, templatePath: state.templatePath });
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
      ? selectTruckMode()
      : (selectCoach(COACHES.find(c => c.id === p.coachId) ? p.coachId : 'scania', { loadLocalModel: false }), modelSequence);
    const errors = [];
    try {
      const localModel = state.vehicleMode === 'coach' ? coachModels[state.coachId]?.[0] : null;
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
function showHelp() {
  const existing = document.getElementById('helpModal');
  if (existing) { existing.remove(); return; }
  const overlay = document.createElement('div');
  overlay.id = 'helpModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:#1a25347d;display:grid;place-items:center;z-index:100;padding:24px;';
  overlay.innerHTML = `<div style="background:#fff;border-radius:18px;padding:25px;width:min(580px,94vw);box-shadow:0 30px 90px #17233335;line-height:1.9"><div style="font-weight:800;font-size:22px;letter-spacing:-.6px;margin-bottom:10px">เริ่มต้นใช้งาน Coaches Skin Studio</div><p>รถบัส: เลือกรุ่นจากทางซ้าย บันทึกเทมเพลต วาด PNG แล้วนำเข้าเพื่อส่งออกเป็น .scs</p><p>รถบรรทุก: เลือกโหมดรถบรรทุก นำเข้าโมเดล GLB และแพ็กลาย .scs ที่ตรงรุ่น เลือก DDS ตัวถัง แล้วบันทึกผัง UV ตามขนาดนั้น</p><p>วาดลายตามผัง UV และ Export PNG ขนาดเดียวกับ DDS ก่อนนำกลับเข้าโปรแกรมเพื่อแทนที่ในแพ็กเดิม</p><p>ตรวจรถทั้งสี่ด้าน แล้วนำไฟล์ .scs ไปทดสอบในเกม</p><button id="dismissHelp" style="border:0;border-radius:9px;background:#205cb1;color:#fff;padding:11px 17px;font-weight:700">เข้าใจแล้ว</button></div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay || e.target.id === 'dismissHelp') overlay.remove(); });
  document.body.append(overlay);
}

$('retryModel').addEventListener('click', () => selectCoach(state.coachId, { variantId: state.localModel?.id }));
document.querySelectorAll('.coach-option').forEach(button => button.addEventListener('click', () => selectCoach(button.dataset.coach)));
$('coachModeBtn').addEventListener('click', () => selectCoach(state.coachId));
$('truckModeBtn').addEventListener('click', selectTruckMode);
$('truckModelSelect').replaceChildren(new Option('เลือกรถบรรทุกตัวอย่าง', ''), ...truckModels.map(model => new Option(model.label, model.id)));
$('truckModelSelect').addEventListener('change', event => { $('truckLoadBuiltin').disabled = !event.target.value; });
$('truckLoadBuiltin').addEventListener('click', loadBuiltinTruck);
$('truckChooseTemplate').addEventListener('click', chooseTemplate);
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
    if (output) toast(`บันทึกเทมเพลต 4096 × 2048 แล้ว · ${output.path}`);
  } catch (error) { displayError(error); }
});
$('useBuiltin').addEventListener('click', () => {
  state.templatePath = '';
  $('templateLabel').textContent = 'สร้างลายใหม่จากรุ่นที่เลือก';
  $('ddsSelect').replaceChildren(new Option('เลือกให้อัตโนมัติ', ''));
  $('ddsSelect').disabled = true;
  $('glassDDS').replaceChildren(new Option('เลือกให้อัตโนมัติ', ''));
  $('glassDDS').disabled = true;
  toast('ใช้การสร้างมอดจากรุ่นรถที่เลือก');
});
for (const direction of ['left', 'right', 'front', 'rear']) {
  document.querySelector(`[data-view="${direction}"]`).addEventListener('click', () => viewport.setView(direction));
}
$('coachVariantSelect').addEventListener('change', event => selectCoach(state.coachId, { variantId: event.target.value }));
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
$('importModel').addEventListener('click', chooseModel);
$('chooseTemplate').addEventListener('click', chooseTemplate);
$('chooseTexconv').addEventListener('click', chooseTexconv);
$('exportBtn').addEventListener('click', exportMod);
$('saveProject').addEventListener('click', saveProject);
$('openProject').addEventListener('click', openProject);
$('scanGame').addEventListener('click', scanGame);
$('helpBtn').addEventListener('click', showHelp);
$('resetCamera').addEventListener('click', () => viewport.resetCamera());
$('toggleWire').addEventListener('click', () => { state.wireframe = !state.wireframe; viewport.setWireframe(state.wireframe); $('toggleWire').style.background = state.wireframe ? '#dfecff' : ''; });
$('meshSelect').addEventListener('change', e => {
  if (e.target.value === 'custom' && state.mappingMode === 'recommended' && !state.mappings.length) {
    state.mappings = defaultMappings();
  }
  state.mappingMode = e.target.value;
  showMapping();
});
$('brightness').addEventListener('input', e => { $('brightnessValue').textContent = e.target.value; viewport.setLighting(e.target.value); });
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); openProject(); }
});
if (api) {
  api.onTextureChanged(file => {
    if (!state.texturePath) return;
    if (file.error) return toast(`รีโหลดลายไม่สำเร็จ: ${file.error}`, true);
    if (file.path === state.texturePath) useTexture(file, true).catch(displayError);
  });
  selectCoach('scania');
} else toast('เปิดไฟล์ด้วย RUN_WINDOWS.bat เพื่อใช้งานปุ่มนำเข้า / Export', true);
