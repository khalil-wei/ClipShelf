const { hash } = require('./media-store.cjs');
const normalizeApp = name => String(name || '').trim().toLocaleLowerCase().replace(/\.exe$/i, '');
function ignoredReason(settings, source, formats, readBuffer) {
  if ((settings.ignoredApps || []).length && !normalizeApp(source)) return 'unknown-source';
  if ((settings.ignoredApps || []).some(app => normalizeApp(app) === normalizeApp(source))) return 'application';
  if (settings.ignoreConfidential !== false) {
    if (formats.some(x => x.toLowerCase() === 'excludeclipboardcontentfrommonitorprocessing')) return 'confidential';
    const historyFormat = formats.find(x => x.toLowerCase() === 'canincludeinclipboardhistory');
    if (historyFormat) { const value = readBuffer(historyFormat); if (value.length >= 4 && value.readUInt32LE(0) === 0) return 'confidential'; }
  }
  return null;
}
function imagePacket(image) {
    if (!image.isEmpty()) {
      const { width, height } = image.getSize();
      if (width * height > 32000000) throw Error('图片超过 3200 万像素，未保存');
      const png = image.toPNG(); if (png.length > 16 * 1024 * 1024) throw Error('图片超过 16 MiB，未保存');
      const scale = Math.min(320 / width, 320 / height, 1);
      const thumbnail = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }).toPNG();
      return { kind: 'image', signature: 'image:' + hash(png), png, thumbnail, width, height };
    }
  return null;
}
function readPacket(clipboard, captureImages = true) {
  const formats = clipboard.availableFormats();
  // Windows can expose CF_DIB/CF_BITMAP without a MIME image name in this list.
  if (captureImages) { const packet = imagePacket(clipboard.readImage()); if (packet) return packet; }
  const text = clipboard.readText();
  if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw Error('文本超过 1 MiB，未保存');
  const html = formats.includes('text/html') ? clipboard.readHTML() : '';
  const boundedHTML = Buffer.byteLength(html, 'utf8') <= 1024 * 1024 ? html : '';
  return { kind: 'text', text, html: boundedHTML, signature: 'text:' + hash(Buffer.from(text + '\0' + boundedHTML)) };
}
function preparePaste(items, { separator = '\n', alwaysPlainText = false } = {}, plain = false) {
  if (!items.length) throw Error('内容已删除');
  if (items.some(x => x.kind === 'image')) {
    if (items.length !== 1) throw Error('图片请单独粘贴；文字可以多选组合');
    return { kind: 'image', mediaId: items[0].mediaId };
  }
  const text = items.map(x => x.text).join(separator);
  if (Buffer.byteLength(text, 'utf8') > 4 * 1024 * 1024) throw Error('一次最多复制 4 MiB，请减少选中内容');
  return { kind: 'text', text, html: items.length === 1 && !plain && !alwaysPlainText ? items[0].html || '' : '' };
}
module.exports = { normalizeApp, ignoredReason, readPacket, imagePacket, preparePaste };
