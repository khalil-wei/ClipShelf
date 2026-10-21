function loadWindowsApi() {
  const user32=require('koffi').load('user32.dll');
  return {
    foreground:user32.func('uintptr_t __stdcall GetForegroundWindow()'),
    allowForeground:user32.func('int __stdcall AllowSetForegroundWindow(uint32_t processId)'),
    keyState:user32.func('int16_t __stdcall GetAsyncKeyState(int key)')
  };
}
class WindowsInput {
  constructor(api=loadWindowsApi()){this.api=api;}
  capture(){return String(this.api.foreground());}
  keyDown(key){return (this.api.keyState(key)&0x8000)!==0;}
  authorizePaste(target,shelf,helperPid){
    const current=this.capture();
    if(current===target)return;
    if(current!==shelf)throw Error('焦点已切换到其他应用，已取消粘贴');
    if(!Number.isInteger(helperPid)||helperPid<=0||!this.api.allowForeground(helperPid))throw Error('无法交接窗口激活权限，请重新呼出面板');
  }
}
module.exports={WindowsInput};
