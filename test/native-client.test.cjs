const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { NativeClient } = require('../src/native-client.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('native helper reconnects without replaying commands from the dead process',async()=>{
  const children=[],commands=[];
  const spawnProcess=()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
    child.stdin.on('data',data=>{commands.push([children.indexOf(child),data.toString().trim()]);});
    child.kill=()=>{if(child.dead)return;child.dead=true;setImmediate(()=>child.emit('exit',1));};
    children.push(child);setImmediate(()=>child.stdout.write('READY\n'));return child;
  };
  const client=new NativeClient('test.ps1',{spawnProcess,restartDelays:[5],requestTimeoutMs:500});
  try {
    assert.ok(await client.ready);const pending=client.request('PASTE 123'),queued=client.request('PASTE 456');
    const one=assert.rejects(pending,/断开|未就绪/),two=assert.rejects(queued,/断开|未就绪/);
    await sleep(1);children[0].kill();await Promise.all([one,two]);
    for(let i=0;i<40&&(!client.alive||children.length<2);i++)await sleep(5);
    assert.ok(client.alive);assert.equal(children.length,2);
    assert.ok(!commands.some(([generation])=>generation===1));
    const current=client.request('CAPTURE');await sleep(1);children[1].stdout.write('321\n');assert.equal(await current,'321');
  } finally {client.close();}
  await sleep(15);assert.equal(children.length,2);
});
