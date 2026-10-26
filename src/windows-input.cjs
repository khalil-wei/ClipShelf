function loadWindowsApi() {
  const user32=require('koffi').load('user32.dll');
  const koffi=require('koffi');
  const rect=koffi.struct('ClipShelfRect',{left:'int32_t',top:'int32_t',right:'int32_t',bottom:'int32_t'});
  return {
    foreground:user32.func('uintptr_t __stdcall GetForegroundWindow()'),
    windowRect:user32.func('GetWindowRect','bool',['uintptr_t',koffi.out(koffi.pointer(rect))]),
    allowForeground:user32.func('int __stdcall AllowSetForegroundWindow(uint32_t processId)'),
    keyState:user32.func('int16_t __stdcall GetAsyncKeyState(int key)')
  };
}
class WindowsInput {
  constructor(api=loadWindowsApi()){this.api=api;}
  capture(){return String(this.api.foreground());}
  bounds(target){
    const rect={};
    if(!this.api.windowRect(Number(target),rect))return null;
    return {x:rect.left,y:rect.top,width:rect.right-rect.left,height:rect.bottom-rect.top};
  }
  keyDown(key){return (this.api.keyState(key)&0x8000)!==0;}
  authorizePaste(target,shelf,helperPid){
    const current=this.capture();
    if(current===target)return;
    if(current!==shelf)throw Error('焦点已切换到其他应用，已取消粘贴');
    if(!Number.isInteger(helperPid)||helperPid<=0||!this.api.allowForeground(helperPid))throw Error('无法交接窗口激活权限，请重新呼出面板');
  }
}
module.exports={WindowsInput};
