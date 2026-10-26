// ICO bitmap frames use bottom-up, straight-alpha BGRA plus a 1-bit AND mask.
// Electron's toBitmap() supplies top-down, premultiplied BGRA on Windows.
function dibIconFrame(pixels,size){
  if(!Number.isInteger(size)||size<1||size>256||pixels.length!==size*size*4)throw Error('Invalid icon bitmap');
  const maskStride=Math.ceil(size/32)*4,colorBytes=size*size*4;
  const frame=Buffer.alloc(40+colorBytes+maskStride*size);
  frame.writeUInt32LE(40,0);frame.writeInt32LE(size,4);frame.writeInt32LE(size*2,8);
  frame.writeUInt16LE(1,12);frame.writeUInt16LE(32,14);frame.writeUInt32LE(colorBytes,20);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const source=(y*size+x)*4,dest=40+((size-1-y)*size+x)*4,a=pixels[source+3];
    for(let channel=0;channel<3;channel++)frame[dest+channel]=a?Math.min(255,Math.round(pixels[source+channel]*255/a)):0;
    frame[dest+3]=a;
    if(!a)frame[40+colorBytes+(size-1-y)*maskStride+(x>>3)]|=0x80>>(x&7);
  }
  return frame;
}
module.exports={dibIconFrame};
