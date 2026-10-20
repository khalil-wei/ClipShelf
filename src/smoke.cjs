const { BrowserWindow, globalShortcut, safeStorage, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const performanceNow=()=>Number(process.hrtime.bigint())/1000000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run({ app, win, store, save, broadcast, startNative, getHelper, getUseRecords, snapshot, dataFile, media, encodeImage, importImageFile }) {
  const execute=win.webContents.executeJavaScript.bind(win.webContents);
  win.webContents.executeJavaScript=async code=>{
    const result=await execute(`(async()=>{try{return {passed:true,value:await (${code.trim().replace(/;$/,'')})};}catch(error){return {passed:false,message:error?.name+': '+error?.message,stack:error?.stack};}})()`);
    if(!result.passed)throw Error(result.stack||result.message);return result.value;
  };
  console.log('SMOKE_STAGE native');
  const helperReady = await startNative(); assert.ok(helperReady, 'Windows helper must start');
  const helper = getHelper(); const handle = await helper.request('CAPTURE'); assert.match(handle, /^\d+$/);
  const oldChild=helper.child;oldChild.kill();for(let i=0;i<100&&(!helper.alive||helper.child===oldChild);i++)await sleep(50);
  assert.ok(helper.alive&&helper.child!==oldChild,'Windows helper must reconnect after process exit');
  const bounds = await helper.request('BOUNDS ' + handle); assert.equal(bounds.split(',').length, 4);
  const shortcutRegistered = globalShortcut.register('Ctrl+Alt+Shift+F12', () => {}); assert.ok(shortcutRegistered);
  let pasteDelivered = false;
  if(process.argv.includes('--paste-integration')) {
  const { NativeClient } = require('./native-client.cjs');
  const sourceFixture=path.join(__dirname,'clipboard-fixture.ps1');
  const fixturePath=app.isPackaged?path.join(app.getPath('userData'),'paste-fixture.ps1'):sourceFixture;
  if(app.isPackaged)fs.writeFileSync(fixturePath,fs.readFileSync(sourceFixture));
  const pasteFixture = new NativeClient(fixturePath);
  const receiver = new BrowserWindow({ x:60,y:60,width: 350, height: 180, show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  try {
    assert.ok(await pasteFixture.ready);await pasteFixture.request('TEXT');
    await receiver.loadURL('data:text/html,<title>ClipShelf controlled receiver</title><textarea id="first">unchanged</textarea><textarea id="second" autofocus>before-after</textarea>');
    win.hide();receiver.setAlwaysOnTop(true);receiver.show(); receiver.focus(); await sleep(200);
    await receiver.webContents.executeJavaScript(`document.querySelector('#first').value='unchanged';const box=document.querySelector('#second');box.value='before-after';box.focus();box.setSelectionRange(7,7);`);
    const captured = await helper.request('CAPTURE');
    assert.equal(captured,receiver.getNativeWindowHandle().readBigUInt64LE().toString());
    receiver.setAlwaysOnTop(false);
    for(let attempt=0;attempt<3;attempt++){
      win.show();win.focus();await sleep(100);
      await helper.request('PASTE '+captured+' '+win.getNativeWindowHandle().readBigUInt64LE().toString());win.hide();await sleep(150);
      const values=await receiver.webContents.executeJavaScript(`[document.querySelector('#first').value,document.querySelector('#second').value]`);
      assert.deepEqual(values,['unchanged','before-'+'ClipShelf paste check'.repeat(attempt+1)+'after'],'paste must insert into the original textbox at its caret');
    }
    pasteDelivered=true;
  } finally { receiver.destroy();try{await pasteFixture.request('RESTORE');}finally{pasteFixture.close();} }
  console.log('PASTE_INTEGRATION_PASS');app.quit();return;
  }
  store.add('ClipShelf smoke test', 'notepad'); store.add('https://example.com', 'msedge'); await save(); broadcast(); win.showInactive(); await sleep(150);
  console.log('SMOKE_STAGE workflow');
  const result = await win.webContents.executeJavaScript(`(async () => {
    const wait = () => new Promise(r => setTimeout(r, 100));
    const key = (value, options={}) => document.querySelector('#cards').dispatchEvent(new KeyboardEvent('keydown', { key:value, bubbles:true, ...options }));
    const query = value => { document.querySelector('#search').value=value; document.querySelector('#search').dispatchEvent(new Event('input')); };
    const state=await window.clips.state(); if(state.items.length!==2) throw Error('state failed');
    query('smoke'); await wait(); if(document.querySelectorAll('.card').length!==1) throw Error('search failed');
    query(''); await wait();
    const before=document.querySelector('.card'); key('ArrowRight');
    if(document.querySelector('.card')!==before) throw Error('navigation must preserve card DOM');
    key(' '); if(!document.querySelector('#preview-dialog').open) throw Error('Space preview failed'); document.querySelector('#preview-dialog').close();
    key('e',{ctrlKey:true}); if(document.querySelector('#item-text').readOnly) throw Error('edit shortcut failed');
    document.querySelector('#item-title').value='重命名测试'; document.querySelector('#item-text').value='edited smoke text';
    document.querySelector('#preview-form').requestSubmit(); await wait();
    if(!(await window.clips.state()).items.some(x=>x.title==='重命名测试'&&x.text==='edited smoke text')) throw Error('edit persistence failed');
    const r=await window.clips.mutate('star',state.items[0].id); if(!r.ok) throw Error(r.error);
    await window.clips.mutate('group-add',null,{name:'工作片段',color:'#629fe7'}); await wait();
    const updated=await window.clips.state(); const group=updated.groups[0];
    const pinboard=[...document.querySelectorAll('#tabs button')].find(b=>b.textContent==='工作片段');
    const transfer=new DataTransfer(); transfer.setData('application/x-clipshelf',JSON.stringify([state.items[0].id]));
    pinboard.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer})); pinboard.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer})); await wait();
    if(!(await window.clips.state()).items.find(x=>x.id===state.items[0].id).groups.includes(group.id)) throw Error('drag-to-pinboard failed');
    await window.clips.mutate('group-set',[state.items[0].id,state.items[1].id],group.id); await wait();
    const grouped=await window.clips.state(); if(!grouped.items.every(x=>x.groups.includes(group.id))) throw Error('batch pin failed');
    await window.clips.mutate('pause'); if(!(await window.clips.state()).paused) throw Error('pause failed'); await window.clips.mutate('pause');
    key('a',{ctrlKey:true}); await wait(); if(document.querySelectorAll('.card[aria-selected="true"]').length!==2) throw Error('multiselect failed');
    key('Delete'); await wait(); if((await window.clips.state()).items.length!==0) throw Error('delete failed');
    key('z',{ctrlKey:true}); await wait(); if((await window.clips.state()).items.length!==2) throw Error('undo failed');
    const pair=[...document.querySelectorAll('.card')]; pair[0].click(); pair[1].focus(); pair[1].dispatchEvent(new MouseEvent('click',{ctrlKey:true,bubbles:true}));
    if(document.querySelectorAll('.card[aria-selected="true"]').length!==2) throw Error('Ctrl-click multiselect failed');
    key('c',{ctrlKey:true}); await wait(); key('1',{ctrlKey:true}); await wait();
    key('Home'); key('ArrowRight',{shiftKey:true}); if(document.querySelectorAll('.card[aria-selected="true"]').length!==2) throw Error('range selection failed');
    key('Process'); if(document.activeElement.id!=='search') throw Error('IME search focus failed');
    document.querySelector('#cards').focus();
    await window.clips.mutate('settings',null,{compact:true,theme:'dark',reduceMotion:true}); await wait();
    if(!document.documentElement.classList.contains('compact')||!document.documentElement.classList.contains('dark')) throw Error('appearance settings failed: '+document.documentElement.className+' '+JSON.stringify((await window.clips.state()).settings));
    await window.clips.mutate('settings',null,{compact:false,theme:'light',reduceMotion:false}); await wait();
    query('<script>'); await wait(); if(document.querySelectorAll('.card').length) throw Error('literal search failed'); query('');
    return {search:true,preview:true,edit:true,batchPin:true,dragToPinboard:true,multiSelect:true,undo:true,settings:true,stableNavigation:true,ime:true,isolated:typeof require==='undefined'};
  })()`);
  console.log('SMOKE_STAGE local');
  const localFeatures = await win.webContents.executeJavaScript(`(async()=>{
    const wait=()=>new Promise(r=>setTimeout(r,110)), $=s=>document.querySelector(s);
    $('#settings').click(); await wait(); if($('#setting-startup').disabled) throw Error('startup switch unavailable');
    $('#setting-startup').checked=true; $('#settings-form').requestSubmit(); await wait();
    if(!(await window.clips.state()).settings.openAtLogin) throw Error('startup form failed');
    await window.clips.mutate('settings',null,{openAtLogin:false});
    $('#pause-duration').click(); [...document.querySelectorAll('#context-menu button')].find(b=>b.textContent==='暂停 5 分钟').click(); await wait();
    let state=await window.clips.state(); if(!state.paused||state.pauseUntil<Date.now()+290000) throw Error('timed pause failed'); $('#pause').click(); await wait();
    const group=state.groups[0]; [...document.querySelectorAll('#tabs button')].find(b=>b.textContent===group.name).click(); await wait();
    const ordered=state.items.map(x=>x.id), last=ordered.at(-1), first=ordered[0];
    const target=$('[data-id="'+first+'"]'), transfer=new DataTransfer(); transfer.setData('application/x-clipshelf',JSON.stringify([last]));
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:target.getBoundingClientRect().left-1})); await wait();
    state=await window.clips.state(); if(state.groups[0].order[0]!==last) throw Error('pinboard item order failed');
    const sorted=state.groups[0].order; $('[data-id="'+sorted[0]+'"]').click(); $('[data-id="'+sorted[1]+'"]').dispatchEvent(new MouseEvent('click',{ctrlKey:true,bubbles:true}));
    $('#stack-add').click(); await wait(); state=await window.clips.state();
    if(state.stack.length!==2||state.stack[0].id!==last||$('#stack-bar').hidden) throw Error('queue UI/order failed');
    $('#stack-reverse').click(); await wait(); if((await window.clips.state()).stack[0].id!==first) throw Error('queue reverse failed');
    $('#stack-copy').click(); await wait(); if((await window.clips.state()).stack.length!==1) throw Error('queue next failed');
    $('#stack-clear').click(); await wait(); if(!$('#stack-bar').hidden) throw Error('queue clear failed');
    await window.clips.mutate('group-add',null,{name:'排序临时组'}); await wait(); state=await window.clips.state(); const temp=state.groups.at(-1);
    const groupTransfer=new DataTransfer(); groupTransfer.setData('application/x-clipshelf-group',temp.id);
    const tab=[...document.querySelectorAll('#tabs button')].find(b=>b.textContent===group.name);
    tab.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:groupTransfer,clientX:tab.getBoundingClientRect().left-1})); await wait();
    if((await window.clips.state()).groups[0].id!==temp.id) throw Error('group drag order failed');
    await window.clips.mutate('group-delete',temp.id); await wait();
    const search=$('#search'); search.value='edited';search.dispatchEvent(new Event('input')); await wait();
    $('#cards').dispatchEvent(new KeyboardEvent('keydown',{key:'g',ctrlKey:true,bubbles:true})); await wait();
    if(search.value||document.querySelectorAll('.card').length!==2) throw Error('jump to history failed');
    return {startupSwitch:true,timedPause:true,pinboardItemOrder:true,pinboardOrder:true,pasteStack:true,jumpToHistory:true};
  })()`);
  const uses = getUseRecords(); assert.ok(uses.some(x => x.copyOnly && x.ids.length === 2), 'multi-copy handler'); assert.ok(uses.some(x => !x.copyOnly && x.ids.length === 1), 'numbered quick paste handler');
  console.log('SMOKE_STAGE hidden');
  store.paused=true;store.pauseUntil=Date.now()+100;broadcast();await sleep(250);assert.equal(store.paused,false,'one-shot timer must resume recording');
  win.hide();store.add('A'.repeat(3000)+' hidden-full-body-marker','test');const hiddenId=store.items[0].id;broadcast();win.showInactive();await sleep(120);
  await win.webContents.executeJavaScript(`(async()=>{const search=document.querySelector('#search');search.value='hidden-full-body-marker';search.dispatchEvent(new Event('input'));await new Promise(r=>requestAnimationFrame(r));if(document.querySelectorAll('.card').length!==1)throw Error('Hidden history body did not reach search');document.querySelector('#cards').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));if(!document.querySelector('#item-text').value.endsWith('hidden-full-body-marker'))throw Error('Full preview body was truncated');document.querySelector('#preview-dialog').close();search.value='';search.dispatchEvent(new Event('input'));})()`);
  store.mutate('delete',hiddenId);broadcast();localFeatures.hiddenShelfUpdates=true;localFeatures.pauseDeadlineResume=true;
  for (let i = 0; i < 1850; i++) store.add('历史记录测试 ' + i, 'notepad');
  broadcast(); await sleep(150);
  const performance = await win.webContents.executeJavaScript(`(async()=>{
    const start=performance.now(); const host=document.querySelector('#cards'); host.scrollLeft=host.scrollWidth; host.dispatchEvent(new Event('scroll')); await new Promise(r=>requestAnimationFrame(r));
    const count=document.querySelectorAll('.card').length; if(count>30) throw Error('virtualization rendered too many cards: '+count);
    if(![...document.querySelectorAll('.card')].some(x=>x.getAttribute('aria-label').includes('edited smoke text')||x.getAttribute('aria-label').includes('重命名测试')||x.getAttribute('aria-label').includes('example.com'))) throw Error('history tail not rendered');
    host.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
    document.querySelector('#search').value='1850'; document.querySelector('#search').dispatchEvent(new Event('input'));
    document.querySelector('#search').value=''; document.querySelector('#search').dispatchEvent(new Event('input'));
    return {history:1852,renderedNodes:count,scrollFrameMs:Math.round(performance.now()-start)};
  })()`);
  const motion = await win.webContents.executeJavaScript(`(async()=>{
    const host=document.querySelector('#cards'), gaps=[]; let last;
    for(let i=0;i<45;i++){const t=await new Promise(r=>requestAnimationFrame(r));if(last)gaps.push(t-last);last=t;host.scrollLeft=i*40;host.dispatchEvent(new Event('scroll'));}
    gaps.sort((a,b)=>a-b);return {sampledFrames:gaps.length,p95FrameMs:Math.round(gaps[Math.floor(gaps.length*.95)]*10)/10,maxFrameMs:Math.round(gaps.at(-1)*10)/10};
  })()`);
  // Keep large performance fixtures out of the visual example.
  store.items = store.items.filter(x => !x.text.startsWith('历史记录测试 '));
  store.mutate('group-add', null, { name: '常用链接', color: '#f06464' });
  store.mutate('group-add', null, { name: '灵感笔记', color: '#eda841' });
  store.add('每一个好想法，\n都值得再被找到。\n\n把今天的灵感留在这里，\n让明天的工作轻一点。', 'notepad');
  store.add('const inspiration = {\n  capture: "the little things",\n  keep: "what matters",\n  create: () => somethingNew()\n};\n\n// A little less searching.\n// A little more creating.', 'Code');
  store.add('#8B6FD6', 'Code');
  store.add('https://developer.mozilla.org/en-US/docs/Web', 'msedge');
  store.add('设计备忘\n\n留白，让内容呼吸。\n动效，让操作连贯。\n细节，让工具顺手。\n\nLess friction. More flow.', 'notepad');
  const bitmap = Buffer.alloc(120 * 80 * 4);
  for (let y=0;y<80;y++) for(let x=0;x<120;x++){ const i=(y*120+x)*4; bitmap[i]=180; bitmap[i+1]=80+y; bitmap[i+2]=70+x; bitmap[i+3]=255; }
  const fixture = nativeImage.createFromBitmap(bitmap, {width:120,height:80}), png = fixture.toPNG();
  const mediaId = await media.write(png, png); store.addImage({mediaId,width:120,height:80,bytes:png.length}, 'mspaint');
  const imageId = store.items[0].id;
  store.add('富文本测试', 'WINWORD', '<b>富文本测试</b>'); const richId = store.items[0].id;
  broadcast(); await sleep(150);
  console.log('SMOKE_STAGE content');
  const content = await win.webContents.executeJavaScript(`(async()=>{
    const id=${JSON.stringify(imageId)}, rich=${JSON.stringify(richId)};
    const image=await window.clips.image(id,true); if(!image.ok||!image.dataUrl.startsWith('data:image/png;base64,')) throw Error('image IPC failed');
    const card=document.querySelector('[data-id="'+id+'"]'); if(!card) throw Error('image card missing');
    const thumbnail=card.querySelector('img'); await thumbnail.decode(); if(thumbnail.naturalWidth!==120) throw Error('thumbnail decode failed');
    card.click(); document.querySelector('#cards').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));
    await new Promise(r=>setTimeout(r,100)); const preview=document.querySelector('#preview-image'); await preview.decode();
    if(document.querySelector('#preview-image-wrap').hidden||!document.querySelector('#item-text').hidden) throw Error('image preview failed');
    document.querySelector('#preview-dialog').close();
    await window.clips.use([id],true); await window.clips.use([rich],true); await window.clips.use([rich],true,true);
    const mixed=await window.clips.use([id,rich],true); if(mixed.ok) throw Error('mixed content must reject');
    return {imagePreview:true,imageClipboardRoute:true,richTextRoute:true,plainTextRoute:true,mixedPasteRejected:true};
  })()`);
  console.log('SMOKE_STAGE images');
  const imageTools = await win.webContents.executeJavaScript(`(async()=>{
    const $=s=>document.querySelector(s),wait=()=>new Promise(r=>setTimeout(r,80)),id=${JSON.stringify(imageId)};
    $('[data-id="'+id+'"]').click();$('#cards').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));await wait();await $('#preview-image').decode();
    $('#image-actual').click();$('#image-in').click();if($('#image-scale').textContent!=='125%')throw Error('image zoom failed');
    $('#image-fit').click();if($('#image-tools').hidden)throw Error('image controls missing');
    $('#image-right').click();for(let i=0;i<80;i++){await wait();const item=(await window.clips.state()).items.find(x=>x.id===id);if(item.width===80&&item.height===120)break;}
    const rotated=(await window.clips.state()).items.find(x=>x.id===id);if(rotated.width!==80||rotated.height!==120)throw Error('image rotation failed');
    for(let i=0;i<40;i++){try{await $('#preview-image').decode();if($('#preview-image').naturalWidth===80)break;}catch{}await wait();}
    if($('#preview-image').naturalWidth!==80)throw Error('rotated preview failed');
    const exported=await window.clips.exportImage(id);if(!exported.ok||!exported.simulated)throw Error('export route failed');
    $('#preview-dialog').close();await window.clips.mutate('undo');await wait();
    const restored=(await window.clips.state()).items.find(x=>x.id===id);if(restored.width!==120||restored.height!==80)throw Error('rotation undo failed');
    return {imageZoom:true,imageRotation:true,imageRotationUndo:true,imageExportRoute:true};
  })()`);
  const contentUses = getUseRecords().slice(-3);
  await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>setTimeout(()=>{if(document.querySelector('#preview-image').hasAttribute('src'))return reject(Error('Closed preview retained full image'));resolve();},80))`);
  imageTools.imagePreviewReleased=true;
  assert.equal(contentUses[0].kind,'image'); assert.equal(contentUses[1].html,'<b>富文本测试</b>'); assert.equal(contentUses[2].html,'');
  assert.deepEqual(await media.read(mediaId),png); assert.ok(!fs.readFileSync(media.file(mediaId)).equals(png));
  const alphaImage=nativeImage.createFromBitmap(Buffer.from([25,50,100,128]),{width:1,height:1});
  const nativeAlpha=nativeImage.createFromBuffer(alphaImage.toPNG()).toBitmap(),alphaPacket=await encodeImage(alphaImage);
  const workerAlpha=nativeImage.createFromBuffer(alphaPacket.png).toBitmap();assert.deepEqual([...workerAlpha],[...nativeAlpha],'transparent PNG must match native encoder pixels');
  console.log('SMOKE_STAGE image-import');
  for (const [extension, bytes] of [['png',alphaImage.toPNG()],['jpg',alphaImage.toJPEG(90)]]) {
    const fixture = path.join(app.getPath('userData'), '本地图片导入测试.' + extension);
    fs.writeFileSync(fixture,bytes);
    try {
      const count = store.items.length, imported = await importImageFile(fixture);
      assert.equal(imported.ok,true); assert.equal(store.items.length,count+1);
      assert.equal(store.items[0].title,'本地图片导入测试');
      await win.webContents.executeJavaScript(`(async()=>{
        const search=document.querySelector('#search');search.value='本地图片导入测试';search.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,100));
        const card=document.querySelector('[data-id="${imported.id}"]');if(!card)throw Error('imported image search failed');card.click();
        document.querySelector('#cards').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));await new Promise(r=>setTimeout(r,100));
        await document.querySelector('#preview-image').decode();document.querySelector('#preview-dialog').close();
        const copied=await window.clips.use(['${imported.id}'],true);if(!copied.ok)throw Error(copied.error);
        const undo=await window.clips.mutate('undo');if(!undo.ok)throw Error(undo.error);
        search.value='';search.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,100));
      })()`);
      assert.equal(store.items.length,count); assert.ok(!store.items.some(x=>x.id===imported.id));
    } finally { fs.unlinkSync(fixture); }
  }
  await win.webContents.executeJavaScript(`(async()=>{
    const count=(await window.clips.state()).items.length;document.querySelector('#cards').dispatchEvent(new KeyboardEvent('keydown',{key:'o',ctrlKey:true,bubbles:true}));
    await new Promise(r=>setTimeout(r,80));if(document.querySelector('#import-image').disabled)throw Error('import button stayed disabled');
    if((await window.clips.state()).items.length!==count)throw Error('canceling import changed history');
  })()`);
  imageTools.localImageImport=true;imageTools.imageImportUndo=true;imageTools.imageImportCancel=true;
  const largeBitmap=Buffer.alloc(2048*8192*4,Buffer.from([40,120,210,255]));
  const largeImage=nativeImage.createFromBitmap(largeBitmap,{width:2048,height:8192});
  let ticks=0,lastTick=performanceNow(),maxGap=0;const startWork=lastTick;
  const heartbeat=setInterval(()=>{const now=performanceNow();maxGap=Math.max(maxGap,now-lastTick);lastTick=now;ticks++;},10);
  let largePacket;
  try {
    largePacket=await encodeImage(largeImage);assert.equal(largePacket.width,2048);assert.equal(largePacket.height,8192);
    const decoded=nativeImage.createFromBuffer(largePacket.png);assert.equal(decoded.getSize().height,8192);assert.ok(decoded.toBitmap().subarray(0,4).equals(Buffer.from([40,120,210,255])));
    for(let i=0;i<8;i++)store.add('压力记录 '+i+' '+ '中'.repeat(170000),'stress-fixture');
    await save();
  } finally {clearInterval(heartbeat);}
  assert.ok(ticks>3,'main event loop must continue during long screenshot encoding');
  const backgroundWork={pixels:2048*8192,encodedBytes:largePacket.png.length,totalMs:Math.round(performanceNow()-startWork),heartbeatTicks:ticks,maxMainGapMs:Math.round(maxGap)};
  store.items=store.items.filter(x=>x.source!=='stress-fixture');
  await save(); broadcast(); await sleep(100); win.setSize(1440, 390); win.show(); win.webContents.send('shelf-show'); await sleep(400);
  await win.webContents.executeJavaScript(`document.querySelector('#feedback').textContent=''`);
  const artifactPath = app.isPackaged ? path.join(path.dirname(process.execPath), 'test-artifacts') : path.join(__dirname, '..', 'artifacts'); fs.mkdirSync(artifactPath, { recursive: true });
  fs.writeFileSync(path.join(artifactPath, 'shelf-v5.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`window.clips.mutate('settings',null,{compact:true,theme:'dark'})`); await sleep(150);
  fs.writeFileSync(path.join(artifactPath, 'shelf-v5-dark.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async()=>{await window.clips.mutate('settings',null,{compact:false,theme:'light'});document.querySelector('[data-id=\"${imageId}\"]').click();document.querySelector('#cards').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));})()`);await sleep(150);
  fs.writeFileSync(path.join(artifactPath,'image-tools-v5.png'),(await win.webContents.capturePage()).toPNG());
  const disk = JSON.parse(safeStorage.decryptString(fs.readFileSync(dataFile))); assert.ok(disk.items.some(x => x.starred)); assert.ok(disk.groups.length === 3);
  const report = { ...result, ...localFeatures, ...content, ...imageTools, helperRecovery:true, nativeBackend:snapshot().status.nativeBackend, transparentImageRoundtrip:true, backgroundWork, encryptedImages:true, performance, motion, encryptedPersistence: true, nativeEvents: snapshot().status.events, shortcutRegistered, pasteDelivered };
  fs.writeFileSync(path.join(artifactPath, 'verification-v5.json'), JSON.stringify(report, null, 2));
  console.log('SMOKE_PASS ' + JSON.stringify(report)); app.quit();
}
module.exports = { run };
