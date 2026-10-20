const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');

test('live descriptor cache does not keep evicted source items alive',()=>{
  // GC is used only in this isolated lifetime test, never in application code or
  // performance measurements. A strong Map of original objects would fail it.
  const script=`
    const assert=require('node:assert/strict');
    const {ClipStore}=require('./src/store.cjs');const {ShelfUpdates}=require('./src/shelf-updates.cjs');
    (async()=>{
      const store=new ClipStore(),cache=new ShelfUpdates();
      for(let i=0;i<8;i++)store.add(i+':'+ 'x'.repeat(900000));
      const refs=store.items.map(item=>new WeakRef(item));cache.full(store.snapshot());store.items=[];
      await new Promise(resolve=>setImmediate(resolve));global.gc();
      assert.equal(cache.items.size,8);assert.equal(refs.filter(ref=>ref.deref()).length,0);
      console.log('COLLECTED');
    })().catch(error=>{console.error(error);process.exitCode=1;});`;
  const result=execFileSync(process.execPath,['--expose-gc','-e',script],{cwd:path.join(__dirname,'..'),encoding:'utf8',windowsHide:true});
  assert.match(result,/COLLECTED/);
});
