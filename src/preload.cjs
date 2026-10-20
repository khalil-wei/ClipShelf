const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('clips', {
  state: () => ipcRenderer.invoke('state'),
  mutate: (action, id, value) => ipcRenderer.invoke('mutate', action, id, value),
  use: (id, copyOnly, plain = false) => ipcRenderer.invoke('use', id, copyOnly, plain),
  stack: (action, ids) => ipcRenderer.invoke('stack', action, ids),
  image: (id, thumbnail = true) => ipcRenderer.invoke('image', id, thumbnail),
  rotateImage: (id, rotation) => ipcRenderer.invoke('image-rotate', id, rotation),
  exportImage: id => ipcRenderer.invoke('image-export', id),
  hide: () => ipcRenderer.send('hide'),
  resize: (height, finish = false) => ipcRenderer.send('resize-shelf', height, finish),
  onState: callback => ipcRenderer.on('state-changed', (_, state) => callback(state)),
  onShow: callback => ipcRenderer.on('shelf-show', (_, options) => callback(options)),
  onHide: callback => ipcRenderer.on('shelf-hide', () => callback()),
  onSuspend: callback => ipcRenderer.on('shelf-suspend', () => callback()),
  onNotice: callback => ipcRenderer.on('notice', (_, message) => callback(message))
});
