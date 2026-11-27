const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const AdmZip = require('adm-zip');
const coachModels = require('./coach-models.json');
const truckModels = require('./truck-models.json');
const { createPaintjob } = require('./create-paintjob.cjs');
const { convertTextureDDS, isLiverySize } = require('./texture-conversion.cjs');

let win;
let watchedPath = '';
let templatePath = '';
let texconvPath = '';
let reloadTimeout = null;
let projectPaths = { texture: '', model: '' };
let glassTexturePath = '';
const allowedTextureExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.dds']);
const MAX_BYTES = 80 * 1024 * 1024;
const localPage = path.join(__dirname, '..', 'dist', 'index.html');
const developmentPage = 'http://127.0.0.1:5173';
const resources = app.isPackaged ? path.join(process.resourcesPath, 'studio-resources') : path.join(app.getAppPath(), 'resources');

function findModel(id) {
  const entry = Object.values(coachModels).flat().find(model => model.id === id);
  if (!entry) throw new Error('เลือกรุ่นรถก่อน');
  return entry;
}

async function writeMod(savePath, zip) {
  const bytes = zip.toBuffer();
  const temp = path.join(path.dirname(savePath), `.${path.basename(savePath)}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx' });
    fs.renameSync(temp, savePath);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function loadSkinTemplate(file) {
  const resolved = path.resolve(file || '');
  if (!['.scs', '.zip'].includes(path.extname(resolved).toLowerCase()) || !fs.statSync(resolved).isFile()) {
    throw new Error('เลือกไฟล์แพ็กลายรถ .scs หรือ .zip');
  }
  const zip = new AdmZip(resolved);
  const ddsEntries = zip.getEntries().filter(entry => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.dds'));
  const ddsFiles = ddsEntries.map(entry => entry.entryName);
  const ddsInfo = Object.fromEntries(ddsEntries.map(entry => {
    const bytes = entry.getData();
    const valid = bytes.length >= 128 && bytes.subarray(0, 4).toString('ascii') === 'DDS ';
    const width = valid ? bytes.readUInt32LE(16) : 0;
    const height = valid ? bytes.readUInt32LE(12) : 0;
    return [entry.entryName, valid && width > 0 && height > 0 && width <= 16384 && height <= 16384 ? { width, height } : null];
  }));
  templatePath = resolved;
  return { path: resolved, ddsFiles, ddsInfo, allCount: zip.getEntries().length };
}

function usesDevelopmentPage() {
  return !app.isPackaged && process.env.COACH_STUDIO_LOCAL_BUILD !== '1';
}

function ensureFile(file, extensions, maxBytes = MAX_BYTES) {
  const p = path.resolve(file || '');
  if (!extensions.has(path.extname(p).toLowerCase())) throw new Error('Unsupported file extension');
  const stats = fs.statSync(p);
  if (!stats.isFile() || stats.size > maxBytes) throw new Error('File missing or too large (80 MB max)');
  return p;
}
function payloadFor(file, extensions) {
  const p = ensureFile(file, extensions);
  return { path: p, filename: path.basename(p), bytes: fs.statSync(p).size, base64: fs.readFileSync(p).toString('base64') };
}
function modelPayload(file) {
  const data = payloadFor(file, new Set(['.glb']));
  const entry = Object.values(coachModels).flat().find(model => model.file === data.filename);
  return { ...data, windowProfile: entry?.windowProfile
    ? JSON.parse(fs.readFileSync(path.join(resources, 'windows', entry.windowProfile), 'utf8')) : null };
}
async function windowArtworkPayload(file) {
  const data = payloadFor(file, new Set(['.png', '.dds']));
  const bytes = Buffer.from(data.base64, 'base64');
  const png = path.extname(file).toLowerCase() === '.png';
  if (png ? bytes.length < 33 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' :
    bytes.length < 128 || bytes.toString('ascii', 0, 4) !== 'DDS ') {
    throw new Error('ไฟล์ลายกระจกเปิดไม่ได้');
  }
  const width = png ? bytes.readUInt32BE(16) : bytes.readUInt32LE(16);
  const height = png ? bytes.readUInt32BE(20) : bytes.readUInt32LE(12);
  const bodyLayout = isLiverySize(width, height);
  const windowLayout = (width === 2048 && height === 512) || (width === 4096 && height === 1024);
  if (!bodyLayout && !windowLayout) {
    throw new Error(`ไฟล์ ${width} × ${height} ไม่ตรงกับผัง ให้ Export เฟรมเต็ม 4096 × 2048 หรือ 8192 × 4096 เป็น PNG หรือใช้ผังกระจก 4096 × 1024 / 2048 × 512`);
  }
  if (!png) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-window-'));
    try {
      const tool = texconvPath || path.join(resources, 'tools', 'texconv.exe');
      await new Promise((resolve, reject) => {
        const child = spawn(tool, ['-ft', 'png', '-m', '1', '-y', '-o', tmp, data.path], { windowsHide: true });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error('แปลงลายกระจก DDS ไม่สำเร็จ')));
      });
      data.base64 = fs.readFileSync(path.join(tmp, path.parse(file).name + '.png')).toString('base64');
      data.filename = path.parse(file).name + '.png';
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  return { ...data, bodyLayout, width, height };
}
function stopWatcher() {
  if (watchedPath) fs.unwatchFile(watchedPath);
  watchedPath = '';
  if (reloadTimeout) clearTimeout(reloadTimeout);
  reloadTimeout = null;
}
function startWatcher(file) {
  stopWatcher();
  watchedPath = file;
  fs.watchFile(file, { interval: 700 }, (newStat, oldStat) => {
    if (newStat.mtimeMs === oldStat.mtimeMs && newStat.size === oldStat.size) return;
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
      try {
        if (win && !win.isDestroyed()) win.webContents.send('texture-changed', payloadFor(file, allowedTextureExt));
      } catch (err) {
        if (win && !win.isDestroyed()) win.webContents.send('texture-changed', { error: err.message });
      }
    }, 500);
  });
}
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(resources, 'branding', 'app.ico'),
    width: 1540, height: 940, minWidth: 1140, minHeight: 730,
    backgroundColor: '#eef0f4', show: true,
    title: `Coaches Skin Studio v${app.getVersion()}`,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  if (usesDevelopmentPage()) win.loadURL(developmentPage);
  else win.loadFile(localPage);
  // Show the window even when the renderer fails; otherwise users see nothing.
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`[Coaches Skin Studio] UI load failed (${code}): ${description} ${url}`);
    dialog.showErrorBox('Coaches Skin Studio: UI could not load',
      `Error ${code}: ${description}\n\nCheck RUN_WINDOWS.bat for details and confirm port 5173 is available.`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Coaches Skin Studio] Renderer exited unexpectedly', details);
    dialog.showErrorBox('Coaches Skin Studio: Renderer stopped',
      `Reason: ${details.reason}\nTry updating your graphics driver, or report the message shown in the launcher.`);
  });
}

async function pickOne(title, filters) {
  const result = await dialog.showOpenDialog(win, { title, properties: ['openFile'], filters });
  return result.canceled ? null : result.filePaths[0];
}
const safeCall = (fn) => async (event, ...args) => {
  try {
    const allowedPage = usesDevelopmentPage() ? developmentPage + '/' : pathToFileURL(localPage).href;
    if (event.sender !== win?.webContents || event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== allowedPage) throw new Error('Untrusted application window');
    return { ok: true, data: await fn(event, ...args) };
  }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
};

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.kaeosopha.coaches.skinstudio');
  createWindow();
  ipcMain.handle('dialog:texture', safeCall(async () => {
    const file = await pickOne('Choose coach skin image', [{ name: 'Skin texture', extensions: ['png', 'jpg', 'jpeg', 'webp', 'dds'] }]);
    if (!file) return null;
    projectPaths.texture = file;
    startWatcher(file);
    return payloadFor(file, allowedTextureExt);
  }));
  ipcMain.handle('file:texture', safeCall(async (_e, file) => {
    const data = payloadFor(file, allowedTextureExt);
    projectPaths.texture = data.path;
    startWatcher(data.path);
    return data;
  }));
  ipcMain.handle('file:composition-texture', safeCall(async () => {
    if (!projectPaths.texture) throw new Error('เพิ่มภาพตัวถังก่อน');
    return windowArtworkPayload(projectPaths.texture);
  }));
  ipcMain.handle('dialog:glass-texture', safeCall(async () => {
    const file = await pickOne('Choose transparent window artwork', [{ name: 'Window artwork', extensions: ['png', 'dds'] }]);
    if (!file) return null;
    const data = await windowArtworkPayload(file);
    glassTexturePath = data.path;
    return data;
  }));
  ipcMain.handle('file:glass-texture', safeCall(async (_e, file) => {
    if (!file) {
      glassTexturePath = '';
      return null;
    }
    const data = await windowArtworkPayload(file);
    glassTexturePath = data.path;
    return data;
  }));
  ipcMain.handle('dialog:model', safeCall(async () => {
    const file = await pickOne('Choose coach or truck model (.glb)', [{ name: 'glTF Binary', extensions: ['glb'] }]);
    if (!file) return null;
    projectPaths.model = file;
    return modelPayload(file);
  }));
  ipcMain.handle('file:model', safeCall(async (_e, file) => {
    const data = modelPayload(file);
    projectPaths.model = data.path;
    return data;
  }));
  ipcMain.handle('file:coach-model', safeCall(async (_e, id) => {
    const entry = findModel(id);
    const folder = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
    const model = path.join(folder, 'local-models', entry.file);
    const bundled = path.join(resources, 'models', entry.file);
    const file = fs.existsSync(bundled) ? bundled : model;
    return fs.existsSync(file) ? modelPayload(file) : null;
  }));
  ipcMain.handle('file:truck-model', safeCall(async (_e, id) => {
    const entry = truckModels.find(model => model.id === id);
    if (!entry) throw new Error('ไม่พบโมเดลรถบรรทุกตัวอย่าง');
    const file = path.join(resources, 'models', 'trucks', entry.file);
    if (!fs.existsSync(file)) throw new Error(`ไม่พบไฟล์โมเดล ${entry.file}`);
    return modelPayload(file);
  }));
  ipcMain.handle('coach:template', safeCall(async (_e, id) => {
    const entry = findModel(id);
    const source = path.join(resources, 'templates', entry.template);
    const save = await dialog.showSaveDialog(win, {
      title: 'Save coach design template', defaultPath: entry.template,
      filters: [{ name: 'PNG template', extensions: ['png'] }]
    });
    if (save.canceled) return null;
    fs.copyFileSync(source, save.filePath);
    return { path: save.filePath };
  }));
  ipcMain.handle('coach:export', safeCall(async (_e, options) => {
    const model = findModel(options?.modelId);
    if (!projectPaths.texture) throw new Error('เพิ่มไฟล์ลายรถก่อนส่งออก');
    const body = await convertDDS(projectPaths.texture, options?.bodyArtwork ? decodePNG(options.bodyArtwork) : null);
    if (!isLiverySize(body.readUInt32LE(16), body.readUInt32LE(12))) {
      throw new Error('ลายรถต้องมีขนาด 4096 × 2048 หรือ 8192 × 4096 ตามเทมเพลต');
    }
    let glass = null;
    if (options.includeGlass) {
      if (!model.glass) throw new Error('ไม่พบผังกระจกรุ่นนี้');
      glass = await convertDDS(glassTexturePath, options.glassArtwork ? decodePNG(options.glassArtwork) : null);
    }
    if (glass && !isLiverySize(glass.readUInt32LE(16), glass.readUInt32LE(12))) {
      throw new Error('ลายกระจกต้องเป็นเฟรมเต็ม 4096 × 2048 หรือ 8192 × 4096');
    }
    const result = createPaintjob(model, projectPaths.texture, body, glass, resources);
    const save = await dialog.showSaveDialog(win, {
      title: 'Export Coaches skin mod (.scs)', defaultPath: result.filename,
      filters: [{ name: 'ETS2 mod', extensions: ['scs'] }]
    });
    if (save.canceled) return null;
    await writeMod(save.filePath, result.zip);
    return { path: save.filePath, name: result.name };
  }));
  ipcMain.handle('dialog:game', safeCall(async () => {
    const res = await dialog.showOpenDialog(win, { title: 'Select your Euro Truck Simulator 2 install folder', properties: ['openDirectory'] });
    if (res.canceled) return null;
    const folder = res.filePaths[0];
    const matches = fs.readdirSync(folder, { withFileTypes: true })
      .filter(x => x.isFile() && /coach|bus|\.scs$/i.test(x.name))
      .map(x => x.name).sort();
    return { path: folder, candidates: matches.slice(0, 150), info: 'Scan only: original game archives are NOT extracted or bundled.' };
  }));
  ipcMain.handle('dialog:template', safeCall(async () => {
    const file = await pickOne('Open a working coach or truck skin mod (.scs / .zip)', [{ name: 'ETS2 ZIP mod', extensions: ['scs', 'zip'] }]);
    if (!file) return null;
    return loadSkinTemplate(file);
  }));
  ipcMain.handle('file:template', safeCall(async (_e, file) => loadSkinTemplate(file)));
  ipcMain.handle('template:dds', safeCall(async () => {
    if (!templatePath) return [];
    return new AdmZip(templatePath).getEntries().filter(e => !e.isDirectory && e.entryName.toLowerCase().endsWith('.dds')).map(e => e.entryName);
  }));
  ipcMain.handle('dialog:texconv', safeCall(async () => {
    const file = await pickOne('Choose texconv.exe (DirectXTex)', [{ name: 'Windows Executable', extensions: ['exe'] }]);
    if (!file) return null;
    if (path.basename(file).toLowerCase() !== 'texconv.exe') throw new Error('Please select texconv.exe');
    texconvPath = file;
    return { path: file };
  }));
  ipcMain.handle('project:save', safeCall(async (_e, project) => {
    const result = await dialog.showSaveDialog(win, { title: 'Save studio project', defaultPath: `${project.vehicleMode === 'truck' ? 'truck' : project.coachId || 'coaches'}-skin.cssproj`, filters: [{ name: 'Coaches Skin Studio Project', extensions: ['cssproj'] }] });
    if (result.canceled) return null;
    const modes = new Set(['original', 'recommended', 'custom']);
    const slots = Array.isArray(project.mapping?.slots) ? project.mapping.slots : [];
    const mapping = {
      mode: modes.has(project.mapping?.mode) ? project.mapping.mode : 'original',
      slots: slots.filter(slot => typeof slot?.id === 'string' && Number.isInteger(slot.channel))
    };
    const safe = { version: 4, vehicleMode: project.vehicleMode === 'truck' ? 'truck' : 'coach', coachId: String(project.coachId || ''), texture: String(project.texturePath || ''), glassTexture: glassTexturePath, model: String(project.modelPath || ''), templatePath: String(project.templatePath || ''), mapping };
    fs.writeFileSync(result.filePath, JSON.stringify(safe, null, 2), 'utf8');
    return { path: result.filePath };
  }));
  ipcMain.handle('project:open', safeCall(async () => {
    const file = await pickOne('Open studio project', [{ name: 'Coaches Skin Studio Project', extensions: ['cssproj'] }]);
    if (!file) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (![1, 2, 3, 4].includes(data.version)) throw new Error('Unsupported project version');
    stopWatcher();
    projectPaths = { texture: '', model: '' };
    glassTexturePath = '';
    return { ...data, path: file };
  }));
  ipcMain.handle('file:exportpng', safeCall(async (_e, dataUrl, filename = 'coaches-paint.png') => {
    if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,/.test(dataUrl)) throw new Error('Invalid PNG data');
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    if (bytes.length > MAX_BYTES) throw new Error('PNG is too large');
    if (typeof filename !== 'string' || !/^[a-zA-Z0-9_-]+\.png$/.test(filename)) throw new Error('Invalid PNG filename');
    const save = await dialog.showSaveDialog(win, { title: 'Export PNG', defaultPath: filename, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (save.canceled) return null;
    fs.writeFileSync(save.filePath, bytes);
    return { path: save.filePath };
  }));
  ipcMain.handle('mod:export', safeCall(async (_e, options) => {
    if (!templatePath) throw new Error('เลือกแพ็กลายรถ .scs หรือ .zip ก่อน');
    if (!projectPaths.texture) throw new Error('Choose a skin texture first');
    const entryName = String(options?.targetDDS || '');
    if (!entryName || !entryName.toLowerCase().endsWith('.dds')) throw new Error('Select a DDS texture from the template');
    const zip = new AdmZip(templatePath);
    const targetEntry = zip.getEntry(entryName);
    if (!targetEntry || targetEntry.isDirectory) throw new Error('Selected DDS entry does not exist in template');
    const glassTarget = String(options?.glassTargetDDS || '');
    const glassEntry = glassTarget && zip.getEntry(glassTarget);
    const generatedGlass = glassTarget && options?.glassArtwork ? decodePNG(options.glassArtwork) : null;
    if (glassTarget && ((!glassTexturePath && !generatedGlass) || !glassEntry || glassEntry.isDirectory ||
        !glassTarget.toLowerCase().endsWith('.dds') || glassTarget === entryName)) {
      throw new Error('Choose a separate window DDS entry and transparent window artwork');
    }
    const newDDS = await convertDDS(projectPaths.texture, options?.bodyArtwork ? decodePNG(options.bodyArtwork) : null);
    const originalDDS = targetEntry.getData();
    if (originalDDS.length < 128 || originalDDS.subarray(0, 4).toString('ascii') !== 'DDS ') throw new Error('ไฟล์ DDS ในแพ็กอ่านขนาดไม่ได้');
    if (newDDS.readUInt32LE(16) !== originalDDS.readUInt32LE(16) || newDDS.readUInt32LE(12) !== originalDDS.readUInt32LE(12)) {
      throw new Error(`ขนาดลายไม่ตรงกับ DDS ของรถ (${originalDDS.readUInt32LE(16)} × ${originalDDS.readUInt32LE(12)} px) ให้บันทึกผัง UV ตามขนาดนี้แล้ว Export PNG ขนาดเท่ากัน`);
    }
    zip.updateFile(entryName, newDDS);
    if (glassTarget) zip.updateFile(glassTarget, await convertDDS(glassTexturePath, generatedGlass));
    const suggested = `${path.parse(templatePath).name}-edited.scs`;
    const save = await dialog.showSaveDialog(win, { title: 'Export Coaches skin mod (.scs)', defaultPath: suggested, filters: [{ name: 'ETS2 mod ZIP', extensions: ['scs'] }] });
    if (save.canceled) return null;
    if (path.resolve(save.filePath).toLowerCase() === path.resolve(templatePath).toLowerCase()) throw new Error('Save as a NEW file (do not overwrite your template)');
    await writeMod(save.filePath, zip);
    return { path: save.filePath };
  }));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { stopWatcher(); if (process.platform !== 'darwin') app.quit(); });

function decodePNG(dataUrl) {
  const prefix = 'data:image/png;base64,';
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix) || dataUrl.length > MAX_BYTES * 2) {
    throw new Error('Invalid PNG data');
  }
  const data = Buffer.from(dataUrl.slice(prefix.length), 'base64');
  if (data.length > MAX_BYTES || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('Invalid PNG data');
  }
  return data;
}

async function convertDDS(file, generatedPNG = null) {
  const source = generatedPNG ? null : ensureFile(file, allowedTextureExt);
  const bundled = path.join(resources, 'tools', 'texconv.exe');
  const tool = texconvPath || (fs.existsSync(bundled) ? bundled : 'texconv.exe');
  return convertTextureDDS(source, generatedPNG, tool);
}
