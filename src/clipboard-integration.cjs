const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run({ app, win, store, media, save, broadcast, startNative, getHelper, poll, snapshot }) {
  const fixture = path.join(__dirname, 'clipboard-fixture.ps1');
  const fixturePath = app.isPackaged ? path.join(app.getPath('userData'), 'clipboard-fixture.ps1') : fixture;
  if (app.isPackaged) fs.writeFileSync(fixturePath, fs.readFileSync(fixture));
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fixturePath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [], waiters = []; let failure = '';
  child.stderr.on('data', chunk => { failure += chunk.toString(); });
  readline.createInterface({ input: child.stdout }).on('line', line => { if (waiters.length) waiters.shift()(line); else lines.push(line); });
  const next = () => Promise.race([new Promise(resolve => { if (lines.length) resolve(lines.shift()); else waiters.push(resolve); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Clipboard fixture timeout: ' + failure)), 15000); timer.unref(); })]);
  const request = async command => { child.stdin.write(command + '\n'); const result = await next(); if (result.startsWith('ERROR')) throw Error(result); return result; };
  let restored = 'not-run';
  try {
    assert.equal(await next(), 'READY'); assert.ok(await startNative());
    const helper=getHelper(),oldChild=helper.child;oldChild.kill();for(let i=0;i<20&&helper.alive;i++)await sleep(10);
    store.configure({ignoredApps:['clipshelf-privacy-fixture']});
    assert.equal(await request('IMAGE'), 'IMAGE_READY');await poll();
    assert.equal(store.items.length,0,'unknown source must be blocked when exclusions are configured');assert.equal(snapshot().status.captureBlocked,true);
    for(let i=0;i<100&&(!helper.alive||helper.child===oldChild);i++)await sleep(50);assert.ok(helper.alive&&helper.child!==oldChild,'helper recovery before clipboard capture');
    store.configure({ignoredApps:[]});await poll();
    for (let i = 0; i < 50 && !store.items.some(x => x.kind === 'image'); i++) await sleep(100);
    const item = store.items.find(x => x.kind === 'image');
    assert.ok(item, 'native clipboard event must capture a real Windows bitmap');
    assert.equal(item.width, 96); assert.equal(item.height, 64);
    assert.equal(await request('CHECK'), 'IMAGE_MATCH');
    await media.read(item.mediaId); await save(); broadcast(); await sleep(80);
    const copied = await win.webContents.executeJavaScript(`window.clips.use([${JSON.stringify(item.id)}],true)`);
    assert.ok(copied.ok, copied.error); assert.equal(await request('CHECK'), 'IMAGE_MATCH');
    await sleep(600); assert.equal(store.items.filter(x => x.kind === 'image').length, 1, 'own writes must not duplicate history');
    const preview = await win.webContents.executeJavaScript(`(async()=>{const r=await window.clips.image(${JSON.stringify(item.id)},true);const img=new Image();img.src=r.dataUrl;await img.decode();return img.naturalWidth===96&&img.naturalHeight===64;})()`);
    assert.ok(preview);
    assert.equal(await request('FILE'), 'FILE_READY');
    for (let i=0;i<50&&!store.items.some(x=>x.kind==='image'&&x.width===80&&x.height===48);i++) await sleep(100);
    const fileItem=store.items.find(x=>x.kind==='image'&&x.width===80&&x.height===48); assert.ok(fileItem,'copied PNG file must enter image history');
    const fileCopied=await win.webContents.executeJavaScript(`window.clips.use([${JSON.stringify(fileItem.id)}],true)`);
    assert.ok(fileCopied.ok,fileCopied.error); assert.equal(await request('CHECK'),'IMAGE_MATCH');
    restored = await request('RESTORE');
    const report = { realWindowsBitmapCaptured: true, nativeImageCopiedBack: true, nativePixelsMatched: true, previewDecoded: true, ownCopyDeduplicated: true, copiedImageFileCaptured: true, imageFileCopiedAsBitmap: true, helperRecovery:true, nativeBackend:snapshot().status.nativeBackend, unknownSourceProtected:true, clipboardRestoration: restored };
    const folder = app.isPackaged ? path.join(path.dirname(process.execPath), 'test-artifacts') : path.join(__dirname, '..', 'artifacts'); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'clipboard-integration-v5.json'), JSON.stringify(report, null, 2));
    console.log('CLIPBOARD_PASS ' + JSON.stringify(report));
  } finally {
    if (restored === 'not-run' && child.exitCode === null) { try { console.log('CLIPBOARD_CLEANUP ' + await request('RESTORE')); } catch {} }
    child.stdin.end(); app.quit();
  }
}
module.exports = { run };
