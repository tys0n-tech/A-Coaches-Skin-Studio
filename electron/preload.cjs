const { contextBridge, ipcRenderer } = require('electron');

const channels = new Set(['texture-changed']);
contextBridge.exposeInMainWorld('studioAPI', {
  openTexture: () => ipcRenderer.invoke('dialog:texture'),
  openGlassTexture: () => ipcRenderer.invoke('dialog:glass-texture'),
  readGlassTextureAt: (filePath) => ipcRenderer.invoke('file:glass-texture', filePath),
  openModel: () => ipcRenderer.invoke('dialog:model'),
  openGameFolder: () => ipcRenderer.invoke('dialog:game'),
  openTemplate: () => ipcRenderer.invoke('dialog:template'),
  openTexconv: () => ipcRenderer.invoke('dialog:texconv'),
  listTemplateDDS: () => ipcRenderer.invoke('template:dds'),
  exportMod: (options) => ipcRenderer.invoke('mod:export', options),
  saveProject: (data) => ipcRenderer.invoke('project:save', data),
  openProject: () => ipcRenderer.invoke('project:open'),
  readTextureAt: (filePath) => ipcRenderer.invoke('file:texture', filePath),
  readCoachModel: (coachId) => ipcRenderer.invoke('file:coach-model', coachId),
  readModelAt: (filePath) => ipcRenderer.invoke('file:model', filePath),
  exportPng: (dataUrl) => ipcRenderer.invoke('file:exportpng', dataUrl),
  onTextureChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('texture-changed', handler);
    return () => ipcRenderer.removeListener('texture-changed', handler);
  }
});
