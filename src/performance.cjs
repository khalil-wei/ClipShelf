// Deterministic local fixtures; never reads or writes the user's clipboard/history.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const readline=require('node:readline');
const {spawn}=require('node:child_process');
const {nativeImage}=require('electron');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const now=()=>Number(process.hrtime.bigint())/1e6;
const round=n=>Math.round(n*100)/100;
async function run({app,win,store,save,broadcast,startNative,getHelper,encodeImage,showShelf,hideShelf}) {
  const label=process.argv.find(x=>x.startsWith('--perf-label='))?.slice(13)||app.getVersion();
  const samples=[],work={};let stage='warmup';
  const script='$ErrorActionPreference="Stop";while($line=[Console]::ReadLine()){try{$req=$line|ConvertFrom-Json;$rows=@(foreach($procId in $req.pids){$p=Get-Process -Id $procId -ErrorAction SilentlyContinue;if($p){@{pid=$p.Id;cpuMs=$p.TotalProcessorTime.TotalMilliseconds;working=$p.WorkingSet64;private=$p.PrivateMemorySize64}}});@{stage=$req.stage;ms=$req.ms;processes=$rows}|ConvertTo-Json -Compress -Depth 4}catch{[Console]::Error.WriteLine($_.Exception.Message)}}';
  const sampler=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let sampleErrors='';sampler.stderr.on('data',x=>sampleErrors+=x);
  readline.createInterface({input:sampler.stdout}).on('line',line=>{try{samples.push(JSON.parse(line));}catch{sampleErrors+=line;}});
  const sample=()=>{const metrics=app.getAppMetrics();sampler.stdin.write(JSON.stringify({stage,ms:now(),pids:[...new Set([...metrics.map(x=>x.pid),getHelper()?.child?.pid].filter(Boolean))]})+'\n');};
  const timer=setInterval(sample,250);sample();
  const measure=async(name,fn)=>{stage=name;sample();const start=now();const result=await fn();sample();work[name]={elapsedMs:round(now()-start),...result};};
  try {
    if(!await startNative())throw Error('Windows helper did not start');
    store.configure({hideOnBlur:false});
    for(let i=0;i<1850;i++)store.add(`fixture-${i} `+'A local clipboard sample. '.repeat(16),'notepad');
    for(let i=0;i<16;i++)store.add(`long-${i} `+'中文剪贴板'.repeat(17476),'msedge');
    await save();broadcast();win.showInactive();await sleep(1000);win.hide();await sleep(2000);
    await measure('hiddenIdle',()=>sleep(8000));
    await measure('hiddenCopies',async()=>{for(let i=0;i<36;i++){store.add(`burst-${i} `+'sample '.repeat(80),'notepad');broadcast();await sleep(100);}await save();await sleep(750);return{copies:36};});
    await measure('openShelf',async()=>{await showShelf(false);return await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const card=document.querySelector('.card.selected');if(!card?.textContent.includes('burst-35'))return reject(Error('Hidden shelf did not receive the latest history'));resolve({cards:document.querySelectorAll('.card').length,latestHistory:true});})))`);});
    await measure('visibleIdle',()=>sleep(8000));
    await measure('scroll',()=>win.webContents.executeJavaScript(`new Promise(resolve=>{const host=document.querySelector('#cards'),frames=[];let n=0,last=performance.now();function step(t){frames.push(t-last);last=t;host.scrollLeft+=100;if(++n<80)requestAnimationFrame(step);else{frames.sort((a,b)=>a-b);resolve({frames:frames.length,p95FrameMs:frames[Math.floor(frames.length*.95)],cards:document.querySelectorAll('.card').length});}}requestAnimationFrame(step);})`));
    await hideShelf(true);
    await measure('largeImages',async()=>{
      const width=2048,height=8192,bitmap=Buffer.alloc(width*height*4,Buffer.from([40,120,210,255]));
      const image=nativeImage.createFromBitmap(bitmap,{width,height}),times=[];let bytes=0;
      for(let i=0;i<3;i++){const t=now(),packet=await encodeImage(image);times.push(round(now()-t));bytes=packet.png.length;if(packet.width!==width||packet.height!==height)throw Error('Encoded dimensions changed');}
      return{pixels:width*height,repetitions:3,encodeMs:times,encodedBytes:bytes};
    });
    await measure('settledIdle',()=>sleep(10000));
    clearInterval(timer);sampler.stdin.end();await new Promise(resolve=>sampler.once('exit',resolve));
    if(sampleErrors)throw Error(sampleErrors);
    const logicalCpus=os.cpus().length,stages={};
    for(const name of Object.keys(work)){
      const rows=samples.filter(x=>x.stage===name);let cpuMs=0,elapsedMs=0;
      for(let i=1;i<rows.length;i++){const previous=new Map(rows[i-1].processes.map(x=>[x.pid,x.cpuMs]));cpuMs+=rows[i].processes.reduce((sum,x)=>sum+(previous.has(x.pid)?Math.max(0,x.cpuMs-previous.get(x.pid)):0),0);elapsedMs+=rows[i].ms-rows[i-1].ms;}
      const totals=rows.map(x=>({working:x.processes.reduce((s,p)=>s+p.working,0)/1048576,private:x.processes.reduce((s,p)=>s+p.private,0)/1048576}));
      stages[name]={...work[name],samples:rows.length,cpuMs:round(cpuMs),cpuOneCorePercent:round(cpuMs/elapsedMs*100),cpuMachinePercent:round(cpuMs/elapsedMs*100/logicalCpus),workingMiBLast:round(totals.at(-1)?.working||0),workingMiBPeak:round(Math.max(...totals.map(x=>x.working))),privateMiBLast:round(totals.at(-1)?.private||0),privateMiBPeak:round(Math.max(...totals.map(x=>x.private)))};
    }
    const result={label,version:app.getVersion(),date:new Date().toISOString(),nativeHelper:path.basename(getHelper().file),logicalCpus,cpu:os.cpus()[0].model,notes:['Windows Get-Process: sum of Electron processes and native helper; measurement PowerShell excluded.','Working set totals include shared pages; private bytes are committed private memory, not exclusive resident RAM.','250 ms sampling; synthetic 1902-item history with about 4 MiB UTF-8 long text; no user clipboard contents/history access.','CPU machine percent divides measured CPU time by wall time and logical processor count; no forced GC.'],stages,samples};
    const out=path.join(app.isPackaged?path.dirname(process.execPath):app.getAppPath(),'test-artifacts');await fs.mkdir(out,{recursive:true});
    const file=path.join(out,`performance-${label}.json`);await fs.writeFile(file,JSON.stringify(result,null,2));console.log(JSON.stringify({file,...result,samples:undefined},null,2));app.quit();
  }catch(e){clearInterval(timer);sampler.kill();console.error(e);app.exit(1);}
}
module.exports={run};
