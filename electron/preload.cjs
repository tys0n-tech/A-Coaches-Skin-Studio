const { contextBridge, ipcRenderer } = require('electron');

const channels = new Set(['texture-changed']);
contextBridge.exposeInMainWorld('studioAPI', {
  readCompositionTexture: () => ipcRenderer.invoke('file:composition-texture'),
  openTexture: () => ipcRenderer.invoke('dialog:texture'),
  saveCoachTemplate: (id) => ipcRenderer.invoke('coach:template', id),
  exportCoach: (options) => ipcRenderer.invoke('coach:export', options),
  openGlassTexture: () => ipcRenderer.invoke('dialog:glass-texture'),
  readGlassTextureAt: (filePath) => ipcRenderer.invoke('file:glass-texture', filePath),
  openModel: () => ipcRenderer.invoke('dialog:model'),
  openGameFolder: () => ipcRenderer.invoke('dialog:game'),
  openTemplate: () => ipcRenderer.invoke('dialog:template'),
  openTemplateAt: (filePath) => ipcRenderer.invoke('file:template', filePath),
  openTexconv: () => ipcRenderer.invoke('dialog:texconv'),
  listTemplateDDS: () => ipcRenderer.invoke('template:dds'),
  exportMod: (options) => ipcRenderer.invoke('mod:export', options),
  saveProject: (data) => ipcRenderer.invoke('project:save', data),
  openProject: () => ipcRenderer.invoke('project:open'),
  readTextureAt: (filePath) => ipcRenderer.invoke('file:texture', filePath),
  readCoachModel: (coachId) => ipcRenderer.invoke('file:coach-model', coachId),
  readModelAt: (filePath) => ipcRenderer.invoke('file:model', filePath),
  exportPng: (dataUrl, filename) => ipcRenderer.invoke('file:exportpng', dataUrl, filename),
  onTextureChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('texture-changed', handler);
    return () => ipcRenderer.removeListener('texture-changed', handler);
  }
});
