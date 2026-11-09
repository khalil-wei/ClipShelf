(function (root) {
  const kinds = ['text', 'link', 'code', 'color', 'image'];
  const palette = ['#f06464', '#eda841', '#69b987', '#629fe7', '#ad83da', '#d88bb7'];
  function classify(text) {
    const value = text.trim();
    if (/^https?:\/\/\S+$/i.test(value)) { try { new URL(value); return 'link'; } catch {} }
    if (/^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value)) return 'color';
    if (/(?:^|\n)\s*(?:const |let |function |import |export |class |def |SELECT |public |<\w+[^>]*>)/.test(value) || /[{};]\s*\n.*[{};=]/.test(value)) return 'code';
    return 'text';
  }
  function titleFor(item) {
    if (item.title) return item.title;
    if (item.kind === 'image') return `图片 ${item.width} × ${item.height}`;
    if (item.kind === 'link') { try { return new URL(item.text.trim()).hostname.replace(/^www\./, ''); } catch {} }
    return item.text.trim().split('\n').find(x => x.trim())?.trim().slice(0, 100) || '未命名片段';
  }
  function queryItems(items, { tab = 'all', query = '', kind = 'all', days = 0, source = '', now = Date.now(), order = [] } = {}) {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const result = items.filter(x => (tab === 'all' || tab === 'star' && x.starred || x.groups.includes(tab)) &&
      (kind === 'all' || x.kind === kind) && (!days || x.updated >= now - days * 86400000) &&
      (!source || x.source === source) && words.every(w => `${x.text}\n${x.title || ''}\n${x.source || ''}`.toLocaleLowerCase().includes(w)));
    if (order.length && tab !== 'all' && tab !== 'star') { const rank = new Map(order.map((id, i) => [id, i])); result.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)); }
    return result;
  }
  function relativeTime(time, now = Date.now()) {
    const mins = Math.max(0, Math.floor((now - time) / 60000));
    return mins < 1 ? '刚刚' : mins < 60 ? `${mins} 分钟前` : mins < 1440 ? `${Math.floor(mins / 60)} 小时前` : `${Math.floor(mins / 1440)} 天前`;
  }
  const model = { kinds, palette, classify, titleFor, queryItems, relativeTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else root.ClipModel = model;
})(typeof window !== 'undefined' ? window : globalThis);
