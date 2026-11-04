const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  moveBy(dx, dy) {
    ipcRenderer.send('move-by', { dx, dy });
  },
  showMenu() {
    ipcRenderer.send('show-context-menu');
  },
  ready() {
    ipcRenderer.send('pet-ready');
  },
  onFluff(handler) {
    ipcRenderer.on('play-fluff', () => handler());
  },
  onResetView(handler) {
    ipcRenderer.on('reset-view', () => handler());
  },
});
