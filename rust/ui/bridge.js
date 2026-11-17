(() => {
  // Rust String 不允许孤立 UTF-16 代理项；此编码同时转义真实私用字符，保证可逆。
  const marker = '\uE000';
  const encode = text => {
    let output = '';
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i), next = text.charCodeAt(i + 1);
      if (unit >= 0xD800 && unit <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) { output += text.slice(i, i + 2); i++; }
      else if (unit >= 0xD800 && unit <= 0xDFFF) output += marker + 's' + unit.toString(16).padStart(4, '0');
      else output += text[i] === marker ? marker + 'e' : text[i];
    }
    return output;
  };
  const decode = text => text.replace(/\uE000(e|s[dD][89a-fA-F][0-9a-fA-F]{2})/g, (_, unit) => unit === 'e' ? marker : String.fromCharCode(parseInt(unit.slice(1), 16)));
  const map = (value, convert) => typeof value === 'string' ? convert(value) : Array.isArray(value) ? value.map(item => map(item, convert)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, map(item, convert)])) : value;
  const callbacks = new Map();
  const events = ['state-changed', 'shelf-show', 'shelf-visible', 'shelf-hide', 'shelf-suspend', 'notice'];
  const ready = Promise.all(events.map(name => window.__TAURI__.event.listen(name, event => {
    const payload = map(event.payload, decode);
    for (const callback of callbacks.get(name) || []) callback(payload);
  })));
  const on = name => callback => {
    if (!callbacks.has(name)) callbacks.set(name, []);
    callbacks.get(name).push(callback);
  };
  const request = async (command, args = {}) => {
    await ready;
    return map(await window.__TAURI__.core.invoke('clips', { command, args: map(args, encode) }), decode);
  };
  const notify = (command, args) => { void request(command, args).catch(error => {
    for (const callback of callbacks.get('notice') || []) callback(String(error));
  }); };
  let started = false;
  window.clips = {
    state: async () => {
      const value = await request('state');
      if (!started) {
        started = true;
        // 先让 renderer 接收初始快照，再请求显示，避免空状态参与入场动画。
        setTimeout(() => notify('ready'), 0);
      }
      return value;
    },
    search: query => request('search', { query }),
    text: id => request('text', { id }),
    mutate: (action, id, value) => request('mutate', { action, id, value }),
    use: (id, copyOnly, plain = false) => request('use', { id, copyOnly, plain }),
    stack: (action, ids) => request('stack', { action, ids }),
    image: (id, thumbnail = true) => request('image', { id, thumbnail }),
    rotateImage: (id, rotation) => request('image-rotate', { id, rotation }),
    exportImage: id => request('image-export', { id }),
    importImage: () => request('image-import'),
    checkUpdate: () => request('update-check'),
    installUpdate: version => request('update-install', { version }),
    hide: () => notify('hide'),
    resize: (height, finish = false) => notify('resize', { height, finish }),
    onState: on('state-changed'),
    onShow: on('shelf-show'),
    onVisible: on('shelf-visible'),
    onHide: on('shelf-hide'),
    onSuspend: on('shelf-suspend'),
    onNotice: on('notice'),
  };
})();
