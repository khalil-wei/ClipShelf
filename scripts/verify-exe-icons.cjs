const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
// Read the PE resources with the same resource library used by Packager.
const packagerRequire=createRequire(require.resolve('@electron/packager'));
function verifyExeIcons(exePath,iconPath){
  const {NtExecutable,NtExecutableResource,Resource}=packagerRequire('resedit');
  const resources=NtExecutableResource.from(NtExecutable.from(fs.readFileSync(exePath))).entries;
  const groups=Resource.IconGroupEntry.fromEntries(resources),ico=fs.readFileSync(iconPath),count=ico.readUInt16LE(4);
  if(groups.length!==1||groups[0].icons.length!==count)throw Error('Unexpected EXE icon groups');
  const rows=[];
  for(let i=0;i<count;i++){
    const at=6+16*i,size=ico[at]||256,length=ico.readUInt32LE(at+8),offset=ico.readUInt32LE(at+12);
    const groupIcon=groups[0].icons[i],resource=resources.find(entry=>entry.type===3&&entry.id===groupIcon.iconID&&entry.lang===groups[0].lang);
    const frame=ico.subarray(offset,offset+length);
    if(!resource||!Buffer.from(resource.bin).equals(frame)||(groupIcon.width||256)!==size||(groupIcon.height||256)!==size)throw Error('EXE icon mismatch: '+size);
    if(size<256&&(frame.readUInt32LE(0)!==40||frame.readInt32LE(4)!==size||frame.readInt32LE(8)!==size*2))throw Error('Small icon must use DIB: '+size);
    if(size===256&&!frame.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw Error('Large icon must use PNG');
    rows.push({size,encoding:size===256?'png':'dib',resourceId:groupIcon.iconID});
  }
  return rows;
}
module.exports={verifyExeIcons};
if(require.main===module){console.log(JSON.stringify(verifyExeIcons(path.resolve(process.argv[2]),path.resolve(process.argv[3]||'src/assets/clipshelf.ico'))));}
