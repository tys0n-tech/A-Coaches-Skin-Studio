const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const AdmZip = require('adm-zip');
const coachModels = require('./coach-models.json');
const { createPaintjob } = require('./create-paintjob.cjs');

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
function windowArtworkPayload(file) {
  const data = payloadFor(file, new Set(['.png', '.dds']));
  const bytes = Buffer.from(data.base64, 'base64');
  const png = path.extname(file).toLowerCase() === '.png';
  if (png ? bytes.length < 33 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' :
    bytes.length < 128 || bytes.toString('ascii', 0, 4) !== 'DDS ') {
    throw new Error('ไฟล์ลายกระจกเปิดไม่ได้');
  }
  const width = png ? bytes.readUInt32BE(16) : bytes.readUInt32LE(16);
  const height = png ? bytes.readUInt32BE(20) : bytes.readUInt32LE(12);
  const bodyLayout = png && width === 4096 && height === 2048;
  const windowLayout = (width === 2048 && height === 512) || (width === 4096 && height === 1024);
  if (!bodyLayout && !windowLayout) {
    throw new Error(`ไฟล์ ${width} × ${height} ไม่ตรงกับผัง ให้ Export เฟรมเต็ม 4096 × 2048 เป็น PNG หรือใช้ผังกระจก 4096 × 1024 / 2048 × 512`);
  }
  return { ...data, bodyLayout };
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
  ipcMain.handle('dialog:glass-texture', safeCall(async () => {
    const file = await pickOne('Choose transparent window artwork', [{ name: 'Window artwork', extensions: ['png', 'dds'] }]);
    if (!file) return null;
    const data = windowArtworkPayload(file);
    glassTexturePath = data.path;
    return data;
  }));
  ipcMain.handle('file:glass-texture', safeCall(async (_e, file) => {
    if (!file) {
      glassTexturePath = '';
      return null;
    }
    const data = windowArtworkPayload(file);
    glassTexturePath = data.path;
    return data;
  }));
  ipcMain.handle('dialog:model', safeCall(async () => {
    const file = await pickOne('Choose converted coach model (.glb)', [{ name: 'glTF Binary', extensions: ['glb'] }]);
    if (!file) return null;
    projectPaths.model = file;
    return payloadFor(file, new Set(['.glb']));
  }));
  ipcMain.handle('file:model', safeCall(async (_e, file) => {
    const data = payloadFor(file, new Set(['.glb']));
    projectPaths.model = data.path;
    return data;
  }));
  ipcMain.handle('file:coach-model', safeCall(async (_e, id) => {
    const entry = findModel(id);
    const folder = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
    const model = path.join(folder, 'local-models', entry.file);
    const bundled = path.join(resources, 'models', entry.file);
    const file = fs.existsSync(bundled) ? bundled : model;
    return fs.existsSync(file) ? payloadFor(file, new Set(['.glb'])) : null;
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
    const body = await convertDDS(projectPaths.texture);
    if (body.readUInt32LE(16) !== 4096 || body.readUInt32LE(12) !== 2048) {
      throw new Error('ลายรถต้องมีขนาด 4096 × 2048 ตามเทมเพลต');
    }
    let glass = null;
    if (options.includeGlass) {
      if (!model.glass) throw new Error('กระจกข้างรองรับ Scania 13.7 ม.');
      glass = await convertDDS(glassTexturePath, options.glassArtwork ? decodePNG(options.glassArtwork) : null);
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
    const file = await pickOne('Open a working Coaches skin mod template (.scs / .zip)', [{ name: 'ETS2 ZIP mod template', extensions: ['scs', 'zip'] }]);
    if (!file) return null;
    const zip = new AdmZip(file); // only ZIP-based user-created .scs mod packages are supported
    const ddsFiles = zip.getEntries().filter(e => !e.isDirectory && e.entryName.toLowerCase().endsWith('.dds')).map(e => e.entryName);
    templatePath = file;
    return { path: file, ddsFiles, allCount: zip.getEntries().length };
  }));
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
    const result = await dialog.showSaveDialog(win, { title: 'Save studio project', defaultPath: `${project.coachId || 'coaches'}-skin.cssproj`, filters: [{ name: 'Coaches Skin Studio Project', extensions: ['cssproj'] }] });
    if (result.canceled) return null;
    const modes = new Set(['original', 'recommended', 'custom']);
    const slots = Array.isArray(project.mapping?.slots) ? project.mapping.slots : [];
    const mapping = {
      mode: modes.has(project.mapping?.mode) ? project.mapping.mode : 'original',
      slots: slots.filter(slot => typeof slot?.id === 'string' && Number.isInteger(slot.channel))
    };
    const safe = { version: 3, coachId: String(project.coachId || ''), texture: String(project.texturePath || ''), glassTexture: glassTexturePath, model: String(project.modelPath || ''), mapping };
    fs.writeFileSync(result.filePath, JSON.stringify(safe, null, 2), 'utf8');
    return { path: result.filePath };
  }));
  ipcMain.handle('project:open', safeCall(async () => {
    const file = await pickOne('Open studio project', [{ name: 'Coaches Skin Studio Project', extensions: ['cssproj'] }]);
    if (!file) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (![1, 2, 3].includes(data.version)) throw new Error('Unsupported project version');
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
    if (!templatePath) throw new Error('Choose a known-working Coaches skin mod ZIP/.scs template first');
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
    const newDDS = await convertDDS(projectPaths.texture);
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
    let newDDS;
    const source = generatedPNG ? null : ensureFile(file, allowedTextureExt);
    if (source && path.extname(source).toLowerCase() === '.dds') {
      newDDS = fs.readFileSync(source);
    } else {
      const bundled = path.join(resources, 'tools', 'texconv.exe');
      const tool = texconvPath || (fs.existsSync(bundled) ? bundled : 'texconv.exe');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coaches-skin-'));
      try {
        const inputFile = source || path.join(tmp, 'generated-window.png');
        if (generatedPNG) fs.writeFileSync(inputFile, generatedPNG);
        const args = ['-f', 'BC3_UNORM', '-m', '0', '-y', '-o', tmp, inputFile];
        await new Promise((resolve, reject) => {
          const child = spawn(tool, args, { windowsHide: true });
          let stderr = '';
          child.on('error', reject);
          child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 2000); });
          child.on('close', code => code === 0 ? resolve() : reject(new Error(`texconv failed (${code}): ${stderr}`)));
        });
        const generated = path.join(tmp, `${path.parse(inputFile).name}.dds`);
        if (!fs.existsSync(generated)) throw new Error('texconv returned without DDS output');
        newDDS = fs.readFileSync(generated);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    if (newDDS.length < 128 || newDDS.subarray(0, 4).toString('ascii') !== 'DDS ') throw new Error('DDS output is invalid');
    return newDDS;
}
