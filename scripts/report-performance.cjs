const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const beforeFile='artifacts/performance-baseline-dist/ClipShelf-win32-x64/test-artifacts/performance-baseline-final-0.5.0.json';
const afterFile='dist/v0.5.1/ClipShelf-win32-x64/test-artifacts/performance-release-repeat-0.5.1.json';
const repeatFile='dist/v0.5.1/ClipShelf-win32-x64/test-artifacts/performance-release-0.5.1.json';
const before=read(beforeFile),after=read(afterFile),repeat=read(repeatFile);
if(before.version!=='0.5.0'||after.version!=='0.5.1'||before.cpu!==after.cpu||before.logicalCpus!==after.logicalCpus)throw Error('Incompatible performance inputs');
const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const metrics=[
  ['后台空闲 CPU（整机口径）','%',before.stages.hiddenIdle.cpuMachinePercent,after.stages.hiddenIdle.cpuMachinePercent],
  ['连续新增 36 条时 CPU（整机口径）','%',before.stages.hiddenCopies.cpuMachinePercent,after.stages.hiddenCopies.cpuMachinePercent],
  ['面板可见空闲 CPU（整机口径）','%',before.stages.visibleIdle.cpuMachinePercent,after.stages.visibleIdle.cpuMachinePercent],
  ['后台空闲末端私有提交','MiB',before.stages.hiddenIdle.privateMiBLast,after.stages.hiddenIdle.privateMiBLast],
  ['后台空闲末端工作集合计','MiB',before.stages.hiddenIdle.workingMiBLast,after.stages.hiddenIdle.workingMiBLast],
  ['大图阶段私有提交采样峰值','MiB',before.stages.largeImages.privateMiBPeak,after.stages.largeImages.privateMiBPeak],
  ['大图阶段工作集合计采样峰值','MiB',before.stages.largeImages.workingMiBPeak,after.stages.largeImages.workingMiBPeak],
  ['3 次大图编码阶段总 CPU 时间','ms',before.stages.largeImages.cpuMs,after.stages.largeImages.cpuMs],
  ['单图编码平均耗时','ms',mean(before.stages.largeImages.encodeMs),mean(after.stages.largeImages.encodeMs)],
  ['呼出至两帧渲染','ms',before.stages.openShelf.elapsedMs,after.stages.openShelf.elapsedMs],
  ['快速滚动帧间隔 p95','ms',before.stages.scroll.p95FrameMs,after.stages.scroll.p95FrameMs]
].map(([label,unit,before,after])=>({label,unit,before,after,reductionPercent:Math.round((1-after/before)*10000)/100}));
for(const [file,name] of [[beforeFile,'performance-baseline-final-0.5.0.json'],[afterFile,'performance-release-repeat-0.5.1.json'],[repeatFile,'performance-release-0.5.1.json']])fs.copyFileSync(path.join(root,file),path.join(root,'artifacts',name));
const report={before:'artifacts/performance-baseline-final-0.5.0.json',after:'artifacts/performance-release-repeat-0.5.1.json',repeat:'artifacts/performance-release-0.5.1.json',cpu:after.cpu,logicalCpus:after.logicalCpus,metrics};
fs.writeFileSync(path.join(root,'artifacts/performance-comparison-v0.5.1.json'),JSON.stringify(report,null,2));
const format=(value,unit)=>`${value.toFixed(unit==='%'?2:1)} ${unit}`;
const table=['主表采用最后一组顺序运行的基线与最终成品，均为打包版。','', '| 指标 | 0.5.0 | 0.5.1 |','| --- | ---: | ---: |',...metrics.map(row=>`| ${row.label} | ${format(row.before,row.unit)} | ${format(row.after,row.unit)} |`),'',
'这组场景中，连续入库的平均 CPU 下降约 91%，大图私有提交峰值下降约 38%，大图编码总 CPU 时间下降约 23%。呼出耗时从约 95ms 增至约 121ms，尚未优化成功；快速滚动没有测出稳定的明显提升。呼出计时包含窗口激活到两帧渲染，不是完整 235ms 动画的结束时间。', '',
`同一最终成品另一次测量：连续入库 CPU ${repeat.stages.hiddenCopies.cpuMachinePercent.toFixed(2)}%，后台私有提交 ${repeat.stages.hiddenIdle.privateMiBLast.toFixed(1)} MiB，工作集合计 ${repeat.stages.hiddenIdle.workingMiBLast.toFixed(1)} MiB；大图私有提交峰值 ${repeat.stages.largeImages.privateMiBPeak.toFixed(1)} MiB，工作集峰值 ${repeat.stages.largeImages.workingMiBPeak.toFixed(1)} MiB。工作集受共享页和系统状态影响较大，不能仅凭一次工作集读数推断独占 RAM。空闲 CPU 也没有稳定下降的证据。`, ''].join('\n');
const doc=path.join(root,'docs/performance-v0.5.1.md');let content=fs.readFileSync(doc,'utf8');
const heading='## 打包版实测\n\n',start=content.indexOf(heading),end=content.indexOf('\n## 验证',start);
if(start<0||end<0)throw Error('Performance report section missing');
fs.writeFileSync(doc,content.slice(0,start+heading.length)+table+'\n'+content.slice(end));
console.log(JSON.stringify(report,null,2));
