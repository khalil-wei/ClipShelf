const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { imageDimensions, loadImageFile, commitImageImport } = require('../src/image-import.cjs');
const { ClipStore } = require('../src/store.cjs');
const { cloneSnapshot, restoreUndo } = require('../src/undo.cjs');
function png(width = 10, height = 20) {
  const bytes = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes;
}
function jpeg(marker) { return Buffer.from([0xff,0xd8, 0xff,0xe1,0,4,0,0, 0xff,0xff,marker,0,11,8,0,20,0,10,1,1,0x11,0, 0xff,0xd9]); }
const packet = { png: png(), thumbnail: png(), width: 10, height: 20 };
const media = { write: async () => 'a'.repeat(64) };

test('image dimensions accept PNG, baseline and progressive JPEG; reject broken headers and pixel bombs', () => {
  for (const bytes of [png(), jpeg(0xc0), jpeg(0xc2)]) assert.deepEqual(imageDimensions(bytes), { width: 10, height: 20 });
  for (const bytes of [Buffer.alloc(0), png(0,20), png().subarray(0,25), jpeg(0xc0).subarray(0,16), Buffer.from([0xff,0xd8,0xff,0xe1,0,1])]) assert.throws(() => imageDimensions(bytes), /有效/);
  assert.throws(() => imageDimensions(png(100000,100000)), /3200/);
});

test('local files are bounded and validated before decoding, including renamed unsupported files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clipshelf-import-')); t.after(() => fs.rm(directory, {recursive:true,force:true}));
  let decoded = 0;
  const codec = { decode: () => { decoded++; return { isEmpty: () => false, getSize: () => ({width:10,height:20}) }; }, encode: async () => packet };
  const file = path.join(directory, '本地图片.png'); await fs.writeFile(file, png());
  assert.deepEqual(await loadImageFile(file, codec), { packet, title: '本地图片' });
  const before = decoded;
  for (const bytes of [Buffer.from('not an image'), png(100000,100000), Buffer.alloc(0)]) {
    await fs.writeFile(file, bytes); await assert.rejects(loadImageFile(file, codec));
  }
  const handle = await fs.open(file, 'w'); await handle.truncate(16 * 1024 * 1024 + 1); await handle.close();
  await assert.rejects(loadImageFile(file, codec), /16 MiB/);
  assert.equal(decoded, before, 'invalid or oversized files must never reach the native decoder');
});

test('decode errors and decoded dimensions are checked before image encoding', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clipshelf-import-')); t.after(() => fs.rm(directory, {recursive:true,force:true}));
  const file = path.join(directory, 'broken.png'); await fs.writeFile(file, png());
  const encode = () => { throw Error('must not encode'); };
  await assert.rejects(loadImageFile(file, {decode:()=>({isEmpty:()=>true}),encode}), /无法解码/);
  await assert.rejects(loadImageFile(file, {decode:()=>({isEmpty:()=>false,getSize:()=>({width:100000,height:100000})}),encode}), /3200/);
});

test('image import preserves existing title and groups, and undo preserves later copies', async () => {
  const store = new ClipStore(); store.add('before');
  const first = await commitImageImport({store,media,packet,title:'local image',save:async()=>{}});
  assert.equal(store.items[0].title, 'local image');
  store.mutate('star', first.id); store.mutate('group-add',null,'Images'); store.mutate('group-set',first.id,store.groups[0].id);
  store.items[0].title = 'my custom title'; const before = cloneSnapshot(store.snapshot());
  const again = await commitImageImport({store,media,packet,title:'renamed file',save:async()=>{}});
  assert.equal(again.id, first.id); assert.equal(store.items.length,2);
  assert.equal(store.items[0].title,'my custom title'); assert.equal(store.items[0].starred,true); assert.equal(store.items[0].groups.length,1);
  store.add('copied after import'); const restored = restoreUndo(again.undo, store);
  assert.equal(restored.items[0].text,'copied after import'); assert.deepEqual(restored.items.slice(1),before.items);
});

test('failed persistence and exhausted pinned capacity roll back the entire import', async () => {
  const store = new ClipStore(); store.add('keep'); const before = cloneSnapshot(store.snapshot());
  await assert.rejects(commitImageImport({store,media,packet,title:'fail',save:async()=>{throw Error('disk full');}}), /disk full/);
  assert.deepEqual(store.snapshot(),before);
  store.items = Array.from({length:2000},(_,i)=>({id:String(i),kind:'text',text:'pinned '+i,title:'',html:'',groups:[],starred:true,source:'',created:1,updated:1}));
  const full = cloneSnapshot(store.snapshot()); let saved = false;
  await assert.rejects(commitImageImport({store,media,packet,title:'full',save:async()=>{saved=true;}}), /容量不足/);
  assert.equal(saved,false); assert.deepEqual(store.snapshot(),full);
});
