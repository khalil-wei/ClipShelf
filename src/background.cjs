const { Worker, isMarkedAsUntransferable } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
class Background {
  constructor({idleMs=15000,imageIdleMs=5000}={}) { this.nextId=0;this.pending=new Map();this.closed=false;this.idleMs=idleMs;this.imageIdleMs=imageIdleMs;this.source=fs.readFileSync(path.join(__dirname,'background-worker.cjs'),'utf8'); }
  idle() {
    clearTimeout(this.idleTimer);if(this.pending.size||this.closed)return;
    this.idleTimer=setTimeout(()=>{if(this.pending.size)return;const worker=this.worker;this.worker=null;this.largeImage=false;void worker?.terminate();},this.largeImage?this.imageIdleMs:this.idleMs);this.idleTimer.unref();
  }
  start() {
    if(this.closed)return;this.failure=null;const worker=new Worker(this.source,{eval:true});this.worker=worker;let failed=false;
    worker.on('message',({id,result,error})=>{if(worker!==this.worker)return;const job=this.pending.get(id);if(!job)return;this.pending.delete(id);if(!this.pending.size){worker.unref();this.idle();}error?job.reject(Error(error)):job.resolve(result);});
    const fail=error=>{if(failed||worker!==this.worker)return;failed=true;for(const job of this.pending.values())job.reject(error);this.pending.clear();this.failure=error;if(!this.closed){this.restartTimer=setTimeout(()=>this.start(),1000);this.restartTimer.unref();}};
    worker.on('error',fail);worker.on('exit',()=>fail(Error('后台处理已停止，请稍后重试')));worker.unref();this.idle();
  }
  run(operation,value) {
    if(this.closed||this.failure)return Promise.reject(this.failure||Error('后台处理已关闭'));
    if(!this.worker)this.start();clearTimeout(this.idleTimer);
    if(operation==='png'&&value?.pixels?.byteLength>=8*1024*1024)this.largeImage=true;
    return new Promise((resolve,reject)=>{
      const id=++this.nextId;this.pending.set(id,{resolve,reject});this.worker.ref();
      try {const pixels=value?.pixels,buffer=pixels?.buffer;const transfer=buffer instanceof ArrayBuffer&&pixels.byteOffset===0&&pixels.byteLength===buffer.byteLength&&!isMarkedAsUntransferable(buffer)?[buffer]:[];this.worker.postMessage({id,operation,value},transfer);}
      catch(e){this.pending.delete(id);if(!this.pending.size)this.worker.unref();reject(e);}
    });
  }
  close() { this.closed=true;clearTimeout(this.restartTimer);clearTimeout(this.idleTimer);for(const job of this.pending.values())job.reject(Error('后台处理已关闭'));this.pending.clear();return this.worker?.terminate()||Promise.resolve(); }
}
module.exports={Background};
