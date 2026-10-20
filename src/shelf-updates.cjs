const {createHash}=require('node:crypto');
const hashBody=text=>text?createHash('sha256').update(text,'utf16le').digest('hex'):'';
class ShelfUpdates {
  constructor({digest=hashBody}={}){this.revision=0;this.items=null;this.bodies=new WeakMap();this.digest=digest;}
  describe(item,source){
    const {text='',html='',...metadata}=item;
    // Memoize against live store objects, never the short-lived IPC projections.
    // Evicting an item also makes this weak entry and its body collectible.
    let body=this.bodies.get(source);
    if(!body||body.text!==text||body.html!==html){body={text,html,digest:[this.digest(text),this.digest(html)]};this.bodies.set(source,body);}
    return JSON.stringify([metadata,body.digest]);
  }
  remember(items,sources=items){
    const originals=new Map(sources.map(item=>[item.id,item]));
    this.items=new Map(items.map(item=>[item.id,this.describe(item,originals.get(item.id)||item)]));
  }
  full(state,sources=state.items){this.remember(state.items,sources);return {...state,revision:++this.revision};}
  next(state,sources=state.items){
    if(!this.items)return this.full(state,sources);
    const upserts=[],next=new Map();
    const originals=new Map(sources.map(item=>[item.id,item]));
    for(const item of state.items){
      const descriptor=this.describe(item,originals.get(item.id)||item);
      if(this.items.get(item.id)!==descriptor)upserts.push({...item,groups:[...item.groups]});
      next.set(item.id,descriptor);
    }
    this.items=next;const {items,...header}=state;
    const baseRevision=this.revision;return {...header,baseRevision,revision:++this.revision,patch:{upserts,order:items.map(item=>item.id)}};
  }
}
module.exports={ShelfUpdates};
