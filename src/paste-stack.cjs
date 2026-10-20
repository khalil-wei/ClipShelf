class PasteStack {
  constructor() { this.ids = []; this.busy = false; }
  add(ids, items) {
    if (!Array.isArray(ids) || ids.length > 2000) throw Error('队列内容无效');
    const valid = new Set(items.map(x => x.id));
    this.ids = [...new Set([...this.ids.filter(id => valid.has(id)), ...ids.filter(id => valid.has(id))])];
    if (this.ids.length > 2000) this.ids = this.ids.slice(0, 2000);
  }
  pending(items) { const byId = new Map(items.map(x => [x.id, x])); this.ids = this.ids.filter(id => byId.has(id)); return this.ids.map(id => byId.get(id)); }
  async next(items, use) {
    if (this.busy) return { ok: false, error: '正在粘贴队列内容' };
    const item = this.pending(items)[0]; if (!item) return { ok: false, error: '顺序粘贴队列为空' };
    this.busy = true;
    try { const result = await use(item.id); if (result.ok && this.ids[0] === item.id) this.ids.shift(); return result; }
    finally { this.busy = false; }
  }
}
module.exports = { PasteStack };
