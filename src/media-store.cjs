const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const isId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex');
const hash = data => createHash('sha256').update(data).digest('hex');
class MediaStore {
  constructor(directory, codec) {
    this.directory = path.resolve(directory); this.codec = codec; this.cache = new Map();
    fs.mkdirSync(this.directory, { recursive: true });
    if (fs.lstatSync(this.directory).isSymbolicLink()) throw Error('图片目录不能是链接');
  }
  file(id, thumbnail = false) {
    if (!isId(id)) throw Error('图片标识无效');
    return path.join(this.directory, id + (thumbnail ? '.thumb.enc' : '.enc'));
  }
  async write(png, thumbnail) {
    for (const data of [png, thumbnail]) if (!Buffer.isBuffer(data) || !data.subarray(0, 8).equals(pngHeader)) throw Error('图片格式无效');
    if (png.length > 16 * 1024 * 1024 || thumbnail.length > 512 * 1024) throw Error('图片过大');
    const id = hash(png);
    for (const [data, small] of [[png, false], [thumbnail, true]]) {
      const target = this.file(id, small);
      try { await fs.promises.access(target); continue; } catch {}
      const temp = target + '.tmp'; await fs.promises.writeFile(temp, await this.codec.encode(data)); await fs.promises.rename(temp, target);
    }
    return id;
  }
  async read(id, thumbnail = false) {
    const key = id + (thumbnail ? '-thumb' : '');
    if (thumbnail && this.cache.has(key)) { const value = this.cache.get(key); this.cache.delete(key); this.cache.set(key, value); return value; }
    const target = this.file(id, thumbnail);
    const info=await fs.promises.lstat(target);if (!info.isFile() || info.isSymbolicLink()) throw Error('图片文件无效');
    const data = this.codec.decode(await fs.promises.readFile(target));
    if (!data.subarray(0, 8).equals(pngHeader) || !thumbnail && hash(data) !== id) throw Error('图片校验失败');
    if (thumbnail) { this.cache.set(key, data); if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value); }
    return data;
  }
  async collect(keep) {
    const ids = new Set(keep);
    const entries=await fs.promises.readdir(this.directory,{withFileTypes:true}),removals=[];
    for (const entry of entries) {
      const name=entry.name;
      const match = /^([a-f0-9]{64})(?:\.thumb)?\.enc$/.exec(name);
      if (!match || ids.has(match[1])) continue;
      const target = path.resolve(this.directory, name);
      if (path.dirname(target) !== this.directory || !entry.isFile() || entry.isSymbolicLink()) continue;
      removals.push({target,id:match[1]});
    }
    for(let i=0;i<removals.length;i+=32)await Promise.all(removals.slice(i,i+32).map(async({target,id})=>{try{await fs.promises.unlink(target);this.cache.delete(id+'-thumb');}catch(e){if(e.code!=='ENOENT')throw e;}}));
  }
}
module.exports = { MediaStore, isId, hash };
