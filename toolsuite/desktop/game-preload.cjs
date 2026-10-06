const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('forgeGame', Object.freeze({ quit: () => ipcRenderer.send('game:quit') }));
