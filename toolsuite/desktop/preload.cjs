/** The renderer receives capabilities, never Node or an unrestricted IPC handle. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('forgeDesktop', Object.freeze({
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  openProject: dir => ipcRenderer.invoke('project:open', dir),
  repairProject: dir => ipcRenderer.invoke('project:repair', dir),
  forgetProject: dir => ipcRenderer.invoke('project:forget', dir),
  createProject: name => ipcRenderer.invoke('project:create', name),
  revealProject: dir => ipcRenderer.invoke('project:reveal', dir),
  listProjects: () => ipcRenderer.invoke('project:list'),
  quit: () => ipcRenderer.invoke('app:quit'),
  assets: () => ipcRenderer.invoke('project:assets'),
  save: (relative, text) => ipcRenderer.invoke('project:save', relative, text),
  importAssets: () => ipcRenderer.invoke('project:import'),
  buildGame: () => ipcRenderer.invoke('project:build'),
  runGame: () => ipcRenderer.invoke('project:run'),
  previewGame: (level, mode, defaults = null) => ipcRenderer.invoke('game:preview', level, mode, defaults),
  stopGame: () => ipcRenderer.invoke('game:stop'),
  readScene: filename => ipcRenderer.invoke('project:scene', filename),
  deleteScene: filename => ipcRenderer.invoke('project:scene-delete', filename),
  onGameState: callback => { const listener = (_event, playing) => callback(playing); ipcRenderer.on('game:state', listener); return () => ipcRenderer.removeListener('game:state', listener); },
  onBuildLog: callback => { const listener = (_event, line) => callback(String(line)); ipcRenderer.on('project:log', listener); return () => ipcRenderer.removeListener('project:log', listener); }
}));
