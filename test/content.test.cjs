const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MediaStore } = require('../src/media-store.cjs');
const { ignoredReason, readPacket, preparePaste } = require('../src/clipboard-content.cjs');
const { ClipStore } = require('../src/store.cjs');

test('media roundtrip, invalid IDs, integrity and selective collection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipshelf-media-test-'));
  try {
    const codec = { encode: x => Buffer.from(x).map(b => b ^ 85), decode: x => Buffer.from(x).map(b => b ^ 85) };
    const media = new MediaStore(dir, codec), png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
    const id = await media.write(png, png);
    assert.notDeepEqual(fs.readFileSync(media.file(id)), png);
    assert.deepEqual(await media.read(id), png);
    assert.deepEqual(await media.read(id, true), png);
    await assert.rejects(media.read('../escape'));
    await media.collect([id]); assert.ok(fs.existsSync(media.file(id)));
    fs.writeFileSync(media.file(id), codec.encode(Buffer.concat([png, Buffer.from('altered')])));
    await assert.rejects(media.read(id), /校验/);
    await media.collect([]); assert.equal(fs.readdirSync(dir).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('privacy excludes process names and confidential clipboard markers', () => {
  assert.equal(ignoredReason({ ignoredApps: ['KEEPASS.exe'] }, 'KeePass', [], () => Buffer.alloc(0)), 'application');
  assert.equal(ignoredReason({ ignoredApps: ['KEEPASS.exe'] }, '', [], () => Buffer.alloc(0)), 'unknown-source');
  assert.equal(ignoredReason({ ignoredApps: [] }, '', [], () => Buffer.alloc(0)), null);
  assert.equal(ignoredReason({}, '', ['CanIncludeInClipboardHistory'], () => Buffer.alloc(4)), 'confidential');
  assert.equal(ignoredReason({}, '', ['ExcludeClipboardContentFromMonitorProcessing'], () => Buffer.alloc(0)), 'confidential');
  assert.equal(ignoredReason({ ignoreConfidential: false }, '', ['CanIncludeInClipboardHistory'], () => Buffer.alloc(4)), null);
});
test('rich clipboard content preserves text and explicit plain paste removes HTML', () => {
  const packet = readPacket({ availableFormats: () => ['text/html'], readImage: () => ({ isEmpty: () => true }), readText: () => 'hello', readHTML: () => '<b>hello</b>' });
  assert.equal(packet.html, '<b>hello</b>');
  assert.equal(preparePaste([packet]).html, packet.html);
  assert.equal(preparePaste([packet], {}, true).html, '');
  assert.equal(preparePaste([packet], { alwaysPlainText: true }).html, '');
  assert.equal(preparePaste([packet, packet], { separator: '\t' }).text, 'hello\thello');
  assert.equal(preparePaste([packet, packet]).html, '');
  assert.throws(() => preparePaste([packet, { kind: 'image' }]), /单独/);
});
test('native bitmap is captured even when MIME image names are absent', () => {
  const png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  const image = { isEmpty: () => false, getSize: () => ({ width: 96, height: 64 }), toPNG: () => png, resize: () => image };
  const packet = readPacket({ availableFormats: () => [], readImage: () => image });
  assert.equal(packet.kind, 'image'); assert.equal(packet.width, 96); assert.deepEqual(packet.png, png);
});
test('image history deduplicates without losing title and pin; edits strip stale HTML', () => {
  const store = new ClipStore(), metadata = { mediaId: 'a'.repeat(64), width: 320, height: 200, bytes: 1000 };
  store.addImage(metadata, 'mspaint'); const id = store.items[0].id;
  store.mutate('star', id); store.mutate('edit', id, { title: '设计图' });
  store.addImage(metadata, 'chrome');
  assert.equal(store.items.length, 1); assert.equal(store.items[0].title, '设计图'); assert.ok(store.items[0].starred);
  assert.equal(preparePaste(store.items).mediaId, metadata.mediaId);
  store.add('hello', 'Word', '<b>hello</b>');
  const text = store.items[0]; store.mutate('edit', text.id, { text: 'changed', title: '' });
  assert.equal(text.html, ''); assert.equal(new ClipStore(store.snapshot()).items[1].kind, 'image');
});
