/* MMP Pro Chart extension: deterministic client-side indicators on validated Worker candles. */
(function(){
"use strict";
const state=mmpChartState;
const defaults={sma:true,bollinger:false,vwap:false,supertrend:false,ichimoku:false,rsi:true,macd:false};
state.proIndicators=Object.assign({},defaults,state.proIndicators||{});
state.chartType=state.chartType||"candles";
const originalCreate=window.mmpCreateNativeChart;
const originalRender=window.mmpRenderChart;
const lineOpts=(color,width=1)=>({color,lineWidth:width,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
const ema=(rows,n)=>{let v=null,a=2/(n+1);return rows.map((r,i)=>{v=v===null?r.close:r.close*a+v*(1-a);return i>=n-1?{time:r.time,value:v}:null;}).filter(Boolean);};
const sma=(rows,n,fn=r=>r.close)=>rows.map((r,i)=>i>=n-1?{time:r.time,value:rows.slice(i-n+1,i+1).reduce((a,x)=>a+fn(x),0)/n}:null).filter(Boolean);
function bollinger(rows,n=20,m=2){return rows.map((r,i)=>{if(i<n-1)return null;const a=rows.slice(i-n+1,i+1).map(x=>x.close),mean=a.reduce((x,y)=>x+y,0)/n,sd=Math.sqrt(a.reduce((x,y)=>x+(y-mean)**2,0)/n);return {time:r.time,mid:mean,upper:mean+m*sd,lower:mean-m*sd};}).filter(Boolean);}
function vwap(rows){let pv=0,vol=0;return rows.map(r=>{const typical=(r.high+r.low+r.close)/3;pv+=typical*r.volume;vol+=r.volume;return {time:r.time,value:vol?pv/vol:r.close};});}
function atr(rows,n=10){let prev=null,vals=[];for(let i=0;i<rows.length;i++){const r=rows[i],tr=prev===null?r.high-r.low:Math.max(r.high-r.low,Math.abs(r.high-prev),Math.abs(r.low-prev));vals.push(tr);prev=r.close;}return vals.map((v,i)=>i>=n-1?{time:rows[i].time,value:vals.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n}:null).filter(Boolean);}
function supertrend(rows,n=10,m=3){const a=atr(rows,n),byTime=new Map(a.map(x=>[x.time,x.value]));let trend=1,prev=null;return rows.map(r=>{const av=byTime.get(r.time);if(!av)return null;const mid=(r.high+r.low)/2,upper=mid+m*av,lower=mid-m*av;if(prev!==null){if(r.close>prev.upper)trend=1;else if(r.close<prev.lower)trend=-1;}const point={time:r.time,value:trend===1?lower:upper};prev={upper,lower};return point;}).filter(Boolean);}
function ichimoku(rows){const mid=(i,n)=>{const a=rows.slice(Math.max(0,i-n+1),i+1);return (Math.max(...a.map(x=>x.high))+Math.min(...a.map(x=>x.low)))/2;};return rows.map((r,i)=>({time:r.time,tenkan:mid(i,9),kijun:mid(i,26)})).filter((x,i)=>i>=25);}
function macd(rows){const a=ema(rows,12),b=ema(rows,26),bm=new Map(b.map(x=>[x.time,x.value]));const m=a.filter(x=>bm.has(x.time)).map(x=>({time:x.time,value:x.value-bm.get(x.time)}));let v=null;const alpha=2/10;const signal=m.map(x=>{v=v===null?x.value:x.value*alpha+v*(1-alpha);return {time:x.time,value:v};});const sm=new Map(signal.map(x=>[x.time,x.value]));return {line:m,signal,hist:m.map(x=>({time:x.time,value:x.value-(sm.get(x.time)||0)}))};}
function rsiLast(rows,n=14){let g=0,l=0;if(rows.length<=n)return null;for(let i=1;i<=n;i++){const d=rows[i].close-rows[i-1].close;g+=Math.max(0,d);l+=Math.max(0,-d);}g/=n;l/=n;for(let i=n+1;i<rows.length;i++){const d=rows[i].close-rows[i-1].close;g=(g*(n-1)+Math.max(0,d))/n;l=(l*(n-1)+Math.max(0,-d))/n;}return l===0?100:100-100/(1+g/l);}
function mfiLast(rows,n=14){if(rows.length<=n)return null;let pos=0,neg=0;for(let i=rows.length-n;i<rows.length;i++){const a=rows[i-1],b=rows[i],tp=(b.high+b.low+b.close)/3,prev=(a.high+a.low+a.close)/3,m=tp*b.volume;if(tp>prev)pos+=m;else if(tp<prev)neg+=m;}return neg===0?100:100-100/(1+pos/neg);}
function obvLast(rows){let v=0;for(let i=1;i<rows.length;i++)v+=rows[i].close>rows[i-1].close?rows[i].volume:rows[i].close<rows[i-1].close?-rows[i].volume:0;return v;}
function heikin(rows){let po=null,pc=null;return rows.map(r=>{const c=(r.open+r.high+r.low+r.close)/4,o=po===null?(r.open+r.close)/2:(po+pc)/2;po=o;pc=c;return {time:r.time,open:o,high:Math.max(r.high,o,c),low:Math.min(r.low,o,c),close:c};});}
function ensureSeries(){
 const st=state,c=st.chart;if(!c||st.proSeries)return;
 st.proSeries={
  sma20:c.addLineSeries(lineOpts("#f0c674",1)),sma50:c.addLineSeries(lineOpts("#8ac6ff",1)),
  bbU:c.addLineSeries(lineOpts("rgba(130,160,220,.8)",1)),bbM:c.addLineSeries(lineOpts("rgba(130,160,220,.45)",1)),bbL:c.addLineSeries(lineOpts("rgba(130,160,220,.8)",1)),
  vwap:c.addLineSeries(lineOpts("#e68bd1",2)),supertrend:c.addLineSeries(lineOpts("#37d6a0",2)),
  tenkan:c.addLineSeries(lineOpts("#ff9f6e",1)),kijun:c.addLineSeries(lineOpts("#7db6ff",1)),
  line:c.addLineSeries(lineOpts("#f4d27e",2))
 };
 const host=document.getElementById("tradingview_widget"),macdEl=document.createElement("div");macdEl.id="mmp-macd-canvas";host.appendChild(macdEl);
 const common={layout:{background:{type:"solid",color:"#0c1420"},textColor:"#aebdca",fontFamily:"Tahoma,Arial,sans-serif",fontSize:10},grid:{vertLines:{color:"rgba(120,145,165,.08)"},horzLines:{color:"rgba(120,145,165,.08)"}},rightPriceScale:{borderColor:"rgba(145,165,185,.18)"},timeScale:{visible:false},crosshair:{mode:1}};
 const mc=LightweightCharts.createChart(macdEl,{...common,width:macdEl.clientWidth||600,height:118});
 const hist=mc.addHistogramSeries({priceLineVisible:false,lastValueVisible:false,priceScaleId:"",base:0});
 const ml=mc.addLineSeries(lineOpts("#67b7ff",2)),ms=mc.addLineSeries(lineOpts("#f2c66d",1));
 st.proMacd={chart:mc,hist,line:ml,signal:ms,el:macdEl};
 const resize=()=>{const w=macdEl.clientWidth||host.clientWidth||600;mc.applyOptions({width:w});};
 if(window.ResizeObserver){st.proResize=new ResizeObserver(resize);st.proResize.observe(host);}
}
window.mmpCreateNativeChart=function(){const ok=originalCreate();if(ok)ensureSeries();return ok;};
window.mmpRenderChart=function(payload){
 originalRender(payload);ensureSeries();
 const rows=payload.candles||[],st=state;if(!rows.length||!st.proSeries)return;
 const s=st.proSeries,on=st.proIndicators||defaults;
 const set=(series,data,visible)=>{series.setData(visible?data:[]);};
 set(s.sma20,sma(rows,20),on.sma);set(s.sma50,sma(rows,50),on.sma);
 const bb=bollinger(rows);set(s.bbU,bb.map(x=>({time:x.time,value:x.upper})),on.bollinger);set(s.bbM,bb.map(x=>({time:x.time,value:x.mid})),on.bollinger);set(s.bbL,bb.map(x=>({time:x.time,value:x.lower})),on.bollinger);
 set(s.vwap,vwap(rows),on.vwap);set(s.supertrend,supertrend(rows),on.supertrend);
 const ichi=ichimoku(rows);set(s.tenkan,ichi.map(x=>({time:x.time,value:x.tenkan})),on.ichimoku);set(s.kijun,ichi.map(x=>({time:x.time,value:x.kijun})),on.ichimoku);
 const lineData=rows.map(x=>({time:x.time,value:x.close}));set(s.line,lineData,st.chartType==="line");
 if(st.chartType==="line"){st.candles.applyOptions({visible:false});}else{st.candles.applyOptions({visible:true});if(st.chartType==="heikin")st.candles.setData(heikin(rows));}
 if(st.proMacd){const m=macd(rows),last=rows[rows.length-1];st.proMacd.hist.setData(on.macd?m.hist.map(x=>({time:x.time,value:x.value,color:x.value>=0?"rgba(32,201,151,.55)":"rgba(240,92,112,.55)"})):[]);st.proMacd.line.setData(on.macd?m.line:[]);st.proMacd.signal.setData(on.macd?m.signal:[]);st.proMacd.el.style.display=on.macd?"block":"none";if(on.macd)st.proMacd.chart.timeScale().fitContent();}
 const rsiEl=document.getElementById("mmp-rsi-canvas");if(rsiEl)rsiEl.style.display=on.rsi?"block":"none";
 const metrics=document.getElementById("mmp-chart-metrics"),a=atr(rows),av=a.length?a[a.length-1].value:null,rl=rsiLast(rows),mf=mfiLast(rows),ob=obvLast(rows);
 if(metrics)metrics.innerHTML=[["RSI",rl===null?"—":rl.toFixed(1)],["ATR",av===null?"—":av.toPrecision(5)],["MFI",mf===null?"—":mf.toFixed(1)],["OBV",Number.isFinite(ob)?Math.round(ob).toLocaleString("en-US"):"—"]].map(x=>"<span>"+x[0]+" <b>"+x[1]+"</b></span>").join("");
 document.querySelectorAll("[data-mmp-indicator]").forEach(b=>b.classList.toggle("active",!!on[b.dataset.mmpIndicator]));
 const typeBtn=document.getElementById("mmp-chart-type-toggle");if(typeBtn)typeBtn.textContent=st.chartType==="candles"?"کندلی":st.chartType==="heikin"?"هیکن‌آشی":"خطی";
};
window.mmpToggleChartIndicator=function(key){if(!(key in defaults))return;state.proIndicators[key]=!state.proIndicators[key];const c=state.cache.get([mmpChartSymbol(),state.interval,state.market].join(":"));if(c)window.mmpRenderChart(c.payload);else mmpLoadChart(false);};
window.mmpToggleChartType=function(){state.chartType=state.chartType==="candles"?"heikin":state.chartType==="heikin"?"line":"candles";const c=state.cache.get([mmpChartSymbol(),state.interval,state.market].join(":"));if(c)window.mmpRenderChart(c.payload);else mmpLoadChart(false);};
const oldInterval=window.mmpSetChartInterval;
window.mmpSetChartInterval=function(value){if(value==="3m"){state.interval="3m";mmpLoadChart(true);return;}oldInterval(value);};
const oldInit=window.initTradingView;
window.initTradingView=function(){oldInit();if(state.refreshTimer){clearInterval(state.refreshTimer);state.refreshTimer=setInterval(()=>{const el=document.getElementById("chart-section");if(!document.hidden&&el&&el.getBoundingClientRect().top<window.innerHeight+600)mmpLoadChart(false);},30000);}};
})();
