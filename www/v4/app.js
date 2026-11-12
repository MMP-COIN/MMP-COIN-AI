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
 let currentTetherPrice=0,currentTetherSources=[],currentTetherWarning="",currentTetherUpdatedAt=0;
 let selectedCurrency="IRT",latestTickerRows=[],latestTickerFailures=[];
 try{
  const saved=JSON.parse(localStorage.getItem("mmp_tether_cache_v1")||"null");
  if(saved&&Number(saved.price)>0&&Date.now()-Number(saved.updatedAt)<15*60*1000){
   currentTetherPrice=Number(saved.price);
   currentTetherSources=Array.isArray(saved.sources)?saved.sources:[];
   currentTetherUpdatedAt=Number(saved.updatedAt);
   currentTetherWarning="آخرین نرخ معتبر ذخیره‌شده";
  }
 }catch(e){}
 async function fetchTetherRate(){
  const localPromise=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   try{
    const response=await fetch(MAIN+"/local-market-watch",{cache:"no-store",signal:controller.signal,headers:{Accept:"application/json"}});
    if(!response.ok)throw new Error("HTTP "+response.status);
    const data=await response.json();
    const sources=Array.isArray(data?.sources)?data.sources.filter(x=>x?.fresh===true&&Number(x.price_toman)>0).map(x=>String(x.exchange||"")).filter(Boolean):[];
    const price=Number(data?.median_toman);
    if(Number.isFinite(price)&&price>=1000&&price<=100000000&&sources.length)return {price,sources,warning:String(data.warning||"")};
   }catch(error){console.warn("Local market monitor unavailable:",error?.message||error);}
   finally{clearTimeout(timer);}
   return null;
  })();
  const fallbackPromise=(async()=>{
   const requests=[
    {source:"Nobitex",url:MAIN+"/market-proxy?source=nobitex-tether",read:d=>Number(d?.stats?.["usdt-rls"]?.latest)/10},
    {source:"Wallex",url:MAIN+"/market-proxy?source=wallex-markets",read:d=>{
     const raw=d?.result?.symbols||d?.result?.markets||{};
     const markets=Array.isArray(raw)?raw:Object.values(raw);
     const tomanMarket=markets.find(m=>String(m?.symbol||"").toUpperCase()==="USDTTMN");
     const rialMarket=markets.find(m=>String(m?.symbol||"").toUpperCase()==="USDTIRT");
     const toman=Number(tomanMarket?.stats?.lastPrice??tomanMarket?.lastPrice);
     const rial=Number(rialMarket?.stats?.lastPrice??rialMarket?.lastPrice);
     return toman>0?toman:rial/10;
    }}
   ];
   const results=await Promise.all(requests.map(async item=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
    try{
     const response=await fetch(item.url,{cache:"no-store",signal:controller.signal});
     if(!response.ok)throw new Error("HTTP "+response.status);
     const data=await response.json(),price=item.read(data);
     if(!Number.isFinite(price)||price<1000||price>100000000)throw new Error("invalid rate");
     return {source:item.source,price};
    }catch(error){return null;}
    finally{clearTimeout(timer);}
   }));
   const valid=results.filter(Boolean);
   if(!valid.length)return {price:0,sources:[],warning:"نرخ تتر موقتاً از منابع داخلی دریافت نشد"};
   if(valid.length===1)return {price:valid[0].price,sources:[valid[0].source],warning:"فقط یک منبع نرخ تتر پاسخ داد"};
   const a=valid[0],b=valid[1],diff=Math.abs(a.price-b.price)/((a.price+b.price)/2);
   if(diff>0.03)return {price:a.price,sources:[a.source],warning:"اختلاف بیش از ۳٪ میان منابع؛ نرخ منبع اصلی نمایش داده شد"};
   return {price:(a.price+b.price)/2,sources:valid.map(x=>x.source),warning:""};
  })();
  const [local,fallback]=await Promise.all([localPromise,fallbackPromise]);
  if(local&&local.sources.length>=(fallback?.sources?.length||0))return local;
  return fallback?.price>0?fallback:local||{price:0,sources:[],warning:"نرخ تتر موقتاً از منابع داخلی دریافت نشد"};
 }
 function renderTicker(rows=latestTickerRows,failures=latestTickerFailures){
  $("ticker").innerHTML=rows.map(x=>{
   const label=x.symbol.replace("USDT"," / USDT");
   const rawValue=x.state==="missing"||x.state==="conflict"?"—":selectedCurrency==="IRT"?(currentTetherPrice>0?Math.round(x.price*currentTetherPrice).toLocaleString("en-US")+" تومان":"— تومان"):money(x.price)+" USDT";
   const value=x.state==="missing"?"داده در دسترس نیست":x.state==="conflict"?"اختلاف منابع — مخفی شد":rawValue;
   const provenance=x.state==="corroborated"?"تطبیق "+x.count+" منبع":x.state==="single"?"تک‌منبع؛ تأییدنشده":x.state==="conflict"?"اختلاف "+x.spread.toFixed(2)+"٪":"بدون منبع معتبر";
   return '<div class="ticker-item"><small>'+label+' · '+provenance+'</small><b>'+value+'</b></div>';
  }).join("");
  const verified=rows.filter(x=>x.state==="corroborated").length;
  const single=rows.filter(x=>x.state==="single").length;
  const conflicts=rows.filter(x=>x.state==="conflict").length;
  const integrity=$("tickerIntegrity");
  if(integrity){
   const currencyNote=selectedCurrency==="IRT"?(currentTetherPrice>0?"نرخ تتر: "+money(currentTetherPrice)+" تومان · "+(currentTetherSources.join(" + ")||"منبع معتبر")+(currentTetherWarning?" · "+currentTetherWarning:""):"نرخ تتر در دسترس نیست؛ قیمت تومانی پنهان است"):"واحد نمایش: USDT";
   integrity.textContent=[verified+" دارایی چندمنبعی",single+" تک‌منبعی",conflicts+" دارای اختلاف",failures.length+" منبع بی‌پاسخ",currencyNote].join(" · ");
   integrity.classList.toggle("integrity-good",verified===rows.length&&currentTetherPrice>0);
   integrity.classList.toggle("integrity-warning",verified!==rows.length||currentTetherPrice<=0);
  }
 }
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
  const [settled,tether]=await Promise.all([
   Promise.allSettled(sources.map(async source=>({source,data:await get(MAIN+"/market-proxy?source="+source)}))),
   fetchTetherRate()
  ]);
  if(tether?.price>0){
   currentTetherPrice=tether.price;currentTetherSources=tether.sources||[];currentTetherWarning=tether.warning||"";currentTetherUpdatedAt=Date.now();
   try{localStorage.setItem("mmp_tether_cache_v1",JSON.stringify({price:currentTetherPrice,sources:currentTetherSources,updatedAt:currentTetherUpdatedAt}));}catch(e){}
  }else if(!(currentTetherPrice>0&&currentTetherUpdatedAt&&Date.now()-currentTetherUpdatedAt<15*60*1000)){
   currentTetherPrice=0;currentTetherSources=[];currentTetherWarning=tether?.warning||"نرخ تتر در دسترس نیست";currentTetherUpdatedAt=0;
  }else currentTetherWarning="اتصال موقتاً ناپایدار؛ آخرین نرخ معتبر نمایش داده می‌شود";
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
  latestTickerRows=rows;latestTickerFailures=failures;renderTicker();
  const verified=rows.filter(x=>x.state==="corroborated").length;
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
 let analysisBusy=false,lastAnalysis=null;
 const analysisCache=new Map();
 const analysisCacheTtl=3*60*1000;
 function analysisPrice(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return "—";
  return selectedCurrency==="IRT"&&currentTetherPrice>0?Math.round(n*currentTetherPrice).toLocaleString("en-US")+" تومان":money(n)+" USDT";
 }
 function analysisLevel(value){
  if(value===null||value===undefined)return "—";
  if(typeof value==="object")return (value.low!=null?analysisPrice(value.low):"—")+" تا "+(value.high!=null?analysisPrice(value.high):"—");
  return analysisPrice(value);
 }
 function renderAnalysis(payload){
  const r=payload?.analysis||{},market=payload?.market||{},frames=market.timeframes||{};
  lastAnalysis=payload;
  const actions={BUY:"خرید",SELL:"فروش",WAIT:"فعلاً انتظار"};
  $("analysisAction").textContent=actions[String(r.action||"WAIT").toUpperCase()]||"فعلاً انتظار";
  $("analysisPrice").textContent=analysisPrice(r.market?.price_usd||frames["4h"]?.price);
  $("analysisRisk").textContent=String(r.risk_level||"نامشخص");
  const confidence=Math.max(0,Math.min(100,Number(r.confidence)||0));
  $("analysisConfidence").textContent=confidence+"/100";
  $("analysisConfidenceBar").style.width=confidence+"%";
  const labels={"15m":"۱۵ دقیقه","1h":"۱ ساعت","4h":"۴ ساعت","1d":"روزانه"};
  $("analysisTimeframes").innerHTML=Object.entries(labels).map(([tf,label])=>{
   const f=frames[tf]||{},trend=f.ema_trend==="bullish"?"صعودی":f.ema_trend==="bearish"?"نزولی":"خنثی / نامشخص";
   return '<div class="analysis-tf"><b>'+label+'</b><strong>'+trend+'</strong><small>RSI: '+escapeHTML(f.rsi??"—")+' · حجم: '+escapeHTML(f.volume_ratio??"—")+'<br>حمایت: '+analysisPrice(f.support)+'<br>مقاومت: '+analysisPrice(f.resistance)+'</small></div>';
  }).join("");
  const levels=r.levels||{},active=r.plan_status==="active_signal";
  const levelRows=active?[
   ["محدوده ورود",analysisLevel(levels.entry_zone)],["حد ضرر",analysisLevel(levels.stop_loss)],
   ["هدف اول",analysisLevel(levels.tp1)],["هدف دوم",analysisLevel(levels.tp2)],["هدف سوم",analysisLevel(levels.tp3)],["نسبت سود به زیان",r.risk_reward??"—"]
  ]:[["وضعیت ورود","ورود فوری تأیید نشده"],["شرط ورود",r.entry_trigger||"انتظار برای تأیید کندل بسته‌شده"],["مدیریت ریسک",r.position_risk||"بدون ورود"]];
  const list=(items)=>Array.isArray(items)&&items.length?'<ul>'+items.map(x=>'<li>'+escapeHTML(x)+'</li>').join("")+'</ul>':"<p>اطلاعات تکمیلی ارائه نشده است.</p>";
  const scenarios=Array.isArray(r.scenarios)?r.scenarios.map(x=>'<li><b>'+escapeHTML(x.name||"سناریو")+'</b> — '+escapeHTML(x.description||"")+'</li>').join(""):"";
  $("analysisReport").innerHTML=
   '<div class="analysis-report-head"><b>'+(active?"برنامهٔ مشروط محاسبه‌شده":"تحلیل محافظه‌کارانه؛ بدون ورود فوری")+'</b><small>منبع: '+escapeHTML(r.data_source||"موتور تحلیل")+'</small></div>'+
   '<div class="analysis-levels">'+levelRows.map(x=>'<div><small>'+x[0]+'</small><b>'+escapeHTML(x[1])+'</b></div>').join("")+'</div>'+
   '<h3>خلاصهٔ تحلیل</h3><p>'+escapeHTML(r.summary||"خلاصه‌ای ارائه نشده است.")+'</p>'+
   '<h3>تحلیل فنی</h3><p>'+escapeHTML(r.technical_analysis||"—")+'</p>'+
   '<h3>دلایل نتیجه</h3>'+list(r.reasons)+
   '<h3>سناریوهای بازار</h3><ul>'+scenarios+'</ul>'+
   '<h3>اقدام‌های قابل‌پیگیری</h3>'+list(r.recommendations)+
   '<p class="analysis-footnote">شرط بی‌اعتبارشدن: '+escapeHTML(r.invalidation||"با تغییر ساختار بازار، تحلیل باید تکرار شود.")+'<br>آخرین کندل: '+escapeHTML(r.market_timestamp||"نامشخص")+' · '+(r.market_data_fresh===true?"تازگی داده تأیید شده":"تازگی داده نیازمند احتیاط")+'</p>';
 }
 async function analyzeMarket(force=true){
  if(analysisBusy)return;
  const symbol=String($("analysisSymbol").value||"").trim().toUpperCase().replace(/[^A-Z0-9_]/g,"");
  const mode=$("analysisMarketMode").value;
  if(!/^[A-Z0-9_]{2,20}$/.test(symbol)){$("analysisStatus").textContent="نماد واردشده معتبر نیست.";return;}
  const key=symbol+"|"+mode,cached=analysisCache.get(key);
  if(!force&&cached&&Date.now()-cached.time<analysisCacheTtl){renderAnalysis(cached.payload);$("analysisStatus").textContent="آخرین تحلیل معتبر ذخیره‌شده نمایش داده شد.";return;}
  analysisBusy=true;
  const button=$("runAnalysis"),refreshButton=$("analyzerRefresh");
  button.disabled=true;button.textContent="در حال تحلیل…";refreshButton.disabled=true;
  $("analysisStatus").textContent="در حال دریافت کندل‌های بسته‌شده و تحلیل چهار بازهٔ زمانی…";
  try{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),65000);
   let response,data;
   try{
    response=await fetch(MAIN+"/analyze",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({symbol,name:symbol,market_mode:mode}),signal:controller.signal});
    data=await response.json();
   }finally{clearTimeout(timer);}
   if(!response.ok)throw new Error((data?.error||"سرویس تحلیل پاسخ معتبر نداد")+(data?.stage?" · مرحله: "+data.stage:""));
   if(!data?.analysis||!data?.market?.timeframes)throw new Error("ساختار پاسخ تحلیل ناقص است؛ گزارش قبلی حفظ شد.");
   analysisCache.set(key,{payload:data,time:Date.now()});
   renderAnalysis(data);
   $("analysisStatus").textContent="تحلیل دریافت شد · منبع و زمان کندل در گزارش ثبت شده است.";
  }catch(error){
   $("analysisStatus").textContent=error.name==="AbortError"?"زمان پاسخ موتور تحلیل تمام شد؛ اتصال یا مسیر جایگزین را دوباره امتحان کن.":"تحلیل دریافت نشد: "+String(error.message||error);
   if(!lastAnalysis)$("analysisReport").innerHTML='<div class="empty-state"><b>موتور تحلیل موقتاً در دسترس نیست</b><small>هیچ خروجی ساختگی جایگزین نشده است.</small></div>';
  }finally{
   analysisBusy=false;button.disabled=false;button.textContent="اجرای تحلیل واقعی";refreshButton.disabled=false;
  }
 }
 $("runAnalysis").addEventListener("click",()=>analyzeMarket(true));
 async function refresh(which){
  if(which==="radar")return loadRadar();
  if(which==="hunter")return loadHunter();
  if(which==="analyzer")return analyzeMarket(true);
  return Promise.allSettled([loadTicker(),loadRadar(),loadHunter(),loadHealth(),analyzeMarket(true)]);
 }
 document.querySelectorAll("[data-refresh]").forEach(b=>b.addEventListener("click",()=>refresh(b.dataset.refresh)));
 const currencyButtons=[$("btn-irt"),$("btn-usdt")];
 function setCurrency(unit){
  selectedCurrency=unit==="USDT"?"USDT":"IRT";
  currencyButtons.forEach((button,index)=>{
   const active=(index===0?selectedCurrency==="IRT":selectedCurrency==="USDT");
   button.classList.toggle("active",active);
   button.setAttribute("aria-pressed",String(active));
  });
  document.documentElement.dataset.currency=selectedCurrency;
  renderTicker();
  if(lastAnalysis)renderAnalysis(lastAnalysis);
 }
 currencyButtons[0].addEventListener("click",()=>setCurrency("IRT"));
 currencyButtons[1].addEventListener("click",()=>setCurrency("USDT"));
 setCurrency("IRT");
 $("refreshAll").addEventListener("click",()=>refresh("all"));
 $("menuToggle").addEventListener("click",()=>document.querySelector(".desktop-nav").classList.toggle("open"));
 document.querySelectorAll(".desktop-nav a").forEach(a=>a.addEventListener("click",()=>document.querySelector(".desktop-nav").classList.remove("open")));
 refresh("all");
 setInterval(()=>Promise.allSettled([loadTicker(),loadRadar(),loadHunter(),loadHealth()]),60000);
})();