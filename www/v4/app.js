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
 async function getFreshProxy(url,timeout=9000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const response=await fetch(url,{signal:controller.signal,cache:"no-store",headers:{Accept:"application/json"}});
   if(!response.ok)throw new Error("HTTP "+response.status);
   const cacheState=String(response.headers.get("X-MMP-Cache")||"").toLowerCase();
   if(cacheState!=="fresh")throw new Error(cacheState==="stale"?"stale market cache":"market cache freshness not confirmed");
   return await response.json();
  }finally{clearTimeout(timer);}
 }
 function money(v){const n=Number(v);return Number.isFinite(n)&&n>0?n.toLocaleString("en-US",{maximumFractionDigits:n>100?2:4}):"—";}
 let currentTetherPrice=0,currentTetherSources=[],currentTetherWarning="";
 let selectedCurrency="IRT",latestTickerRows=[],latestTickerFailures=[];
 async function fetchTetherRate(){
  const fallbackPromise=(async()=>{
   const requests=[
    {source:"Nobitex",url:MAIN+"/market-proxy?source=nobitex-tether",read:d=>Number(d?.stats?.["usdt-rls"]?.latest)/10},
    {source:"Wallex",url:MAIN+"/market-proxy?source=wallex-markets",read:d=>{
     const raw=d?.result?.symbols||d?.result?.markets||{},markets=Array.isArray(raw)?raw:Object.values(raw);
     const toman=markets.find(m=>["USDTTMN","USDTIRT"].includes(String(m?.symbol||"").toUpperCase()));
     const rial=markets.find(m=>["USDTIRR","USDTRLS"].includes(String(m?.symbol||"").toUpperCase()));
     const a=Number(toman?.stats?.lastPrice??toman?.lastPrice),b=Number(rial?.stats?.lastPrice??rial?.lastPrice);
     return a>0?a:b/10;
    }},
    {source:"Bitpin",url:MAIN+"/market-proxy?source=bitpin-tickers",read:d=>{
     const rows=Array.isArray(d?.results)?d.results:Array.isArray(d?.data)?d.data:Array.isArray(d)?d:[];
     const pair=rows.find(m=>{
      const code=String(m?.code||m?.symbol||"").replace(/[/-]/g,"_").toUpperCase(),flat=code.replace(/_/g,"");
      const base=String(m?.currency1?.code||m?.base_currency||m?.baseAsset||"").toUpperCase();
      const quote=String(m?.currency2?.code||m?.quote_currency||m?.quoteAsset||"").toUpperCase();
      return /^USDT_(IRT|IRR|RLS|TMN)$/.test(code)||/^USDT(IRT|IRR|RLS|TMN)$/.test(flat)||(base==="USDT"&&["IRT","IRR","RLS","TMN"].includes(quote));
     });
     const price=Number(pair?.price_info?.price??pair?.internal_price_info?.price??pair?.price??pair?.last_price??pair?.last),unit=String(pair?.currency2?.code||pair?.quote_currency||pair?.quoteAsset||String(pair?.code||pair?.symbol||"USDT_IRT").split(/[_/-]/).pop()).toUpperCase();
     return price>0?(["IRR","RLS"].includes(unit)?price/10:price):0;
    }},
    {source:"Exir",url:MAIN+"/market-proxy?source=exir-tickers",read:d=>{
     const source=d?.result||d?.data||d||{},entries=Array.isArray(source)?source.map(x=>[x?.symbol||x?.pair||"",x]):Object.entries(source);
     const pair=entries.find(([key,value])=>{
      const symbol=String(value?.symbol||value?.pair||key).toLowerCase().replace(/[_/]/g,"-");
      return /^(usdt-(irt|tmn|toman|irr|rls)|(irt|tmn|toman|irr|rls)-usdt)$/.test(symbol);
     });
     if(!pair)return 0;
     const symbol=String(pair[1]?.symbol||pair[0]||"").toLowerCase().replace(/[_/]/g,"-"),parts=symbol.split("-");
     const reverse=parts[0]!=="usdt",unit=reverse?parts[0]:parts[1],raw=Number(pair[1]?.last??pair[1]?.close??pair[1]?.price);
     const price=reverse&&raw>0?1/raw:raw;
     return price>0?(["irr","rls"].includes(unit)?price/10:price):0;
    }},
    {source:"Ramzinex",url:MAIN+"/market-proxy?source=ramzinex-pairs",read:d=>{
     const raw=d?.result?.data??d?.data??d?.result?.pairs??d?.pairs??[],rows=Array.isArray(raw)?raw:Object.values(raw);
     const code=v=>Array.isArray(v)?String(v[0]?.symbol??v[0]?.code??v[0]??""):String(v?.symbol??v?.code??v?.name??v??"");
     const pair=rows.find(x=>{
      const base=code(x?.base_currency_symbol??x?.base_currency??x?.baseCurrency).toUpperCase();
      const quote=code(x?.quote_currency_symbol??x?.quote_currency??x?.quoteCurrency).toUpperCase();
      const name=String(x?.url_name??x?.symbol??x?.pair??"").toLowerCase().replace(/[_/]/g,"-");
      return (base==="USDT"&&["IRR","IRT","RLS","TMN","TOMAN"].includes(quote))||/^(usdt-(irr|irt|rls|tmn|toman))$/.test(name);
     });
     if(!pair)return 0;
     const buy=Number(pair.buy??pair.best_buy??pair.bid),sell=Number(pair.sell??pair.best_sell??pair.ask);
     const last=Number(pair.last??pair.last_price??pair.price??pair.rate),quote=code(pair.quote_currency_symbol??pair.quote_currency??pair.quoteCurrency).toUpperCase();
     const rawPrice=buy>0&&sell>0?(buy+sell)/2:last;
     return rawPrice>0?(["IRR","RLS"].includes(quote)?rawPrice/10:rawPrice):0;
    }}
   ];
   const results=await Promise.all(requests.map(async item=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
    try{
     const response=await fetch(item.url,{cache:"no-store",signal:controller.signal});
     if(!response.ok)throw new Error("HTTP "+response.status);
     if(String(response.headers.get("X-MMP-Cache")||"").toLowerCase()!=="fresh")throw new Error("stale or unverified Toman-rate cache");
     const data=await response.json(),price=item.read(data);
     if(!Number.isFinite(price)||price<1000||price>100000000)throw new Error("invalid rate");
     return {source:item.source,price};
    }catch(error){return null;}
    finally{clearTimeout(timer);}
   }));
   const valid=results.filter(Boolean);
   if(valid.length<2)return {price:0,sources:valid.map(x=>x.source),warning:"کمتر از دو منبع مستقل معتبر؛ نرخ نمایش داده نمی‌شود"};
   const sorted=valid.map(x=>x.price).sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
   const median=sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
   const consensus=valid.filter(x=>Math.abs(x.price-median)/median<=0.025);
   if(consensus.length<2)return {price:0,sources:valid.map(x=>x.source),warning:"اختلاف منابع بیش از حد مجاز؛ نرخ نمایش داده نمی‌شود"};
   const price=consensus.reduce((sum,x)=>sum+x.price,0)/consensus.length;
   const spread=Math.max(...consensus.map(x=>Math.abs(x.price-price)/price));
   if(spread>0.03)return {price:0,sources:consensus.map(x=>x.source),warning:"اجماع منابع معتبر شکل نگرفت؛ نرخ نمایش داده نمی‌شود"};
   return {price,sources:consensus.map(x=>x.source),warning:consensus.length<valid.length?"منبع پرت از اجماع حذف شد":""};
  })();
  const fallback=await fallbackPromise;
  return fallback?.price>0?fallback:fallback||{price:0,sources:[],warning:"نرخ تتر موقتاً از منابع داخلی دریافت نشد"};
 }
 function renderTicker(rows=latestTickerRows,failures=latestTickerFailures){
  if(!Array.isArray(rows)||rows.length===0)return;
  $("ticker").innerHTML=rows.map(x=>{
   const label=x.label||(x.symbol==="PAXGUSDT"?"طلای توکنی PAXG / USDT":x.symbol==="USDTIRT"?"تتر / تومان":x.symbol.replace("USDT"," / USDT"));
   const unavailable=x.state==="missing"||x.state==="conflict"||x.state==="single";
   const value=unavailable?(x.state==="conflict"?"اختلاف منابع — مخفی شد":x.state==="single"?"تک‌منبع — مخفی شد":"داده در دسترس نیست"):x.symbol==="USDTIRT"?money(currentTetherPrice)+" تومان":money(x.price)+" USDT";
   const toman=x.symbol==="USDTIRT"?"":currentTetherPrice>0?money(Math.round(x.price*currentTetherPrice))+" تومان":"— تومان";
   const provenance=x.state==="corroborated"?"تطبیق "+x.count+" منبع":x.state==="single"?"تک‌منبع؛ مخفی شد":x.state==="conflict"?"اختلاف "+x.spread.toFixed(2)+"٪":"بدون منبع معتبر";
   return '<div class="ticker-item"><small>'+label+' · '+provenance+'</small><b>'+value+'</b>'+(toman?'<small class="ticker-secondary">'+toman+'</small>':'')+'</div>';
  }).join("");
  const verified=rows.filter(x=>x.state==="corroborated").length;
  const single=rows.filter(x=>x.state==="single").length;
  const conflicts=rows.filter(x=>x.state==="conflict").length;
  const integrity=$("tickerIntegrity");
  if(integrity){
   const currencyNote=currentTetherPrice>0?"نرخ تتر: "+money(currentTetherPrice)+" تومان · "+(currentTetherSources.join(" + ")||"منبع معتبر")+(currentTetherWarning?" · "+currentTetherWarning:""):"نرخ تتر در دسترس نیست؛ قیمت تومانی پنهان است";
   integrity.textContent=[verified+" دارایی چندمنبعی",single+" تک‌منبعی",conflicts+" دارای اختلاف",failures.length+" منبع بی‌پاسخ",currencyNote].join(" · ");
   integrity.classList.toggle("integrity-good",verified===rows.length&&currentTetherPrice>0);
   integrity.classList.toggle("integrity-warning",verified!==rows.length||currentTetherPrice<=0);
  }
 }
 async function loadTicker(){
  const symbols=["BTCUSDT","ETHUSDT","PAXGUSDT"];
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
   Promise.allSettled(sources.map(async source=>({source,data:await getFreshProxy(MAIN+"/market-proxy?source="+source)}))),
   fetchTetherRate()
  ]);
  if(tether?.price>0){
   currentTetherPrice=tether.price;currentTetherSources=tether.sources||[];currentTetherWarning=tether.warning||"";
  }else{
   currentTetherPrice=0;currentTetherSources=[];currentTetherWarning=tether?.warning||"نرخ زنده تتر تأیید نشد؛ قیمت تومانی پنهان است";
  }
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
  const assetRows=symbols.map(symbol=>{
   const q=quotes[symbol].sort((a,b)=>a.price-b.price);
   if(!q.length)return {symbol,state:"missing"};
   const median=q.length%2?q[(q.length-1)/2].price:(q[q.length/2-1].price+q[q.length/2].price)/2;
   const spread=median>0?(q[q.length-1].price-q[0].price)/median*100:Infinity;
   if(q.length>=2&&spread>1.5)return {symbol,state:"conflict",count:q.length,spread};
   const selected=q.length>=2?median:q[0].price;
   return {symbol,state:q.length>=2?"corroborated":"single",price:selected,count:q.length,spread,sources:q.map(x=>x.source)};
  });
  const tetherRow=currentTetherPrice>0&&currentTetherSources.length>=2
   ?{symbol:"USDTIRT",label:"تتر / تومان",state:"corroborated",price:currentTetherPrice,count:currentTetherSources.length,spread:0,sources:currentTetherSources}
   :{symbol:"USDTIRT",label:"تتر / تومان",state:"missing",price:0,count:currentTetherSources.length,sources:currentTetherSources};
  const rows=[...assetRows,tetherRow];
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
   let runtime=null;
   try{runtime=await get(MAIN+"/health");}catch(e){}
   const runtimeHealthy=runtime?.worker==="online"&&/^QIE-\d+\.\d+\.\d+$/.test(String(runtime.engine_version||""))&&runtime.ai_binding===true&&runtime.futures_engine_binding===true&&runtime.market_cache_binding===true&&runtime.admin_db_binding===true;
   const runtimeVersion=$("runtimeVersion");
   if(runtimeVersion)runtimeVersion.textContent=runtimeHealthy?"ENGINE "+runtime.engine_version:"ENGINE VERSION UNVERIFIED";
   let d=null;
   for(let attempt=0;attempt<3&&!d;attempt++){
    try{d=await get(MAIN+"/connections-health");}
    catch(error){if(attempt<2)await new Promise(resolve=>setTimeout(resolve,450*(attempt+1)));}
   }
   const checks=Array.isArray(d?.checks)?d.checks:[],up=checks.filter(x=>x.status==="ok"||x.status==="slow").length,total=checks.length;
   const connectionFresh=d?.stale!==true;
   const connectionsHealthy=!!d&&connectionFresh&&total>0&&up===total;
   const partialHealthy=runtimeHealthy&&connectionFresh&&up>0;
   const fullyHealthy=runtimeHealthy&&connectionsHealthy;
   const statusText=!runtimeHealthy?"هسته اصلی تأیید نشد":!d?"اتصال‌ها بررسی نشدند":fullyHealthy?up+" از "+total+" اتصال سالم":partialHealthy?up+" از "+total+" اتصال سالم · ناقص":"اتصال سرویس‌ها تأیید نشد";
   $("coreStatus").textContent=statusText;
   const engineStatus=$("engineStatus");if(engineStatus)engineStatus.textContent="وضعیت هسته و داده‌ها: "+statusText;
   $("coreUpdated").textContent=d?.checked_at?new Date(d.checked_at).toLocaleTimeString("fa-IR"):"—";
   const live=$("serviceStatus");
   if(live){live.textContent=fullyHealthy?"هسته و "+up+"/"+total+" اتصال سالم":!runtimeHealthy?"هسته تأییدنشده":!d?"اتصال بررسی نشد":partialHealthy?up+"/"+total+" اتصال سالم · ناقص":"اتصال تأییدنشده";live.classList.remove("pending","healthy","partial","down");live.classList.add(fullyHealthy?"healthy":partialHealthy?"partial":"down");}
  }

 let marketChart=null,macdChart=null,rsiChart=null,mainChartSeries=null,mainChartType="",ema20Series=null,ema50Series=null,bollUpperSeries=null,bollLowerSeries=null,volumeSeries=null,macdLineSeries=null,macdSignalSeries=null,macdHistogramSeries=null,rsiLineSeries=null;
 let lastChartPayload=null,lastChartKey="",chartBusy=false;
 const chartIntervalMs={"1m":60000,"3m":180000,"5m":300000,"15m":900000,"1h":3600000,"4h":14400000,"1d":86400000};
 function chartEMA(values,period){
  const out=new Array(values.length).fill(null);if(values.length<period)return out;
  let prev=values.slice(0,period).reduce((sum,value)=>sum+value,0)/period;out[period-1]=prev;
  const k=2/(period+1);
  for(let i=period;i<values.length;i++){prev=values[i]*k+prev*(1-k);out[i]=prev;}
  return out;
 }
 function chartIndicators(candles){
  const closes=candles.map(x=>x.close),ema20=chartEMA(closes,20),ema50=chartEMA(closes,50),upper=[],lower=[],rsi=new Array(closes.length).fill(null);
  for(let i=19;i<closes.length;i++){
   const slice=closes.slice(i-19,i+1),mean=slice.reduce((a,b)=>a+b,0)/20;
   const variance=slice.reduce((a,b)=>a+(b-mean)*(b-mean),0)/20,sd=Math.sqrt(variance);
   upper[i]=mean+2*sd;lower[i]=mean-2*sd;
  }
  if(closes.length>=15){
   const gains=[],losses=[];
   for(let i=1;i<closes.length;i++){const d=closes[i]-closes[i-1];gains.push(Math.max(0,d));losses.push(Math.max(0,-d));}
   let avgGain=gains.slice(0,14).reduce((a,b)=>a+b,0)/14,avgLoss=losses.slice(0,14).reduce((a,b)=>a+b,0)/14;
   rsi[14]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
   for(let i=15;i<closes.length;i++){avgGain=(avgGain*13+gains[i-1])/14;avgLoss=(avgLoss*13+losses[i-1])/14;rsi[i]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);}
  }
  const e12=chartEMA(closes,12),e26=chartEMA(closes,26),macd=new Array(closes.length).fill(null);
  for(let i=0;i<closes.length;i++)if(e12[i]!==null&&e26[i]!==null)macd[i]=e12[i]-e26[i];
  const compact=macd.filter(Number.isFinite),compactSignal=chartEMA(compact,9),signal=new Array(closes.length).fill(null),histogram=new Array(closes.length).fill(null);
  const offset=macd.findIndex(Number.isFinite);
  for(let i=0;i<compact.length;i++){const index=offset+i;if(compactSignal[i]!==null){signal[index]=compactSignal[i];histogram[index]=compact[i]-compactSignal[i];}}
  const points=values=>values.map((value,index)=>Number.isFinite(value)?{time:candles[index].time,value}:null).filter(Boolean);
  return {ema20:points(ema20),ema50:points(ema50),upper:points(upper),lower:points(lower),rsi:points(rsi),macd:points(macd),signal:points(signal),histogram:histogram.map((value,index)=>Number.isFinite(value)?{time:candles[index].time,value,color:value>=0?"rgba(37,214,149,.68)":"rgba(255,94,108,.68)"}:null).filter(Boolean)};
 }
 function chartCreate(container,height,timeVisible){
  return window.LightweightCharts.createChart(container,{width:Math.max(320,container.clientWidth||600),height,layout:{background:{color:"#0a121d"},textColor:"#aab6c4"},grid:{vertLines:{color:"rgba(255,255,255,.035)"},horzLines:{color:"rgba(255,255,255,.035)"}},rightPriceScale:{borderColor:"#273547"},timeScale:{borderColor:"#273547",timeVisible,secondsVisible:false}});
 }
 function ensureChartInstances(){
  if(!window.LightweightCharts||typeof window.LightweightCharts.createChart!=="function")throw new Error("کتابخانه نمودار بارگذاری نشد.");
  if(!marketChart){
   marketChart=chartCreate($("marketChart"),330,true);
   ema20Series=marketChart.addLineSeries({color:"#e5c77f",lineWidth:1,title:"EMA 20"});
   ema50Series=marketChart.addLineSeries({color:"#70a8ff",lineWidth:1,title:"EMA 50"});
   bollUpperSeries=marketChart.addLineSeries({color:"rgba(176,143,83,.65)",lineWidth:1,lineStyle:2,title:"BB Upper"});
   bollLowerSeries=marketChart.addLineSeries({color:"rgba(176,143,83,.65)",lineWidth:1,lineStyle:2,title:"BB Lower"});
   volumeSeries=marketChart.addHistogramSeries({priceScaleId:"",priceFormat:{type:"volume"},base:0});
   volumeSeries.priceScale().applyOptions({scaleMargins:{top:.78,bottom:0}});
  }
  if(!macdChart){
   macdChart=chartCreate($("macdChart"),125,false);
   macdHistogramSeries=macdChart.addHistogramSeries({base:0,priceFormat:{type:"price",precision:5,minMove:.00001},title:"MACD Histogram"});
   macdLineSeries=macdChart.addLineSeries({color:"#e5c77f",lineWidth:1,title:"MACD"});
   macdSignalSeries=macdChart.addLineSeries({color:"#70a8ff",lineWidth:1,title:"Signal"});
  }
  if(!rsiChart){
   rsiChart=chartCreate($("rsiChart"),125,false);
   rsiLineSeries=rsiChart.addLineSeries({color:"#b99aff",lineWidth:2,title:"RSI 14"});
   rsiLineSeries.createPriceLine({price:70,color:"rgba(255,94,108,.7)",lineWidth:1,lineStyle:2,axisLabelVisible:true,title:"70"});
   rsiLineSeries.createPriceLine({price:30,color:"rgba(37,214,149,.7)",lineWidth:1,lineStyle:2,axisLabelVisible:true,title:"30"});
   rsiChart.priceScale("right").applyOptions({autoScale:true,scaleMargins:{top:.1,bottom:.1}});
  }
 }
 function chartCandleRows(payload){
  const raw=Array.isArray(payload?.candles)?payload.candles:[];
  const map=new Map();
  for(const row of raw){
   const time=Number(row?.time),open=Number(row?.open),high=Number(row?.high),low=Number(row?.low),close=Number(row?.close),volume=Number(row?.volume);
   if(!Number.isFinite(time)||time<=0||![open,high,low,close,volume].every(Number.isFinite)||open<=0||high<=0||low<=0||close<=0||volume<0||high<Math.max(open,close,low)||low>Math.min(open,close,high))continue;
   map.set(time,{time,open,high,low,close,volume});
  }
  return [...map.values()].sort((a,b)=>a.time-b.time);
 }
 function chartHeikinAshi(candles){
  let previousOpen=null,previousClose=null;
  return candles.map(c=>{
   const close=(c.open+c.high+c.low+c.close)/4;
   const open=previousOpen===null?(c.open+c.close)/2:(previousOpen+previousClose)/2;
   const high=Math.max(c.high,open,close),low=Math.min(c.low,open,close);
   previousOpen=open;previousClose=close;
   return {time:c.time,open,high,low,close};
  });
 }
 function updateChartVisibility(){
  if(ema20Series)ema20Series.applyOptions({visible:$("showEma20").checked});
  if(ema50Series)ema50Series.applyOptions({visible:$("showEma50").checked});
  if(bollUpperSeries)bollUpperSeries.applyOptions({visible:$("showBollinger").checked});
  if(bollLowerSeries)bollLowerSeries.applyOptions({visible:$("showBollinger").checked});
  if(volumeSeries)volumeSeries.applyOptions({visible:$("showVolume").checked});
  $("macdChart").hidden=!$("showMacd").checked;
  $("rsiChart").hidden=!$("showRsi").checked;
 }
 function renderChart(payload){
  const candles=chartCandleRows(payload);
  if(candles.length<55)throw new Error("برای محاسبه EMA50 و اندیکاتورها حداقل ۵۵ کندل معتبر لازم است.");
  ensureChartInstances();
  const type=$("chartType").value,indicator=chartIndicators(candles);
  if(!mainChartSeries||mainChartType!==type){
   if(mainChartSeries)marketChart.removeSeries(mainChartSeries);
   if(type==="line")mainChartSeries=marketChart.addLineSeries({color:"#e5c77f",lineWidth:2,title:"Price"});
   else if(type==="bars")mainChartSeries=marketChart.addBarSeries({upColor:"#25d695",downColor:"#ff5e6c",openVisible:true,thinBars:false});
   else mainChartSeries=marketChart.addCandlestickSeries({upColor:"#25d695",downColor:"#ff5e6c",borderUpColor:"#25d695",borderDownColor:"#ff5e6c",wickUpColor:"#25d695",wickDownColor:"#ff5e6c"});
   mainChartType=type;
  }
  const priceRows=type==="line"?candles.map(x=>({time:x.time,value:x.close})):type==="heikin-ashi"?chartHeikinAshi(candles):candles.map(({time,open,high,low,close})=>({time,open,high,low,close}));
  mainChartSeries.setData(priceRows);
  ema20Series.setData(indicator.ema20);ema50Series.setData(indicator.ema50);
  bollUpperSeries.setData(indicator.upper);bollLowerSeries.setData(indicator.lower);
  volumeSeries.setData(candles.map(x=>({time:x.time,value:x.volume,color:x.close>=x.open?"rgba(37,214,149,.32)":"rgba(255,94,108,.32)"})));
  macdHistogramSeries.setData(indicator.histogram);macdLineSeries.setData(indicator.macd);macdSignalSeries.setData(indicator.signal);
  rsiLineSeries.setData(indicator.rsi);
  const key=String(payload.symbol)+"|"+String(payload.interval)+"|"+String(payload.market);
  if(key!==lastChartKey){marketChart.timeScale().fitContent();macdChart.timeScale().fitContent();rsiChart.timeScale().fitContent();lastChartKey=key;}
  updateChartVisibility();
  lastChartPayload=payload;
  const price=Number(payload.price)||candles[candles.length-1].close;
  const toman=currentTetherPrice>0?" · "+Math.round(price*currentTetherPrice).toLocaleString("en-US")+" تومان":"";
  $("chartProvider").textContent="منبع: "+String(payload.provider||"نامشخص");
  $("chartLastPrice").textContent="قیمت: "+money(price)+" USDT"+toman;
  $("chartFreshness").textContent="تازگی: "+(payload.data_stale===true?"کهنه":"تازه تأیید شد");
  $("chartFreshness").classList.toggle("stale",payload.data_stale===true);
  $("chartStatus").textContent="نمودار آماده است · "+candles.length+" کندل معتبر · "+String(payload.interval)+" · "+String(payload.market).toUpperCase();
 }
 async function loadChart(){
  if(chartBusy)return;
  const symbol=String($("chartSymbol").value||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  const interval=$("chartInterval").value,market=$("chartMarket").value;
  if(!/^[A-Z0-9]{2,30}$/.test(symbol)){$("chartStatus").textContent="نماد نمودار معتبر نیست.";return;}
  chartBusy=true;const button=$("loadChart"),refreshButton=$("chartRefresh");
  button.disabled=true;refreshButton.disabled=true;button.textContent="در حال دریافت…";
  $("chartStatus").textContent="در حال دریافت کندل و اعتبارسنجی تازگی داده…";
  try{
   const libraryReady=window.mmpChartLibraryReady?await window.mmpChartLibraryReady:!!window.LightweightCharts;
   if(!libraryReady||!window.LightweightCharts)throw new Error("کتابخانه نمودار از هیچ‌یک از منابع پشتیبان بارگذاری نشد.");
   const payload=await get(MAIN+"/market-candles?symbol="+encodeURIComponent(symbol)+"&interval="+encodeURIComponent(interval)+"&market="+encodeURIComponent(market),20000);
   const candles=chartCandleRows(payload),last=candles[candles.length-1],ageMs=Number(payload.data_age_ms),intervalMs=chartIntervalMs[interval]||900000;
   const candleAge=last?Math.max(0,Date.now()-last.time*1000):Infinity;
   const effectiveAge=Number.isFinite(ageMs)?Math.max(ageMs,candleAge):candleAge;
   if(payload.data_stale===true||!Number.isFinite(effectiveAge)||effectiveAge>intervalMs*2+120000){
    $("chartFreshness").textContent="تازگی: داده کهنه";
    $("chartFreshness").classList.add("stale");
    $("chartStatus").textContent="داده کندلی تازه تأیید نشد؛ آخرین نمودار معتبر حفظ شد و LIVE اعلام نمی‌شود.";
    return;
   }
   renderChart(payload);
  }catch(error){
   $("chartStatus").textContent="دریافت نمودار ناموفق بود: "+String(error?.message||error).slice(0,180);
   $("chartFreshness").textContent="تازگی: تأییدنشده";
   $("chartFreshness").classList.add("stale");
  }finally{
   chartBusy=false;button.disabled=false;refreshButton.disabled=false;button.textContent="بارگذاری نمودار";
  }
 }

 let analysisBusy=false,lastAnalysis=null;
 const analysisCache=new Map();
 const analysisCacheTtl=3*60*1000;
 function analysisPrice(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return "—";
  return selectedCurrency==="IRT"?(currentTetherPrice>0?Math.round(n*currentTetherPrice).toLocaleString("en-US")+" تومان":"— تومان"):money(n)+" USDT";
 }
 function analysisLevel(value){
  if(value===null||value===undefined)return "—";
  if(typeof value==="object")return (value.low!=null?analysisPrice(value.low):"—")+" تا "+(value.high!=null?analysisPrice(value.high):"—");
  return analysisPrice(value);
 }
 function renderAnalysis(payload){
  const r=payload?.analysis||{},market=payload?.market||{},frames=market.timeframes||{};
  const fresh=market.market_data_fresh===true&&r.market_data_fresh===true;
  lastAnalysis=payload;
  const actions={BUY:"خرید",SELL:"فروش",WAIT:"فعلاً انتظار"};
  const action=fresh?String(r.action||"WAIT").toUpperCase():"WAIT";
  $("analysisAction").textContent=actions[action]||"فعلاً انتظار";
  $("analysisPrice").textContent=fresh?analysisPrice(r.market?.price_usd||frames["4h"]?.price):"—";
  $("analysisRisk").textContent=fresh?String(r.risk_level||"نامشخص"):"داده تازه تأیید نشده";
  const confidence=fresh?Math.max(0,Math.min(100,Number(r.confidence)||0)):0;
  $("analysisConfidence").textContent=confidence+"/100";
  $("analysisConfidenceBar").style.width=confidence+"%";
  const labels={"15m":"۱۵ دقیقه","1h":"۱ ساعت","4h":"۴ ساعت","1d":"روزانه"};
  $("analysisTimeframes").innerHTML=Object.entries(labels).map(([tf,label])=>{
   const f=frames[tf]||{},trend=f.ema_trend==="bullish"?"صعودی":f.ema_trend==="bearish"?"نزولی":"خنثی / نامشخص";
   return '<div class="analysis-tf"><b>'+label+'</b><strong>'+trend+'</strong><small>RSI: '+escapeHTML(f.rsi??"—")+' · حجم: '+escapeHTML(f.volume_ratio??"—")+'<br>حمایت: '+analysisPrice(f.support)+'<br>مقاومت: '+analysisPrice(f.resistance)+'</small></div>';
  }).join("");
  const levels=r.levels||{},active=fresh&&r.plan_status==="active_signal";
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
   const fresh=data.market.market_data_fresh===true&&data.analysis.market_data_fresh===true;
    $("analysisStatus").textContent=fresh?"تحلیل دریافت شد · تازگی هر چهار بازه تأیید شده است.":"تحلیل دریافت شد؛ تازگی داده تأیید نشد و فقط حالت انتظار نمایش داده می‌شود.";
  }catch(error){
   $("analysisStatus").textContent=error.name==="AbortError"?"زمان پاسخ موتور تحلیل تمام شد؛ اتصال یا مسیر جایگزین را دوباره امتحان کن.":"تحلیل دریافت نشد: "+String(error.message||error);
   if(!lastAnalysis)$("analysisReport").innerHTML='<div class="empty-state"><b>موتور تحلیل موقتاً در دسترس نیست</b><small>هیچ خروجی ساختگی جایگزین نشده است.</small></div>';
  }finally{
   analysisBusy=false;button.disabled=false;button.textContent="اجرای تحلیل واقعی";refreshButton.disabled=false;
  }
 }
 $("runAnalysis").addEventListener("click",()=>analyzeMarket(true));
 async function refresh(which,includeAnalysis=true){
  if(which==="radar")return loadRadar();
  if(which==="hunter")return loadHunter();
  if(which==="chart")return loadChart();
  if(which==="analyzer")return analyzeMarket(true);
  const tasks=[loadTicker(),loadChart(),loadRadar(),loadHunter(),loadHealth()];
  if(includeAnalysis)tasks.push(analyzeMarket(true));
  return Promise.allSettled(tasks);
 }
 document.querySelectorAll("[data-refresh]").forEach(b=>b.addEventListener("click",()=>refresh(b.dataset.refresh)));
 const currencyButtons=[$("btn-irt"),$("btn-usdt")];
 $("chartRefresh").addEventListener("click",loadChart);
 $("loadChart").addEventListener("click",loadChart);
 $("chartType").addEventListener("change",()=>{if(lastChartPayload)try{renderChart(lastChartPayload);}catch(error){$("chartStatus").textContent=String(error?.message||error);}});
 ["showEma20","showEma50","showBollinger","showVolume","showMacd","showRsi"].forEach(id=>$(id).addEventListener("change",updateChartVisibility));
 $("chartInterval").addEventListener("change",loadChart);
 $("chartMarket").addEventListener("change",loadChart);
 $("chartSymbol").addEventListener("keydown",event=>{if(event.key==="Enter")loadChart();});
 window.addEventListener("resize",()=>{if(marketChart)marketChart.applyOptions({width:Math.max(320,$("marketChart").clientWidth)});if(macdChart)macdChart.applyOptions({width:Math.max(320,$("macdChart").clientWidth)});if(rsiChart)rsiChart.applyOptions({width:Math.max(320,$("rsiChart").clientWidth)});});
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
  if(lastChartPayload)renderChart(lastChartPayload);
 }
 currencyButtons[0].addEventListener("click",()=>setCurrency("IRT"));
 currencyButtons[1].addEventListener("click",()=>setCurrency("USDT"));
 setCurrency("IRT");
 $("refreshAll").addEventListener("click",()=>refresh("all"));
 const menuButton=$("menuToggle"),primaryNav=$("primaryNav");
 function setMenuOpen(open){
  const expanded=!!open;
  primaryNav.classList.toggle("open",expanded);
  menuButton.setAttribute("aria-expanded",String(expanded));
  menuButton.setAttribute("aria-label",expanded?"بستن منو":"بازکردن منو");
 }
 menuButton.addEventListener("click",()=>setMenuOpen(!primaryNav.classList.contains("open")));
 primaryNav.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>setMenuOpen(false)));
 refresh("all",false);
 setInterval(()=>Promise.allSettled([loadTicker(),loadChart(),loadRadar(),loadHunter(),loadHealth()]),60000);
})();