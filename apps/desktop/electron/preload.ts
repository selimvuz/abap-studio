import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, RuntimeEvent } from '../../../packages/shared/src/index';

const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke('studio:bootstrap'),
  listPrograms: () => ipcRenderer.invoke('studio:listPrograms'),
  saveProgram: (name, source) => ipcRenderer.invoke('studio:saveProgram', name, source),
  renameProgram: (oldName, newName) => ipcRenderer.invoke('studio:renameProgram', oldName, newName),
  deleteProgram: (name) => ipcRenderer.invoke('studio:deleteProgram', name),
  openProgram: () => ipcRenderer.invoke('studio:openProgram'),
  exportProgram: (name, source) => ipcRenderer.invoke('studio:exportProgram', name, source),
  updateSettings: (settings) => ipcRenderer.invoke('studio:updateSettings', settings),
  check: (source) => ipcRenderer.invoke('studio:check', source),
  format: (source) => ipcRenderer.invoke('studio:format', source),
  run: (request) => ipcRenderer.invoke('studio:run', request),
  stop: () => ipcRenderer.invoke('studio:stop'),
  debug: (command) => ipcRenderer.invoke('studio:debug', command),
  setDirty: (dirty) => ipcRenderer.send('studio:setDirty', dirty),
  onRuntime: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, event: RuntimeEvent) => callback(event);
    ipcRenderer.on('studio:runtime', listener);
    return () => ipcRenderer.removeListener('studio:runtime', listener);
  },
  onMenu: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on('studio:menu', listener);
    return () => ipcRenderer.removeListener('studio:menu', listener);
  },
};

contextBridge.exposeInMainWorld('desktop', Object.freeze(api));
