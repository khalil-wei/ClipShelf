const test=require('node:test');
const assert=require('node:assert/strict');
const {WindowsInput}=require('../src/windows-input.cjs');
const {ShortcutLatch}=require('../src/shortcut-latch.cjs');
test('window bounds are read directly without waiting for the native request queue',()=>{
  const input=new WindowsInput({windowRect:(target,rect)=>{assert.equal(target,42);Object.assign(rect,{left:-100,top:20,right:700,bottom:620});return true;}});
  assert.deepEqual(input.bounds('42'),{x:-100,y:20,width:800,height:600});
  assert.equal(new WindowsInput({windowRect:()=>false}).bounds('42'),null);
});
test('foreground rights are granted only by the active shelf to its own helper',()=>{
  let foreground=10;const grants=[];
  const input=new WindowsInput({foreground:()=>foreground,allowForeground:pid=>{grants.push(pid);return 1;},keyState:()=>0});
  input.authorizePaste('20','10',123);assert.deepEqual(grants,[123]);
  foreground=20;input.authorizePaste('20','10',123);assert.equal(grants.length,1);
  foreground=30;assert.throws(()=>input.authorizePaste('20','10',123),/取消粘贴/);assert.equal(grants.length,1);
  foreground=10;assert.throws(()=>input.authorizePaste('20','10',0),/激活权限/);
});
test('one held shortcut cannot repeatedly toggle or overwrite the paste target',async()=>{
  let held=true,time=0,pending,calls=0;
  const latch=new ShortcutLatch(()=>held,{now:()=>time,schedule:fn=>{pending=fn;return 1;},cancel:()=>{pending=null;}});
  await latch.run(()=>calls++);time=1000;pending();
  await latch.run(()=>calls++);assert.equal(calls,1);
  held=false;pending();await latch.run(()=>calls++);assert.equal(calls,2);
  time+=200;pending();latch.close();await latch.run(()=>calls++);assert.equal(calls,2);
});
test('shortcut remains latched while capture/show is pending even after key release',async()=>{
  let complete,time=0,pending,calls=0;
  const latch=new ShortcutLatch(()=>false,{now:()=>time,schedule:fn=>{pending=fn;},cancel:()=>{}});
  const action=latch.run(()=>{calls++;return new Promise(resolve=>{complete=resolve;});});
  time=500;await latch.run(()=>calls++);assert.equal(calls,1);complete();await action;
  await latch.run(()=>calls++);assert.equal(calls,2);latch.close();
});
