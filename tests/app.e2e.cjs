const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..');
const AdmZip = require(path.join(appDir, 'node_modules/adm-zip'));
const catalog = require(path.join(appDir, 'electron/coach-models.json'));
const output = path.join(require('node:os').tmpdir(), 'coaches-studio-qa-' + process.pid);
fs.mkdirSync(output, { recursive: true });
const paint = process.env.COACH_STUDIO_TEST_PAINT || path.join(output, 'Test-Paint.png');
const resolution = process.env.COACH_STUDIO_TEST_8K === '1' ? 8192 : 4096;
const errors = [];
let openFile = paint;
let selected;
app.setAppPath(appDir);
app.setPath('userData', path.join(output, 'profile-' + process.pid));
process.env.COACH_STUDIO_LOCAL_BUILD = '1';
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [openFile] });
dialog.showSaveDialog = async (_window, options) => ({
  canceled: false,
  filePath: path.join(output, selected.id + (options.title === 'Save coach design template' ? '.png' : options.title === 'Export PNG' ? '.glass.png' : '.scs'))
});
dialog.showErrorBox = (title, message) => errors.push(title + ' ' + message);
require(path.join(appDir, 'electron/main.cjs'));

async function until(check) {
  for (let count = 0; count < 160; count++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Timed out checking ' + selected?.id);
}

app.whenReady().then(async () => {
  await until(() => BrowserWindow.getAllWindows().length);
  const [window] = BrowserWindow.getAllWindows();
  window.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  const run = script => window.webContents.executeJavaScript(script);
  const click = id => run(`document.getElementById('${id}').click()`);
  const contains = (id, text) => until(() => run(
    `document.getElementById('${id}')?.textContent.includes(${JSON.stringify(text)})`
  ).catch(() => false));
  await contains('sceneSource', 'Scania_Touring_13.7m_6x2.glb');
  if (!process.env.COACH_STUDIO_TEST_PAINT) {
    const data = await run(`(() => {
      const canvas = document.createElement('canvas'); canvas.width=${resolution}; canvas.height=${resolution / 2};
      const ctx = canvas.getContext('2d'); ctx.scale(${resolution / 4096},${resolution / 4096});
      ctx.fillStyle='#cf176a'; ctx.fillRect(300,200,3000,450); ctx.fillRect(300,1450,3000,450);
      ctx.fillStyle='#2ba9d8'; ctx.fillRect(250,550,3200,100); ctx.fillRect(250,1450,3200,100);
      return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    fs.writeFileSync(paint, Buffer.from(data, 'base64'));
  }
  for (const [brand, rows] of Object.entries(catalog)) {
    for (const model of rows) {
      selected = model;
      await run(`document.querySelector('[data-coach="${brand}"]').click()`);
      if (rows.length > 1) {
        await run(`(() => { const s = document.getElementById('coachVariantSelect'); s.value = '${model.id}'; s.dispatchEvent(new Event('change')); })()`);
      }
      await contains('sceneSource', model.file);
      await until(() => run("!document.getElementById('saveTemplate').disabled"));
      assert.equal(await run("document.getElementById('glassTools').hidden"), !model.glass);
      const bundled = await run(`window.studioAPI.readCoachModel('${model.id}')`);
      assert.equal(bundled.ok, true);
      assert.equal(bundled.data.windowProfile.id, model.id);
      assert.ok(bundled.data.path.includes('resources'), bundled.data.path);
      await click('exportGlassUV');
      await until(() => fs.existsSync(path.join(output, model.id + '.glass.png')));
      const glassGuide = fs.readFileSync(path.join(output, model.id + '.glass.png'));
      assert.equal(glassGuide.readUInt32BE(16), 4096);
      assert.equal(glassGuide.readUInt32BE(20), 2048);
      await click('saveTemplate');
      await until(() => fs.existsSync(path.join(output, model.id + '.png')));
      const template = fs.readFileSync(path.join(output, model.id + '.png'));
      assert.deepEqual(template, fs.readFileSync(path.join(appDir, 'resources/templates', model.template)));
      await click('importTexture');
      await contains('textureFileName', path.basename(paint));
      await until(() => run("!document.getElementById('exportBtn').disabled"));
      for (const direction of ['left', 'right', 'front', 'rear']) {
        await run(`document.querySelector('[data-view="${direction}"]').click()`);
      }
      await click('exportBtn');
      await contains('toast', 'ส่งออกสำเร็จ');
      const archive = new AdmZip(path.join(output, model.id + '.scs'));
      const entries = archive.getEntries();
      const definition = entries.find(entry => entry.entryName.includes('/paint_job/')).getData().toString();
      assert.ok(definition.includes(`${model.cabin}.${model.vehicle}.cabin`));
      assert.equal(entries.filter(entry => entry.entryName.endsWith('.dds')).length, model.glass ? 2 : 1);
      for (const entry of entries.filter(entry => entry.entryName.endsWith('.dds'))) {
        const data = entry.getData();
        assert.equal(data.toString('ascii', 0, 4), 'DDS ');
        assert.equal(data.readUInt32LE(16), resolution);
        assert.equal(data.readUInt32LE(12), resolution / 2);
      }
      const texture = entries.find(entry => entry.entryName.endsWith('/' + model.windowModel + '.dds'));
      assert.ok(texture);
      openFile = path.join(output, model.id + '-window.dds');
      fs.writeFileSync(openFile, texture.getData());
      await click('chooseGlass');
      await contains('glassTextureLabel', model.id + '-window.png');
      await until(() => run("!document.getElementById('exportBtn').disabled"));
      assert.equal(await run("document.getElementById('glassPreviewStatus').textContent"), 'กำลังแสดงบนกระจกข้าง');
      openFile = paint;
      await run(`document.querySelector('[data-view="left"]').click()`);
      await new Promise(resolve => setTimeout(resolve, 200));
      window.webContents.debugger.attach('1.3');
      const image = await window.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
      window.webContents.debugger.detach();
      fs.writeFileSync(path.join(output, model.id + '-preview.png'), Buffer.from(image.data, 'base64'));
      console.log('PASS bundled model, exact template, view controls, automatic SCS', model.id);
    }
  }
  // Change selections while an existing GLB is still being decoded.
  await run(`(() => {
    document.querySelector('[data-coach="volvo"]').click();
    setTimeout(() => {
      for (let i = 0; i < 12; i++) document.querySelector('[data-coach="' + ['scania', 'volvo', 'man'][i % 3] + '"]').click();
      const select = document.getElementById('coachVariantSelect');
      select.value = 'man-121';
      select.dispatchEvent(new Event('change'));
    }, 40);
  })()`);
  await contains('sceneSource', 'MAN_Lions_Coach_12.1m_4x2.glb');
  await until(() => run("document.getElementById('sceneLoading').hidden"));
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(await run("document.getElementById('sceneSource').textContent"), 'MAN_Lions_Coach_12.1m_4x2.glb');
  assert.equal(await run("document.getElementById('propertySource').textContent"), 'Imported GLB');
  assert.equal(await run("document.getElementById('glassTools').hidden"), false);
  console.log('PASS rapid changes keep the last selected model and hide loading overlay');
  assert.deepEqual(errors, []);
  app.exit(0);
}).catch(error => {
  console.error(error, errors);
  app.exit(1);
});
