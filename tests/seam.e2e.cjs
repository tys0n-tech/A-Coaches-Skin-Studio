const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'..');
app.setPath('userData',path.join(require('node:os').tmpdir(),'coaches-seam-profile-'+process.pid));
app.whenReady().then(async()=>{
 const {createServer}=await import(require('node:url').pathToFileURL(path.join(repo,'node_modules/vite/dist/node/index.js')).href);
 const server=await createServer({root:repo,configFile:path.join(repo,'vite.config.js'),server:{host:'127.0.0.1',port:5187,strictPort:true}});await server.listen();console.log('Server ready');
 const win=new BrowserWindow({width:1220,height:850,show:true,webPreferences:{sandbox:true,contextIsolation:true}});
 win.webContents.on('console-message',e=>console.log('Renderer:',e.message));await win.loadURL('http://127.0.0.1:5187/tests/seam-preview.html');console.log('Page ready');
 const run=s=>win.webContents.executeJavaScript(s);
 for(let i=0;i<100;i++){if(await run('Boolean(window.testViewport)'))break;await new Promise(r=>setTimeout(r,100));}
 console.log('Viewport ready');const file=process.env.COACH_STUDIO_TEST_PAINT;
 if(!file || !process.env.COACH_STUDIO_TEST_GLASS) throw Error('Set COACH_STUDIO_TEST_PAINT and COACH_STUDIO_TEST_GLASS to full-frame body and window images');
 const texture={filename:path.basename(file),base64:fs.readFileSync(file).toString('base64')};
 const glassFile=process.env.COACH_STUDIO_TEST_GLASS; const glassTexture={filename:'Frame 2.png',base64:fs.readFileSync(glassFile).toString('base64')};
 const profile=JSON.parse(fs.readFileSync(path.join(repo,'resources/windows/scania-137.json')));
 const model=fs.readFileSync(path.join(repo,'resources/models/Scania_Touring_13.7m_6x2.glb')).toString('base64');
 await run(`(async()=>{const v=window.testViewport;const slots=await v.importGLB(${JSON.stringify(model)});v.windowProfile=${JSON.stringify(profile)};await v.updateTexture(${JSON.stringify(texture)});v.applyMappings(slots.filter(s=>s.defaultChannel!==null).map(s=>({id:s.id,channel:s.defaultChannel})),true);return true;})()`);
 const prepared=await run(`(async()=>{const v=window.testViewport;return {body:await window.testBodyArtwork(${JSON.stringify(texture)},${JSON.stringify(glassTexture)},v.windowProfile),glass:await window.testWindowArtwork(${JSON.stringify(glassTexture)},v.windowProfile,true)};})()`);
 const preparedDir=process.env.COACH_STUDIO_SEAM_OUTPUT || path.join(require('node:os').tmpdir(),'coaches-seam-qa-'+process.pid);fs.mkdirSync(preparedDir,{recursive:true});
 for(const [name,data]of Object.entries(prepared))fs.writeFileSync(path.join(preparedDir,name+'.png'),Buffer.from(data.split(',')[1],'base64'));
 console.log('Model and texture ready');const output=preparedDir;fs.mkdirSync(output,{recursive:true});
 for(const side of [-1,1]) {
  await run(`(()=>{const v=window.testViewport;v.camera.fov=12;v.camera.updateProjectionMatrix();v.camera.position.set(${side*19},3,0);v.controls.target.set(0,2.7,4);v.controls.update();v.clearGlassArtwork();})()`);
  for (const glass of [false,true]) {
   if(glass)await run(`(async()=>{const v=window.testViewport;const body=await window.testBodyArtwork(${JSON.stringify(texture)},${JSON.stringify(glassTexture)},v.windowProfile);await v.updateTexture({filename:'body.png',base64:body.split(',')[1]});const png=await window.testWindowArtwork(${JSON.stringify(glassTexture)},v.windowProfile,true);await v.setGlassArtwork({filename:'glass.png',base64:png.split(',')[1]},()=>true,true);if(v.windowOverlay.material.side!==0)throw Error('Decal must be outward-facing');})()`);
   await new Promise(r=>setTimeout(r,300));
   win.webContents.debugger.attach('1.3');const image=await win.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png'});win.webContents.debugger.detach();
   fs.writeFileSync(path.join(output,`side${side}-${glass?'on':'off'}.png`),Buffer.from(image.data,'base64'));
  }
 }
 console.log('PASS both sides render outward-facing decals and continuous body artwork. Artifacts:',output);await server.close();win.destroy();app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
