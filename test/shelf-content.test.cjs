const test=require('node:test');
const assert=require('node:assert/strict');
const {projectItem,searchIds,searchCooperatively,PREVIEW_CHARS}=require('../src/shelf-content.cjs');
const {ShelfUpdates}=require('../src/shelf-updates.cjs');
const {ShelfSearch}=require('../src/shelf-receiver.js');

test('card IPC bounds body size but full-text search finds text past the preview',()=>{
  const item={id:'long',text:'x'.repeat(900000)+' tail-marker',html:'<b>rich</b>',title:'片段',source:'notepad',groups:[]};
  const projected=projectItem(item);
  assert.equal(projected.text.length,PREVIEW_CHARS);assert.equal(projected.textLength,item.text.length);
  assert.equal(projected.hasFormatting,true);assert.equal(projected.html,undefined);
  assert.deepEqual(searchIds([item],'TAIL-marker 片段'),['long']);
  assert.deepEqual(searchIds([item],'missing'),[]);
  assert.throws(()=>searchIds([item],'x'.repeat(4097)),/过长/);
});

test('edits beyond the preview still invalidate the projected shelf revision',()=>{
  const source={id:'long',text:'x'.repeat(3000)+'A',html:'',groups:[]},updates=new ShelfUpdates();
  const snapshot=()=>({items:[projectItem(source)]});updates.full(snapshot(),[source]);
  source.text=source.text.slice(0,-1)+'B';
  assert.equal(updates.next(snapshot(),[source]).patch.upserts.length,1);
  assert.equal(updates.next(snapshot(),[source]).patch.upserts.length,0);
});
test('full-text search yields for shortcuts and cancels superseded work',async()=>{
  const items=Array.from({length:80},(_,i)=>({id:String(i),text:'x'.repeat(10000)+' marker',groups:[]}));
  let turns=0;
  assert.deepEqual(await searchCooperatively(items,'marker',{yieldControl:async()=>{turns++;}}),items.map(item=>item.id));
  assert.ok(turns>0);
  let current=true;
  assert.deepEqual(await searchCooperatively(items,'marker',{isCurrent:()=>current,yieldControl:async()=>{current=false;}}),[]);
});

test('out-of-order search replies and a cleared query cannot restore stale results',async()=>{
  const replies=[],search=new ShelfSearch({fetchMatches:()=>new Promise(resolve=>replies.push(resolve)),onResult:()=>{}});
  const turn=()=>new Promise(resolve=>setImmediate(resolve));
  search.matches('old',1);await turn();search.matches('new',1);await turn();
  replies[1]({ids:['new']});await turn();replies[0]({ids:['old']});await turn();
  assert.deepEqual([...search.matches('new',1)],['new']);
  search.matches('new',2);await turn();search.matches('',2);replies[2]({ids:['stale']});await turn();
  assert.equal(search.ids,null);
});
