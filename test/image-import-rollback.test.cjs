const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { ClipStore } = require('../src/store.cjs');
const { ShelfReceiver } = require('../src/shelf-receiver.js');
const importer = require('../src/image-import.cjs');

test('failed import pushes rollback to a renderer that read history during the pending save, before media cleanup', async () => {
  const root = path.resolve(__dirname, '..'), mainFile = path.join(root, 'src/main.cjs');
  const realRequire = createRequire(mainFile), handlers = new Map();
  const importedMedia = 'a'.repeat(64), existingMedia = 'b'.repeat(64), undoMedia = 'c'.repeat(64);
  const store = new ClipStore(); store.add('existing text');
  store.addImage({ mediaId: existingMedia, width: 1, height: 1, bytes: 33 });
  const originalIds = store.items.map(x => x.id);
  let rejectSave, savedStarted, cleanupStarted, releaseCleanup, keptMedia;
  const saveStarted = new Promise(resolve => savedStarted = resolve);
  const pendingSave = new Promise((_, reject) => rejectSave = reject);
  const collecting = new Promise(resolve => cleanupStarted = resolve);
  const cleanup = new Promise(resolve => releaseCleanup = resolve);
  const receiver = new ShelfReceiver({ fetchState: async () => handlers.get('state')(), onState() {} });
  let pushes = 0;
  const win = { isVisible: () => true, isDestroyed: () => false, webContents: { send(channel, packet) {
    if (channel === 'state-changed') { pushes++; receiver.receive(packet); }
  } } };
  // Load the real main-process handlers without starting Electron, accessing
  // user history, registering OS shortcuts, or opening native dialogs.
  const app = { isPackaged: false, setName() {}, setAppUserModelId() {}, getPath: () => root,
    setPath() {}, getVersion: () => 'test', requestSingleInstanceLock: () => false, quit() {}, on() {} };
  const context = { console, Buffer, process, fixtureStore: store, fixtureWindow: win,
    fixtureMedia: { write: async () => importedMedia, collect: async keep => { keptMedia = keep; cleanupStarted(); await cleanup; } },
    fixtureSaver: { save: () => { savedStarted(); return pendingSave; } }, fixtureUndoMedia: undoMedia,
    setTimeout: () => ({ unref() {} }), clearTimeout() {}, clearInterval() {}, require(name) {
      if (name === 'electron') return { app, ipcMain: { handle: (key, fn) => handlers.set(key, fn), on() {} },
        globalShortcut: { register: () => true }, nativeTheme: { shouldUseDarkColors: false } };
      if (name === 'node:fs') return { ...fs, mkdirSync() {} };
      if (name === './login-startup.cjs') return { LoginStartup: class { read() { return false; } } };
      if (name === './image-import.cjs') return { ...importer, loadImageFile: async () => ({
        packet: { png: Buffer.alloc(33), thumbnail: Buffer.alloc(33), width: 1, height: 1 }, title: 'pending image'
      }) };
      return realRequire(name);
    } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(mainFile, 'utf8') + '\nstore=fixtureStore;win=fixtureWindow;media=fixtureMedia;saver=fixtureSaver;undoState={mediaIds:[fixtureUndoMedia]};installIpc();globalThis.beginImport=importImageFile;', context);
  const importing = context.beginImport('controlled.png');
  const failed = assert.rejects(importing, /controlled disk full/);
  await saveStarted;
  receiver.receive(handlers.get('state')());
  assert.ok(receiver.state.items.some(x => x.mediaId === importedMedia), 'renderer observed the provisional import');
  rejectSave(Error('controlled disk full'));
  await collecting;
  try {
    assert.equal(pushes, 1, 'rollback must be pushed before cleanup finishes');
    assert.deepEqual(receiver.state.items.map(x => x.id), originalIds, 'renderer must return to the authoritative history');
    assert.deepEqual(store.items.map(x => x.id), originalIds);
    assert.ok(keptMedia.includes(existingMedia) && keptMedia.includes(undoMedia), 'retain current and previous undo images');
    assert.ok(!keptMedia.includes(importedMedia), 'failed import media can be collected');
  } finally { releaseCleanup(); await failed; }
});
