const { palette, titleFor, queryItems, relativeTime } = window.ClipModel;
const $ = selector => document.querySelector(selector);
const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const icon = window.clipIcon;
let state = { items: [], groups: [], paused: false, settings: {}, status: {} };
let tab = 'all', visible = [], primary = null, anchor = null, selection = new Set(), groupEdit = null, groupColor = palette[0], previewId = null, previewMode = 'view';
let previewRequest=0, imageScale=1, imagePan=null, imageWorking=false;
let toastTimer, renderFrame, wheelFrame, wheelTarget = 0, animation, tabsKey = '', sourcesKey = '', previousError = '', lastScroll = 0;
const cards = new Map(), viewport = $('#cards'), track = $('#cards-track');
const typeLabels = { text: '文本', code: '代码', link: '链接', color: '颜色', image: '图片' };
const sourceNames = { chrome: 'Chrome', msedge: 'Microsoft Edge', firefox: 'Firefox', Code: 'Visual Studio Code', notepad: '记事本', WindowsTerminal: 'Windows Terminal', WINWORD: 'Word', EXCEL: 'Excel', POWERPNT: 'PowerPoint', electron: 'ClipShelf' };
const sourceName = value => sourceNames[value] || value || '本机';
const reduced = () => state.settings.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
const dimensions = () => { const style = getComputedStyle(document.documentElement); const width = parseFloat(style.getPropertyValue('--card-width')) || 250; return { width, stride: width + (parseFloat(style.getPropertyValue('--gap')) || 20) }; };
function notice(text) { $('#feedback').textContent = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#feedback').textContent = ''; }, 6000); }
const shelfReceiver=new window.ShelfReceiver({
  fetchState:()=>window.clips.state(),
  onError:error=>notice(error.message),
  onState(next){state=next;if(!['all','star',...state.groups.map(g=>g.id)].includes(tab))tab='all';scheduleRender();}
});
function receive(next){shelfReceiver.receive(next);}
async function mutate(action, id, value, quiet = false) { const result = await window.clips.mutate(action, id, value); if (!result.ok) { if (!quiet) notice(result.error); } else if (result.state) receive(result.state); return result; }
function scheduleRender() { cancelAnimationFrame(renderFrame); renderFrame = requestAnimationFrame(render); }
function closeMenus() { $('#context-menu').hidden = true; }
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
function animateShelf(open) {
  animation?.cancel();
  const shell = $('#shell');
  if (reduced()) { shell.style.opacity = open ? '1' : '0'; return; }
  shell.style.opacity = '1';
  animation = shell.animate(open ? [{ opacity: 0, transform: 'translateY(28px) scale(.994)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }] : [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(24px)' }], { duration: open ? 235 : 125, easing: open ? 'cubic-bezier(.16,1,.3,1)' : 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
}
function refreshTabs() {
  const key = JSON.stringify([tab, state.groups]); if (key === tabsKey) return; tabsKey = key;
  const host = $('#tabs'); host.replaceChildren();
  [{ id: 'all', name: '剪贴板', icon: 'history' }, { id: 'star', name: '收藏', icon: 'star' }, ...state.groups].forEach(group => {
    const b = node('button', group.id === tab ? 'active' : ''); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(group.id === tab)); b.tabIndex = group.id === tab ? 0 : -1;
    if (group.icon) b.append(icon(group.icon, 14)); else { const dot = node('span', 'dot'); dot.style.setProperty('--pin-color', group.color); b.append(dot); }
    b.append(document.createTextNode(group.name)); b.onclick = () => switchTab(group.id);
    b.oncontextmenu = event => { event.preventDefault(); if (!group.icon) { switchTab(group.id); openGroup(group.id); } };
    if (!group.icon) {
      b.draggable = true; b.ondragstart = event => { event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-clipshelf-group', group.id); };
      b.ondragover = event => { if (event.dataTransfer.types.includes('application/x-clipshelf') || event.dataTransfer.types.includes('application/x-clipshelf-group')) { event.preventDefault(); event.dataTransfer.dropEffect = event.dataTransfer.types.includes('application/x-clipshelf-group') ? 'move' : 'copy'; b.classList.add('drag-over'); } };
      b.ondragleave = () => b.classList.remove('drag-over');
      b.ondrop = async event => { event.preventDefault(); b.classList.remove('drag-over'); try { const movingGroup = event.dataTransfer.getData('application/x-clipshelf-group'); if (movingGroup) { await mutate('group-move', movingGroup, {beforeId:group.id,after:event.clientX>b.getBoundingClientRect().x+b.offsetWidth/2}); return; } const ids = JSON.parse(event.dataTransfer.getData('application/x-clipshelf')); const r = await mutate('group-set', ids, group.id); if (r.ok) notice('已加入「' + group.name + '」'); } catch { notice('无法识别拖入的内容'); } };
    }
    host.append(b);
  });
}
function switchTab(next) { tab = next; primary = null; anchor = null; selection.clear(); resetScroll(); render(); }
function resetScroll() { cancelAnimationFrame(wheelFrame); viewport.scrollLeft = 0; wheelTarget = 0; }
function render() {
  cancelAnimationFrame(renderFrame);renderFrame=0;
  const settings = state.settings;
  document.documentElement.classList.toggle('dark', settings.theme === 'dark' || settings.theme === 'system' && state.status.dark);
  document.documentElement.classList.toggle('compact', settings.compact || window.innerHeight < 345);
  document.documentElement.classList.toggle('reduced-motion', !!settings.reduceMotion);
  refreshTabs();
  const sources = [...new Set(state.items.map(x => x.source).filter(Boolean))].sort(); const key = sources.join('\n');
  if (sourcesKey !== key) { const selectedSource = $('#source-filter').value; sourcesKey = key; $('#source-filter').replaceChildren(new Option('全部应用', ''), ...sources.map(s => new Option(sourceName(s), s))); if (sources.includes(selectedSource)) $('#source-filter').value = selectedSource; }
  visible = queryItems(state.items, { tab, query: $('#search').value, kind: $('#kind-filter').value, days: Number($('#days-filter').value), source: $('#source-filter').value, order: state.groups.find(g => g.id === tab)?.order || [] });
  const ids = new Set(visible.map(x => x.id)); selection = new Set([...selection].filter(id => ids.has(id)));
  if (!ids.has(primary)) primary = visible[0]?.id || null;
  if (!selection.size && primary) selection.add(primary);
  if (!ids.has(anchor)) anchor = primary;
  $('#section-title').textContent = tab === 'all' ? '剪贴板历史' : tab === 'star' ? '我的收藏' : state.groups.find(g => g.id === tab)?.name || '';
  $('#count').textContent = visible.length + ' 项'; $('#multi-count').textContent = selection.size > 1 ? '已选 ' + selection.size + ' 项' : '';
  $('#remove-group').hidden = $('#edit-group').hidden = tab === 'all' || tab === 'star'; $('#undo').hidden = !state.status.canUndo;
  $('#pause').replaceChildren(icon(state.paused ? 'play' : 'pause', 12), document.createTextNode(state.paused ? '继续记录' : '暂停'));
  $('#recording').classList.toggle('protected',!!state.status.captureBlocked);
  $('#recording').title=state.status.captureBlocked ? '来源无法确认，已按应用排除规则停止采集；助手恢复后自动重试' : state.status.reconnecting ? 'Windows 助手自动重连中' : '';
  $('#recording').classList.toggle('paused', state.paused); $('#recording').replaceChildren(node('i'), document.createTextNode(state.paused ? state.pauseUntil ? '已暂停 · ' + new Date(state.pauseUntil).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ' 恢复' : '已暂停' : state.status.captureBlocked ? '来源未确认 · 保护中' : state.status.reconnecting ? '本地记录 · 助手恢复中' : '本地记录'));
  $('#clear-search').hidden = !$('#search').value; $('#compact').classList.toggle('active', !!settings.compact);
  $('#activation-key').textContent = settings.shortcut?.replaceAll('+', ' ') || 'Ctrl Shift V';
  const filtered = $('#search').value || $('#kind-filter').value !== 'all' || Number($('#days-filter').value) || $('#source-filter').value;
  $('#filters-toggle').classList.toggle('active', !!filtered || !$('#filters').hidden);
  $('#empty').hidden = visible.length > 0; viewport.hidden = !visible.length;
  $('#empty h2').textContent = filtered ? '没有找到匹配的内容' : tab === 'all' ? '每一次复制，都有迹可循。' : '把常用的，留在触手可及的地方。';
  $('#empty p').textContent = filtered ? '换个关键词，或者减少筛选条件再试试。' : tab === 'all' ? '复制文字、截图或图片，下一次灵感就在这里。' : '将卡片拖到这个分组，或右键选择加入分组。';
  if (state.status.error && state.status.error !== previousError) notice(state.status.error); previousError = state.status.error;
  const queue = state.stack || []; $('#stack-bar').hidden = !queue.length; $('#stack-count').textContent = '顺序粘贴 · ' + queue.length + ' 项'; $('#stack-next-title').textContent = queue[0]?.title || ''; $('#stack-next').title = state.status.stackShortcut ? 'Ctrl+Alt+P：在目标窗口粘贴下一项' : '快捷键未注册，可从面板操作';
  renderWindow();
}
function renderWindow() {
  const { width, stride } = dimensions();
  track.style.width = Math.max(0, visible.length * stride - (stride - width)) + 'px';
  const start = Math.max(0, Math.floor(viewport.scrollLeft / stride) - 3), end = Math.min(visible.length, Math.ceil((viewport.scrollLeft + viewport.clientWidth) / stride) + 4);
  const indices = new Set(); for (let index = start; index < end; index++) indices.add(index);
  const primaryIndex = visible.findIndex(x => x.id === primary); if (primaryIndex >= 0) indices.add(primaryIndex);
  const keep = new Set();
  for (const index of indices) {
    const item = visible[index]; if (!item) continue; keep.add(item.id);
    const fingerprint = JSON.stringify([item.text.slice(0, 650), item.text.length, item.title, item.kind, item.mediaId, item.hasFormatting, item.starred, item.groups, item.source, item.updated]);
    let card = cards.get(item.id);
    if (!card || card.dataset.fingerprint !== fingerprint) {
      const old = card; card = createCard(item); card.dataset.fingerprint = fingerprint; cards.set(item.id, card);
      if (old) old.replaceWith(card); else { track.append(card); if (!reduced() && performance.now()-lastScroll>160 && index >= start && index < end) card.firstElementChild.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
    }
    card.style.transform = `translate3d(${index * stride}px,0,0)`;
    card.classList.toggle('selected', item.id === primary); card.classList.toggle('multi-selected', selection.has(item.id) && item.id !== primary);
    card.setAttribute('aria-selected', String(selection.has(item.id))); card.tabIndex = item.id === primary ? 0 : -1;
    const badge = card.querySelector('.quick-number'); badge.textContent = index < 9 ? String(index + 1) : ''; badge.hidden = index >= 9;
  }
  for (const [id, card] of cards) if (!keep.has(id)) { card.remove(); cards.delete(id); }
  if (primary && cards.has(primary)) viewport.setAttribute('aria-activedescendant', 'clip-' + primary); else viewport.removeAttribute('aria-activedescendant');
}
function createCard(item) {
  const card = node('article', 'card ' + item.kind); card.id = 'clip-' + item.id; card.dataset.id = item.id; card.setAttribute('role', 'option'); card.setAttribute('aria-label', titleFor(item)); card.draggable = true;
  const surface = node('div', 'card-surface'), head = node('div', 'card-head');
  head.append(node('span', '', typeLabels[item.kind]), node('time', '', relativeTime(item.updated)));
  if (item.starred) { const pin = node('span', 'pin-mark'); pin.append(icon('star', 11)); head.append(pin); }
  const source = node('span', 'source-badge', sourceName(item.source).slice(0, 1).toUpperCase()); source.title = sourceName(item.source); head.append(source);
  const content = node('div', 'card-content');
  if (item.kind === 'image') {
    const image = node('img', 'image-thumbnail'); image.alt = titleFor(item); image.decoding = 'async'; content.append(image);
    window.clips.image(item.id, true).then(result => { if (result.ok && card.dataset.id === item.id) image.src = result.dataUrl; else { content.replaceChildren(node('span', 'image-error', result.error || '无法读取图片')); } });
  } else if (item.kind === 'link') {
    const art = node('div', 'link-art'); art.append(icon('globe', 54));
    const caption = node('div', 'link-caption'); caption.append(node('strong', '', titleFor(item)), node('small', '', item.text.trim())); content.append(art, caption);
  } else if (item.kind === 'color') {
    surface.style.setProperty('--clip-color', item.text.trim()); content.textContent = item.text.trim().toUpperCase();
  } else if (item.kind === 'code') {
    const code = item.text.slice(0, 650), regex = /(\/\/[^\n]*|#[^\n]*$|"[^"\n]*"|'[^'\n]*'|\b(?:const|let|function|return|import|export|class|def|if|else|async|await|public|private|new|true|false|null)\b)/gm;
    let cursor = 0, match; while ((match = regex.exec(code))) { content.append(document.createTextNode(code.slice(cursor, match.index))); content.append(node('span', match[0].startsWith('//') || match[0].startsWith('#') ? 'syntax-comment' : /^["']/.test(match[0]) ? 'syntax-string' : 'syntax-keyword', match[0])); cursor = regex.lastIndex; } content.append(document.createTextNode(code.slice(cursor)));
  } else {
    const text = item.text.slice(0, 600); const first = titleFor(item); const multiline = text.includes('\n');
    if (item.title || multiline && text.split('\n')[0].length < 70) { content.append(node('strong', 'card-title', first), node('span', 'card-body', item.title ? text : text.slice(text.indexOf('\n') + 1).trimStart())); }
    else content.textContent = text;
  }
  const foot = node('div', 'card-foot'); foot.append(node('span', 'card-label', item.kind === 'image' ? `${item.width} × ${item.height}` : item.groups.length ? item.groups.map(id => state.groups.find(g => g.id === id)?.name).filter(Boolean).join(' · ') : sourceName(item.source)));
  if (item.hasFormatting) { const formatted = node('span', 'format-badge', 'Aa'); formatted.title = '保留原始格式 · Shift+Enter 以纯文本粘贴'; foot.append(formatted); }
  const actions = node('span', 'card-actions');
  for (const [name, title, action] of [['copy', '复制', () => use([item.id], true)], ['star', item.starred ? '取消收藏' : '收藏', () => mutate('star', item.id)], ['more', '更多操作', event => contextMenu(event, item.id)]]) {
    const b = node('button'); b.title = title; b.setAttribute('aria-label', title); b.append(icon(name, 13)); b.onclick = event => { event.stopPropagation(); action(event); }; b.ondblclick = event => event.stopPropagation(); actions.append(b);
  }
  foot.append(actions, node('span', 'quick-number')); surface.append(head, content, foot); card.append(surface);
  card.onclick = event => selectItem(item.id, event.ctrlKey || event.metaKey, event.shiftKey);
  card.ondblclick = event => { event.preventDefault(); selectItem(item.id); use([item.id]); };
  card.oncontextmenu = event => contextMenu(event, item.id);
  card.ondragstart = event => { if (!selection.has(item.id)) selectItem(item.id); event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData('application/x-clipshelf', JSON.stringify([...selection])); };
  card.ondragover = event => { if (state.groups.some(g=>g.id===tab) && event.dataTransfer.types.includes('application/x-clipshelf')) { event.preventDefault(); event.dataTransfer.dropEffect='move'; card.classList.add('reorder-target'); } };
  card.ondragleave = () => card.classList.remove('reorder-target');
  card.ondrop = async event => { event.preventDefault(); card.classList.remove('reorder-target'); try { const ids=JSON.parse(event.dataTransfer.getData('application/x-clipshelf')); const rect=card.getBoundingClientRect(); await mutate('group-item-move',ids,{groupId:tab,beforeId:item.id,after:event.clientX>rect.x+rect.width/2}); } catch { notice('无法调整排序'); } };
  return card;
}
function selectItem(id, toggle = false, range = false) {
  if (range && anchor) { const a = visible.findIndex(x => x.id === anchor), b = visible.findIndex(x => x.id === id); if (a >= 0 && b >= 0) selection = new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1).map(x => x.id)); }
  else if (toggle) { if (selection.has(id)) selection.delete(id); else selection.add(id); anchor = id; }
  else { selection = new Set([id]); anchor = id; }
  primary = id; $('#multi-count').textContent = selection.size > 1 ? '已选 ' + selection.size + ' 项' : ''; renderWindow();
}
function scrollToItem(id) {
  const i = visible.findIndex(x => x.id === id), { width, stride } = dimensions(); if (i < 0) return;
  let left = viewport.scrollLeft;
  if (i * stride < left + 4) left = Math.max(0, i * stride - 4);
  else if (i * stride + width > left + viewport.clientWidth - 12) left = i * stride + width - viewport.clientWidth + 16;
  cancelAnimationFrame(wheelFrame); wheelTarget = left; viewport.scrollTo({ left, behavior: reduced() ? 'instant' : 'smooth' }); renderWindow();
}
async function use(ids = [...selection], copyOnly = false, plain = false) {
  closeMenus(); if (!ids.length) return;
  const wanted=new Set(ids), ordered=visible.filter(x=>wanted.has(x.id)).map(x=>x.id);
  const result = await window.clips.use(ordered.length===wanted.size ? ordered : ids, copyOnly, plain);
  if (!result.ok) notice(result.error); else if (copyOnly) notice(ids.length > 1 ? `已复制 ${ids.length} 项` : '已复制'); else closeDialogs();
}
function openPreview(mode = 'view', id = primary) {
  const item = state.items.find(x => x.id === id); if (!item && mode !== 'new') return;
  closeMenus(); previewId = mode === 'new' ? null : id; previewMode = mode;
  $('#preview-kind').replaceChildren(icon(item?.kind || 'text')); $('#preview-heading').textContent = mode === 'new' ? '新建文本片段' : mode === 'view' ? '快速预览' : '编辑片段';
  $('#item-title').value = item?.title || ''; $('#item-text').value = item?.text || ''; $('#preview-error').textContent = '';
  const readOnly = mode === 'view'; $('#item-text').readOnly = $('#item-title').readOnly = readOnly;
  $('#item-text').hidden = item?.kind === 'image'; $('#preview-image-wrap').hidden = item?.kind !== 'image';
  const request=++previewRequest;$('#image-tools').hidden=item?.kind!=='image';$('#preview-image').removeAttribute('src');
  if (item?.kind === 'image') { const requestId = id; $('#preview-image').alt = titleFor(item); window.clips.image(id, false).then(result => { if (previewId !== requestId || request!==previewRequest) return; if (result.ok) { $('#preview-image').onload=fitImage;$('#preview-image').src = result.dataUrl; } else $('#preview-error').textContent = result.error; }); }
  $('#preview-save').hidden = readOnly; $('#preview-edit').hidden = !readOnly; $('#preview-copy').hidden = $('#preview-paste').hidden = !readOnly;
  $('#preview-meta').textContent = item ? `${sourceName(item.source)} · ${relativeTime(item.updated)} · ` + (item.kind === 'image' ? `${item.width} × ${item.height} · ${Math.ceil(item.bytes / 1024)} KiB` : `${item.text.length.toLocaleString()} 字符` + (item.hasFormatting ? ' · 保留原始格式' : '')) : '保存后会出现在剪贴板历史中';
  if (!$('#preview-dialog').open) $('#preview-dialog').showModal();
  if (mode === 'rename' || mode === 'new' || item?.kind === 'image') $('#item-title').focus(); else $('#item-text').focus();
}
function setImageScale(value, point) {
  const img=$('#preview-image'), host=$('#preview-image-wrap');if(!img.naturalWidth)return;
  const old=imageScale;imageScale=Math.max(.01,Math.min(4,value));
  const x=point?.x??host.clientWidth/2,y=point?.y??host.clientHeight/2;
  const left=(host.scrollLeft+x)*imageScale/old-x,top=(host.scrollTop+y)*imageScale/old-y;
  img.style.width=img.naturalWidth*imageScale+'px';img.style.height=img.naturalHeight*imageScale+'px';
  $('#image-scale').textContent=Math.round(imageScale*100)+'%';$('#image-zoom').value=Math.round(imageScale*100);host.scrollLeft=left;host.scrollTop=top;
}
function fitImage(){const img=$('#preview-image'),host=$('#preview-image-wrap');setImageScale(Math.min(host.clientWidth/img.naturalWidth,host.clientHeight/img.naturalHeight,1));host.scrollLeft=host.scrollTop=0;}
async function rotateImage(rotation){
  if(imageWorking)return;imageWorking=true;const id=previewId,request=previewRequest;
  $('#image-left').disabled=$('#image-right').disabled=true;
  try{const result=await window.clips.rotateImage(id,rotation);if(!result.ok){if(previewId===id)$('#preview-error').textContent=result.error;else notice(result.error);}else{receive(result.state);if(previewId===id&&previewRequest===request&&$('#preview-dialog').open)openPreview('view',id);notice('图片已旋转，可按 Ctrl+Z 撤销');}}
  finally{imageWorking=false;$('#image-left').disabled=$('#image-right').disabled=false;}
}
$('#image-fit').onclick=fitImage;$('#image-actual').onclick=()=>setImageScale(1);$('#image-in').onclick=()=>setImageScale(imageScale*1.25);$('#image-out').onclick=()=>setImageScale(imageScale/1.25);$('#image-zoom').oninput=event=>setImageScale(Number(event.target.value)/100);
$('#image-left').onclick=()=>rotateImage(270);$('#image-right').onclick=()=>rotateImage(90);
$('#image-export').onclick=async()=>{const result=await window.clips.exportImage(previewId);if(!result.ok)$('#preview-error').textContent=result.error;else if(!result.canceled)notice('图片已导出');};
const imageHost=$('#preview-image-wrap');
$('#preview-dialog').addEventListener('close',()=>{
  if($('#preview-dialog').open)return;
  previewRequest++;imagePan=null;const image=$('#preview-image');image.onload=null;image.removeAttribute('src');image.style.width=image.style.height='';
  $('#item-text').value='';imageHost.classList.remove('panning');
});
imageHost.addEventListener('wheel',event=>{if(!event.ctrlKey)return;event.preventDefault();const rect=imageHost.getBoundingClientRect();setImageScale(imageScale*Math.exp(-event.deltaY*.0015),{x:event.clientX-rect.left,y:event.clientY-rect.top});},{passive:false});
imageHost.onpointerdown=event=>{if(event.button!==0)return;imagePan={x:event.clientX,y:event.clientY,left:imageHost.scrollLeft,top:imageHost.scrollTop};imageHost.setPointerCapture(event.pointerId);imageHost.classList.add('panning');};
imageHost.onpointermove=event=>{if(!imagePan)return;imageHost.scrollLeft=imagePan.left+imagePan.x-event.clientX;imageHost.scrollTop=imagePan.top+imagePan.y-event.clientY;};
imageHost.onpointerup=imageHost.onpointercancel=()=>{imagePan=null;imageHost.classList.remove('panning');};
function openGroup(id = null) {
  const group = state.groups.find(g => g.id === id); groupEdit = group?.id || null; groupColor = group?.color || palette[state.groups.length % palette.length];
  $('#group-heading').textContent = group ? '编辑收藏分组' : '新建收藏分组'; $('#group-name').value = group?.name || ''; renderColors(); $('#group-dialog').showModal(); $('#group-name').focus();
}
function renderColors() {
  $('#group-colors').replaceChildren(...palette.map((color, index) => { const b = node('button', color === groupColor ? 'chosen' : ''); b.type = 'button'; b.style.setProperty('--pin-color', color); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(color === groupColor)); b.setAttribute('aria-label', ['珊瑚红', '琥珀黄', '薄荷绿', '天空蓝', '薰衣草', '玫瑰粉'][index]); b.onclick = () => { groupColor = color; renderColors(); }; return b; }));
}
function contextMenu(event, id) {
  event.preventDefault(); event.stopPropagation(); if (!selection.has(id)) selectItem(id);
  const host = $('#context-menu'); host.replaceChildren();
  const entry = (glyph, label, action, key = '', danger = false) => { const b = node('button', danger ? 'danger' : ''); b.setAttribute('role', 'menuitem'); b.append(icon(glyph, 14), document.createTextNode(label)); if (key) b.append(node('small', '', key)); b.onclick = () => { closeMenus(); action(); }; host.append(b); };
  entry('paste', selection.size > 1 ? '粘贴选中内容' : '粘贴', () => use(), 'Enter'); entry('copy', '复制', () => use([...selection], true), 'Ctrl+C');
  if ([...selection].every(i => state.items.find(x => x.id === i)?.kind !== 'image')) entry('text', '粘贴为纯文本', () => use([...selection], false, true), 'Shift+Enter');
  if (selection.size === 1) { entry('eye', '快速预览', () => openPreview(), 'Space'); entry('edit', '编辑内容', () => openPreview('edit'), 'Ctrl+E'); entry('text', '重命名', () => openPreview('rename'), 'Ctrl+R'); }
  entry('paste', '加入顺序粘贴队列', () => stackAction('add'), 'Ctrl+Shift+S');
  if (selection.size === 1) entry('history', '在历史中显示', () => jumpHistory(id), 'Ctrl+G');
  host.append(node('hr')); entry('star', '收藏 / 取消收藏', () => mutate('star', [...selection]));
  if (state.groups.length) { host.append(node('div', 'menu-label', '加入 / 移出分组')); for (const group of state.groups) { const checked = [...selection].every(i => state.items.find(x => x.id === i)?.groups.includes(group.id)); entry(checked ? 'check' : 'plus', group.name, () => mutate('group-toggle', [...selection], group.id)); } }
  host.append(node('hr')); entry('trash', '删除选中内容', () => mutate('delete', [...selection]), 'Delete', true);
  host.hidden = false; host.style.left = Math.min(event.clientX || 100, innerWidth - host.offsetWidth - 10) + 'px'; host.style.top = Math.max(8, Math.min(event.clientY || 80, innerHeight - host.offsetHeight - 10)) + 'px';
}
async function stackAction(action) { const ids=visible.filter(x=>selection.has(x.id)).map(x=>x.id); const result=await window.clips.stack(action,ids); if (!result.ok) notice(result.error); else if(action==='add') notice('已加入顺序粘贴队列'); }
function jumpHistory(id=primary) { $('#search').value=''; $('#kind-filter').value='all'; $('#days-filter').value='0'; $('#source-filter').value=''; switchTab('all'); if(state.items.some(x=>x.id===id)) { selectItem(id); scrollToItem(id); viewport.focus(); } }
async function openSettings() {
  try { receive(await window.clips.state()); } catch {}
  $('#setting-startup').checked = !!state.settings.openAtLogin; $('#setting-startup').disabled = !state.status.startupSupported; $('#startup-hint').textContent = state.status.startupSupported ? '启动后驻留托盘，不弹出面板；便携版需保留在固定位置' : '请在 Windows 便携版中启用自启动';
  const s = state.settings; $('#setting-theme').value = s.theme; $('#setting-shortcut').value = s.shortcut; $('#setting-retention').value = s.retentionDays;
  $('#setting-separator').value = ({ '\n': 'line', '\n\n': 'paragraph', ' ': 'space', '\t': 'tab' })[s.separator] || 'line';
  $('#setting-blur').checked = s.hideOnBlur; $('#setting-motion').checked = s.reduceMotion; $('#setting-compact').checked = s.compact; $('#settings-error').textContent = ''; $('#settings-dialog').showModal();
  $('#setting-images').checked = s.captureImages; $('#setting-plain').checked = s.alwaysPlainText; $('#setting-confidential').checked = s.ignoreConfidential; $('#setting-ignored-apps').value = (s.ignoredApps || []).join('\n');
}
function confirmAction(title, description, action) { $('#confirm-title').textContent = title; $('#confirm-description').textContent = description; $('#confirm-dialog').showModal(); $('#accept-confirm').onclick = async () => { await action(); $('#confirm-dialog').close(); }; }
function toggleFilters() { $('#filters').hidden = !$('#filters').hidden; $('#filters-toggle').setAttribute('aria-expanded', String(!$('#filters').hidden)); render(); }
function go(delta, extend = false, edge = null) { if (!visible.length) return; const current = Math.max(0, visible.findIndex(x => x.id === primary)); const index = edge === 'first' ? 0 : edge === 'last' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, current + delta)); selectItem(visible[index].id, false, extend); viewport.focus({ preventScroll: true }); scrollToItem(primary); }
$('#search').oninput = () => { resetScroll(); render(); };
$('#clear-search').onclick = () => { $('#search').value = ''; resetScroll(); render(); $('#search').focus(); };
$('#stack-add').onclick = () => stackAction('add');
$('#import-image').onclick = async () => {
  const button = $('#import-image'); if (button.disabled) return;
  button.disabled = true; closeMenus();
  try {
    const result = await window.clips.importImage();
    if (!result.ok) notice(result.error);
    else if (!result.canceled) {
      if (result.state) receive(result.state);
      jumpHistory(result.id); notice('图片已导入，可用 Ctrl+Z 撤销');
    }
  } catch { notice('导入失败，请稍后重试'); }
  finally { button.disabled = false; }
};
for(const action of ['next','copy','reverse','clear']) $('#stack-'+action).onclick = () => stackAction(action);
$('#hide').onclick = () => window.clips.hide(); $('#about').onclick = () => notice('ClipShelf ' + (state.status.version || '') + ' · 本地剪贴板 · ' + (state.status.events ? 'Windows 事件采集' : '轮询采集'));
$('#pause-duration').onclick = event => { const host=$('#context-menu'); host.replaceChildren(); for(const [minutes,label] of [[5,'暂停 5 分钟'],[15,'暂停 15 分钟'],[60,'暂停 1 小时'],[0,'暂停，直到手动恢复']]) { const button=node('button','',label); button.setAttribute('role','menuitem'); button.onclick=()=>{closeMenus();mutate('pause',null,minutes);}; host.append(button); } const rect=event.currentTarget.getBoundingClientRect(); host.hidden=false;host.style.left=Math.max(8,rect.right-host.offsetWidth)+'px';host.style.top=Math.min(rect.bottom+4,innerHeight-host.offsetHeight-8)+'px'; };
$('#pause').onclick = () => mutate('pause'); $('#undo').onclick = () => mutate('undo');
$('#add-group').onclick = () => openGroup(); $('#edit-group').onclick = () => openGroup(tab); $('#new-item').onclick = () => openPreview('new'); $('#settings').onclick = openSettings;
$('#compact').onclick = () => mutate('settings', null, { compact: !state.settings.compact });
$('#filters-toggle').onclick = toggleFilters;
for (const selector of ['#kind-filter', '#days-filter', '#source-filter']) $(selector).onchange = () => { resetScroll(); render(); };
$('#reset-filters').onclick = () => { $('#kind-filter').value = 'all'; $('#days-filter').value = '0'; $('#source-filter').value = ''; resetScroll(); render(); };
$('#clear').onclick = () => confirmAction('清理历史记录？', '收藏和分组中的内容会保留。操作后可用 Ctrl+Z 撤销。', () => mutate('clear'));
$('#remove-group').onclick = () => confirmAction('删除这个分组？', '分组里的内容仍保留在剪贴板历史中。', async () => { const r = await mutate('group-delete', tab); if (r.ok) switchTab('all'); });
$('#group-form').onsubmit = async event => { event.preventDefault(); const r = await mutate(groupEdit ? 'group-edit' : 'group-add', groupEdit, { name: $('#group-name').value, color: groupColor }); if (r.ok) $('#group-dialog').close(); };
$('#preview-edit').onclick = () => openPreview('edit', previewId);
$('#preview-copy').onclick = () => use([previewId], true); $('#preview-paste').onclick = () => use([previewId]);
$('#preview-form').onsubmit = async event => { event.preventDefault(); const result = await mutate(previewId ? 'edit' : 'create', previewId, { text: $('#item-text').value, title: $('#item-title').value }, true); if (result.ok) { $('#preview-dialog').close(); notice('已保存'); } else $('#preview-error').textContent = result.error; };
$('#settings-form').onsubmit = async event => { event.preventDefault(); const result = await mutate('settings', null, { openAtLogin: $('#setting-startup').checked, theme: $('#setting-theme').value, shortcut: $('#setting-shortcut').value, retentionDays: Number($('#setting-retention').value), separator: ({ line: '\n', paragraph: '\n\n', space: ' ', tab: '\t' })[$('#setting-separator').value], hideOnBlur: $('#setting-blur').checked, reduceMotion: $('#setting-motion').checked, compact: $('#setting-compact').checked, captureImages: $('#setting-images').checked, alwaysPlainText: $('#setting-plain').checked, ignoreConfidential: $('#setting-confidential').checked, ignoredApps: $('#setting-ignored-apps').value.split('\n').map(x => x.trim()).filter(Boolean) }, true); if (result.ok) $('#settings-dialog').close(); else $('#settings-error').textContent = result.error; };
for (const b of document.querySelectorAll('.close-dialog')) b.onclick = () => b.closest('dialog').close();
for (const dialog of document.querySelectorAll('dialog')) { dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }); dialog.addEventListener('close', () => viewport.focus({ preventScroll: true })); }
viewport.addEventListener('scroll', () => { lastScroll = performance.now(); renderWindow(); }, { passive: true });
viewport.addEventListener('wheel', event => {
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.shiftKey) return;
  event.preventDefault(); if (!wheelFrame) wheelTarget = viewport.scrollLeft;
  const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? viewport.clientWidth : 1;
  wheelTarget = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, wheelTarget + event.deltaY * scale));
  if (reduced()) { viewport.scrollLeft = wheelTarget; return; }
  const tick = () => { const delta = wheelTarget - viewport.scrollLeft; if (Math.abs(delta) <= 1) { viewport.scrollLeft = wheelTarget; wheelFrame = 0; return; } const before = viewport.scrollLeft; viewport.scrollLeft += delta * .24; if (viewport.scrollLeft === before) { viewport.scrollLeft = wheelTarget; wheelFrame = 0; return; } wheelFrame = requestAnimationFrame(tick); };
  if (!wheelFrame) wheelFrame = requestAnimationFrame(tick);
}, { passive: false });
new ResizeObserver(() => { document.documentElement.classList.toggle('compact', state.settings.compact || innerHeight < 345); renderWindow(); }).observe(viewport);
$('#resize-handle').addEventListener('pointerdown', event => {
  const startY = event.screenY, startHeight = window.outerHeight; const handle = event.currentTarget; handle.setPointerCapture(event.pointerId);
  handle.onpointermove = move => window.clips.resize(startHeight + startY - move.screenY);
  handle.onpointerup = end => { window.clips.resize(startHeight + startY - end.screenY, true); handle.releasePointerCapture(end.pointerId); handle.onpointermove = null; handle.onpointerup = null; };
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('#context-menu')) closeMenus(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Control') document.documentElement.classList.add('show-numbers');
  const dialog = document.querySelector('dialog[open]');
  if(dialog?.id==='preview-dialog'&&previewMode==='view'&&state.items.find(x=>x.id===previewId)?.kind==='image'&&(event.ctrlKey||event.metaKey)) { if(event.key.toLowerCase()==='s'){event.preventDefault();$('#image-export').click();return;} if(event.key.toLowerCase()==='z'){event.preventDefault();const id=previewId;void mutate('undo').then(result=>{if(result.ok&&previewId===id&&$('#preview-dialog').open)openPreview('view',id);});return;} }
  if (dialog) { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && dialog.id === 'preview-dialog' && previewMode !== 'view') { event.preventDefault(); $('#preview-form').requestSubmit(); } return; }
  const key = event.key.toLowerCase(), ctrl = event.ctrlKey || event.metaKey, editing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
  if (!editing && (key === 'process' || event.keyCode === 229)) { $('#search').focus(); return; }
  if (key === 'escape') { event.preventDefault(); if (!$('#context-menu').hidden) closeMenus(); else if ($('#search').value) { $('#search').value = ''; resetScroll(); render(); } else if (!$('#filters').hidden) { $('#filters').hidden = true; $('#filters-toggle').setAttribute('aria-expanded', 'false'); render(); } else window.clips.hide(); return; }
  if (ctrl && ['f', 'k'].includes(key)) { event.preventDefault(); if (key === 'f' && document.activeElement === $('#search')) toggleFilters(); $('#search').focus(); $('#search').select(); return; }
  if (ctrl && /^[1-9]$/.test(key)) { event.preventDefault(); const item = visible[Number(key) - 1]; if (item) use([item.id], false, event.shiftKey); return; }
  if (ctrl && event.shiftKey && key === 's') { event.preventDefault(); stackAction('add'); return; }
  if (ctrl && key === 'g' && primary) { event.preventDefault(); jumpHistory(); return; }
  if (ctrl && key === ',') { event.preventDefault(); openSettings(); return; }
  if (ctrl && key === 'n') { event.preventDefault(); event.shiftKey ? openGroup() : openPreview('new'); return; }
  if (ctrl && key === 'o') { event.preventDefault(); $('#import-image').click(); return; }
  if (ctrl && key === 't') { event.preventDefault(); mutate('pause'); return; }
  if (ctrl && ['arrowright', 'arrowleft'].includes(key)) { event.preventDefault(); const tabs = ['all', 'star', ...state.groups.map(g => g.id)], index = tabs.indexOf(tab); switchTab(tabs[(index + (key === 'arrowright' ? 1 : tabs.length - 1)) % tabs.length]); return; }
  if (ctrl && key === 'z' && !editing) { event.preventDefault(); mutate('undo'); return; }
  if (ctrl && key === 'a' && !editing) { event.preventDefault(); selection = new Set(visible.map(x => x.id)); render(); return; }
  if (ctrl && key === 'c' && !editing) { event.preventDefault(); use([...selection], true); return; }
  if (ctrl && ['e', 'r'].includes(key) && primary) { event.preventDefault(); openPreview(key === 'e' ? 'edit' : 'rename'); return; }
  if (key === 'tab' && document.activeElement === $('#search') && !event.shiftKey) { event.preventDefault(); viewport.focus(); return; }
  if (key === 'enter' && !event.target.closest('button,select') && primary) { event.preventDefault(); if (event.target.id === 'search' && $('#search').value) { viewport.focus(); scrollToItem(primary); } else use([...selection], false, event.shiftKey); return; }
  if (['arrowright', 'arrowleft', 'arrowdown', 'arrowup', 'home', 'end'].includes(key)) {
    if (editing && !(event.target.id === 'search' && (key === 'arrowdown' || key === 'arrowup' || !$('#search').value))) return;
    event.preventDefault(); go(key === 'arrowright' || key === 'arrowdown' ? 1 : -1, event.shiftKey, key === 'home' ? 'first' : key === 'end' ? 'last' : null); return;
  }
  if (editing) return;
  if (key === ' ') { event.preventDefault(); openPreview(); return; }
  if (key === 'delete' && selection.size) { event.preventDefault(); mutate('delete', [...selection]); return; }
  if (!ctrl && !event.altKey && event.key.length === 1) { $('#search').focus(); $('#search').value += event.key; resetScroll(); render(); event.preventDefault(); }
});
document.addEventListener('keyup', event => { if (event.key === 'Control') document.documentElement.classList.remove('show-numbers'); });
window.addEventListener('blur', () => document.documentElement.classList.remove('show-numbers'));
window.clips.onState(receive);
window.clips.onShow(options => { closeMenus(); if (!options?.preserve) { closeDialogs(); $('#search').value = ''; tab = 'all'; selection.clear(); primary = null; resetScroll(); } render(); if(state.status.error)notice(state.status.error); animateShelf(true); viewport.focus({ preventScroll: true }); });
window.clips.onHide(() => { closeMenus(); animateShelf(false); });
window.clips.onSuspend(()=>{closeDialogs();cancelAnimationFrame(renderFrame);cancelAnimationFrame(wheelFrame);wheelFrame=0;animation?.cancel();});
window.clips.onNotice(notice);
for (const e of document.querySelectorAll('[data-icon]')) e.replaceChildren(icon(e.dataset.icon, e.classList.contains('empty-icon') ? 39 : 18));
window.clips.state().then(receive);
