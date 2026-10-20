const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { inflateSync } = require('node:zlib');
const { Background } = require('../src/background.cjs');
const { AsyncSave } = require('../src/async-save.cjs');
function pixelsOf(png) {
  png=Buffer.from(png);const width=png.readUInt32BE(16),height=png.readUInt32BE(20),parts=[];
  for(let at=8;at<png.length;){const size=png.readUInt32BE(at);if(png.toString('ascii',at+4,at+8)==='IDAT')parts.push(png.subarray(at+8,at+8+size));at+=12+size;}
  const raw=inflateSync(Buffer.concat(parts)),pixels=[];
  for(let y=0;y<height;y++){const row=raw.subarray(y*(width*4+1)+1,(y+1)*(width*4+1));for(let x=4;x<row.length;x++)row[x]=(row[x]+row[x-4])&255;pixels.push(...row);}
  return {width,height,pixels};
}
test('background PNG keeps channel order, alpha and clockwise rotation',async()=>{
  const worker=new Background();
  try {
    const raw=Buffer.from([0,0,255,255,0,255,0,255,255,0,0,255,25,50,100,128]);
    const result=await worker.run('png',{pixels:raw,width:2,height:2,rotation:90});
    assert.deepEqual(pixelsOf(result.png),{width:2,height:2,pixels:[0,0,255,255,255,0,0,255,199,100,50,128,0,255,0,255]});
    await assert.rejects(worker.run('png',{pixels:Buffer.alloc(4),width:40000000,height:1}),/尺寸/);
    assert.equal(await worker.run('serialize',{value:'你好',images:2}),' {"value":"你好","images":2}'.trim());
  } finally {await worker.close();}
});
test('async writes keep invocation order and can retry after a filesystem failure',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipshelf-save-')),file=path.join(dir,'missing','history.enc');
  const background={run:async(_,value)=>{if(value.value==='first')await new Promise(r=>setTimeout(r,25));return JSON.stringify(value);}};
  const saver=new AsyncSave(file,background,text=>Buffer.from('encoded:'+text));
  try {
    await assert.rejects(saver.save({value:'initial'}));await fs.mkdir(path.dirname(file));
    await Promise.all([saver.save({value:'first'}),saver.save({value:'second'})]);await saver.flush();
    assert.equal(await fs.readFile(file,'utf8'),'encoded:{"value":"second"}');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('streamed PNG preserves row boundaries, both rotations and output limit recovery',async()=>{
  const worker=new Background(),width=7,height=137,source=Buffer.alloc(width*height*4),expected=[];
  for(let i=0;i<width*height;i++){
    const a=[255,128,0,100,10][i%5],b=i%(a+1),g=(i*3)%(a+1),r=(i*7)%(a+1);
    source.set([b,g,r,a],i*4);expected.push(a?Math.min(255,Math.round(r*255/a)):0,a?Math.min(255,Math.round(g*255/a)):0,a?Math.min(255,Math.round(b*255/a)):0,a);
  }
  try {
    for(const rotation of [0,90,270]){
      const result=await worker.run('png',{pixels:Buffer.from(source),width,height,rotation}),decoded=pixelsOf(result.png),w=rotation?height:width,h=rotation?width:height,rotated=[];
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=rotation===90?y:rotation===270?width-1-y:x,sy=rotation===90?height-1-x:rotation===270?x:y;rotated.push(...expected.slice((sy*width+sx)*4,(sy*width+sx+1)*4));}
      assert.deepEqual(decoded,{width:w,height:h,pixels:rotated});
    }
    await assert.rejects(worker.run('png',{pixels:Buffer.from(source),width,height,maxBytes:100}),/大小限制/);
    assert.equal(await worker.run('serialize',{afterLimit:true}),'{"afterLimit":true}');
  } finally {await worker.close();}
});
test('idle background thread releases resources and recreates on demand',async()=>{
  const worker=new Background({idleMs:30});
  try{
    assert.equal(worker.worker,undefined);await worker.run('serialize',{before:true});const previous=worker.worker;
    await new Promise(r=>setTimeout(r,100));assert.equal(worker.worker,null);
    assert.equal(await worker.run('serialize',{after:true}),'{"after":true}');assert.notEqual(worker.worker,previous);
  }finally{await worker.close();}
});
test('background worker restarts after unexpected termination',async()=>{
  const worker=new Background();
  try {
    await worker.run('serialize',{before:true});await worker.worker.terminate();
    await assert.rejects(worker.run('serialize',{during:true}),/停止/);
    await new Promise(resolve=>setTimeout(resolve,1150));
    assert.equal(await worker.run('serialize',{after:true}),'{"after":true}');
  } finally {await worker.close();}
});
