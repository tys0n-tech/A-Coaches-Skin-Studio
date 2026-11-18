import './style.css';
import coachModels from '../electron/coach-models.json';
import { CoachViewport, COACHES } from './scene.js';

const $ = id => document.getElementById(id);
const api = window.studioAPI;
const state = { coachId: 'scania', localModel: null, texturePath: '', modelPath: '', templatePath: '', mappingMode: 'original', mappings: [], slots: [], wireframe: false, texture: null };
let toastTimeout = null;
let applySequence = 0;
let modelSequence = 0;
const viewport = new CoachViewport($('sceneCanvas'));
let glassRequest = 0;

async function showGlass(file) {
  const request = ++glassRequest;
  const model = modelSequence;
  const supported = state.localModel?.id === 'scania-137' && Boolean(state.modelPath);
  const isCurrent = () => request === glassRequest && model === modelSequence;
  const shown = await viewport.setGlassArtwork(file, isCurrent, supported);
  if (isCurrent()) {
    $('glassPreviewStatus').textContent = shown ? 'กำลังแสดงบนกระจกข้าง' :
      file ? 'พรีวิวได้กับโมเดล Scania 13.7 ม. ในโปรแกรม' : '';
  }
}

async function chooseGlass() {
  try {
    const file = await invoke('openGlassTexture');
    if (!file) return;
    state.glass = file;
    $('glassTextureLabel').textContent = file.filename;
    await showGlass(file);
  } catch (error) { displayError(error); }
}

function toast(message, error = false) {
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
  const request = ++modelSequence;
  state.localModel = null;
  clearTexture();
  const c = viewport.setCoach(id);
  $('glassPreviewStatus').textContent = '';
  const variants = coachModels[c.id] || [];
  const model = variants.find(item => item.id === variantId) || variants[0];
  state.localModel = loadLocalModel ? model : null;
  showVariants(c.id);
  state.coachId = c.id;
  state.modelPath = '';
  state.slots = [];
  state.mappings = [];
  state.mappingMode = 'original';
  state.wireframe = false;
  document.querySelectorAll('.coach-option').forEach(b => b.classList.toggle('selected', b.dataset.coach === id));
  $('vehicleTitle').textContent = c.name;
  $('propertyModel').textContent = c.name;
  $('vehicleSubtitle').textContent = 'Reference illustration · Not original DLC mesh';
  $('propertySource').textContent = 'Illustration';
  $('sceneSource').textContent = 'REFERENCE MODEL';
  $('previewBadge').textContent = 'ILLUSTRATIVE PREVIEW';
  $('modeText').textContent = 'Illustrative mode';
  $('meshSelect').replaceChildren(new Option('นำเข้า GLB ก่อน', ''));
  $('meshSelect').disabled = true;
  $('meshHelp').textContent = 'โมเดลตัวอย่างใช้การฉายภาพแบบ 2D บนด้านข้างรถ ไม่ใช่ UV จริงของ DLC';
  $('mappingStatus').textContent = 'Demo model · skin projection';
  $('mappingRows').hidden = true;
  $('mappingRows').replaceChildren();
  if (loadLocalModel && api && model) {
    invoke('readCoachModel', model.id).then(file => {
      if (request !== modelSequence) return;
      if (file) return useModel(file, request);
      state.localModel = null;
      renderTextureSource();
      toast('ไม่พบไฟล์โมเดลในเครื่อง · ใช้ปุ่มนำเข้าโมเดล 3D', true);
    }).catch(error => {
      if (request === modelSequence) displayError(error);
    });
  }
}

async function useTexture(file, automatic = false) {
  if (!file) return;
  if (file.error) throw new Error(file.error);
  const sequence = ++applySequence;
  const res = await viewport.updateTexture(file);
  if (!res || sequence !== applySequence) return;
  state.texture = file;
  state.texturePath = file.path;
  applyMappings();
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
      });
      row.append(text, select);
      rows.append(row);
    }
  }
  applyMappings();
}

async function useModel(file, request) {
  if (!file || request !== modelSequence) return;
  const legacyVolvo = state.coachId === 'volvo' && /^Volvo[_ -]9700/i.test(file.filename);
  const slots = await viewport.importGLB(file.base64, () => request === modelSequence, legacyVolvo);
  if (!slots) return;
  state.modelPath = file.path;
  state.localModel = (coachModels[state.coachId] || []).find(model => model.file === file.filename) || null;
  showVariants(state.coachId);
  renderTextureSource();
  const coach = COACHES.find(item => item.id === state.coachId);
  const title = state.localModel?.label ? `${coach.name} · ${state.localModel.label}` : coach.name;
  $('vehicleTitle').textContent = $('propertyModel').textContent = title;
  state.slots = slots;
  state.mappings = [];
  const defaults = defaultMappings();
  state.mappingMode = defaults.length ? 'recommended' : 'original';
  $('propertySource').textContent = 'Imported GLB';
  $('sceneSource').textContent = file.filename;
  $('vehicleSubtitle').textContent = 'โมเดล GLB · ใช้ผัง UV ของโมเดล';
  $('previewBadge').textContent = 'IMPORTED GLB · UV PREVIEW';
  $('modeText').textContent = 'Custom GLB mode';
  $('meshSelect').replaceChildren(new Option('วัสดุต้นฉบับ', 'original'));
  if (defaults.length) $('meshSelect').add(new Option(`วัสดุตัวถังที่กำหนดไว้ (${defaults.length})`, 'recommended'));
  $('meshSelect').add(new Option('กำหนดวัสดุและ UV เอง', 'custom'));
  $('meshSelect').disabled = !slots.length;
  $('meshHelp').textContent = 'เลือกวัสดุได้หลายรายการพร้อมกัน และเลือก UV ให้แต่ละรายการ';
  showMapping();
  if (state.glass && state.localModel?.id === 'scania-137') await showGlass(state.glass);
  toast(`โหลดโมเดลแล้ว · ${file.filename}`);
}

async function chooseTexture() { try { await useTexture(await invoke('openTexture')); } catch (e) { displayError(e); } }
async function chooseModel() {
  const request = ++modelSequence;
  try { await useModel(await invoke('openModel'), request); } catch (error) { displayError(error); }
}
async function chooseTemplate() {
  try {
    const data = await invoke('openTemplate');
    if (!data) return;
    state.templatePath = data.path;
    $('templateLabel').textContent = data.path.split(/[\\/]/).pop();
    $('templateLabel').title = data.path;
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
    for (const file of data.ddsFiles) select.add(new Option(file, file));
    select.disabled = false;
    for (const file of data.ddsFiles) glassSelect.add(new Option(file, file));
    const windowEntry = data.ddsFiles.find(file => file.endsWith('/scania137_window.dds'));
    if (windowEntry) {
      glassSelect.value = windowEntry;
      const bodyEntry = data.ddsFiles.find(file => file.endsWith('/nca137_body.dds'));
      if (bodyEntry) select.value = bodyEntry;
    }
    glassSelect.disabled = false;
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
    if (!state.templatePath) throw new Error('กรุณาเลือกม็อดต้นแบบ Coaches .scs ที่ใช้งานได้จริงก่อน');
    if (!$('ddsSelect').value) throw new Error('กรุณาเลือกไฟล์ DDS ที่ต้องการแทนที่');
    if ($('glassDDS').value && !state.glass) throw new Error('กรุณาเลือกไฟล์ PNG โปร่งใสหรือ DDS สำหรับกระจก');
    const output = await invoke('exportMod', { targetDDS: $('ddsSelect').value, glassTargetDDS: $('glassDDS').value });
    if (output) toast(`ส่งออกสำเร็จ: ${output.path} · ต้องทดสอบในเกมก่อนใช้งานจริง`);
  } catch (e) { displayError(e); }
}
async function saveProject() {
  try {
    const result = await invoke('saveProject', { coachId: state.coachId, mapping: { mode: state.mappingMode, slots: state.mappings }, modelPath: state.modelPath, texturePath: state.texturePath });
    if (result) toast(`บันทึกโปรเจ็กต์แล้ว: ${result.path}`);
  } catch (e) { displayError(e); }
}
async function openProject() {
  try {
    const p = await invoke('openProject');
    if (!p) return;
    state.glass = null;
    $('glassTextureLabel').textContent = 'ยังไม่ได้เลือก';
    selectCoach(COACHES.find(c => c.id === p.coachId) ? p.coachId : 'scania', { loadLocalModel: false });
    const request = modelSequence;
    const errors = [];
    try {
      const localModel = coachModels[state.coachId]?.[0];
      const model = p.model ? await invoke('readModelAt', p.model)
        : localModel ? await invoke('readCoachModel', localModel.id) : null;
      await useModel(model, request);
    } catch (e) { errors.push(`โหลดโมเดลไม่สำเร็จ ${e.message}`); }
    if (request !== modelSequence) return;
    if (p.glassTexture) {
      try {
        state.glass = await invoke('readGlassTextureAt', p.glassTexture);
        $('glassTextureLabel').textContent = state.glass.filename;
        if (state.localModel?.id === 'scania-137') await showGlass(state.glass);
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
    const matches = game.candidates.filter(name => /coach|bus/i.test(name));
    $('gameResult').textContent = `${game.path}\n${matches.length ? 'ไฟล์ที่มีคำว่า coach/bus: ' + matches.join(', ') : 'ไม่พบชื่อไฟล์ coach/bus ในระดับโฟลเดอร์นี้ (อาจอยู่ภายใน archive หรือชื่ออื่น)'}`;
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
  overlay.innerHTML = `<div style="background:#fff;border-radius:18px;padding:25px;width:min(580px,94vw);box-shadow:0 30px 90px #17233335;line-height:1.9"><div style="font-weight:800;font-size:22px;letter-spacing:-.6px;margin-bottom:10px">เริ่มต้นใช้งาน Coaches Skin Studio</div><p>1. เลือกรถและรุ่นย่อยทางซ้ายเพื่อเปิดโมเดล 3D ที่ติดตั้งไว้</p><p>2. เพิ่มลาย PNG ของคุณ แล้วเลือกวัสดุตัวถังและ UV ทางด้านล่าง</p><p>3. โปรแกรมจะตรวจไฟล์ PNG ที่คุณเลือก เมื่อแก้ไฟล์เดิมแล้วกด Save โปรแกรมจะรีโหลด 3D ให้</p><p>4. Export .scs ต้องมี working skin template สำหรับ Coaches และใช้ texconv.exe ในการแปลง PNG เป็น DDS</p><button id="dismissHelp" style="border:0;border-radius:9px;background:#205cb1;color:#fff;padding:11px 17px;font-weight:700">เข้าใจแล้ว</button></div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay || e.target.id === 'dismissHelp') overlay.remove(); });
  document.body.append(overlay);
}

document.querySelectorAll('.coach-option').forEach(button => button.addEventListener('click', () => selectCoach(button.dataset.coach)));
$('coachVariantSelect').addEventListener('change', event => selectCoach(state.coachId, { variantId: event.target.value }));
$('importTexture').addEventListener('click', chooseTexture);
$('chooseGlass').addEventListener('click', chooseGlass);
$('clearGlass').addEventListener('click', async () => {
  try {
    await invoke('readGlassTextureAt', '');
    state.glass = null;
    $('glassTextureLabel').textContent = 'ยังไม่ได้เลือก';
    await showGlass(null);
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
