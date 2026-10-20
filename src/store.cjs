const { randomUUID } = require('node:crypto');
const { classify, palette, queryItems } = require('./view-model.js');
const { isId } = require('./media-store.cjs');
const MAX_BYTES = 1024 * 1024;
const bodyCache = new WeakMap();
function bodyBytes(item) {
  const cached=bodyCache.get(item);if(cached&&cached.text===item.text&&cached.html===item.html)return cached.bytes;
  const bytes=Buffer.byteLength(item.text||'')+Buffer.byteLength(item.html||'');bodyCache.set(item,{text:item.text,html:item.html,bytes});return bytes;
}
const defaults = { openAtLogin: false, theme: 'system', compact: false, reduceMotion: false, hideOnBlur: true, height: 390, retentionDays: 0, shortcut: 'Ctrl+Shift+V', separator: '\n', captureImages: true, alwaysPlainText: false, ignoredApps: [], ignoreConfidential: true };
class ClipStore {
  constructor(data = {}) {
    this.groups = Array.isArray(data.groups) ? data.groups.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string').slice(0, 30).map((g, i) => ({ ...g, order: Array.isArray(g.order) ? [...new Set(g.order.filter(x => typeof x === 'string'))].slice(0,2000) : [], color: palette.includes(g.color) ? g.color : palette[i % palette.length] })) : [];
    const groupIds = new Set(this.groups.map(g => g.id));
    this.items = Array.isArray(data.items) ? data.items.filter(x => x && typeof x.id === 'string' && typeof x.text === 'string' && (x.kind !== 'image' || isId(x.mediaId) && x.width > 0 && x.height > 0)).slice(0, 2000).map(x => ({ ...x, kind: x.kind === 'image' ? 'image' : classify(x.text), html: typeof x.html === 'string' && Buffer.byteLength(x.html) <= MAX_BYTES ? x.html : '', title: typeof x.title === 'string' ? x.title.slice(0, 100) : '', source: typeof x.source === 'string' ? x.source : '', starred: x.starred === true, groups: Array.isArray(x.groups) ? x.groups.filter(g => groupIds.has(g)) : [], updated: Number(x.updated) || Date.now(), created: Number(x.created) || Date.now() })) : [];
    this.settings = { ...defaults };
    if (data.settings) this.configure(data.settings);
    this.paused = data.paused === true;
    this.pauseUntil = this.paused && Number.isFinite(data.pauseUntil) ? Math.max(0, data.pauseUntil) : 0;
    this.resumeExpired();
  }
  snapshot() { return { items: this.items, groups: this.groups, paused: this.paused, pauseUntil: this.pauseUntil, settings: this.settings }; }
  resumeExpired(now = Date.now()) { if (this.paused && this.pauseUntil && this.pauseUntil <= now) { this.paused = false; this.pauseUntil = 0; return true; } return false; }
  configure(value) {
    if (!value || typeof value !== 'object') throw Error('设置无效');
    const s = { ...this.settings };
    if ('theme' in value) { if (!['system', 'light', 'dark'].includes(value.theme)) throw Error('主题无效'); s.theme = value.theme; }
    for (const key of ['compact', 'reduceMotion', 'hideOnBlur', 'captureImages', 'alwaysPlainText', 'ignoreConfidential', 'openAtLogin']) if (key in value) { if (typeof value[key] !== 'boolean') throw Error('设置无效'); s[key] = value[key]; }
    if ('ignoredApps' in value) { if (!Array.isArray(value.ignoredApps) || value.ignoredApps.length > 50 || value.ignoredApps.some(x => typeof x !== 'string' || x.length > 80 || /[\\/\x00-\x1f]/.test(x))) throw Error('请输入应用进程名，每行一个，最多 50 个'); s.ignoredApps = [...new Set(value.ignoredApps.map(x => x.trim()).filter(Boolean))]; }
    if ('height' in value) { if (!Number.isFinite(value.height)) throw Error('高度无效'); s.height = Math.max(290, Math.min(640, Math.round(value.height))); }
    if ('retentionDays' in value) { if (![0, 7, 30, 90].includes(value.retentionDays)) throw Error('保留时间无效'); s.retentionDays = value.retentionDays; }
    if ('shortcut' in value) { if (!['Ctrl+Shift+V', 'Ctrl+Alt+V', 'Alt+V'].includes(value.shortcut)) throw Error('快捷键无效'); s.shortcut = value.shortcut; }
    if ('separator' in value) { if (!['\n', '\n\n', ' ', '\t'].includes(value.separator)) throw Error('分隔符无效'); s.separator = value.separator; }
    if ('compact' in value && value.compact === false && s.height < 345) s.height = 390;
    this.settings = s;
  }
  prune(now = Date.now()) {
    if (this.settings.retentionDays) this.items = this.items.filter(x => x.starred || x.groups.length || x.updated >= now - this.settings.retentionDays * 86400000);
    let mediaBytes = this.items.reduce((sum, x) => sum + (x.kind === 'image' ? Number(x.bytes) || 0 : 0), 0);
    let textBytes = this.items.reduce((sum, x) => sum + bodyBytes(x), 0);
    while (this.items.length > 2000 || mediaBytes > 128 * 1024 * 1024 || textBytes > 64 * 1024 * 1024) {
      const index = this.items.findLastIndex(x => !x.starred && !x.groups.length);
      if (index < 0) break;
      const removed = this.items.splice(index, 1)[0]; if (removed.kind === 'image') mediaBytes -= removed.bytes || 0;
      textBytes -= bodyBytes(removed);
    }
  }
  add(text, source = '', html = '') {
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > MAX_BYTES) return false;
    const existing = this.items.find(x => x.kind !== 'image' && x.text === text);
    const item = existing || { id: randomUUID(), text, title: '', kind: classify(text), created: Date.now(), source: '', groups: [], starred: false };
    this.items = this.items.filter(x => x.id !== item.id);
    item.html = typeof html === 'string' && Buffer.byteLength(html) <= MAX_BYTES ? html : ''; item.updated = Date.now(); if (source) item.source = String(source).slice(0, 100);
    this.items.unshift(item); this.prune();
    return this.items.includes(item);
  }
  addImage(metadata, source = '') {
    if (!metadata || !isId(metadata.mediaId) || !Number.isFinite(metadata.width) || !Number.isFinite(metadata.height) || metadata.width <= 0 || metadata.height <= 0 || metadata.width * metadata.height > 32000000 || !Number.isFinite(metadata.bytes) || metadata.bytes <= 0 || metadata.bytes > 16 * MAX_BYTES) throw Error('图片数据无效');
    const existing = this.items.find(x => x.kind === 'image' && x.mediaId === metadata.mediaId);
    const item = existing || { id: randomUUID(), kind: 'image', text: '', title: '', html: '', created: Date.now(), groups: [], starred: false };
    Object.assign(item, { mediaId: metadata.mediaId, width: metadata.width, height: metadata.height, bytes: metadata.bytes }, { updated: Date.now(), source: source || item.source || '' });
    this.items = [item, ...this.items.filter(x => x.id !== item.id)]; this.prune(); return this.items.includes(item);
  }
  replaceImage(id, metadata) {
    const item = this.items.find(x => x.id === id && x.kind === 'image');
    if (!item || !isId(metadata.mediaId) || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width < 1 || metadata.height < 1 || metadata.width * metadata.height > 32000000 || metadata.bytes <= 0 || metadata.bytes > 16 * MAX_BYTES) throw Error('图片数据无效');
    Object.assign(item, {mediaId:metadata.mediaId,width:metadata.width,height:metadata.height,bytes:metadata.bytes});
    this.prune(); if(!this.items.includes(item)) throw Error('图片容量不足，请先清理部分历史');
  }
  mutate(action, id, value) {
    const ids = Array.isArray(id) ? id : [id];
    const selected = this.items.filter(x => ids.includes(x.id));
    const item = selected[0];
    switch (action) {
      case 'star': if (!item) throw Error('内容不存在'); { const starred = !selected.every(x => x.starred); selected.forEach(x => { x.starred = starred; }); } break;
      case 'delete': this.items = this.items.filter(x => !ids.includes(x.id)); break;
      case 'create': if (!this.add(value?.text, 'ClipShelf')) throw Error('内容为空、过大或历史已满'); this.items[0].title = String(value?.title || '').trim().slice(0, 100); break;
      case 'edit':
        if (!item || !value) throw Error('内容不存在');
        if (item.kind !== 'image') { if (typeof value.text !== 'string' || !value.text.trim() || Buffer.byteLength(value.text, 'utf8') > MAX_BYTES) throw Error('内容不能为空或超过 1 MiB'); if (item.text !== value.text) item.html = ''; item.text = value.text; item.kind = classify(value.text); }
        item.title = String(value.title || '').trim().slice(0, 100); break;
      case 'group-add': {
        const name = (typeof value === 'string' ? value : value?.name || '').trim().slice(0, 30);
        if (!name) throw Error('请输入分组名称');
        if (this.groups.some(g => g.name === name)) throw Error('分组名称已存在');
        if (this.groups.length >= 30) throw Error('最多创建 30 个分组');
        this.groups.push({ id: randomUUID(), name, order: [], color: palette.includes(value?.color) ? value.color : palette[this.groups.length % palette.length] }); break;
      }
      case 'group-edit': {
        const group = this.groups.find(g => g.id === id); const name = String(value?.name || '').trim().slice(0, 30);
        if (!group || !name) throw Error('分组名称不能为空');
        if (this.groups.some(g => g.id !== id && g.name === name)) throw Error('分组名称已存在');
        group.name = name; if (palette.includes(value.color)) group.color = value.color; break;
      }
      case 'group-delete': this.groups = this.groups.filter(g => g.id !== id); this.items.forEach(x => { x.groups = x.groups.filter(g => g !== id); }); break;
      case 'group-move': {
        const group = this.groups.find(g => g.id === id), before = this.groups.find(g => g.id === value?.beforeId);
        if (!group || !before) throw Error('分组不存在'); if (group === before) break;
        const rest = this.groups.filter(g => g !== group), position = rest.indexOf(before) + (value.after ? 1 : 0);
        rest.splice(position, 0, group); this.groups = rest; break;
      }
      case 'group-item-move': {
        const group = this.groups.find(g => g.id === value?.groupId);
        if (!group || !selected.length || selected.some(x => !x.groups.includes(group.id))) throw Error('只能排序同一分组里的内容');
        const ordered = queryItems(this.items, { tab: group.id, order: Array.isArray(group.order) ? group.order : [] }).map(x => x.id);
        if (!ordered.includes(value.beforeId) || ids.includes(value.beforeId)) break;
        const moving = ordered.filter(i => ids.includes(i)), rest = ordered.filter(i => !ids.includes(i));
        rest.splice(rest.indexOf(value.beforeId) + (value.after ? 1 : 0), 0, ...moving); group.order = rest; break;
      }
      case 'group-toggle': case 'group-set':
        if (!item || !this.groups.some(g => g.id === value)) throw Error('分组或内容不存在');
        selected.forEach(x => { x.groups = x.groups.includes(value) ? action === 'group-toggle' ? x.groups.filter(g => g !== value) : x.groups : [...x.groups, value]; }); break;
      case 'pause':
        if (value !== undefined) { if (![0, 5, 15, 60].includes(value)) throw Error('暂停时长无效'); this.paused = true; this.pauseUntil = value ? Date.now() + value * 60000 : 0; }
        else { this.paused = !this.paused; this.pauseUntil = 0; } break;
      case 'clear': this.items = this.items.filter(x => x.starred || x.groups.length); break;
      case 'settings': this.configure(value); this.prune(); break;
      default: throw Error('未知操作');
    }
  }
}
module.exports = { ClipStore };
