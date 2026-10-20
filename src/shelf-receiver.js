(function(root){
  class ShelfReceiver {
    constructor({fetchState,onState,onError=()=>{}}){
      this.fetchState=fetchState;this.onState=onState;this.onError=onError;
      this.state=null;this.latestRevision=0;this.resync=null;
    }
    receive(packet){
      const current=this.state?.revision||0;
      this.latestRevision=Math.max(this.latestRevision,packet.revision||0);
      if(packet.revision&&packet.revision<=current)return;
      if(packet.patch){
        if(packet.baseRevision!==current){this.requestState();return;}
        const items=new Map((this.state?.items||[]).map(item=>[item.id,item]));
        for(const item of packet.patch.upserts)items.set(item.id,item);
        const {patch,...header}=packet;
        this.state={...header,items:patch.order.map(id=>items.get(id)).filter(Boolean)};
      }else this.state=packet;
      this.onState(this.state);
    }
    requestState(){
      if(this.resync)return this.resync;
      let succeeded=false;
      this.resync=Promise.resolve().then(()=>this.fetchState()).then(full=>{
        succeeded=true;this.receive(full);
      }).catch(error=>this.onError(error)).finally(()=>{
        this.resync=null;
        // A newer patch may have arrived after the snapshot was captured. Keep
        // only its revision, then fetch again; do not retain large patch bodies.
        if(succeeded&&(this.state?.revision||0)<this.latestRevision)this.requestState();
      });
      return this.resync;
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={ShelfReceiver};
  else root.ShelfReceiver=ShelfReceiver;
})(typeof window!=='undefined'?window:globalThis);
