/* MMP Chart Pro: expanded candle modes, technical overlays and faster live refresh. */
(function(){
"use strict";
const $=id=>document.getElementById(id);\nconst getChartState=()=>typeof mmpChartState!=="undefined"?mmpChartState:null;
const state={mode:"standard",enabled:new Set(["ema9","sma20","vwap"]),macdChart:null,macdHist:null,macdLine:null,macdSignal:null,extraSeries:{},timer:null};
const css=`
.mmp-chart-pro{display:grid;gap:9px;margin:10px 0 12px;padding:11px;border:1px solid #34475b;border-radius:13px;background:linear-gradient(145deg,#101b29,#0a121d)}
.mmp-chart-pro-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.mmp-chart-pro-label{font-size:10px;color:#9eafc1;font-weight:800;margin-left:3px}
.mmp-chart-pro select,.mmp-chart-pro button{min-height:34px;border:1px solid #3b5065;border-radius:9px;background:#142234;color:#e5edf5;padding:6px 10px;font:700 11px Tahoma,Arial,sans-serif}
.mmp-chart-pro button.active{background:linear-gradient(135deg,#e9cc88,#a77c3d);color:#111923;border-color:#e9cc88}
.mmp-chart-pro select{color:#f2d99b}
#mmp-macd-canvas{height:125px;margin-top:8px;border:1px solid #304256;border-radius:11px;overflow:hidden;background:#0c1420}
.mmp-chart-pro-note{font-size:10px;color:#8fa1b4;line-height:1.7}
@media(max-width:560px){.mmp-chart-pro{padding:8px}.mmp-chart-pro button,.mmp-chart-pro select{font-size:10px;padding:6px 8px}}
`;
function inject(){
 const section=$("chart-section"),toolbar=section?.querySelector(".mmp-chart-toolbar");
 if(!section||!toolbar||$("mmp-chart-pro"))return;
 const style=document.createElement("style");style.textContent=css;document.head.appendChild(style);
 const panel=document.createElement("div");panel.id="mmp-chart-pro";panel.className="mmp-chart-pro";
 panel.innerHTML=`
 <div class="mmp-chart-pro-row"><span class="mmp-chart-pro-label">نوع کندل</span>
 <select id="mmp-chart-candle-mode" aria-label="نوع نمایش کندل"><option value="standard">کندل ژاپنی</option><option value="hollow">کندل توخالی</option><option value="heikin">Heikin Ashi</option></select>
 <span class="mmp-chart-pro-label">اندیکاتورهای بیشتر</span>
 <button type="button" data-pro-ind="ema9" class="active">EMA 9</button><button type="button" data-pro-ind="sma20">SMA 20</button><button type="button" data-pro-ind="sma50">SMA 50</button><button type="button" data-pro-ind="vwap" class="active">VWAP</button>
 </div>
 <div class="mmp-chart-pro-row"><button type="button" id="mmp-chart-macd-toggle">نمایش MACD</button><span class="mmp-chart-pro-note">اندیکاتورها از OHLCV دریافتی محاسبه می‌شوند؛ داده قدیمی به‌عنوان زنده علامت‌گذاری نمی‌شود.</span></div>
 <div id="mmp-macd-canvas" hidden></div>`;
 toolbar.insertAdjacentElement("afterend",panel);
 panel.querySelector("#mmp-chart-candle-mode").addEventListener("change",e=>{state.mode=e.target.value;window.mmpLoadChart?.(true);});
 panel.querySelectorAll("[data-pro-ind]").forEach(btn=>btn.addEventListener("click",()=>{const key=btn.dataset.proInd;state.enabled.has(key)?state.enabled.delete(key):state.enabled.add(key);btn.classList.toggle("active",state.enabled.has(key));renderExtras();}));
 $("mmp-chart-macd-toggle").addEventListener("click",toggleMacd);
}
function sma(rows,p){const out=[];for(let i=p-1;i<rows.length;i++){let sum=0;for(let j=i-p+1;j<=i;j++)sum+=rows[j].close;out.push({time:rows[i].time,value:sum/p});}return out;}
function ema(rows,p){const out=[];if(!rows.length)return out;const a=2/(p+1);let v=rows[0].close;rows.forEach((r,i)=>{v=i?v+a*(r.close-v):r.close;if(i>=p-1)out.push({time:r.time,value:v});});return out;}
function vwap(rows){let pv=0,vol=0,out=[];rows.forEach(r=>{const typical=(r.high+r.low+r.close)/3;pv+=typical*(r.volume||0);vol+=r.volume||0;if(vol>0)out.push({time:r.time,value:pv/vol});});return out;}
function ha(rows){let prevO=null,prevC=null;return rows.map(r=>{const close=(r.open+r.high+r.low+r.close)/4,open=prevO===null?(r.open+r.close)/2:(prevO+prevC)/2,high=Math.max(r.high,open,close),low=Math.min(r.low,open,close);prevO=open;prevC=close;return {...r,open,high,low,close};});}
function ensureSeries(){
 const st=getChartState();if(!st?.chart||!window.LightweightCharts)return;
 const defs={ema9:{color:"#f6b85e",lineWidth:2},sma20:{color:"#69c7ff",lineWidth:2},sma50:{color:"#d18cff",lineWidth:2},vwap:{color:"#f4e07a",lineWidth:2}};
 Object.entries(defs).forEach(([k,opt])=>{if(!state.extraSeries[k])state.extraSeries[k]=st.chart.addLineSeries({...opt,priceLineVisible:false,lastValueVisible:false});});
}
function renderExtras(){
 const st=getChartState(),cache=st?.cache?.get([window.mmpChartSymbol?.(),st?.interval,st?.market].join(":"));
 if(cache)window.mmpRenderChart?.(cache.payload);
}
function renderMacd(rows){
 if(!state.macdChart||!rows?.length)return;
 const fast=emaRaw(rows.map(x=>x.close),12),slow=emaRaw(rows.map(x=>x.close),26),line=rows.map((r,i)=>({time:r.time,value:fast[i]-slow[i]})).slice(25);
 const sig=emaPoints(line,9),sigMap=new Map(sig.map(x=>[x.time,x.value]));
 state.macdLine.setData(line);state.macdSignal.setData(sig);
 state.macdHist.setData(line.filter(x=>sigMap.has(x.time)).map(x=>({time:x.time,value:x.value-sigMap.get(x.time),color:x.value>=sigMap.get(x.time)?"rgba(32,201,151,.7)":"rgba(240,92,112,.7)"})));
}
function emaRaw(values,p){const a=2/(p+1);let v=values[0]||0;return values.map((x,i)=>{v=i?x*a+v*(1-a):x;return v;});}
function emaPoints(points,p){if(points.length<p)return[];const a=2/(p+1);let v=points.slice(0,p).reduce((s,x)=>s+x.value,0)/p;const out=[{time:points[p-1].time,value:v}];for(let i=p;i<points.length;i++){v=points[i].value*a+v*(1-a);out.push({time:points[i].time,value:v});}return out;}
function toggleMacd(){
 const host=$("mmp-macd-canvas"),btn=$("mmp-chart-macd-toggle");if(!host)return;
 const show=host.hidden;host.hidden=!show;btn.classList.toggle("active",show);btn.textContent=show?"پنهان‌کردن MACD":"نمایش MACD";
 if(show&&!state.macdChart&&window.LightweightCharts){const st=getChartState(),opts={width:host.clientWidth||600,height:125,layout:{background:{type:"solid",color:"#0c1420"},textColor:"#aebdca"},grid:{vertLines:{color:"#ffffff0d"},horzLines:{color:"#ffffff0d"}},rightPriceScale:{borderColor:"#ffffff22"},timeScale:{visible:false}};state.macdChart=LightweightCharts.createChart(host,opts);state.macdHist=state.macdChart.addHistogramSeries({priceLineVisible:false,lastValueVisible:false});state.macdLine=state.macdChart.addLineSeries({color:"#64b5ff",lineWidth:1,priceLineVisible:false,lastValueVisible:false});state.macdSignal=state.macdChart.addLineSeries({color:"#f1c66d",lineWidth:1,priceLineVisible:false,lastValueVisible:false});}
 if(show){const st=getChartState(),c=st?.cache?.get([window.mmpChartSymbol?.(),st?.interval,st?.market].join(":"));if(c)renderMacd(c.payload.candles);}
}
function wrapRenderer(){
 if(typeof window.mmpRenderChart!=="function"||window.mmpRenderChart.__proWrapped)return;
 const original=window.mmpRenderChart;
 function wrapped(payload){
  const rows=payload?.candles||[],mode=state.mode;
  const display=mode==="heikin"?ha(rows):rows;
  const next={...payload,candles:display};
  original(next);
  const st=getChartState();if(!st?.chart)return;
  ensureSeries();
  const defs={ema9:ema(rows,9),sma20:sma(rows,20),sma50:sma(rows,50),vwap:vwap(rows)};
  Object.entries(state.extraSeries).forEach(([key,series])=>series.setData(state.enabled.has(key)?defs[key]:[]));
  if(mode==="hollow")st.candles.applyOptions({upColor:"rgba(32,201,151,0.08)",downColor:"rgba(240,92,112,0.08)",borderUpColor:"#20c997",borderDownColor:"#f05c70",wickUpColor:"#20c997",wickDownColor:"#f05c70"});
  else st.candles.applyOptions({upColor:"#20c997",downColor:"#f05c70",borderUpColor:"#20c997",borderDownColor:"#f05c70",wickUpColor:"#20c997",wickDownColor:"#f05c70"});
  if(!$("mmp-macd-canvas")?.hidden)renderMacd(rows);
 }
 wrapped.__proWrapped=true;window.mmpRenderChart=wrapped;
}
function populateSymbols(){
 const select=$("tv-symbol");if(!select||select.dataset.proPopulated)return;
 const add=(symbol,name)=>{const value="BINANCE:"+symbol+"USDT";if([...select.options].some(o=>o.value===value))return;const o=document.createElement("option");o.value=value;o.textContent=name+" ("+symbol+")";select.appendChild(o);};
 const seed=["ETH","SOL","BNB","XRP","ADA","DOGE","TRX","LINK","AVAX","TON","DOT","LTC","BCH","NEAR","UNI","APT","ARB","OP","SUI","AAVE","ETC","FIL","ATOM","ICP","INJ","FET","RENDER","PEPE","SHIB"];
 seed.forEach(s=>add(s,s));
 select.dataset.proPopulated="1";
}
function liveRefresh(){
 if(document.hidden||!$("chart-section"))return;
 const st=getChartState(),interval=st?.interval||"1h",delay=interval==="1m"||interval==="3m"?18000:45000;
 if(!state.lastRefresh||Date.now()-state.lastRefresh>=delay){state.lastRefresh=Date.now();window.mmpLoadChart?.(true);}
}
function boot(){
 inject();populateSymbols();wrapRenderer();
 const timer=setInterval(()=>{wrapRenderer();populateSymbols();},500);
 setTimeout(()=>clearInterval(timer),15000);
 if(state.timer)clearInterval(state.timer);state.timer=setInterval(liveRefresh,5000);
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)liveRefresh();});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();