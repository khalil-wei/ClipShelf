const { parentPort } = require('node:worker_threads');
const { createDeflate } = require('node:zlib');
const { Readable, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; table[n] = c >>> 0; }
function chunkInto(result, at, type, parts, size) {
  result.writeUInt32BE(size,at);result.write(type,at+4,4,'ascii');let cursor=at+8;
  for(const part of parts){part.copy(result,cursor);cursor+=part.length;}
  let crc=0xffffffff;for(let i=at+4;i<cursor;i++)crc=table[(crc^result[i])&255]^crc>>>8;
  result.writeUInt32BE((crc^0xffffffff)>>>0,cursor);return cursor+4;
}
async function png({ pixels, width, height, rotation = 0, maxBytes = 16 * 1024 * 1024 }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 32000000 || ![0, 90, 270].includes(rotation)) throw Error('图片尺寸无效');
  // View transferred pixels directly. Stream bounded scanline blocks instead of
  // allocating another complete bitmap; normal opaque screenshots avoid division.
  pixels = Buffer.from(pixels.buffer,pixels.byteOffset,pixels.byteLength); if (pixels.length !== width * height * 4) throw Error('图片像素不完整');
  const w = rotation ? height : width, h = rotation ? width : height, stride = w * 4 + 1;
  function* rows(){
    const blockRows=Math.max(1,Math.min(64,Math.floor(512*1024/stride)));
    for(let first=0;first<h;first+=blockRows){
      const count=Math.min(blockRows,h-first),raw=Buffer.allocUnsafe(stride*count);
      for(let line=0;line<count;line++){
        const y=first+line,row=line*stride;raw[row]=1;let red=0,green=0,blue=0,opacity=0;
        let offset=rotation===90?((height-1)*width+y)*4:rotation===270?(width-1-y)*4:y*width*4;
        const step=rotation===90?-width*4:rotation===270?width*4:4;
        for(let x=0,at=row+1;x<w;x++,offset+=step,at+=4){
          const a=pixels[offset+3];let r=pixels[offset+2],g=pixels[offset+1],b=pixels[offset];
          if(a!==255){if(a){r=Math.min(255,Math.round(r*255/a));g=Math.min(255,Math.round(g*255/a));b=Math.min(255,Math.round(b*255/a));}else r=g=b=0;}
          raw[at]=r-red;raw[at+1]=g-green;raw[at+2]=b-blue;raw[at+3]=a-opacity;
          red=r;green=g;blue=b;opacity=a;
        }
      }
      yield raw;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const parts=[];let size=0;
  await pipeline(Readable.from(rows(),{objectMode:false,highWaterMark:64*1024}),createDeflate({level:4}),new Writable({write(part,_,done){size+=part.length;if(size>maxBytes-57)return done(Error('图片压缩后超过大小限制，未保存'));parts.push(part);done();}}));
  const result=Buffer.allocUnsafeSlow(size+57);result.write('89504e470d0a1a0a',0,8,'hex');
  let at=chunkInto(result,8,'IHDR',[ihdr],13);at=chunkInto(result,at,'IDAT',parts,size);chunkInto(result,at,'IEND',[],0);
  return { png: result, width: w, height: h };
}
let queue=Promise.resolve();
parentPort.on('message', ({ id, operation, value }) => {
  // Keep simultaneous image jobs from multiplying peak native buffer memory.
  queue=queue.then(async()=>{
    try { const result = operation === 'serialize' ? JSON.stringify(value) : operation === 'png' ? await png(value) : (() => { throw Error('后台任务无效'); })(); parentPort.postMessage({ id, result },operation==='png'?[result.png.buffer]:[]); }
    catch (error) { parentPort.postMessage({ id, error: error.message }); }
  });
});
