const test=require('node:test');
const assert=require('node:assert/strict');
const {ShelfUpdates}=require('../src/shelf-updates.cjs');
const {ClipStore}=require('../src/store.cjs');
test('shelf patches preserve bodies through in-place mutations, deletions, reordering and full resync',()=>{
  const store=new ClipStore(),updates=new ShelfUpdates();store.add('large body '.repeat(10000));store.add('second');
  let view=structuredClone(updates.full(store.snapshot()));
  const apply=packet=>{if(packet.patch){const byId=new Map(view.items.map(x=>[x.id,x]));for(const item of packet.patch.upserts)byId.set(item.id,item);view={...packet,items:packet.patch.order.map(id=>byId.get(id))};}else view=packet;};
  const unchanged=updates.next(store.snapshot());assert.deepEqual(unchanged.patch.upserts,[]);assert.equal(unchanged.baseRevision,view.revision);apply(unchanged);
  store.mutate('group-add',null,'working');store.mutate('group-set',store.items[0].id,store.groups[0].id);
  store.mutate('star',store.items[0].id);store.add('third');
  let packet=updates.next(store.snapshot());assert.equal(packet.patch.upserts.length,2);apply(structuredClone(packet));assert.deepEqual(view.items,store.items);
  store.mutate('delete',store.items[1].id);store.add(store.items[1].text);apply(structuredClone(updates.next(store.snapshot())));assert.deepEqual(view.items,store.items);
  store.items[0].title='resync';const full=updates.full(store.snapshot());apply(structuredClone(full));store.items[0].title='';apply(structuredClone(updates.next(store.snapshot())));assert.deepEqual(view.items,store.items);assert.ok(view.revision>full.revision);
});

test('cache holds bounded descriptors instead of evicted text and HTML bodies',()=>{
  const store=new ClipStore(),updates=new ShelfUpdates();
  for(let i=0;i<8;i++)store.add(`retained-marker-${i}:`+'x'.repeat(900000),'test','<b>'+'y'.repeat(900000)+'</b>');
  updates.full(store.snapshot());
  for(const item of store.items)item.updated=Date.now()-8*86400000;
  store.configure({retentionDays:7});store.prune();assert.equal(store.items.length,0);
  assert.equal(updates.items.size,8);
  for(const descriptor of updates.items.values()){
    assert.equal(typeof descriptor,'string');assert.ok(descriptor.length<2048);assert.ok(!descriptor.includes('retained-marker'));
  }
  updates.next(store.snapshot());assert.equal(updates.items.size,0);
});

test('live source memo avoids hashing unchanged bodies for each fresh IPC projection',()=>{
  const {createHash}=require('node:crypto');let hashes=0;
  const updates=new ShelfUpdates({digest:text=>{if(!text)return '';hashes++;return createHash('sha256').update(text).digest('hex');}}),store=new ClipStore();
  store.add('unchanged body '.repeat(50000));
  const projected=()=>({...store.snapshot(),items:store.items.map(({html,...item})=>({...item,hasFormatting:!!html}))});
  updates.full(projected(),store.items);
  for(let i=0;i<10;i++)assert.deepEqual(updates.next(projected(),store.items).patch.upserts,[]);
  assert.equal(hashes,1);
  const item=store.items[0],updated=item.updated;store.mutate('edit',item.id,{text:item.text.slice(0,-1)+'X',title:item.title});
  assert.equal(item.updated,updated);const patch=updates.next(projected(),store.items);
  assert.equal(hashes,2);assert.equal(patch.patch.upserts.length,1);assert.equal(patch.patch.upserts[0].text,item.text);
});

test('body descriptors distinguish exact UTF-16 strings including unmatched surrogates',()=>{
  const store=new ClipStore(),updates=new ShelfUpdates();store.add('same '+String.fromCharCode(0xd800));
  updates.full(store.snapshot());const item=store.items[0];
  store.mutate('edit',item.id,{text:'same '+String.fromCharCode(0xd801),title:''});
  const packet=updates.next(store.snapshot());assert.equal(packet.patch.upserts.length,1);assert.equal(packet.patch.upserts[0].text,item.text);
});
