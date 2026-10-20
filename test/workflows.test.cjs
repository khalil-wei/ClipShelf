const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ClipStore } = require('../src/store.cjs');
const { queryItems, classify } = require('../src/view-model.js');
const { restoreUndo } = require('../src/undo.cjs');
test('legacy history migrates safely without losing pins or text', () => {
  const s = new ClipStore({ items: [{ id: 'legacy', text: 'old text', groups: ['missing'], starred: true }], groups: [] });
  assert.equal(s.items[0].text, 'old text'); assert.equal(s.items[0].starred, true); assert.deepEqual(s.items[0].groups, []); assert.equal(s.settings.shortcut, 'Ctrl+Shift+V');
});
test('editing and renaming retains source, ordering and pin memberships', () => {
  const s = new ClipStore(); s.add('first', 'Code'); const item = s.items[0]; s.mutate('star', item.id); s.mutate('group-add', null, { name: 'Work', color: '#f06464' }); s.mutate('group-set', [item.id], s.groups[0].id); s.add('second');
  s.mutate('edit', item.id, { text: 'https://example.com', title: 'Reference' });
  assert.equal(s.items[1].id, item.id); assert.equal(item.kind, 'link'); assert.equal(item.source, 'Code'); assert.equal(item.title, 'Reference'); assert.ok(item.starred); assert.equal(item.groups.length, 1);
});
test('search combines title, unicode, source, type, group and time filters', () => {
  const s = new ClipStore(); s.add('设计规范 中文示例', 'Code'); const target = s.items[0]; target.title = 'Windows notes'; s.add('https://example.com', 'msedge');
  assert.deepEqual(queryItems(s.items, { query: '中文 Windows', source: 'Code', kind: 'text', days: 1 }).map(x => x.id), [target.id]);
  assert.equal(queryItems(s.items, { query: '中文', kind: 'link' }).length, 0);
  target.updated = Date.now() - 10 * 86400000; assert.equal(queryItems(s.items, { days: 7, query: '中文' }).length, 0);
});
test('retention removes expired unpinned records and preserves pins/groups', () => {
  const s = new ClipStore(); for (const text of ['ordinary', 'pinned', 'grouped']) s.add(text);
  s.mutate('star', s.items[1].id); s.mutate('group-add', null, 'Work'); s.mutate('group-set', s.items[0].id, s.groups[0].id);
  s.items.forEach(x => { x.updated -= 40 * 86400000; }); s.mutate('settings', null, { retentionDays: 7 });
  assert.deepEqual(s.items.map(x => x.text), ['grouped', 'pinned']);
});
test('undo after a delete preserves newer copied content and current preferences', () => {
  const s = new ClipStore(); s.add('old'); const before = JSON.stringify(s.snapshot()); s.mutate('delete', s.items[0].id); const afterIds = s.items.map(x => x.id);
  s.add('new copy'); s.mutate('settings', null, { theme: 'dark', shortcut: 'Alt+V' }); s.mutate('pause');
  const restored = restoreUndo({ before, afterIds }, s); assert.deepEqual(restored.items.map(x => x.text), ['new copy', 'old']); assert.equal(restored.settings.theme, 'dark'); assert.equal(restored.settings.shortcut, 'Alt+V'); assert.equal(restored.paused, true);
});
test('batch pinning is idempotent; batch deletion preserves unselected records', () => {
  const s = new ClipStore(); for (const text of ['one', 'two', 'three']) s.add(text); s.mutate('group-add', null, 'Work'); const ids = s.items.slice(0, 2).map(x => x.id), group = s.groups[0].id;
  s.mutate('group-set', ids, group); s.mutate('group-set', ids, group); assert.ok(s.items.slice(0, 2).every(x => x.groups.length === 1)); s.mutate('delete', ids); assert.deepEqual(s.items.map(x => x.text), ['one']);
});
test('invalid preferences do not partially apply and empty edits are rejected', () => {
  const s = new ClipStore(); s.add('keep'); assert.throws(() => s.mutate('settings', null, { theme: 'dark', shortcut: 'bad' })); assert.equal(s.settings.theme, 'system'); assert.throws(() => s.mutate('edit', s.items[0].id, { text: ' ' })); assert.equal(s.items[0].text, 'keep');
});
test('classifies code, colors and validated links without treating markup as UI', () => {
  assert.equal(classify('const value = 1;'), 'code'); assert.equal(classify('#ABC'), 'color'); assert.equal(classify('https://example.com'), 'link'); assert.equal(classify('https://['), 'text');
});
test('expanding compact mode restores a usable normal height', () => {
  const s = new ClipStore(); s.mutate('settings', null, { height: 302, compact: true }); s.mutate('settings', null, { compact: false }); assert.equal(s.settings.height, 390); assert.equal(s.settings.compact, false);
});
test('a completely pinned history rejects new entries without losing pins', () => {
  const items = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), text: 'pinned ' + i, starred: true, groups: [] })); const s = new ClipStore({ items }); assert.equal(s.add('new'), false); assert.equal(s.items.length, 2000); assert.ok(s.items.every(x => x.starred));
});
