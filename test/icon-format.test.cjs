const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {dibIconFrame}=require('../scripts/icon-format.cjs');
test('ICO DIB keeps orientation, alpha and a DWORD-aligned transparent mask',()=>{
  const frame=dibIconFrame(Buffer.from([10,20,30,255,0,0,0,0,25,50,75,128,9,8,7,255]),2);
  assert.equal(frame.readUInt32LE(0),40);assert.equal(frame.readInt32LE(8),4);
  assert.deepEqual([...frame.subarray(40,44)],[50,100,149,128]);
  assert.deepEqual([...frame.subarray(48,52)],[10,20,30,255]);
  assert.equal(frame.length,40+16+8);assert.equal(frame[60],0x40);assert.equal(frame[56],0);
});
test('shipping ICO uses bitmap frames for Explorer small icons and PNG only at 256px',()=>{
  const ico=fs.readFileSync(require('node:path').join(__dirname,'../src/assets/clipshelf.ico'));
  assert.equal(ico.readUInt16LE(4),9);
  for(let i=0;i<9;i++){
    const at=6+i*16,size=ico[at]||256,offset=ico.readUInt32LE(at+12),length=ico.readUInt32LE(at+8),frame=ico.subarray(offset,offset+length);
    assert.equal(frame.length,length);
    if(size===256)assert.equal(frame.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    else{assert.equal(frame.readUInt32LE(0),40);assert.equal(frame.readInt32LE(4),size);assert.equal(frame.readInt32LE(8),size*2);}
  }
});
