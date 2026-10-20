const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, safeStorage, screen, Tray, Menu, nativeImage, dialog, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { ClipStore } = require('./store.cjs');
const { NativeClient } = require('./native-client.cjs');
const { restoreUndo, cloneSnapshot } = require('./undo.cjs');
const { MediaStore, hash } = require('./media-store.cjs');
const { Background } = require('./background.cjs');
const { AsyncSave } = require('./async-save.cjs');
const { ignoredReason, readPacket, preparePaste } = require('./clipboard-content.cjs');
const { LoginStartup } = require('./login-startup.cjs');
const { PasteStack } = require('./paste-stack.cjs');
const { ShelfUpdates } = require('./shelf-updates.cjs');
const { imageDimensions, loadImageFile, commitImageImport } = require('./image-import.cjs');
const shelfUpdates = new ShelfUpdates();
const stack = new PasteStack();
const smoke = process.argv.includes('--smoke') || process.argv.includes('--paste-integration');
const clipboardCheck = process.argv.includes('--clipboard-integration');
const startupCheck = process.argv.includes('--startup-integration');
const performanceCheck = process.argv.includes('--performance');
const isolated = smoke || clipboardCheck || startupCheck || performanceCheck;
const startup = new LoginStartup(app, { simulate: smoke, supported: smoke || process.platform === 'win32' && app.isPackaged });
const smokeUses = [];
app.setName('ClipShelf');
if (process.platform === 'win32') app.setAppUserModelId('ClipShelf');
const userPath = isolated ? path.join(app.getPath('temp'), 'clipshelf-smoke-' + process.pid) : path.join(app.getPath('appData'), 'ClipShelf');
fs.mkdirSync(userPath, { recursive: true }); app.setPath('userData', userPath);
let win, tray, store, media, helper, dataFile, pollTimer, saveTimer, clipTimer, hideTimer, hidePromise, hideResolve, quitting = false, showing = false, busy = false, pollAgain = false, target = '0', lastSignature = '', undoState = null, pasting = false;
let lastSequence = '', lastCapturedSequence = '', sequenceBusy = false, captureEpoch = 0, background, saver;
let stateQueue = Promise.resolve();
function stateTask(task) { const result = stateQueue.then(task); stateQueue = result.catch(() => {}); return result; }
let pauseTimer, pauseDeadline=0, modalBusy = false;
const captureRetries = new Set();
let status = { version: app.getVersion(), shortcut: '', native: false, events: false, dark: false, error: '', canUndo: false, startupSupported: startup.supported };
const snapshot = () => ({ ...store.snapshot(), stack: stack.pending(store.items).map(x => ({ id: x.id, title: x.title || (x.kind === 'image' ? '图片' : x.text.slice(0, 60)), kind: x.kind })), items: store.items.map(({ html, ...item }) => ({ ...item, hasFormatting: !!html })), status: { ...status, canUndo: !!undoState, dark: nativeTheme.shouldUseDarkColors } });
function broadcast() {
  armPauseTimer();
  // A hidden shelf needs only the latest state when opened, never every copy.
  if (win && !win.isDestroyed() && win.isVisible()) {const packet=shelfUpdates.next(snapshot(),store.items);win.webContents.send('state-changed',packet);return packet;}
}
function armPauseTimer(){
  const deadline=store?.paused?store.pauseUntil:0;if(deadline===pauseDeadline)return;
  clearTimeout(pauseTimer);pauseDeadline=deadline;if(!deadline||quitting)return;
  pauseTimer=setTimeout(()=>{pauseDeadline=0;void stateTask(async()=>{if(store.resumeExpired()){baseline();try{await save();}catch(e){status.error=e.message;}}broadcast();});},Math.max(1,Math.min(2147483647,deadline-Date.now())));pauseTimer.unref();
}
function startMonitoring(){
  const tick=async()=>{try{await checkClipboardSequence();}finally{if(!quitting)pollTimer=setTimeout(tick,helper?.alive&&helper.events?5000:750);}};
  pollTimer=setTimeout(tick,helper?.alive&&helper.events?5000:750);armPauseTimer();
}
function save() { clearTimeout(saveTimer); return saver.save(store.snapshot()); }
async function collectMedia() { if (media) { try { await media.collect([...store.items.filter(x => x.kind === 'image').map(x => x.mediaId), ...(undoState?.mediaIds || [])]); } catch (e) { status.error = '图片缓存清理暂未完成：' + e.message; } } }
let saveFailures=0,lastStorageError='';
function scheduleSave(delay=120) {
  clearTimeout(saveTimer);if(quitting)return;
  saveTimer=setTimeout(()=>{void stateTask(async()=>{
    try{await save();saveFailures=0;if(status.error===lastStorageError)status.error='';lastStorageError='';await collectMedia();}
    catch(e){lastStorageError=status.error=e.message;broadcast();if(!quitting)scheduleSave(Math.min(10000,1000*2**Math.min(saveFailures++,4)));}
  });},delay);
}
function baseline(signature = null) {
  if (smoke) return;
  const epoch = ++captureEpoch; lastSignature = signature || ''; lastCapturedSequence = ''; lastSequence = '';
  if (helper?.alive) void helper.request('SEQUENCE').then(sequence => { if (epoch === captureEpoch) lastCapturedSequence = lastSequence = sequence; }).catch(() => {});
  else if (!signature) { try { lastSignature = readPacket(clipboard, false).signature; } catch {} }
}
async function encodeImage(image, rotation = 0) {
  const size = image.getSize(); if (size.width * size.height > 32000000) throw Error('图片超过 3200 万像素，未保存');
  const scale = Math.min(320 / size.width, 320 / size.height, 1);
  const small = image.resize({width: Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale)),quality:'good'});
  const result = await background.run('png',{pixels:image.toBitmap(),width:size.width,height:size.height,rotation});
  const thumbSize = small.getSize(), thumb = await background.run('png',{pixels:small.toBitmap(),width:thumbSize.width,height:thumbSize.height,rotation,maxBytes:512*1024});
  const png=Buffer.from(result.png.buffer,result.png.byteOffset,result.png.byteLength),thumbnail=Buffer.from(thumb.png.buffer,thumb.png.byteOffset,thumb.png.byteLength);
  return {kind:'image',png,thumbnail,width:result.width,height:result.height,signature:'image:'+hash(png)};
}
function startNative() {
  const executable=app.isPackaged?path.join(process.resourcesPath,'ClipShelf.Native.exe'):path.join(__dirname,'..','build','ClipShelf.Native.exe');
  const file = fs.existsSync(executable)?executable:app.isPackaged ? path.join(process.resourcesPath, 'native.ps1') : path.join(__dirname, 'native.ps1');
  status.nativeBackend=file.endsWith('.exe')?'compiled':'powershell';
  helper = new NativeClient(file, {
    onChange: info => {
      if (smoke || performanceCheck) return;
      clearTimeout(clipTimer); for (const timer of captureRetries) clearTimeout(timer); captureRetries.clear();
      clipTimer = setTimeout(() => poll(), 40);
      for (const delay of [160, 450]) { const timer = setTimeout(() => { captureRetries.delete(timer); void poll(); }, delay); captureRetries.add(timer); }
    },
    onStatus: (available, events, info = {}) => { status.native = available; status.events = events; status.reconnecting = !available; if(!available) { captureEpoch++; lastCapturedSequence = lastSequence = ''; } if(available && info.recovered) { if(status.error.startsWith('Windows 助手'))status.error='';lastCapturedSequence = lastSequence = ''; if(!isolated) setTimeout(()=>poll(),0); } broadcast(); }
  });
  return helper.ready;
}
function fitShelf(area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, customHeight) {
  const desired = customHeight || (store.settings.compact ? 302 : store.settings.height);
  const height = Math.min(desired, area.height - 16), width = Math.max(280, area.width - 24);
  win.setBounds({ x: area.x + 12, y: area.y + area.height - height - 8, width, height });
}
async function hideShelf(immediate = false) {
  if (!win?.isVisible()) return;
  if (hidePromise) return hidePromise;
  if (immediate || store.settings.reduceMotion) { win.hide(); return; }
  win.webContents.send('shelf-hide');
  hidePromise = new Promise(resolve => { hideResolve = resolve; hideTimer = setTimeout(() => { if (!win.isDestroyed()) win.hide(); hideTimer = null; hidePromise = null; hideResolve = null; resolve(); }, 135); });
  return hidePromise;
}
async function showShelf(captureTarget = true) {
  if (showing || pasting || modalBusy) return;
  if (hideTimer && win.isVisible()) { clearTimeout(hideTimer); hideTimer = null; hideResolve?.(); hideResolve = null; hidePromise = null; win.webContents.send('shelf-show', { preserve: true }); win.focus(); return; }
  if (win.isVisible()) { await hideShelf(); return; }
  showing = true; target = '0';
  let area;
  try {
    if (captureTarget && helper?.alive) {
      target = await helper.request('CAPTURE');
      const [x, y, width, height] = (await helper.request('BOUNDS ' + target)).split(',').map(Number);
      if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
        const rect = screen.screenToDipRect(null, { x, y, width, height }); area = screen.getDisplayMatching(rect).workArea;
      }
    }
  } catch { target = '0'; }
  fitShelf(area); win.show(); win.focus(); win.webContents.send('shelf-show'); showing = false;
}
async function poll(source = '') {
  if (store.paused || pasting || quitting) return false;
  if (busy) { pollAgain = true; return false; } busy = true;
  const epoch = captureEpoch;
  try {
    const sequence = helper?.alive ? await helper.request('SEQUENCE') : null;
    if(sequence !== null && sequence === lastCapturedSequence) return true;
    if (!source && helper?.alive) { try { source = await helper.request('SOURCE'); } catch {} }
    const reason=ignoredReason(store.settings, source, clipboard.availableFormats(), name=>clipboard.readBuffer(name));
    const blocked = reason === 'unknown-source';
    if(status.captureBlocked !== blocked) { status.captureBlocked=blocked; broadcast(); }
    if (store.paused || epoch!==captureEpoch || reason) return reason !== 'unknown-source';
    let image=store.settings.captureImages ? clipboard.readImage() : null;
    let packet=image && !image.isEmpty() ? null : readPacket(clipboard,false);
    if(packet && store.settings.captureImages && helper?.alive) {
      const files=JSON.parse(await helper.request('FILES'));
      if(Array.isArray(files)&&files.length===1&&typeof files[0]==='string'&&/^[A-Za-z]:[\\/]/.test(files[0])&&/\.(png|jpe?g)$/i.test(files[0])) {
        const file=await fs.promises.open(files[0],'r');
        try {
          const info=await file.stat(); if(!info.isFile()||info.size>16*1024*1024) throw Error('图片文件超过 16 MiB，未保存');
          const bytes=Buffer.alloc(info.size+1), read=await file.read(bytes,0,bytes.length,0); if(read.bytesRead!==info.size) throw Error('图片文件正在变化，请重新复制');
          imageDimensions(bytes.subarray(0,read.bytesRead));
          image=nativeImage.createFromBuffer(bytes.subarray(0,read.bytesRead)); if(!image.isEmpty()) packet=null;
        } finally { await file.close(); }
      }
    }
    if(sequence!==null&&helper?.alive&&await helper.request('SEQUENCE')!==sequence) { pollAgain=true; return false; }
    if(!packet) packet=await encodeImage(image);
    return await stateTask(async()=>{
      if(quitting||store.paused||pasting||epoch!==captureEpoch) return false;
      if(packet.signature!==lastSignature) {
        let changed;
        if(packet.kind==='image') {
          const mediaId=await media.write(packet.png,packet.thumbnail);
          if(epoch!==captureEpoch||quitting||store.paused) return false;
          changed=store.addImage({mediaId,width:packet.width,height:packet.height,bytes:packet.png.length},source);
        } else changed=store.add(packet.text,source,packet.html);
        lastSignature=packet.signature;
        if(changed) { status.error='';broadcast();scheduleSave(); }
        else if(packet.kind==='image'||packet.text?.trim()) { status.error='历史容量已满，固定内容较多；请清理部分收藏或分组后再复制';broadcast(); }
      }
      if(packet.kind==='image'||packet.text?.trim()) lastCapturedSequence=sequence;
      return true;
    });
  } catch(e) { status.error=e.message;broadcast();return false; }
  finally { busy=false;if(pollAgain&&!quitting){pollAgain=false;void poll();} }
}
async function checkClipboardSequence() {
  if (sequenceBusy || store.paused) return;
  if (performanceCheck && !helper?.alive) return;
  sequenceBusy = true;
  try {
    if (!helper?.alive) { await poll(); return; }
    const sequence = await helper.request('SEQUENCE');
    if (performanceCheck) { lastSequence=sequence; return; }
    if (sequence !== lastSequence) { if(await poll()) lastSequence = sequence; }
  } catch { if(!performanceCheck)await poll(); }
  finally { sequenceBusy = false; }
}
function registerShortcut(shortcut) {
  if (smoke || shortcut === status.shortcut) return;
  if (!globalShortcut.register(shortcut, () => showShelf(true))) throw Error(shortcut + ' 已被其他应用占用，请选择其他快捷键');
  if (status.shortcut) globalShortcut.unregister(status.shortcut);
  status.shortcut = shortcut; tray?.setToolTip('ClipShelf · ' + shortcut);
}
async function importImageFile(filePath) {
  const image = await loadImageFile(filePath, { decode: bytes => nativeImage.createFromBuffer(bytes), encode: encodeImage });
  return stateTask(async () => {
    if (quitting) throw Error('应用正在退出');
    try {
      const result = await commitImageImport({ store, media, save, ...image });
      undoState = result.undo;
      await collectMedia();
      const next = broadcast() || shelfUpdates.next(snapshot(), store.items);
      return { ok: true, id: result.id, state: next };
    } catch (error) { scheduleSave(1000); await collectMedia(); throw error; }
  });
}
function installIpc() {
  ipcMain.handle('state', () => { try { store.settings.openAtLogin=startup.read(); } catch {} return shelfUpdates.full(snapshot(),store.items); });
  ipcMain.on('hide', () => { void hideShelf(); });
  ipcMain.on('resize-shelf', (_, height, finish) => {
    if (!Number.isFinite(height)) return;
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    fitShelf(area, Math.max(290, Math.min(640, height)));
    if (finish) { const height=win.getBounds().height; void stateTask(()=>{store.settings.height=height;store.settings.compact=height<345;scheduleSave();broadcast();}); }
  });
  ipcMain.handle('mutate', (_, action, id, value) => {
    if(action==='settings'||action==='pause') captureEpoch++;
    return stateTask(async()=>{
    const before = cloneSnapshot(store.snapshot()); const previousShortcut = store.settings.shortcut; const previousStartup = !!store.settings.openAtLogin;
    try {
      if (action === 'undo') { if (!undoState) throw Error('没有可撤销的操作'); Object.assign(store, restoreUndo(undoState, store)); await save(); undoState = null; }
      else {
        store.mutate(action, id, value);
        if (action === 'settings') { registerShortcut(store.settings.shortcut); if (!!store.settings.openAtLogin !== previousStartup) startup.set(!!store.settings.openAtLogin); }
        await save();
        if (!['pause', 'settings'].includes(action)) undoState = { before, afterIds: store.items.map(x => x.id) };
      }
      if (!['pause', 'settings', 'undo'].includes(action) && undoState) undoState.mediaIds = before.items.filter(x => x.kind === 'image').map(x => x.mediaId);
      if (action === 'settings' && store.settings.captureImages && !before.settings.captureImages) { lastSignature = ''; lastCapturedSequence=lastSequence=''; void poll(); }
      else if (action === 'pause' || action === 'settings') baseline();
      if (action === 'settings' || action === 'undo') fitShelf(screen.getDisplayMatching(win.getBounds()).workArea);
      await collectMedia(); const next=broadcast()||shelfUpdates.next(snapshot(),store.items);return { ok: true, state: next };
    } catch (e) {
      Object.assign(store, new ClipStore(before));scheduleSave(1000);
      if (action === 'settings') { try { if (startup.read() !== previousStartup) startup.set(previousStartup); } catch {} }
      if (!smoke && status.shortcut !== previousShortcut) { try { registerShortcut(previousShortcut); } catch {} }
      return { ok: false, error: e.message };
    }
    });
  });
  ipcMain.handle('image', async (_, id, thumbnail = true) => {
    const item = store.items.find(x => x.id === id && x.kind === 'image');
    if (!item) return { ok: false, error: '图片不存在' };
    try { const png = await media.read(item.mediaId, thumbnail !== false); return { ok: true, dataUrl: 'data:image/png;base64,' + png.toString('base64') }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('image-rotate', (_, id, rotation) => stateTask(async()=>{
    const before=cloneSnapshot(store.snapshot());
    try {
      if(![90,270].includes(rotation)) throw Error('旋转角度无效');
      const item=store.items.find(x=>x.id===id&&x.kind==='image');if(!item) throw Error('图片不存在');
      const packet=await encodeImage(nativeImage.createFromBuffer(await media.read(item.mediaId)),rotation);
      const mediaId=await media.write(packet.png,packet.thumbnail);
      store.replaceImage(id,{mediaId,width:packet.width,height:packet.height,bytes:packet.png.length});
      await save();undoState={before,afterIds:store.items.map(x=>x.id),mediaIds:before.items.filter(x=>x.kind==='image').map(x=>x.mediaId)};
      await collectMedia();const next=broadcast()||shelfUpdates.next(snapshot(),store.items);return {ok:true,state:next};
    } catch(e) {Object.assign(store,new ClipStore(before));return {ok:false,error:e.message};}
  }));
  ipcMain.handle('image-import', async () => {
    if (modalBusy) return { ok: false, error: '文件对话框已打开' };
    if (smoke) return { ok: true, canceled: true };
    modalBusy = true;
    try {
      const result = await dialog.showOpenDialog(win, { title: '导入本地图片', filters: [{ name: 'PNG / JPEG 图片', extensions: ['png', 'jpg', 'jpeg'] }], properties: ['openFile'] });
      if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true };
      return await importImageFile(result.filePaths[0]);
    } catch (error) { return { ok: false, error: error.message }; }
    finally { modalBusy = false; }
  });
  ipcMain.handle('image-export', async(_,id)=>{
    if(modalBusy) return {ok:false,error:'文件对话框已打开'};
    const item=store.items.find(x=>x.id===id&&x.kind==='image');if(!item) return {ok:false,error:'图片不存在'};
    if(smoke) return {ok:true,simulated:true};
    modalBusy=true;
    try {
      const name=(item.title||'ClipShelf-'+id.slice(0,8)).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,80)||'ClipShelf';
      const result=await dialog.showSaveDialog(win,{title:'图片另存为',defaultPath:path.join(app.getPath('pictures'),name+'.png'),filters:[{name:'PNG 图片',extensions:['png']}],properties:['showOverwriteConfirmation']});
      if(result.canceled) return {ok:true,canceled:true};
      await fs.promises.writeFile(result.filePath,await media.read(item.mediaId));return {ok:true};
    } catch(e) {return {ok:false,error:e.message};} finally {modalBusy=false;}
  });
  async function useContent(ids, copyOnly, plain = false) {
    if (pasting) return { ok: false, error: '正在粘贴，请稍候' };
    ids = Array.isArray(ids) ? ids : [ids];
    const byId = new Map(store.items.map(x => [x.id, x]));
    const items = [...new Set(ids)].map(id => byId.get(id)).filter(Boolean);
    if (!items.length) return { ok: false, error: '内容已删除' };
    let payload;
    try { payload = preparePaste(items, store.settings, !!plain); } catch (e) { return { ok: false, error: e.message }; }
    if (smoke) { smokeUses.push({ ids: items.map(x => x.id), ...payload, copyOnly: !!copyOnly }); return { ok: true, copied: !!copyOnly }; }
    pasting = true; captureEpoch++;
    try {
      if (payload.kind === 'image') {
        const image = nativeImage.createFromBuffer(await media.read(payload.mediaId)); if (image.isEmpty()) throw Error('无法解码图片');
        clipboard.writeImage(image);
        let ready = false;
        for (let attempt = 0; attempt < 10 && !ready; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 30));
          try { ready = helper?.alive ? await helper.request('IMAGE_READY') === 'YES' : !clipboard.readImage().isEmpty(); } catch {}
        }
        if (!ready) throw Error('系统暂未准备好图片剪贴板，请重新复制或粘贴');
      }
      else if (payload.html) clipboard.write({ text: payload.text, html: payload.html });
      else clipboard.writeText(payload.text);
      baseline(payload.kind==='image' ? 'image:'+payload.mediaId : readPacket(clipboard,false).signature);
      if (copyOnly) return { ok: true, copied: true };
      if (target === '0') return { ok: false, error: '已复制。请从目标应用按 ' + store.settings.shortcut + ' 呼出面板，再直接粘贴。' };
      // Keep our input queue foreground until the native helper hands focus
      // back. Hiding first discards the user's activation entitlement.
      try {
        await helper.request('PASTE ' + target + ' ' + win.getNativeWindowHandle().readBigUInt64LE().toString());
        if (status.error.startsWith('已复制；自动粘贴失败')) status.error = '';
        await hideShelf(true); return { ok: true };
      }
      catch (e) {
        if(quitting)return {ok:false,error:'应用正在退出'};
        status.error = '已复制；自动粘贴失败，可回原窗口按 Ctrl+V。' + e.message;
        // If the user switched apps during the handoff, respect that focus.
        if (!win.isFocused()) await hideShelf(true);
        broadcast(); return { ok: false, error: status.error };
      }
    } catch (e) { return { ok: false, error: e.message }; }
    finally { pasting = false; }
  }
  ipcMain.handle('use', (_, ids, copyOnly, plain) => useContent(ids, copyOnly, plain));
  async function nextStack(copyOnly = false, capture = false) {
    const result = await stack.next(store.items, async id => {
      if (capture && helper?.alive) {
        const current = await helper.request('CAPTURE');
        if (current !== win.getNativeWindowHandle().readBigUInt64LE().toString()) target = current;
      }
      return useContent([id], copyOnly);
    });
    broadcast(); return result;
  }
  ipcMain.handle('stack', async (_, action, ids) => {
    try {
      if (stack.busy) return { ok: false, error: '正在粘贴，请稍候' };
      if (action === 'add') stack.add(ids, store.items);
      else if (action === 'reverse') stack.ids.reverse();
      else if (action === 'clear') stack.ids = [];
      else if (action === 'next' || action === 'copy') return await nextStack(action === 'copy');
      else throw Error('队列操作无效');
      broadcast(); return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  if (!isolated) {
    status.stackShortcut = globalShortcut.register('Ctrl+Alt+P', () => { void nextStack(false, true).then(result => { if (!result.ok) { status.error = result.error; broadcast(); } }).catch(e => { status.error = e.message; broadcast(); }); });
  }
}
function createTray() {
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; const line = x > 3 && x < 12 && (y === 5 || y === 8 || y === 11); pixels[i] = line ? 255 : 211; pixels[i + 1] = line ? 255 : 91; pixels[i + 2] = line ? 255 : 113; pixels[i + 3] = 255; }
  tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 16, height: 16 })); tray.on('click', () => showShelf(false));
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开 ClipShelf', click: () => showShelf(false) }, { label: '暂停 / 继续记录', click: () => { captureEpoch++; void stateTask(async()=>{try {store.mutate('pause');baseline();await save();broadcast();} catch(e){dialog.showErrorBox('保存失败',e.message);}}); } }, { type: 'separator' }, { label: '退出', click: () => app.quit() }]));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_, argv) => { if (!argv.includes('--background') && win) void showShelf(false); });
  app.whenReady().then(async () => {
    dataFile = path.join(app.getPath('userData'), 'history.enc');
    try { store = new ClipStore(!isolated && fs.existsSync(dataFile) ? JSON.parse(safeStorage.decryptString(fs.readFileSync(dataFile))) : {}); store.prune(); }
    catch (e) { dialog.showErrorBox('无法读取历史', '已保留原文件，未覆盖。' + e.message); app.quit(); return; }
    try { store.settings.openAtLogin = startup.read(); } catch (e) { status.error = '无法读取自启动状态：' + e.message; }
    background=new Background(); saver=new AsyncSave(dataFile,background,text=>{if(!safeStorage.isEncryptionAvailable()) throw Error('Windows 本地加密不可用，历史暂未保存');return safeStorage.encryptString(text);});
    media = new MediaStore(path.join(app.getPath('userData'), 'media'), { encode: buffer => safeStorage.encryptString(buffer.toString('base64')), decode: buffer => Buffer.from(safeStorage.decryptString(buffer), 'base64') });
    await collectMedia(); installIpc();
    win = new BrowserWindow({ width: 1400, height: 390, frame: false, show: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#edf0f4', backgroundMaterial: 'acrylic', roundedCorners: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    win.on('show',broadcast);
    win.on('hide',()=>win.webContents.send('shelf-suspend'));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', e => e.preventDefault());
    win.on('close', e => { if (!quitting && !smoke) { e.preventDefault(); void hideShelf(); } });
    win.on('blur', () => { if (!smoke && !pasting && !modalBusy && !showing && store.settings.hideOnBlur) void hideShelf(); });
    await win.loadFile(path.join(__dirname, 'index.html'));
    nativeTheme.on('updated', broadcast);
    if (startupCheck) { await require('./startup-integration.cjs').run({ app, win }); return; }
    if (smoke) {
      await require('./smoke.cjs').run({ app, win, store, media, save, broadcast, startNative, getHelper: () => helper, getUseRecords: () => smokeUses, snapshot, dataFile, encodeImage, importImageFile }); return;
    }
    if (clipboardCheck) {
      await require('./clipboard-integration.cjs').run({ app, win, store, media, save, broadcast, startNative, snapshot, getHelper:()=>helper, poll }); return;
    }
    if (performanceCheck) {
      startMonitoring();
      await require('./performance.cjs').run({app,win,store,save,broadcast,startNative,getHelper:()=>helper,encodeImage,showShelf,hideShelf});return;
    }
    void startNative().then(() => poll()); createTray();
    try { registerShortcut(store.settings.shortcut); } catch (e) { status.error = e.message; }
    startMonitoring();
    if (!process.argv.includes('--background')) await showShelf(false);
    broadcast();
  }).catch(e => { console.error(e?.stack||String(e)); app.exit(1); });
}
app.on('window-all-closed', () => { if (smoke) app.quit(); });
app.on('before-quit', event => {
  if(quitting) return; quitting=true;captureEpoch++;
  clearInterval(pauseTimer);clearInterval(pollTimer);clearTimeout(saveTimer);clearTimeout(clipTimer);clearTimeout(hideTimer);for(const timer of captureRetries)clearTimeout(timer);
  globalShortcut.unregisterAll();helper?.close();tray?.destroy();
  if(!saver) return;event.preventDefault();
  void stateTask(async()=>{try{await save();await saver.flush();}catch(e){console.error('历史保存失败：'+e.message);dialog.showErrorBox('历史暂未保存','已保留上次成功保存的历史。'+e.message);}finally{await background.close();app.quit();}});
});
