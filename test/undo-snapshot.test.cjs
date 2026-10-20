const test=require('node:test');
const assert=require('node:assert/strict');
const {ClipStore}=require('../src/store.cjs');
const {cloneSnapshot,restoreUndo}=require('../src/undo.cjs');
test('undo metadata snapshot survives later in-place edits and preserves newer copies',()=>{
  const store=new ClipStore();store.add('正文'.repeat(100000));const id=store.items[0].id;
  store.mutate('group-add',null,'工作');const groupId=store.groups[0].id;store.mutate('group-set',id,groupId);
  const before=cloneSnapshot(store.snapshot());
  store.mutate('edit',id,{text:'changed',title:'changed'});store.items[0].groups.length=0;store.groups[0].order.push('changed');store.settings.ignoredApps.push('private');
  assert.equal(before.items[0].text,'正文'.repeat(100000));assert.deepEqual(before.items[0].groups,[groupId]);assert.ok(!before.groups[0].order.includes('changed'));assert.deepEqual(before.settings.ignoredApps,[]);
  store.add('copied after edit');const restored=restoreUndo({before,afterIds:[id]},store);
  assert.equal(restored.items[0].text,'copied after edit');assert.equal(restored.items.find(x=>x.id===id).text,before.items[0].text);assert.deepEqual(restored.settings.ignoredApps,['private']);
});
