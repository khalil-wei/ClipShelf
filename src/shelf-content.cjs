const {queryItems}=require('./view-model.js');
// Only the main process keeps complete history bodies. IPC cards are bounded.
const PREVIEW_CHARS=650;
function projectItem({text='',html='',...item}){
  return {...item,text:text.slice(0,PREVIEW_CHARS),textLength:text.length,hasFormatting:!!html};
}
function searchIds(items,query){
  if(typeof query!=='string'||query.length>4096)throw Error('搜索内容过长');
  return queryItems(items,{query}).map(item=>item.id);
}
async function searchCooperatively(items,query,{isCurrent=()=>true,yieldControl=()=>new Promise(resolve=>setImmediate(resolve))}={}){
  if(typeof query!=='string'||query.length>4096)throw Error('搜索内容过长');
  const ids=[];let start=0;
  while(start<items.length){
    if(!isCurrent())return [];
    let end=start,chars=0;
    do{chars+=items[end++].text.length;}while(end<items.length&&end-start<32&&chars<524288);
    ids.push(...searchIds(items.slice(start,end),query));start=end;
    if(start<items.length)await yieldControl();
  }
  return isCurrent()?ids:[];
}
module.exports={projectItem,searchIds,searchCooperatively,PREVIEW_CHARS};
