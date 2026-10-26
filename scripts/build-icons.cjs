const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {dibIconFrame}=require('./icon-format.cjs');
if(!process.versions.electron){
  const {spawnSync}=require('node:child_process');
  const result=spawnSync(require('electron'),[__filename],{stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;process.exit(result.status??1);
}
const {app,nativeImage}=require('electron');
app.whenReady().then(()=>{
  const original=nativeImage.createFromPath(path.join(root,'design','clipshelf-logo-approved-transparent.png'));
  if(original.isEmpty())throw Error('Missing logo master');
  const output=path.join(root,'src','assets');fs.mkdirSync(output,{recursive:true});
  const sizes=[16,20,24,32,40,48,64,128,256];
  const images=sizes.map(size=>original.resize({width:size,height:size,quality:'best'}));
  const frames=images.map((image,index)=>sizes[index]===256?image.toPNG():dibIconFrame(image.toBitmap(),sizes[index]));
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
  let offset=header.length;
  sizes.forEach((size,index)=>{
    const at=6+16*index;header[at]=header[at+1]=size===256?0:size;
    header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);
    header.writeUInt32LE(frames[index].length,at+8);header.writeUInt32LE(offset,at+12);offset+=frames[index].length;
    if(size===64||size===256)fs.writeFileSync(path.join(output,`clipshelf-${size}.png`),images[index].toPNG());
  });
  fs.writeFileSync(path.join(output,'clipshelf.ico'),Buffer.concat([header,...frames]));
  console.log('Built ClipShelf PNG and 9-size Windows ICO assets');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
