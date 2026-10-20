const fs = require('node:fs/promises');
const path = require('node:path');
const { ClipStore } = require('./store.cjs');
const { cloneSnapshot } = require('./undo.cjs');
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

// Check dimensions before invoking the native decoder, which allocates pixels.
function imageDimensions(bytes) {
  let width, height;
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || marker === undefined) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (sofMarkers.has(marker)) {
        if (length < 8) break;
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!width || !height) throw Error('请选择有效的 PNG 或 JPEG 图片');
  if (width * height > 32000000) throw Error('图片超过 3200 万像素，未保存');
  return { width, height };
}

async function loadImageFile(filePath, { decode, encode }) {
  const file = await fs.open(filePath, 'r');
  let bytes;
  try {
    const info = await file.stat();
    if (!info.isFile() || !info.size || info.size > MAX_FILE_BYTES) throw Error('请选择不超过 16 MiB 的图片文件');
    const buffer = Buffer.alloc(info.size + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await file.stat();
    if (total !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw Error('图片文件正在变化，请稍后重试');
    bytes = buffer.subarray(0, total);
  } finally { await file.close(); }
  imageDimensions(bytes);
  const image = decode(bytes);
  if (image.isEmpty()) throw Error('无法解码图片，请选择完整的 PNG 或 JPEG 文件');
  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0 || size.width * size.height > 32000000) throw Error('图片尺寸无效或超过 3200 万像素');
  return { packet: await encode(image), title: path.parse(filePath).name.trim().slice(0, 100) };
}

async function commitImageImport({ store, media, save, packet, title }) {
  const before = cloneSnapshot(store.snapshot());
  try {
    const mediaId = await media.write(packet.png, packet.thumbnail);
    if (!store.addImage({ mediaId, width: packet.width, height: packet.height, bytes: packet.png.length }, 'ClipShelf')) throw Error('图片容量不足，请先清理部分历史');
    const item = store.items[0];
    if (!item.title) item.title = title;
    await save();
    return { id: item.id, undo: { before, afterIds: store.items.map(x => x.id), mediaIds: before.items.filter(x => x.kind === 'image').map(x => x.mediaId) } };
  } catch (error) { Object.assign(store, new ClipStore(before)); throw error; }
}

module.exports = { imageDimensions, loadImageFile, commitImageImport };
