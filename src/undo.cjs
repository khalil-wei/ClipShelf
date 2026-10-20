const { ClipStore } = require('./store.cjs');
// Text/HTML strings are immutable; keep their storage shared while copying mutable
// metadata. structuredClone duplicates every large body for a simple star/delete.
function cloneSnapshot(snapshot){
  return {...snapshot,items:snapshot.items.map(item=>({...item,groups:[...item.groups]})),groups:snapshot.groups.map(group=>({...group,order:[...group.order]})),settings:{...snapshot.settings,ignoredApps:[...snapshot.settings.ignoredApps]}};
}
function restoreUndo(record, current) {
  const restored = typeof record.before === 'string' ? JSON.parse(record.before) : cloneSnapshot(record.before);
  const afterIds = new Set(record.afterIds);
  const newCopies = current.items.filter(x => !afterIds.has(x.id));
  const identity = x => x.kind === 'image' ? 'image:' + x.mediaId : 'text:' + x.text;
  const newTexts = new Set(newCopies.map(identity));
  restored.items = [...newCopies, ...restored.items.filter(x => !newTexts.has(identity(x)))];
  restored.settings = current.settings;
  restored.paused = current.paused;
  restored.pauseUntil = current.pauseUntil;
  return new ClipStore(restored);
}
module.exports = { restoreUndo, cloneSnapshot };
