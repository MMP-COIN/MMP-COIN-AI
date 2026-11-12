(() => {
 "use strict";
 const MAIN="https://mmp-coin-ai-analyzer.mehrdadmohammadi1988.workers.dev";
 const RADAR="https://mmp-coin-ai-radar.mehrdadmohammadi1988.workers.dev";
 const $=id=>document.getElementById(id);
 async function get(url,timeout=9000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{const response=await fetch(url,{signal:controller.signal,cache:"no-store",headers:{Accept:"application/json"}});if(!response.ok)throw new Error("HTTP "+response.status);return await response.json();}
  finally{clearTimeout(timer);}
 }
 function money(v){const n=Number(v);return Number.isFinite(n)&&n>0?n.toLocaleString("en-US",{maximumFractionDigits:n>100?2:4}):"—";}
 async function loadTicker(){
  const symbols=["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT"];
  const sources=["binance-tickers","okx-tickers","bybit-tickers","gate-tickers","kucoin-tickers","bitget-tickers","mexc-tickers"];
  const normalize=(source,data)=>{
   let rows=[];
   if(source==="binance-tickers"||source==="gate-tickers"||source==="mexc-tickers")rows=Array.isArray(data)?data.map(x=>[x.symbol||x.currency_pair,x.lastPrice||x.last||x.close]):[];
   else if(source==="okx-tickers")rows=(data.data||[]).map(x=>[x.instId,x.last]);
   else if(source==="bybit-tickers")rows=(data.result?.list||[]).map(x=>[x.symbol,x.lastPrice]);
   else if(source==="kucoin-tickers")rows=(data.data?.ticker||[]).map(x=>[x.symbol,x.last]);
   else if(source==="bitget-tickers")rows=(data.data||[]).map(x=>[x.symbol,x.lastPr||x.last]);
   return rows.map(([symbol,price])=>[String(symbol||"").toUpperCase().replace(/[^A-Z0-9]/g,""),Number(price)]);
  };
  const settled=await Promise.allSettled(sources.map(async source=>({source,data:await get(MAIN+"/market-proxy?source="+source)})));
  const quotes=Object.fromEntries(symbols.map(s=>[s,[]]));
  const failures=[];
  for(let i=0;i<settled.length;i++){
   const item=settled[i];
   if(item.status!=="fulfilled"){failures.push(sources[i]);continue;}
   const {source,data}=item.value;
   for(const [symbol,price] of normalize(source,data)){
    if(quotes[symbol]&&Number.isFinite(price)&&price>0)quotes[symbol].push({source:source.replace("-tickers","").toUpperCase(),price});
   }
  }
  const rows=symbols.map(symbol=>{
   const q=quotes[symbol].sort((a,b)=>a.price-b.price);
   if(!q.length)return {symbol,state:"missing"};
   const median=q.length%2?q[(q.length-1)/2].price:(q[q.length/2-1].price+q[q.length/2].price)/2;
   const spread=median>0?(q[q.length-1].price-q[0].price)/median*100:Infinity;
   if(q.length>=2&&spread>1.5)return {symbol,state:"conflict",count:q.length,spread};
   const selected=q.length>=2?median:q[0].price;
   return {symbol,state:q.length>=2?"corroborated":"single",price:selected,count:q.length,spread,sources:q.map(x=>x.source)};
  });
  $("ticker").innerHTML=rows.map(x=>{
   const label=x.symbol.replace("USDT"," / USDT");
   const value=x.state==="missing"?"داده در دسترس نیست":x.state==="conflict"?"اختلاف منابع — مخفی شد":money(x.price);
   const provenance=x.state==="corroborated"?"تطبیق "+x.count+" منبع":x.state==="single"?"تک‌منبع؛ تأییدنشده":x.state==="conflict"?"اختلاف "+x.spread.toFixed(2)+"٪":"بدون منبع معتبر";
   return '<div class="ticker-item"><small>'+label+' · '+provenance+'</small><b>'+value+'</b></div>';
  }).join("");
  const verified=rows.filter(x=>x.state==="corroborated").length;
  const single=rows.filter(x=>x.state==="single").length;
  const conflicts=rows.filter(x=>x.state==="conflict").length;
  const integrity=$("tickerIntegrity");
  if(integrity){
   integrity.textContent=verified===symbols.length
    ?"اعتبارسنجی موفق: هر چهار دارایی با حداقل دو منبع مستقل تطبیق داده شدند."
    :[verified+" دارایی با چند منبع تطبیق‌شده",single+" دارایی تک‌منبعی و تأییدنشده",conflicts+" دارایی دارای اختلاف منابع",failures.length+" منبع بی‌پاسخ"].join(" · ");
   integrity.classList.toggle("integrity-good",verified===symbols.length);
   integrity.classList.toggle("integrity-warning",verified!==symbols.length);
  }
  if(verified!==symbols.length)console.warn("MMP ticker integrity incomplete",{rows,failures});
 }
 function empty(el,title,detail){el.innerHTML='<div class="empty-state"><b>'+title+'</b><small>'+detail+'</small></div>';}
 function parseTimestamp(value){
  if(value===undefined||value===null||value==="")return NaN;
  if(typeof value==="number")return value<1e12?value*1000:value;
  const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:NaN;
 }
 function escapeHTML(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
 }
 function renderSignals(el,signals,scannedAt,maxAgeMs=15*60*1000){
  const scanTime=parseTimestamp(scannedAt),now=Date.now(),age=now-scanTime;
  if(!Number.isFinite(scanTime)||age< -2*60*1000||age>maxAgeMs){
   empty(el,"سیگنال قابل‌تأیید در دسترس نیست",!Number.isFinite(scanTime)?"زمان اسکن معتبر ارائه نشده است.":"داده اسکن قدیمی یا دارای اختلاف ساعت است؛ برای جلوگیری از گمراهی پنهان شد.");
   return;
  }
  if(!Array.isArray(signals)||!signals.length){empty(el,"در حال حاضر سیگنال معتبری دریافت نشده","هیچ سیگنال ساختگی یا داده بدون زمان معتبر نمایش داده نمی‌شود.");return;}
  const valid=signals.filter(x=>{
   const symbol=String(x.symbol||x.asset||x.pair||"").trim();
   return /^[A-Za-z0-9._:/-]{2,32}$/.test(symbol);
  });
  if(!valid.length){empty(el,"سیگنال قابل‌تأیید وجود ندارد","ساختار داده دریافتی برای نمایش معتبر نیست.");return;}
  el.innerHTML=valid.slice(0,30).map(x=>{
   const symbol=escapeHTML(x.symbol||x.asset||x.pair);
   const score=Number(x.score??x.quantum?.score);
   const change=Number(x.change24h??x.price_change_percentage_24h);
   const exchange=escapeHTML(x.exchange||x.provider||x.source||"منبع نامشخص");
   return '<div class="signal-row"><span><b>'+symbol+'</b><br><small>'+exchange+(Number.isFinite(change)?' · '+change.toFixed(2)+'%':'')+'</small></span><span class="signal-score">'+(Number.isFinite(score)&&score>=0&&score<=100?Math.round(score)+"/100":"امتیاز تأییدنشده")+'</span><small>اسکن: '+new Date(scanTime).toLocaleTimeString("fa-IR")+'</small></div>';
  }).join("");
 }
 async function loadRadar(){
  const el=$("radarList");$("radarMeta").textContent="در حال دریافت…";
  try{
   const d=await get(RADAR+"/fast-radar-snapshot");
   const signals=d.signals||d.snapshot?.signals||[];
   $("radarMeta").textContent=(d.scanned_at||d.updated_at||"وضعیت: "+(d.status||"نامشخص"));
   renderSignals(el,signals,d.scanned_at||d.updated_at||d.snapshot?.scanned_at,10*60*1000);
  }catch(e){$("radarMeta").textContent="اتصال ناموفق";el.innerHTML='<div class="signal-error">دریافت داده رادار ناموفق بود؛ لطفاً بعداً دوباره تلاش کنید.</div>';}
 }
 async function loadHunter(){
  $("spotMeta").textContent="در حال دریافت…";$("futuresMeta").textContent="در حال دریافت…";
  try{
   const d=await get(MAIN+"/hunter-combined-snapshot");
   const spot=d.spot?.snapshot||d.spot||{},futures=d.futures?.snapshot||d.futures||{};
   $("spotMeta").textContent=(spot.status||"نامشخص")+" · "+(spot.scanned_count??0)+" اسکن";
   $("futuresMeta").textContent=(futures.status||"نامشخص")+" · "+(futures.scanned_count??0)+" اسکن";
   renderSignals($("spotList"),spot.signals||[],spot.scanned_at||d.scanned_at,15*60*1000);
   renderSignals($("futuresList"),futures.signals||[],futures.scanned_at||d.scanned_at,15*60*1000);
  }catch(e){
   $("spotMeta").textContent="اتصال ناموفق";$("futuresMeta").textContent="اتصال ناموفق";
   $("spotList").innerHTML='<div class="signal-error">سرویس Spot پاسخ نداد.</div>';
   $("futuresList").innerHTML='<div class="signal-error">سرویس Futures پاسخ نداد.</div>';
  }
 }
 async function loadHealth(){
  try{
   const d=await get(MAIN+"/connections-health");
   const checks=Array.isArray(d.checks)?d.checks:[],up=checks.filter(x=>x.status==="ok"||x.status==="slow").length,total=checks.length;
   $("coreStatus").textContent=total?up+" از "+total+" اتصال سالم":"پاسخ ناقص";
   const engineStatus=$("engineStatus");if(engineStatus)engineStatus.textContent="وضعیت اتصال داده‌ها: "+(total?up+" از "+total+" اتصال سالم":"پاسخ ناقص");
   $("coreUpdated").textContent=d.checked_at?new Date(d.checked_at).toLocaleTimeString("fa-IR"):"—";
   const live=$("serviceStatus");
   if(live){live.textContent=total?up+"/"+total+" اتصال سالم":"پاسخ ناقص";live.classList.remove("pending","healthy","partial","down");live.classList.add(up===total&&total>0?"healthy":up>0?"partial":"down");}
  }catch(e){
   $("coreStatus").textContent="عدم دریافت پاسخ";$("coreUpdated").textContent="اتصال بررسی نشد";
   const engineStatus=$("engineStatus");if(engineStatus)engineStatus.textContent="وضعیت اتصال داده‌ها: بررسی ناموفق";
   const live=$("serviceStatus");if(live){live.textContent="عدم دریافت پاسخ";live.classList.remove("pending","healthy","partial");live.classList.add("down");}
  }
 }
 async function refresh(which){
  if(which==="radar")return loadRadar();
  if(which==="hunter")return loadHunter();
  return Promise.allSettled([loadTicker(),loadRadar(),loadHunter(),loadHealth()]);
 }
 document.querySelectorAll("[data-refresh]").forEach(b=>b.addEventListener("click",()=>refresh(b.dataset.refresh)));
 $("refreshAll").addEventListener("click",()=>refresh("all"));
 $("menuToggle").addEventListener("click",()=>document.querySelector(".desktop-nav").classList.toggle("open"));
 document.querySelectorAll(".desktop-nav a").forEach(a=>a.addEventListener("click",()=>document.querySelector(".desktop-nav").classList.remove("open")));
 refresh("all");
 setInterval(()=>Promise.allSettled([loadTicker(),loadRadar(),loadHunter(),loadHealth()]),60000);
})();