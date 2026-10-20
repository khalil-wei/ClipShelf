const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
if(process.platform!=='win32')throw Error('The Windows helper must be built on Windows');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'build');fs.mkdirSync(directory,{recursive:true});
const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
const result=spawnSync(compiler,['/nologo','/optimize+','/platform:x64','/target:exe','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/out:'+path.join(directory,'ClipShelf.Native.exe'),path.join(root,'src','native.cs')],{encoding:'utf8',windowsHide:true});
if(result.error)throw result.error;if(result.status!==0)throw Error(result.stdout+'\n'+result.stderr);
console.log('Built build/ClipShelf.Native.exe');
