// Hold one toggle until the shortcut's main key is released, including OS repeat.
class ShortcutLatch {
  constructor(isDown,{schedule=setTimeout,cancel=clearTimeout,now=Date.now}={}){Object.assign(this,{isDown,schedule,cancel,now});this.active=false;this.closed=false;}
  async run(action){
    if(this.active||this.closed)return;
    this.active=true;const started=this.now();
    try{return await action();}
    finally{
      const release=()=>{
        if(this.closed)return;
        if(this.isDown()||this.now()-started<180){this.timer=this.schedule(release,25);this.timer?.unref?.();}
        else this.active=false;
      };
      release();
    }
  }
  close(){this.closed=true;this.cancel(this.timer);}
}
module.exports={ShortcutLatch};
