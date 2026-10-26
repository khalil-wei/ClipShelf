const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const {verifyExeIcons}=require('./verify-exe-icons.cjs');
async function pack(){
  const {version}=require('../package.json');
  execFileSync(process.execPath,[path.join(__dirname,'build-native.cjs')],{cwd:root,stdio:'inherit',windowsHide:true});
  const {packager}=await import('@electron/packager');
  const packages=await packager({
    dir:root,name:'ClipShelf',platform:'win32',arch:'x64',out:path.join(root,'dist','v'+version),overwrite:true,
    asar:{unpack:'**/*.node'},
    icon:path.join(root,'src','assets','clipshelf.ico'),
    extraResource:[path.join(root,'build','ClipShelf.Native.exe'),path.join(root,'src','native.ps1')],
    ignore:[/^\/(build|scripts|dist|design|reference|test|docs|artifacts|test-artifacts|\.smoke-data|\.git|\.codex|\.agents)(\/|$)/,/^\/\.env(\.|$)/,/paste-reference-evidence\.json$/]
  });
  for(const folder of packages){
    const icons=verifyExeIcons(path.join(folder,'ClipShelf.exe'),path.join(root,'src','assets','clipshelf.ico'));
    console.log('EXE icon resources verified: '+icons.map(icon=>icon.size+'px '+icon.encoding).join(', '));
    if(process.platform==='win32'){
      const shell=require('koffi').load('shell32.dll');
      const notify=shell.func('void __stdcall SHChangeNotify(int32_t eventId, uint32_t flags, str16 path, uintptr_t unused)');
      // SHCNE_UPDATEITEM | SHCNF_PATHW | SHCNF_FLUSH: update this file's Shell view.
      notify(0x2000,0x1005,path.join(folder,'ClipShelf.exe'),0);
    }
    const locales=path.join(folder,'locales');
    // Keep English fallback and both Chinese locales; preserve runtime DLLs and licenses.
    for(const name of await fs.readdir(locales)){
      if(!['en-US.pak','zh-CN.pak','zh-TW.pak'].includes(name)&&name.endsWith('.pak'))await fs.unlink(path.join(locales,name));
    }
    console.log('Packaged: '+folder);
  }
}
pack().catch(error=>{console.error(error);process.exitCode=1;});
