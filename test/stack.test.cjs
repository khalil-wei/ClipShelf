const test = require('node:test');
const assert = require('node:assert/strict');
const { PasteStack } = require('../src/paste-stack.cjs');
const { ClipStore } = require('../src/store.cjs');
const { queryItems } = require('../src/view-model.js');
test('queue preserves chosen order, skips deleted items, advances only on success', async () => {
  const queue = new PasteStack(), items = [{id:'a'},{id:'b'},{id:'c'}];
  queue.add(['b','a','b','unknown','c'], items); assert.deepEqual(queue.ids,['b','a','c']);
  await queue.next(items, async () => ({ok:false})); assert.deepEqual(queue.ids,['b','a','c']);
  const used=[]; await queue.next(items.filter(x=>x.id!=='b'), async id => { used.push(id); return {ok:true}; });
  assert.deepEqual(used,['a']); assert.deepEqual(queue.ids,['c']);
});
test('concurrent queue paste is rejected until the previous item completes', async () => {
  const queue = new PasteStack(), items = [{id:'a'},{id:'b'}]; queue.add(['a','b'],items);
  let resolve; const first=queue.next(items,()=>new Promise(r=>{resolve=r;}));
  assert.equal((await queue.next(items,async()=>({ok:true}))).ok,false);
  resolve({ok:true}); await first; assert.deepEqual(queue.ids,['b']);
});
test('pinboard and item reordering survives recopy and reload', () => {
  const store=new ClipStore(); for(const text of ['a','b','c']) store.add(text);
  store.mutate('group-add',null,{name:'first'}); store.mutate('group-add',null,{name:'second'});
  const [a,b,c]=store.items.map(x=>x.id), [g,h]=store.groups.map(x=>x.id);
  store.mutate('group-set',[a,b,c],g); store.mutate('group-item-move',[c],{groupId:g,beforeId:a,after:false});
  store.mutate('group-move',h,{beforeId:g}); assert.equal(store.groups[0].id,h);
  store.add(store.items.find(x=>x.id===b).text);
  const reload=new ClipStore(store.snapshot()); const group=reload.groups.find(x=>x.id===g);
  assert.deepEqual(queryItems(reload.items,{tab:g,order:group.order}).map(x=>x.id),[c,a,b]);
  assert.deepEqual(reload.items.map(x=>x.id),[b,a,c]);
});
test('timed pause persists, expires, and manual resume cancels the deadline', () => {
  const store=new ClipStore(); store.mutate('pause',null,5);
  const resumed=new ClipStore(store.snapshot()); assert.ok(resumed.paused);
  assert.equal(resumed.resumeExpired(resumed.pauseUntil-1),false); assert.equal(resumed.resumeExpired(resumed.pauseUntil),true);
  assert.equal(resumed.paused,false); assert.equal(resumed.pauseUntil,0);
  store.mutate('pause'); assert.equal(store.paused,false); assert.equal(store.pauseUntil,0);
});
