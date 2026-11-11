(() => {
 "use strict";
 const MAIN="https://mmp-coin-ai-analyzer.mehrdadmohammadi1988.workers.dev";
 const RADAR="https://mmp-coin-ai-radar.mehrdadmohammadi1988.workers.dev";
 const $=id=>document.getElementById(id);
 const engines=[
  ["01","Market Intelligence","هوشمندی کلی بازار"],["02","Explosive Move Prediction","پیش‌بینی فشار حرکت"],["03","Early Opportunity Hunter","کشف زودهنگام فرصت"],["04","Smart Money Flow","جریان پول هوشمند"],["05","Liquidity Hunter","شکار نواحی نقدینگی"],["06","Multi-timeframe Alignment","هم‌جهتی تایم‌فریم‌ها"],["07","Volatility Intelligence","هوشمندی نوسان"],["08","Market Sentiment","احساسات بازار"],["09","Scenario Simulator","شبیه‌ساز سناریو"],["10","Adaptive Learning","یادگیری تطبیقی"],["11","Structure Intelligence","تحلیل ساختار قیمت"],["12","Risk Intelligence","ارزیابی ریسک"]
 ];
 $("engineGrid").innerHTML=engines.map(([n,name,fa])=>'<article class="engine-item"><span class="engine-number">'+n+'</span><span><b>'+name+'</b><small>'+fa+'</small></span></article>').join("");
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
   return rows.map(([symbol,price])=>[String(symbol||"").toUpperCase().split("-").join("").split("_").join("").split("/").join(""),Number(price)]);
  };
  const prices={},providers={},failures=[];
  for(const source of sources){
   const missing=symbols.filter(s=>!Number.isFinite(prices[s])||prices[s]<=0);
   if(!missing.length)break;
   try{
    const data=await get(MAIN+"/market-proxy?source="+source);
    for(const [symbol,price] of normalize(source,data)){
     if(missing.includes(symbol)&&Number.isFinite(price)&&price>0){prices[symbol]=price;providers[symbol]=source.replace("-tickers","").toUpperCase();}
    }
   }catch(error){failures.push(source+": "+String(error?.message||error));}
  }
  const available=symbols.filter(s=>Number.isFinite(prices[s])&&prices[s]>0);
  $("ticker").innerHTML=symbols.map(s=>{
   const name=s.replace("USDT"," / USDT");
   return '<div class="ticker-item"><small>'+name+' · '+(providers[s]||"بدون منبع")+'</small><b>'+(prices[s]?money(prices[s]):"داده در دسترس نیست")+'</b></div>';
  }).join("");
  if(available.length!==symbols.length)console.warn("MMP ticker incomplete",{available,failures});
 }
 function empty(el,title,detail){el.innerHTML='<div class="empty-state"><b>'+title+'</b><small>'+detail+'</small></div>';}
 function renderSignals(el,signals){
  if(!Array.isArray(signals)||!signals.length){empty(el,"در حال حاضر سیگنال داده دریافتی‌ای وجود ندارد","رادار فقط فرصت‌های واقعی و دریافت‌شده از موتور را نشان می‌دهد.");return;}
  el.innerHTML=signals.slice(0,30).map(x=>{
   const symbol=String(x.symbol||x.asset||x.pair||"نامشخص").replace(/[<>]/g,"");
   const score=Number(x.score??x.quantum?.score);
   const change=Number(x.change24h??x.price_change_percentage_24h);
   const exchange=String(x.exchange||x.provider||x.source||"چندصرافی").replace(/[<>]/g,"");
   return '<div class="signal-row"><span><b>'+symbol+'</b><br><small>'+exchange+(Number.isFinite(change)?' · '+change.toFixed(2)+'%':'')+'</small></span><span class="signal-score">'+(Number.isFinite(score)?Math.round(score)+'/100':'داده دریافتی')+'</span><small>داده دریافتی</small></div>';
  }).join("");
 }
 async function loadRadar(){
  const el=$("radarList");$("radarMeta").textContent="در حال دریافت…";
  try{
   const d=await get(RADAR+"/fast-radar-snapshot");
   const signals=d.signals||d.snapshot?.signals||[];
   $("radarMeta").textContent=(d.scanned_at||d.updated_at||"وضعیت: "+(d.status||"نامشخص"));
   renderSignals(el,signals);
  }catch(e){$("radarMeta").textContent="اتصال ناموفق";el.innerHTML='<div class="signal-error">دریافت داده رادار ناموفق بود؛ لطفاً بعداً دوباره تلاش کنید.</div>';}
 }
 async function loadHunter(){
  $("spotMeta").textContent="در حال دریافت…";$("futuresMeta").textContent="در حال دریافت…";
  try{
   const d=await get(MAIN+"/hunter-combined-snapshot");
   const spot=d.spot?.snapshot||d.spot||{},futures=d.futures?.snapshot||d.futures||{};
   $("spotMeta").textContent=(spot.status||"نامشخص")+" · "+(spot.scanned_count??0)+" اسکن";
   $("futuresMeta").textContent=(futures.status||"نامشخص")+" · "+(futures.scanned_count??0)+" اسکن";
   renderSignals($("spotList"),spot.signals||[]);
   renderSignals($("futuresList"),futures.signals||[]);
  }catch(e){
   $("spotMeta").textContent="اتصال ناموفق";$("futuresMeta").textContent="اتصال ناموفق";
   $("spotList").innerHTML='<div class="signal-error">سرویس Spot پاسخ نداد.</div>';
   $("futuresList").innerHTML='<div class="signal-error">سرویس Futures پاسخ نداد.</div>';
  }
 }
 async function loadHealth(){
  try{
   const d=await get(MAIN+"/connections-health");
   const checks=Array.isArray(d.checks)?d.checks:[],up=checks.filter(x=>x.status==="ok"||x.status==="slow").length;
   $("coreStatus").textContent=checks.length?up+" از "+checks.length+" اتصال سالم":"پاسخ ناقص";
   $("coreUpdated").textContent=d.checked_at?new Date(d.checked_at).toLocaleTimeString("fa-IR"):"—";
   const live=document.getElementById("serviceStatus");if(live)live.textContent=up?"سرویس‌ها بررسی شدند":"اختلال اتصال";
  }catch(e){$("coreStatus").textContent="عدم دریافت پاسخ";$("coreUpdated").textContent="اتصال بررسی نشد";const live=document.getElementById("serviceStatus");if(live)live.textContent="عدم دریافت پاسخ";}
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