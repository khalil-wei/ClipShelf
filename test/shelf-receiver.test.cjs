const test=require('node:test');
const assert=require('node:assert/strict');
const {ShelfReceiver}=require('../src/shelf-receiver.js');
const {ShelfUpdates}=require('../src/shelf-updates.cjs');
const {ClipStore}=require('../src/store.cjs');
const clone=structuredClone;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){const store=new ClipStore(),updates=new ShelfUpdates();store.add('initial');return{store,updates,initial:clone(updates.full(store.snapshot()))};}

test('resync catches the final patch received after the full snapshot was captured',async()=>{
  const {store,updates,initial}=fixture();let resolveFirst,firstReply,requests=0;
  const receiver=new ShelfReceiver({onState(){},fetchState(){
    requests++;const reply=clone(updates.full(store.snapshot()));
    if(requests===1){firstReply=reply;return new Promise(resolve=>resolveFirst=resolve);}return reply;
  }});
  receiver.receive(initial);updates.full(store.snapshot());receiver.receive(clone(updates.next(store.snapshot())));await flush();
  const initialId=store.items[0].id;
  for(let i=0;i<3;i++){store.add('during resync '+i);receiver.receive(clone(updates.next(store.snapshot())));}
  store.mutate('delete',initialId);receiver.receive(clone(updates.next(store.snapshot())));
  assert.equal(requests,1,'only one request may be in flight');resolveFirst(firstReply);await flush();
  assert.equal(requests,2);assert.deepEqual(receiver.state.items,store.items);assert.equal(receiver.state.revision,updates.revision);
});

test('a late full response cannot replace a newer independently received state',async()=>{
  const {store,updates,initial}=fixture();let resolveFirst,firstReply,requests=0;
  const receiver=new ShelfReceiver({onState(){},fetchState(){requests++;firstReply=clone(updates.full(store.snapshot()));return new Promise(resolve=>resolveFirst=resolve);}});
  receiver.receive(initial);updates.full(store.snapshot());receiver.receive(clone(updates.next(store.snapshot())));await flush();
  store.add('newest');const latest=clone(updates.full(store.snapshot()));receiver.receive(latest);
  resolveFirst(firstReply);await flush();assert.equal(requests,1);assert.deepEqual(receiver.state,latest);
});

test('failed resync does not spin and retries on the next gap',async()=>{
  const {store,updates,initial}=fixture();let requests=0;const errors=[];
  const receiver=new ShelfReceiver({onState(){},onError:error=>errors.push(error.message),fetchState(){if(++requests===1)throw Error('offline');return clone(updates.full(store.snapshot()));}});
  receiver.receive(initial);updates.full(store.snapshot());receiver.receive(clone(updates.next(store.snapshot())));await flush();
  assert.deepEqual(errors,['offline']);assert.equal(requests,1);assert.equal(receiver.resync,null);
  store.add('after failure');receiver.receive(clone(updates.next(store.snapshot())));await flush();
  assert.equal(requests,2);assert.deepEqual(receiver.state.items,store.items);
});

test('ordered patches update membership and order while duplicate and stale packets are ignored',()=>{
  const {store,updates,initial}=fixture();let changes=0;
  const receiver=new ShelfReceiver({onState(){changes++;},fetchState(){throw Error('unexpected resync');}});
  receiver.receive(initial);store.add('second');const patch=clone(updates.next(store.snapshot()));receiver.receive(patch);
  receiver.receive(patch);receiver.receive(initial);assert.equal(changes,2);assert.deepEqual(receiver.state.items,store.items);
  store.mutate('delete',store.items[1].id);receiver.receive(clone(updates.next(store.snapshot())));assert.deepEqual(receiver.state.items,store.items);
});
