const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ClipStore } = require('../src/store.cjs');
test('duplicate copies move to front without losing pin or group', () => {
  const s=new ClipStore(); s.add('first'); const id=s.items[0].id; s.mutate('star',id); s.mutate('group-add',null,'工作'); const g=s.groups[0].id; s.mutate('group-toggle',id,g); s.add('second'); s.add('first');
  assert.equal(s.items.length,2); assert.equal(s.items[0].id,id); assert.equal(s.items[0].starred,true); assert.deepEqual(s.items[0].groups,[g]);
});
test('clear preserves pins and groups; removing group preserves records',()=>{
  const s=new ClipStore(); s.add('pin'); s.mutate('star',s.items[0].id); s.add('group'); s.mutate('group-add',null,'工作'); const g=s.groups[0].id; s.mutate('group-toggle',s.items[0].id,g); s.add('plain'); s.mutate('clear'); assert.equal(s.items.length,2); s.mutate('group-delete',g); assert.equal(s.items.length,2); assert.ok(s.items.every(x=>x.groups.length===0));
});
test('bounded history evicts unpinned content first',()=>{const s=new ClipStore();s.add('keep');s.mutate('star',s.items[0].id);for(let i=0;i<2010;i++)s.add(String(i));assert.equal(s.items.length,2000);assert.ok(s.items.some(x=>x.text==='keep'));});
test('invalid and oversized clips rejected, links classified',()=>{const s=new ClipStore();assert.equal(s.add(' '),false);assert.equal(s.add('x'.repeat(1024*1024+1)),false);s.add('https://example.com');assert.equal(s.items[0].kind,'link');assert.throws(()=>s.mutate('group-add',null,''));});
test('snapshot round trip preserves pause and groups',()=>{const s=new ClipStore();s.add('你好 <script>');s.mutate('pause');s.mutate('group-add',null,'设计');assert.deepEqual(new ClipStore(JSON.parse(JSON.stringify(s.snapshot()))).snapshot(),s.snapshot());});
