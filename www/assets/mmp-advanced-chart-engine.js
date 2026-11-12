/* MMP Advanced Chart Engine
 * Deterministic OHLC transforms and indicator calculations.
 * All synthetic chart types are derived from validated source OHLCV candles.
 * Copyright (c) MMP COIN AI project contributors.
 */
(function(root){
 "use strict";
 const finite=n=>Number.isFinite(Number(n));
 function validate(rows){
  if(!Array.isArray(rows)) throw new TypeError("OHLC rows must be an array");
  const clean=rows.map(r=>({time:Number(r.time),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Math.max(0,Number(r.volume)||0)}))
   .filter(r=>finite(r.time)&&r.time>0&&[r.open,r.high,r.low,r.close].every(finite)&&r.open>0&&r.high>0&&r.low>0&&r.close>0&&r.high>=Math.max(r.open,r.close,r.low)&&r.low<=Math.min(r.open,r.close,r.high))
   .sort((a,b)=>a.time-b.time);
  return clean.filter((r,i)=>i===0||r.time>clean[i-1].time);
 }
 function heikinAshi(input){
  const rows=validate(input);let prev=null;
  return rows.map(r=>{const close=(r.open+r.high+r.low+r.close)/4,open=prev?(prev.open+prev.close)/2:(r.open+r.close)/2,out={time:r.time,open,close,high:Math.max(r.high,open,close),low:Math.min(r.low,open,close),volume:r.volume};prev=out;return out;});
 }
 function sma(input,period){
  const rows=validate(input),out=[];if(period<1)return out;let sum=0;
  rows.forEach((r,i)=>{sum+=r.close;if(i>=period)sum-=rows[i-period].close;if(i>=period-1)out.push({time:r.time,value:sum/period});});return out;
 }
 function ema(input,period){
  const rows=validate(input),out=[];if(!rows.length||period<1)return out;const alpha=2/(period+1);let v=rows[0].close;
  rows.forEach((r,i)=>{v=i?v* (1-alpha)+r.close*alpha:r.close;if(i>=period-1)out.push({time:r.time,value:v});});return out;
 }
 function atr(input,period=14){
  const rows=validate(input),trs=[];rows.forEach((r,i)=>{const p=rows[i-1],tr=i?Math.max(r.high-r.low,Math.abs(r.high-p.close),Math.abs(r.low-p.close)):r.high-r.low;trs.push({time:r.time,value:tr});});
  let v=0;return trs.reduce((out,r,i)=>{if(i<period){v+=r.value;if(i===period-1)out.push({time:r.time,value:v/period});}else{v=(v*(period-1)+r.value)/period;out.push({time:r.time,value:v});}return out;},[]);
 }
 function rsi(input,period=14){
  const rows=validate(input),out=[];if(rows.length<=period)return out;let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=rows[i].close-rows[i-1].close;gain+=Math.max(0,d);loss+=Math.max(0,-d);}
  let ag=gain/period,al=loss/period;out.push({time:rows[period].time,value:al===0?100:100-100/(1+ag/al)});
  for(let i=period+1;i<rows.length;i++){const d=rows[i].close-rows[i-1].close;ag=(ag*(period-1)+Math.max(0,d))/period;al=(al*(period-1)+Math.max(0,-d))/period;out.push({time:rows[i].time,value:al===0?100:100-100/(1+ag/al)});}return out;
 }
 function bollinger(input,period=20,mult=2){
  const rows=validate(input),mid=sma(rows,period),out=[];mid.forEach(m=>{const idx=rows.findIndex(r=>r.time===m.time),slice=rows.slice(idx-period+1,idx),variance=slice.reduce((s,r)=>s+(r.close-m.value)**2,0)/period,sd=Math.sqrt(variance);out.push({time:m.time,middle:m.value,upper:m.value+mult*sd,lower:m.value-mult*sd});});return out;
 }
 function macd(input,fast=12,slow=26,signal=9){
  const a=ema(input,fast),b=ema(input,slow),map=new Map(b.map(x=>[x.time,x.value])),line=a.filter(x=>map.has(x.time)).map(x=>({time:x.time,value:x.value-map.get(x.time)}));
  const sig=ema(line.map(x=>({time:x.time,open:x.value,high:x.value,low:x.value,close:x.value})),signal);
  const sm=new Map(sig.map(x=>[x.time,x.value]));return line.filter(x=>sm.has(x.time)).map(x=>({time:x.time,macd:x.value,signal:sm.get(x.time),histogram:x.value-sm.get(x.time)}));
 }
 function stochastic(input,kPeriod=14,dPeriod=3){
  const rows=validate(input),k=[];for(let i=kPeriod-1;i<rows.length;i++){const s=rows.slice(i-kPeriod+1,i+1),hi=Math.max(...s.map(x=>x.high)),lo=Math.min(...s.map(x=>x.low));k.push({time:rows[i].time,value:hi===lo?50:100*(rows[i].close-lo)/(hi-lo)});}
  const d=sma(k.map(x=>({time:x.time,open:x.value,high:x.value,low:x.value,close:x.value})),dPeriod);return {k,d};
 }
 function vwap(input){
  const rows=validate(input),out=[];let pv=0,vol=0;rows.forEach(r=>{const typical=(r.high+r.low+r.close)/3;pv+=typical*r.volume;vol+=r.volume;if(vol>0)out.push({time:r.time,value:pv/vol});});return out;
 }
 function ichimoku(input){
  const rows=validate(input),line=(end,period)=>{if(end<period-1)return null;const s=rows.slice(end-period+1,end+1);return (Math.max(...s.map(x=>x.high))+Math.min(...s.map(x=>x.low)))/2;};
  return rows.map((r,i)=>({time:r.time,tenkan:line(i,9),kijun:line(i,26),senkouA:line(i,26)==null||line(i,9)==null?null:(line(i,9)+line(i,26))/2,senkouB:line(i,52)})).filter(x=>x.tenkan!=null);
 }
 function brickTransform(input,type,options={}){
  const rows=validate(input);if(!rows.length)return [];
  const atrRows=atr(rows,14),step=Math.max(Number(options.boxSize)||0,atrRows.length?atrRows[atrRows.length-1].value*(Number(options.atrFactor)||0.5):0,rows[0].close*0.001);
  const out=[];let open=rows[0].open,close=rows[0].close,trend=0,previousClose=close,lastTime=rows[0].time;
  const push=(o,c,t,v)=>{out.push({time:t,open:o,close:c,high:Math.max(o,c),low:Math.min(o,c),volume:v});};
  if(type==="renko"||type==="range"){
   rows.forEach(r=>{let guard=0;while(Math.abs(r.close-close)>=step&&guard++<100){const dir=r.close>close?1:-1,next=close+dir*step;push(close,next,r.time,r.volume/Math.max(1,Math.floor(Math.abs(r.close-close)/step)));close=next;}});
  }else if(type==="linebreak"){
   const history=[];rows.forEach(r=>{const top=Math.max(...history.slice(-3).map(x=>x.close),close),bottom=Math.min(...history.slice(-3).map(x=>x.close),close);let dir=r.close>top?1:r.close<bottom?-1:0;if(!history.length)dir=r.close>=close?1:-1;if(dir){const next=r.close;push(close,next,r.time,r.volume);close=next;history.push(out[out.length-1]);}});
  }else if(type==="kagi"){
   let direction=0,extreme=close;rows.forEach(r=>{if(!direction)direction=r.close>=close?1:-1;if(direction>0){if(r.close>=extreme){extreme=r.close;close=r.close;}else if(extreme-r.close>=step){push(previousClose,extreme,r.time,r.volume);previousClose=extreme;direction=-1;extreme=r.close;}}else{if(r.close<=extreme){extreme=r.close;close=r.close;}else if(r.close-extreme>=step){push(previousClose,extreme,r.time,r.volume);previousClose=extreme;direction=1;extreme=r.close;}}});if(extreme!==previousClose)push(previousClose,extreme,rows[rows.length-1].time,rows[rows.length-1].volume);
  }else if(type==="pointfigure"){
   const box=step;let colDir=0,colTop=close,colBottom=close;rows.forEach(r=>{const move=r.close-close,boxes=Math.floor(Math.abs(move)/box);if(!colDir&&boxes){colDir=move>0?1:-1;}if(colDir===1&&r.close>=colTop+box){const n=Math.floor((r.close-colTop)/box);for(let i=0;i<n;i++){const o=colTop+i*box;push(o,o+box,r.time,r.volume/Math.max(1,n));}colTop+=n*box;close=colTop;}else if(colDir===-1&&r.close<=colBottom-box){const n=Math.floor((colBottom-r.close)/box);for(let i=0;i<n;i++){const o=colBottom-i*box;push(o,o-box,r.time,r.volume/Math.max(1,n));}colBottom-=n*box;close=colBottom;}else if(colDir===1&&r.close<=colTop-3*box){colDir=-1;colBottom=colTop;const n=Math.floor((colBottom-r.close)/box);for(let i=0;i<n;i++)push(colBottom-i*box,colBottom-(i+1)*box,r.time,r.volume/Math.max(1,n));colBottom-=n*box;close=colBottom;}else if(colDir===-1&&r.close>=colBottom+3*box){colDir=1;colTop=colBottom;const n=Math.floor((r.close-colTop)/box);for(let i=0;i<n;i++)push(colTop+i*box,colTop+(i+1)*box,r.time,r.volume/Math.max(1,n));colTop+=n*box;close=colTop;}});}
  return out.filter(x=>x.time>0&&x.high>=x.low);
 }
 function volumeProfile(input,bins=32){
  const rows=validate(input);if(!rows.length)return [];const lo=Math.min(...rows.map(x=>x.low)),hi=Math.max(...rows.map(x=>x.high)),step=(hi-lo)/Math.max(1,bins);if(!step)return [{price:lo,volume:rows.reduce((s,r)=>s+r.volume,0)}];
  const out=Array.from({length:bins},(_,i)=>({price:lo+(i+.5)*step,volume:0}));rows.forEach(r=>{const i=Math.min(bins-1,Math.max(0,Math.floor(((r.high+r.low+r.close)/3-lo)/step)));out[i].volume+=r.volume;});return out;
 }
 function normalizeCompare(series){
  return Object.entries(series||{}).map(([symbol,input])=>{const rows=validate(input),base=rows[0]?.close||0;return {symbol,data:base?rows.map(r=>({time:r.time,value:(r.close/base-1)*100})):[]};});
 }
 function drawingLevels(rows,kind){
  const r=validate(rows);if(!r.length)return [];const hi=Math.max(...r.map(x=>x.high)),lo=Math.min(...r.map(x=>x.low)),range=hi-lo;
  if(kind==="fibonacci")return [0,.236,.382,.5,.618,.786,1].map(p=>({ratio:p,price:hi-range*p}));
  return [{kind:"support",price:lo},{kind:"resistance",price:hi}];
 }
 const api={version:"1.0.0",validate,heikinAshi,sma,ema,atr,rsi,bollinger,macd,stochastic,vwap,ichimoku,brickTransform,volumeProfile,normalizeCompare,drawingLevels};
 root.MMPChartEngine=api;
})(window);
