// MMP Quantum Intelligence Engine: dynamic market discovery with no fixed asset ceiling
import { QUANTUM_ENGINE_NAME, QUANTUM_ENGINE_VERSION, normalizeQuantumUniverse, scoreQuantumOpportunity, calculateQuantumIndicators, calculateMarketScanPriority, detectEarlyMovePressure } from "./quantum-core.js";
import { normalizeMarketCandles, alignMarketCandles, assessMarketDataFreshness } from "./market-data-core.js";
import { updateLearningLedger, applyLearningCalibration } from "./learning-engine.js";
import { decideQuantumSignal } from "./decision-engine.js";
const HUNTER_BATCH_SIZE = 8; // per-cycle budget; the full rotating universe remains uncapped
const FUTURES_HUNTER_BATCH_SIZE = 8; // per-cycle budget; the full rotating universe remains uncapped
const MODEL = "@cf/openai/gpt-oss-120b";
function extractAIJson(value){
 let raw=typeof value==="string"?value:JSON.stringify(value??"");
 raw=raw.replace(/^\s*\x60{3}(?:json)?\s*/i,"").replace(/\s*\x60{3}\s*$/,"").trim();
 const start=raw.indexOf("{"),end=raw.lastIndexOf("}");
 if(start<0||end<=start)throw new Error("AI returned no JSON object");
 const candidate=raw.slice(start,end+1);
 const parsed=JSON.parse(candidate);
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("AI returned invalid JSON object");
 return candidate;
}
async function reserveCloudflareAIDailyBudget(env){
 const maxCalls=Math.max(0,Math.floor(Number(env.CF_AI_DAILY_MAX_CALLS??20)));
 const day=new Date().toISOString().slice(0,10);
 const now=new Date().toISOString();
 if(!env.ADMIN_DB)return {allowed:false,day,calls:null,max_calls:maxCalls,remaining:0,reason:"D1 daily budget store is not bound; Cloudflare AI blocked fail-closed"};
 try{
  const row=await env.ADMIN_DB.prepare(
   "INSERT INTO mmp_ai_daily_budget (utc_day,calls,updated_at) VALUES (?,1,?) ON CONFLICT(utc_day) DO UPDATE SET calls=mmp_ai_daily_budget.calls+1,updated_at=excluded.updated_at WHERE mmp_ai_daily_budget.calls < ? RETURNING calls"
  ).bind(day,now,maxCalls).first();
  if(row&&Number(row.calls)<=maxCalls){
   const calls=Number(row.calls);
   return {allowed:true,day,calls,max_calls:maxCalls,remaining:Math.max(0,maxCalls-calls),reason:null};
  }
  const current=await env.ADMIN_DB.prepare("SELECT calls FROM mmp_ai_daily_budget WHERE utc_day = ?").bind(day).first();
  const calls=Number(current?.calls)||0;
  return {allowed:false,day,calls,max_calls:maxCalls,remaining:0,reason:"Daily Cloudflare AI call budget reached"};
 }catch(error){
  return {allowed:false,day,calls:null,max_calls:maxCalls,remaining:0,reason:"Daily budget storage error; Cloudflare AI blocked fail-closed: "+String(error?.message||error).slice(0,140)};
 }
}
async function runAIWithFallback(env,prompt){
 const failures=[];
 if(env.GROQ_API_KEY){
  const groqModels=[
   {id:"openai/gpt-oss-120b",maxTokens:1800,timeoutMs:18000,reasoning_effort:"low"},
   {id:"openai/gpt-oss-20b",maxTokens:1200,timeoutMs:12000,reasoning_effort:"low"}
  ];
  for(const model of groqModels){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),model.timeoutMs);
   try{
    const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{
     method:"POST",headers:{"Authorization":"Bearer "+env.GROQ_API_KEY,"Content-Type":"application/json"},
     body:JSON.stringify({model:model.id,messages:[{role:"system",content:"Return only one valid JSON object. Do not use markdown fences."},{role:"user",content:prompt}],response_format:{type:"json_object"},temperature:0.2,max_completion_tokens:model.maxTokens,reasoning_effort:model.reasoning_effort}),
     signal:controller.signal
    });
    if(!response.ok){const detail=(await response.text()).slice(0,220);failures.push("Groq "+model.id+" HTTP "+response.status+": "+detail);continue;}
    const data=await response.json(),content=data.choices?.[0]?.message?.content;
    if(content)return {provider:"Groq "+model.id,raw:content,fallbacks:failures};
    failures.push("Groq "+model.id+": empty response");
   }catch(error){failures.push("Groq "+model.id+": "+String(error?.message||error).slice(0,160));}
   finally{clearTimeout(timer);}
  }
 }
 if(env.AI){
  const budget=await reserveCloudflareAIDailyBudget(env);
  if(!budget.allowed){
   failures.push("Cloudflare AI skipped: "+budget.reason+" ("+budget.calls+"/"+budget.max_calls+" UTC daily calls)");
   const error=new Error("Cloudflare AI daily budget unavailable or exhausted");
   error.cloudflareBudget=budget;
   throw error;
  }
  try{
   const result=await env.AI.run("@cf/openai/gpt-oss-120b",{messages:[{role:"system",content:"Return only one valid JSON object. Do not use markdown fences."},{role:"user",content:prompt}],max_tokens:1600,temperature:0.2});
   const content=result?.choices?.[0]?.message?.content||result?.response||result?.output_text;
   if(content)return {provider:"Cloudflare Workers AI",raw:content,fallbacks:failures,cloudflareBudget:budget};
   failures.push("Cloudflare AI: empty response");
  }catch(error){failures.push("Cloudflare AI: "+String(error?.message||error).slice(0,180));}
 }
 if(env.HF_TOKEN){
  try{
   const response=await fetch("https://router.huggingface.co/v1/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+env.HF_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({model:"Qwen/Qwen2.5-7B-Instruct",messages:[{role:"system",content:"Return only one valid JSON object. Do not use markdown fences."},{role:"user",content:prompt}],max_tokens:1400,temperature:0.2})});
   if(response.ok){const data=await response.json(),content=data.choices?.[0]?.message?.content;if(content)return {provider:"Hugging Face Qwen",raw:content,fallbacks:failures};}
   else failures.push("Hugging Face HTTP "+response.status+": "+(await response.text()).slice(0,180));
  }catch(error){failures.push("Hugging Face: "+String(error?.message||error).slice(0,160));}
 }
 throw new Error("All AI providers failed: "+failures.join(" | ").slice(0,700));
}
const ALLOWED_ORIGINS = new Set([
 "https://mmp-coin.github.io",
 "https://localhost",
 "http://localhost",
 "capacitor://localhost",
 "ionic://localhost",
 "http://localhost:8100",
 "https://localhost:8100"
]);
function corsHeaders(request){
 const origin=request?.headers.get("Origin");
 const headers={"Vary":"Origin"};
 if(origin&&ALLOWED_ORIGINS.has(origin)){
  headers["Access-Control-Allow-Origin"]=origin;
  headers["Access-Control-Allow-Methods"]="GET, POST, OPTIONS";
  headers["Access-Control-Allow-Headers"]="Content-Type";
  headers["Access-Control-Max-Age"]="86400";
  headers["Access-Control-Expose-Headers"]="X-MMP-Cache, X-MMP-Data-Age, X-MMP-Data-Source, Cf-Cache-Status, Warning";
 }
 return headers;
}
const json=(obj,status=200,request=null,extraHeaders={})=>new Response(JSON.stringify(obj),{status,headers:{...corsHeaders(request),...extraHeaders,"Content-Type":extraHeaders["Content-Type"]||"application/json; charset=utf-8","Cache-Control":extraHeaders["Cache-Control"]||"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
async function checkRateLimit(binding,request,scope){
 if(!binding)return "unavailable";
 const ip=request.headers.get("CF-Connecting-IP")||"unknown";
 try{const result=await binding.limit({key:ip+":"+scope});return result?.success?"ok":"limited";}
 catch{return "unavailable";}
}
function rateLimitReply(result,request){
 if(result==="ok")return null;
 if(result==="limited")return json({error:"تعداد درخواست‌ها بیش از حد مجاز است؛ یک دقیقه دیگر دوباره تلاش کنید."},429,request,{"Retry-After":"60"});
 return json({error:"محافظت امنیتی سرویس موقتاً در دسترس نیست."},503,request);
}
function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function ema(values,period){if(values.length<period)return null;let k=2/(period+1),v=mean(values.slice(0,period));for(let i=period;i<values.length;i++)v=values[i]*k+v*(1-k);return v}
function emaSeries(values,period){const out=new Array(values.length).fill(null);if(values.length<period)return out;const k=2/(period+1);let value=mean(values.slice(0,period));out[period-1]=value;for(let i=period;i<values.length;i++){value=values[i]*k+value*(1-k);out[i]=value;}return out;}
function rsi(values,p=14){if(values.length<=p)return null;let up=0,dn=0;for(let i=values.length-p;i<values.length;i++){let d=values[i]-values[i-1];if(d>0)up+=d;else dn-=d;}if(dn===0)return 100;let rs=(up/p)/(dn/p);return 100-100/(1+rs)}
function analyzeKlines(rows){
 const candles=rows.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));
 const closes=candles.map(x=>x.c), highs=candles.map(x=>x.h), lows=candles.map(x=>x.l), vols=candles.map(x=>x.v);
 const last=candles[candles.length-1],e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200);
 const fast=ema(closes,12),slow=ema(closes,26);
 const fastSeries=emaSeries(closes,12),slowSeries=emaSeries(closes,26);
 const macdSeries=fastSeries.map((value,i)=>value==null||slowSeries[i]==null?null:value-slowSeries[i]).filter(Number.isFinite);
 const macd=fast!=null&&slow!=null?fast-slow:null,signal=macdSeries.length?ema(macdSeries,9):null;
 const tr=candles.slice(1).map((x,i)=>Math.max(x.h-x.l,Math.abs(x.h-candles[i].c),Math.abs(x.l-candles[i].c)));
 const atr=tr.length>=14?mean(tr.slice(-14)):null;
 const support=Math.min(...lows.slice(-30)),resistance=Math.max(...highs.slice(-30));
 const takerBuyBase=rows.slice(-24).reduce((s,x)=>s+Number(x[9]||0),0);
 const totalBase=rows.slice(-24).reduce((s,x)=>s+Number(x[5]||0),0);
 return {candles,price:last.c,change_pct:(last.c/closes[closes.length-2]-1)*100,rsi:rsi(closes),ema20:e20,ema50:e50,ema200:e200,ema_trend:e20&&e50&&e200?(last.c>e20&&e20>e50&&e50>e200?"bullish":last.c<e20&&e20<e50&&e50<e200?"bearish":"mixed"):"insufficient",macd,macd_signal:macd==null||signal==null?"insufficient":macd>signal?"bullish crossover bias":macd<signal?"bearish crossover bias":"neutral",atr,atr_percent:atr?atr/last.c*100:null,support,resistance,volume_ratio:mean(vols.slice(-5))/(mean(vols.slice(-25))||1),taker_buy_volume_ratio:totalBase?takerBuyBase/totalBase:null,candle_time:new Date(last.t).toISOString()};
}
function splitQuotePair(symbol){
 const match=String(symbol||"").toUpperCase().match(/^([A-Z0-9_]+?)(USDT|USDC|FDUSD|BUSD|USD|BTC|ETH|IRT)$/);
 return match?{base:match[1],quote:match[2]}:null;
}
function analyzeClosedKlines(rows,interval){
 const duration=({"1m":60000,"3m":180000,"5m":300000,"15m":900000,"1h":3600000,"4h":14400000,"1d":86400000})[interval];
 if(!duration)throw new Error("Unsupported candle interval: "+interval);
 const minimum=interval==="1d"?20:30,now=Date.now();
 const normalized=normalizeMarketCandles(rows);
 const closed=normalized.filter(row=>Number(row[0])+duration<=now-1000);
 if(closed.length<minimum)throw new Error("داده کندل‌های بسته‌شده کافی نیست؛ داده کندل باز برای تحلیل استفاده نمی‌شود.");
 const result=analyzeKlines(closed),lastOpen=Number(closed[closed.length-1][0]),closedAt=lastOpen+duration;
 result.candle_time=new Date(lastOpen).toISOString();
 result.candle_closed_at=new Date(closedAt).toISOString();
 const freshness=assessMarketDataFreshness(closedAt,now,duration*2);result.data_age_ms=freshness.ageMs;result.data_fresh=freshness.fresh;result.data_freshness_reason=freshness.reason;
 // Keep the active, still-forming candle for chart display; all analysis above remains closed-candle-only.
 const chartRows=normalized.slice(-250),chartLast=chartRows[chartRows.length-1],chartAge=Math.max(0,now-Number(chartLast?.[0]||0));
 result.chart_candles=chartRows.map(row=>({time:Math.floor(Number(row[0])/1000),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5])||0}));
 result.chart_data_age_ms=chartAge;
 result.chart_data_fresh=!!chartLast&&chartAge<=duration*1.5;
 result.chart_data_freshness_reason=result.chart_data_fresh?"latest candle timestamp is within the live freshness window":"latest candle is older than "+Math.round(duration*1.5/60000)+" minutes";
 if(!result.chart_data_fresh)throw new Error("کندل‌های منبع قدیمی هستند؛ "+result.chart_data_freshness_reason);
 result.candle_interval=interval;
 return result;
}
async function candles(symbol,interval,env,marketType="spot"){
 const headers={"Accept":"application/json, text/plain, */*","User-Agent":"MMP-COIN-AI/1.0","Accept-Language":"en-US,en;q=0.9"};
 const minimumCandles=interval==="1d"?20:30;
 if(marketType==="spot"&&String(symbol).toUpperCase().endsWith("IRT")){
  const base=String(symbol).toUpperCase().slice(0,-3),resolution={"1m":"1","3m":"3","5m":"5","15m":"15","1h":"60","4h":"240","1d":"D"}[interval],seconds={"1m":60,"3m":180,"5m":300,"15m":900,"1h":3600,"4h":14400,"1d":86400}[interval];
  if(!base||!resolution||!seconds)throw new Error("Unsupported Nobitex candle interval or pair");
  const to=Math.floor(Date.now()/1000),from=to-seconds*260;let lastError=null;
  for(const host of ["https://apiv2.nobitex.ir","https://api.nobitex.ir"]){
   try{
    const url=host+"/market/udf/history?symbol="+encodeURIComponent(base+"IRT")+"&resolution="+resolution+"&from="+from+"&to="+to;
    const response=await fetchWithTimeout(url,{headers});
    if(!response.ok)throw new Error("Nobitex candle HTTP "+response.status);
    const payload=await response.json();
    if(payload?.s!=="ok"||!Array.isArray(payload.t))throw new Error(payload?.errmsg||"Nobitex candle history unavailable");
    const rows=payload.t.map((time,i)=>[Number(time)*1000,String(payload.o?.[i]??0),String(payload.h?.[i]??0),String(payload.l?.[i]??0),String(payload.c?.[i]??0),String(payload.v?.[i]??0)]).filter(row=>row.slice(1,5).every(value=>Number(value)>0)).sort((a,b)=>a[0]-b[0]);
    if(rows.length<minimumCandles)throw new Error("Nobitex candle history is insufficient");
    const result=analyzeClosedKlines(rows,interval);result.data_provider="Nobitex Spot";return result;
   }catch(error){lastError=error;}
  }
  throw new Error("Nobitex Spot data unavailable for "+symbol+": "+(lastError?.message||"no candle response"));
 }
 const okxBar={"1m":"1m","3m":"3m","5m":"5m","15m":"15m","1h":"1H","4h":"4H","1d":"1Dutc"}[interval];
 const bybitInterval={"1m":"1","3m":"3","5m":"5","15m":"15","1h":"60","4h":"240","1d":"D"}[interval];
 const toBybitRows=list=>list.slice().reverse().map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]);
 const toOkxRows=list=>list.slice().reverse().map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]);
 const validRows=rows=>Array.isArray(rows)&&rows.length>=minimumCandles;
 if(marketType==="futures"){
  let errors=[];
  const pair=splitQuotePair(symbol);
  if(!pair||pair.quote!=="USDT")throw new Error("Futures market supports USDT perpetual contracts only");
  const contract=pair.base+"_USDT";
  const kucoinGranularity={"1m":1,"5m":5,"15m":15,"1h":60,"4h":240,"1d":1440}[interval];
  if(kucoinGranularity){
   try{
    const now=Date.now(),kucoinSymbol=(pair.base==="BTC"?"XBT":pair.base)+"USDTM";
    const url="https://api-futures.kucoin.com/api/v1/kline/query?symbol="+encodeURIComponent(kucoinSymbol)+"&granularity="+kucoinGranularity+"&from="+(now-300*kucoinGranularity*60000)+"&to="+now;
    const r=await fetchWithTimeout(url,{headers});if(!r.ok)throw new Error("KuCoin Futures HTTP "+r.status);
    const d=await r.json(),raw=d?.code==="200000"?d.data:null;
    const rows=Array.isArray(raw)?raw.map(x=>[Number(x[0]),String(x[1]),String(x[2]),String(x[3]),String(x[4]),String(x[5]||0),String(x[6]||0),"0","0","0"]):[];
    if(!validRows(rows))throw new Error(d?.msg||"insufficient KuCoin Futures candle history");
    const result=analyzeClosedKlines(rows,interval);result.data_provider="KuCoin USDT Futures";return result;
   }catch(e){errors.push("KuCoin: "+e.message);}
  }
  for(const host of ["https://api.gateio.ws","https://api.gate.us"]){
   try{
    const r=await fetchWithTimeout(host+"/api/v4/futures/usdt/candlesticks?contract="+encodeURIComponent(contract)+"&interval="+interval+"&limit=250",{headers});
    if(!r.ok)throw new Error("Gate Futures HTTP "+r.status);
    const raw=await r.json(),rows=Array.isArray(raw)?raw.map(x=>[Number(x.t)<1e12?Number(x.t)*1000:Number(x.t),x.o,x.h,x.l,x.c,x.v,x.sum||"0","0","0","0"]):[];
    if(!validRows(rows))throw new Error("insufficient Gate Futures candle history");
    const result=analyzeClosedKlines(rows,interval);result.data_provider="Gate USDT Futures";return result;
   }catch(e){errors.push("Gate: "+e.message);if(/HTTP (400|403|429|451)|invalid|not listed|insufficient|Symbol Is Invalid/i.test(String(e?.message||e)))break;}
  }
  try{
   const mexcInterval={"1m":"Min1","5m":"Min5","15m":"Min15","1h":"Min60","4h":"Hour4","1d":"Day1"}[interval];
  if(mexcInterval){
   try{
    const now=Math.floor(Date.now()/1000),start=now-300*({"1m":60,"5m":300,"15m":900,"1h":3600,"4h":14400,"1d":86400}[interval]);
    const r=await fetchWithTimeout("https://contract.mexc.com/api/v1/contract/kline/"+encodeURIComponent(contract)+"?interval="+mexcInterval+"&start="+start+"&end="+now,{headers});
    if(!r.ok)throw new Error("MEXC Futures HTTP "+r.status);
    const d=await r.json(),v=d?.data;
    const rows=d?.success===true&&Array.isArray(v?.time)?v.time.map((t,i)=>[Number(t)*1000,String(v.open?.[i]??0),String(v.high?.[i]??0),String(v.low?.[i]??0),String(v.close?.[i]??0),String(v.vol?.[i]??0),String(v.amount?.[i]??0),"0","0","0"]):[];
    if(!validRows(rows))throw new Error(d?.msg||"insufficient MEXC Futures candle history");
    const result=analyzeClosedKlines(rows,interval);result.data_provider="MEXC USDT Futures";return result;
   }catch(e){errors.push("MEXC: "+e.message);}
  }
  const url="https://api.bitget.com/api/v3/market/candles?category=USDT-FUTURES&symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250";
   const r=await fetchWithTimeout(url,{headers});if(!r.ok)throw new Error("Bitget Futures HTTP "+r.status);
   const payload=await r.json(),raw=payload?.code==="00000"?payload.data:null;
   const rows=Array.isArray(raw)?raw.map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5]||"0",x[6]||"0","0","0","0"]):[];
   if(!validRows(rows))throw new Error(payload?.msg||"insufficient Bitget Futures candle history");
   const result=analyzeClosedKlines(rows,interval);result.data_provider="Bitget USDT Futures";return result;
  }catch(e){errors.push("Bitget: "+e.message);}
  for(const host of ["https://api.bybit.com","https://api.bytick.com","https://api.bybit.eu"]){
   try{
    const url=host+"/v5/market/kline?category=linear&symbol="+encodeURIComponent(symbol)+"&interval="+bybitInterval+"&limit=250";
    const r=await fetchWithTimeout(url,{headers});if(!r.ok)throw new Error("Bybit Linear HTTP "+r.status);
    const payload=await r.json(),list=payload?.retCode===0?payload.result?.list:null;
    if(!validRows(list))throw new Error(payload?.retMsg||"insufficient Bybit linear candle history");
    const result=analyzeClosedKlines(toBybitRows(list),interval);result.data_provider="Bybit Linear Perpetual";return result;
   }catch(e){errors.push("Bybit: "+e.message);if(/HTTP (400|403|429|451)|invalid|not listed|insufficient|Symbol Is Invalid/i.test(String(e?.message||e)))break;}
  }
  if(pair){
   for(const host of ["https://www.okx.com","https://us.okx.com"]){
    try{
     const instId=pair.base+"-"+pair.quote+"-SWAP",r=await fetchWithTimeout(host+"/api/v5/market/candles?instId="+encodeURIComponent(instId)+"&bar="+okxBar+"&limit=250",{headers});
     if(!r.ok)throw new Error("OKX Swap HTTP "+r.status);
     const payload=await r.json(),list=payload?.code==="0"?payload.data:null;
     if(!validRows(list))throw new Error(payload?.msg||"insufficient OKX swap candle history");
     const result=analyzeClosedKlines(toOkxRows(list),interval);result.data_provider="OKX Linear Swap";return result;
    }catch(e){errors.push("OKX: "+e.message);if(/HTTP (400|403|429|451)|invalid|not listed|insufficient|Symbol Is Invalid/i.test(String(e?.message||e)))break;}
   }
  }
  for(const host of ["https://fapi.binance.com","https://fapi1.binance.com","https://fapi2.binance.com","https://fapi3.binance.com"]){
   try{
    const r=await fetchWithTimeout(host+"/fapi/v1/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",{headers});
    if(!r.ok)throw new Error("Binance Futures HTTP "+r.status);
    const rows=await r.json();if(!validRows(rows))throw new Error("insufficient Binance Futures candle history");
    const result=analyzeClosedKlines(rows,interval);result.data_provider="Binance USD-M Futures";return result;
   }catch(e){errors.push("Binance: "+e.message);if(/HTTP (400|403|429|451)|invalid|not listed|insufficient|Symbol Is Invalid/i.test(String(e?.message||e)))break;}
  }
  throw new Error("Futures data unavailable for "+symbol+" "+interval+"; "+errors.join(" | ").slice(0,520));
 }
 let lastError=null,bitgetError=null,bybitError=null,okxError=null;
 const pairInfo=splitQuotePair(symbol);
 if(pairInfo){
  try{
   const kucoinInterval={"1m":"1min","3m":"3min","5m":"5min","15m":"15min","1h":"1hour","4h":"4hour","1d":"1day"}[interval];
   const url="https://api.kucoin.com/api/v1/market/candles?symbol="+encodeURIComponent(pairInfo.base+"-"+pairInfo.quote)+"&type="+kucoinInterval;
   const r=await fetchWithTimeout(url,{headers});
   if(!r.ok)throw new Error("KuCoin Spot HTTP "+r.status);
   const payload=await r.json(),rows=payload?.code==="200000"?payload.data:null;
   if(!validRows(rows))throw new Error(payload?.msg||"insufficient KuCoin spot candle history");
   const normalized=rows.map(x=>Array.isArray(x)?[Number(x[0])*1000,x[1],x[3],x[4],x[2],x[5]||"0","0","0","0","0"]:[Number(x.time)*1000,x.open,x.highest,x.lowest,x.close,x.volume||"0","0","0","0","0"]).sort((a,b)=>a[0]-b[0]);
   const result=analyzeClosedKlines(normalized,interval);result.data_provider="KuCoin Spot (fallback)";return result;
  }catch(e){lastError=new Error((lastError?.message||"Binance unavailable")+"; "+e.message);}
  try{
   const gateInterval={"1m":"1m","3m":"3m","5m":"5m","15m":"15m","1h":"1h","4h":"4h","1d":"1d"}[interval];
   const gatePair=pairInfo.base+"_"+pairInfo.quote;
   const url="https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair="+encodeURIComponent(gatePair)+"&interval="+gateInterval+"&limit=250";
   const r=await fetchWithTimeout(url,{headers});
   if(!r.ok)throw new Error("Gate.io Spot HTTP "+r.status);
   const rows=await r.json();
   if(!validRows(rows))throw new Error("insufficient Gate.io spot candle history");
   const normalized=rows.map(x=>[Number(x[0])<1e12?Number(x[0])*1000:Number(x[0]),x[5],x[3],x[4],x[2],x[6]||"0","0","0","0","0"]).sort((a,b)=>a[0]-b[0]);
   const result=analyzeClosedKlines(normalized,interval);result.data_provider="Gate.io Spot (fallback)";return result;
  }catch(e){lastError=new Error((lastError?.message||"Binance unavailable")+"; "+e.message);}
 }
 const whitebitPair=splitQuotePair(symbol);
 if(whitebitPair){
  let whitebitError=null;
  const market=whitebitPair.base+"_"+whitebitPair.quote;
  const whitebitInterval={"1m":"1m","3m":"3m","5m":"5m","15m":"15m","1h":"1h","4h":"4h","1d":"1d"}[interval];
  for(const host of ["https://whitebit.com","https://whitebit.eu","https://whitebit.tr","https://whitebit.ge"]){
   try{
    // Confirm the exact market is currently listed before requesting its candles.
    // This avoids sending stale/unsupported symbols to WhiteBIT's instrument resolver.
    const symbolsResponse=await fetchWithTimeout(host+"/api/v1/public/symbols",{headers});
    if(!symbolsResponse.ok)throw new Error("WhiteBIT symbols HTTP "+symbolsResponse.status);
    const symbolsPayload=await symbolsResponse.json();
    const availableSymbols=symbolsPayload?.success===true&&Array.isArray(symbolsPayload.result)?symbolsPayload.result:[];
    if(!availableSymbols.includes(market))throw new Error("WhiteBIT market is not listed: "+market);
    const url=host+"/api/v1/public/kline?market="+encodeURIComponent(market)+"&interval="+whitebitInterval+"&limit=250";
    const r=await fetchWithTimeout(url,{headers});
    if(!r.ok)throw new Error("WhiteBIT HTTP "+r.status);
    const payload=await r.json(),rows=payload?.success===true?(Array.isArray(payload.result)?payload.result:Array.isArray(payload.result?.kline)?payload.result.kline:null):null;
    if(!validRows(rows))throw new Error(typeof payload?.message==="string"?payload.message:"insufficient WhiteBIT candle history");
    const normalized=rows.map(x=>[Number(x[0])*1000,x[1],x[3],x[4],x[2],x[5]||"0","0","0","0","0"]).sort((a,b)=>a[0]-b[0]);
    const result=analyzeClosedKlines(normalized,interval);result.data_provider="WhiteBIT Spot";return result;
   }catch(e){whitebitError=e;if(/HTTP (400|403|429|451)|invalid|not listed|insufficient|Symbol Is Invalid/i.test(String(e?.message||e)))break;}
  }
  lastError=new Error((lastError?.message||"Earlier spot sources unavailable")+"; "+(whitebitError?.message||"WhiteBIT unavailable"));
 }

 try{
  const r=await fetchWithTimeout("https://api.mexc.com/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",{headers});
  if(!r.ok)throw new Error("MEXC Spot HTTP "+r.status);
  const rows=await r.json();if(!validRows(rows))throw new Error("insufficient MEXC spot candle history");
  const result=analyzeClosedKlines(rows,interval);result.data_provider="MEXC Spot";return result;
 }catch(e){lastError=new Error((lastError?.message||"Binance unavailable")+"; "+e.message);}
 try{
  const bitgetInterval={"1m":"1m","3m":"3m","5m":"5m","15m":"15m","1h":"1H","4h":"4H","1d":"1D"}[interval];
  const url="https://api.bitget.com/api/v3/market/candles?category=SPOT&symbol="+encodeURIComponent(symbol)+"&interval="+bitgetInterval+"&limit=250";
  const r=await fetchWithTimeout(url,{headers});
  if(!r.ok)throw new Error("Bitget Spot HTTP "+r.status);
  const payload=await r.json(),rows=payload?.code==="00000"||payload?.code==="0"?payload.data:null;
  if(!validRows(rows))throw new Error(payload?.msg||"insufficient Bitget spot candle history");
  const normalized=rows.map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]).sort((a,b)=>a[0]-b[0]);
  const result=analyzeClosedKlines(normalized,interval);result.data_provider="Bitget Spot";return result;
 }catch(e){bitgetError=e;}
 try{
  const bitgetGranularity={"1m":"1min","3m":"3min","5m":"5min","15m":"15min","1h":"1h","4h":"4h","1d":"1day"}[interval];
  const now=Date.now(),start=now-250*({"1m":60000,"3m":180000,"5m":300000,"15m":900000,"1h":3600000,"4h":14400000,"1d":86400000}[interval]);
  const url="https://api.bitget.com/api/v2/spot/market/candles?symbol="+encodeURIComponent(symbol)+"&granularity="+bitgetGranularity+"&startTime="+start+"&endTime="+now+"&limit=250";
  const r=await fetchWithTimeout(url,{headers:{...headers,"Origin":"https://www.bitget.com","Referer":"https://www.bitget.com/","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"}});if(!r.ok)throw new Error("Bitget Spot V2 HTTP "+r.status);
  const payload=await r.json(),rows=payload?.code==="00000"?payload.data:null;
  if(!validRows(rows))throw new Error(payload?.msg||"insufficient Bitget V2 spot candle history");
  const normalized=rows.map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]).sort((a,b)=>a[0]-b[0]);
  const result=analyzeClosedKlines(normalized,interval);result.data_provider="Bitget Spot V2 fallback";return result;
 }catch(e){bitgetError=new Error((bitgetError?.message||"Bitget V3 unavailable")+"; "+e.message);}
 for(const host of ["https://api.bybit.com","https://api.bytick.com","https://api.bybit.eu"]){
  try{
   const url=host+"/v5/market/kline?category=spot&symbol="+encodeURIComponent(symbol)+"&interval="+bybitInterval+"&limit=250";
   const r=await fetchWithTimeout(url,{headers});
   if(!r.ok)throw new Error("Bybit Spot HTTP "+r.status);
   const payload=await r.json(),list=payload?.retCode===0?payload.result?.list:null;
   if(!validRows(list))throw new Error(payload?.retMsg||"insufficient Bybit spot candle history");
   const result=analyzeClosedKlines(toBybitRows(list),interval);result.data_provider="Bybit Spot (fallback)";return result;
  }catch(e){bybitError=e;if(/HTTP (400|403|429|451)|invalid|not listed|insufficient|Symbol Is Invalid/i.test(String(e?.message||e)))break;}
 }
 const pair=splitQuotePair(symbol);
 if(pair){
  const instId=pair.base+"-"+pair.quote;
  for(const host of ["https://www.okx.com"]){
   try{
    const r=await fetchWithTimeout(host+"/api/v5/market/candles?instId="+encodeURIComponent(instId)+"&bar="+okxBar+"&limit=250",{headers});
    if(!r.ok)throw new Error("OKX Spot HTTP "+r.status);
    const payload=await r.json(),list=payload?.code==="0"?payload.data:null;
    if(!validRows(list))throw new Error(payload?.msg||"insufficient OKX spot candle history");
    const result=analyzeClosedKlines(toOkxRows(list),interval);result.data_provider="OKX Spot (fallback)";return result;
   }catch(e){okxError=e;}
  }
 }else okxError=new Error("Unsupported quote currency for OKX spot");
 const spotUrls=[
  "https://api.binance.com/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",
  "https://api.binance.us/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",
  "https://api1.binance.com/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",
  "https://api2.binance.com/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",
  "https://api3.binance.com/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",
  "https://data-api.binance.vision/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250"
 ];
 for(const url of spotUrls){
  try{
   const r=await fetchWithTimeout(url,{headers});
   if(!r.ok)throw new Error("Binance Spot HTTP "+r.status);
   const rows=await r.json();
   if(!validRows(rows))throw new Error("insufficient Binance spot candle history");
   const result=analyzeClosedKlines(rows,interval);
   result.data_provider=url.includes("binance.us")?"Binance.US":url.includes("data-api")?"Binance Data API":url.includes("api1.")||url.includes("api2.")||url.includes("api3.")?"Binance mirror":"Binance Spot";
   return result;
  }catch(e){lastError=e;if(/HTTP (400|403|429|451)|invalid|not listed|insufficient|Symbol Is Invalid/i.test(String(e?.message||e)))break;}
 }
 throw new Error("Spot data unavailable for "+symbol+" "+interval+"; Binance: "+(lastError?.message||"failed")+"; Bybit: "+(bybitError?.message||"failed")+"; Bitget: "+(bitgetError?.message||"failed")+"; OKX: "+(okxError?.message||"failed"));
}
function roundPrice(value,price){const decimals=price>=1000?2:price>=1?4:price>=0.01?6:8;return Number(value.toFixed(decimals));}
function buildSetup(direction,m){
 const price=Number(m?.price),atr=Number(m?.atr),support=Number(m?.support),resistance=Number(m?.resistance);
 if(!Number.isFinite(price)||price<=0||!Number.isFinite(atr)||atr<=0)return null;
 const pad=atr*0.12;let low,high,stop,entry;
 if(direction==="LONG"){
  const pivot=Number.isFinite(resistance)&&resistance>price*0.995?resistance:price;
  low=Math.max(price,pivot);high=low+pad;entry=(low+high)/2;
  stop=Math.min(entry-atr*0.9,Number.isFinite(support)&&support<entry?support-atr*0.12:entry-atr*1.1);
 }else{
  const pivot=Number.isFinite(support)&&support<price*1.005?support:price;
  low=pivot-pad;high=Math.min(price,pivot);entry=(low+high)/2;
  stop=Math.max(entry+atr*0.9,Number.isFinite(resistance)&&resistance>entry?resistance+atr*0.12:entry+atr*1.1);
 }
 const risk=Math.abs(entry-stop);if(!Number.isFinite(risk)||risk<=0)return null;
 const sign=direction==="LONG"?1:-1,fmt=x=>roundPrice(x,price),target=k=>fmt(entry+sign*risk*k);
 return {direction,entry_zone:{low:fmt(low),high:fmt(high)},stop_loss:fmt(stop),tp1:target(1.5),tp2:target(2.2),tp3:target(3),risk_reward:"1:1.5 / 1:2.2 / 1:3",holding_horizon:"تا تأیید بسته‌شدن کندل ۴ ساعته",position_risk:"پس از تأیید: حداکثر ۱٪ سرمایه در معرض زیان؛ حجم معامله بر اساس فاصله حد ضرر",trigger:direction==="LONG"?"فقط پس از بسته‌شدن کندل ۴ ساعته بالای مقاومت و تثبیت قیمت":"فقط پس از بسته‌شدن کندل ۴ ساعته زیر حمایت و تثبیت قیمت",invalidation:direction==="LONG"?"بسته‌شدن کندل ۴ ساعته دوباره زیر سطح شکست":"بسته‌شدن کندل ۴ ساعته دوباره بالای سطح شکست"};
}
function buildTradePlans(longMarket,action,mode,shortMarket=longMarket){
 const long=buildSetup("LONG",longMarket),short=mode==="spot"||!shortMarket?null:buildSetup("SHORT",shortMarket);
 if(action==="BUY"&&long)return {active:long,conditional:null};
 if(action==="SELL"&&short)return {active:short,conditional:null};
 return {active:null,conditional:{long,short}};
}

function validSymbol(s){return /^[A-Z0-9_]{2,30}$/.test(s||"")&&!s.startsWith("_")&&!s.endsWith("_")&&!s.includes("USDTUSDT")}
const ASSET_SYMBOL_OVERRIDES=Object.freeze({bitcoin:"BTC",ethereum:"ETH",tether:"USDT","usd-coin":"USDC",binancecoin:"BNB",solana:"SOL",ripple:"XRP",dogecoin:"DOGE",cardano:"ADA","avalanche-2":"AVAX","the-open-network":"TON",tron:"TRX",litecoin:"LTC",polkadot:"DOT",chainlink:"LINK"});

let exchangeCatalogCache=null,exchangeCatalogCacheAt=0;
async function fetchWithTimeout(url,options={},timeoutMs=9000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 const externalSignal=options.signal;
 let abortExternal=()=>controller.abort();
 if(externalSignal){if(externalSignal.aborted)controller.abort();else externalSignal.addEventListener("abort",abortExternal,{once:true});}
 try{return await fetch(url,{...options,signal:controller.signal});}
 finally{clearTimeout(timer);if(externalSignal)externalSignal.removeEventListener("abort",abortExternal);}
}
async function marketFallbackKey(cacheIdentity){
 // Hash a stable logical cache identity, never the full request URL: clients may
 // append cache-busting timestamps that otherwise create an unlimited D1 key stream.
 const bytes=new TextEncoder().encode(String(cacheIdentity));
 const digest=await crypto.subtle.digest("SHA-256",bytes);
 return "market:"+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
async function readMarketFallback(env,key){
 if(!env.MARKET_CACHE_DB)return null;
 try{
  const row=await env.MARKET_CACHE_DB.prepare("SELECT payload,cached_at FROM market_data_cache WHERE cache_key = ?").bind(key).first();
  if(!row?.payload||!Number.isFinite(Number(row.cached_at)))return null;
  const ageMs=Math.max(0,Date.now()-Number(row.cached_at));
  // Keep last-known-good fallback for 24h through temporary upstream/D1 outages.
  if(ageMs>86400000)return null;
  const payload=JSON.parse(row.payload);
  return payload&&typeof payload==="object"?{payload,ageMs}:null;
 }catch{return null;}
}
async function writeMarketFallback(env,key,payload,previous=null,minIntervalMs=21600000){
 // D1 is a last-resort fallback, not a live ticker store. Live data is fetched
 // upstream; persist each stable fallback key at most once every six hours.
 const writeIntervalMs=Math.max(21600000,Number(minIntervalMs)||0);
 if(!env.MARKET_CACHE_DB||previous?.ageMs<writeIntervalMs)return;
 try{
  await env.MARKET_CACHE_DB.prepare("INSERT INTO market_data_cache (cache_key,payload,cached_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,cached_at=excluded.cached_at").bind(key,JSON.stringify(payload),Date.now()).run();
 }catch(error){console.warn("Market fallback cache write failed:",String(error?.message||error).slice(0,180));}
}
async function cleanupMarketFallbackCache(env){
 const now=new Date();
 // Run once daily and delete in a small bounded batch; never sweep the full cache.
 if(!env.MARKET_CACHE_DB||now.getUTCHours()!==0||now.getUTCMinutes()!==15)return;
 try{
  const cutoff=Date.now()-7*86400000;
  await env.MARKET_CACHE_DB.prepare("DELETE FROM market_data_cache WHERE cache_key IN (SELECT cache_key FROM market_data_cache WHERE cached_at < ? ORDER BY cached_at ASC LIMIT 100)").bind(cutoff).run();
  // Keep the fallback table bounded without a large daily sweep.
  await env.MARKET_CACHE_DB.prepare("DELETE FROM market_data_cache WHERE cache_key IN (SELECT cache_key FROM market_data_cache ORDER BY cached_at ASC LIMIT 100) AND (SELECT COUNT(*) FROM market_data_cache)>4000").run();
 }catch(error){console.warn("Market fallback cache cleanup failed:",String(error?.message||error).slice(0,160));}
}
async function readPublicJson(url){
 try{
  const r=await fetchWithTimeout(url,{headers:{"Accept":"application/json, text/plain, */*","User-Agent":"MMP-COIN-AI/1.0","Accept-Language":"en-US,en;q=0.9"}},7500);
  if(!r.ok)return {ok:false,status:r.status,error:"HTTP "+r.status};
  const data=await r.json();return {ok:true,status:r.status,data};
 }catch(e){return {ok:false,status:0,error:e.message||"network error"};}
}
async function readAnyPublicJson(urls){
 let last=null;
 for(const url of urls){
  const result=await readPublicJson(url);
  if(result.ok)return {...result,source:url};
  last=result;
 }
 return last||{ok:false,status:0,error:"No public endpoint responded"};
}
async function readOkxCatalog(instType){
 let last=null;
 for(const host of ["https://www.okx.com"]){
  const r=await readPublicJson(host+"/api/v5/public/instruments?instType="+instType);
  if(r.ok&&r.data?.code==="0"&&Array.isArray(r.data.data))return {...r,source:host};
  last=r;
 }
 return last||{ok:false,status:0,error:"OKX catalog unavailable"};
}
async function getExchangeCatalogs(){
 if(exchangeCatalogCache&&Date.now()-exchangeCatalogCacheAt<300000)return exchangeCatalogCache;
 const urls=[
  ["binance_spot","https://api.binance.com/api/v3/exchangeInfo"],
  ["bybit_spot",[
   "https://api.bybit.eu/v5/market/instruments-info?category=spot&limit=1000",
   "https://api.bytick.eu/v5/market/instruments-info?category=spot&limit=1000",
   "https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000",
   "https://api.bytick.com/v5/market/instruments-info?category=spot&limit=1000"
  ]],
  ["binance_futures","https://fapi.binance.com/fapi/v1/exchangeInfo"],
  ["bybit_futures",[
   "https://api.bybit.eu/v5/market/instruments-info?category=linear&limit=1000",
   "https://api.bytick.eu/v5/market/instruments-info?category=linear&limit=1000",
   "https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000",
   "https://api.bytick.com/v5/market/instruments-info?category=linear&limit=1000"
  ]],
  ["bitget_futures","https://api.bitget.com/api/v3/market/tickers?category=USDT-FUTURES"],
  ["gate_futures",["https://api.gateio.ws/api/v4/futures/usdt/tickers","https://api.gate.us/api/v4/futures/usdt/tickers"]],
  ["bitget_spot","https://api.bitget.com/api/v3/market/instruments?category=SPOT"],
  ["whitebit_spot",["https://whitebit.com/api/v1/public/markets","https://whitebit.eu/api/v1/public/markets","https://whitebit.tr/api/v1/public/markets","https://whitebit.ge/api/v1/public/markets"]],
  ["gate_spot",["https://api.gateio.ws/api/v4/spot/currency_pairs","https://api.gate.us/api/v4/spot/currency_pairs"]],
  ["kucoin_spot",["https://api.kucoin.com/api/v2/symbols","https://api.kucoin.tr/api/v2/symbols"]],
  ["nobitex_spot","https://apiv2.nobitex.ir/market/stats?dstCurrency=rls"]
 ];
 const results=await Promise.all(urls.map(async ([key,endpoint])=>[key,Array.isArray(endpoint)?await readAnyPublicJson(endpoint):await readPublicJson(endpoint)]));
 const out=Object.fromEntries(results);
 const [okxSpot,okxSwap]=await Promise.all([readOkxCatalog("SPOT"),readOkxCatalog("SWAP")]);
 out.okx_spot=okxSpot;out.okx_futures=okxSwap;
 exchangeCatalogCache=out;exchangeCatalogCacheAt=Date.now();return out;
}
function exchangeSupport(symbol,catalogs){
 const base=String(symbol||"").toUpperCase();
 const quotes=["USDT","USDC","FDUSD","BUSD","USD","BTC","ETH","IRT"];
 const choose=items=>items.filter(Boolean).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const binanceSpotPair=(catalogs.binance_spot?.data?.symbols||[]).filter(x=>x.status==="TRADING"&&x.baseAsset===base&&quotes.includes(x.quoteAsset)).map(x=>({pair:x.symbol,quote:x.quoteAsset})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const bybitSpotPair=(catalogs.bybit_spot?.data?.result?.list||[]).filter(x=>x.status==="Trading"&&x.baseCoin===base&&quotes.includes(x.quoteCoin)).map(x=>({pair:x.symbol,quote:x.quoteCoin})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const okxSpotPair=(catalogs.okx_spot?.data?.data||[]).filter(x=>x.state==="live"&&x.baseCcy===base&&quotes.includes(x.quoteCcy)).map(x=>({pair:String(x.instId||"").replaceAll("-",""),quote:x.quoteCcy})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const bitgetSpotPair=(catalogs.bitget_spot?.data?.data||[]).filter(x=>x.status==="online"&&String(x.symbol||"").toUpperCase().startsWith(base)&&quotes.some(q=>String(x.symbol||"").toUpperCase()===base+q)).map(x=>{const q=quotes.find(q=>String(x.symbol||"").toUpperCase()===base+q);return q?{pair:String(x.symbol).toUpperCase(),quote:q}:null;}).filter(Boolean).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const whitebitSpotPair=(catalogs.whitebit_spot?.data?.success===true?(catalogs.whitebit_spot.data.result||[]):[]).filter(x=>String(x.stock||"").toUpperCase()===base&&quotes.includes(String(x.money||"").toUpperCase())).map(x=>({pair:String(x.name||"").toUpperCase().replace("_",""),quote:String(x.money).toUpperCase()})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const gateSpotPair=(Array.isArray(catalogs.gate_spot?.data)?catalogs.gate_spot.data:[]).filter(x=>String(x.base||"").toUpperCase()===base&&quotes.includes(String(x.quote||"").toUpperCase())&&["tradable","buyable","sellable"].includes(String(x.trade_status||"").toLowerCase())).map(x=>({pair:String(x.base).toUpperCase()+String(x.quote).toUpperCase(),quote:String(x.quote).toUpperCase()})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const kucoinSpotPair=(catalogs.kucoin_spot?.data?.code==="200000"&&Array.isArray(catalogs.kucoin_spot.data.data)?catalogs.kucoin_spot.data.data:[]).filter(x=>x.enableTrading===true&&String(x.baseCurrency||"").toUpperCase()===base&&quotes.includes(String(x.quoteCurrency||"").toUpperCase())).map(x=>({pair:String(x.baseCurrency).toUpperCase()+String(x.quoteCurrency).toUpperCase(),quote:String(x.quoteCurrency).toUpperCase()})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const nobitexStats=catalogs.nobitex_spot?.data?.stats||{};
 const nobitexSpotPair=Number(nobitexStats[base.toLowerCase()+"-rls"]?.latest)>0&&Number(nobitexStats["usdt-rls"]?.latest)>0?{pair:base+"IRT",quote:"IRT"}:null;
 const binanceFuturesPair=(catalogs.binance_futures?.data?.symbols||[]).filter(x=>x.status==="TRADING"&&(!x.contractType||x.contractType==="PERPETUAL")&&x.baseAsset===base&&quotes.includes(x.quoteAsset)).map(x=>({pair:x.symbol,quote:x.quoteAsset})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const bybitFuturesPair=(catalogs.bybit_futures?.data?.result?.list||[]).filter(x=>x.status==="Trading"&&(!x.contractType||x.contractType==="LinearPerpetual")&&x.baseCoin===base&&quotes.includes(x.quoteCoin)).map(x=>({pair:x.symbol,quote:x.quoteCoin})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const okxFuturesPair=(catalogs.okx_futures?.data?.data||[]).filter(x=>x.state==="live"&&(!x.ctType||x.ctType==="linear")&&String(x.instId||"").endsWith("-SWAP")).map(x=>{const p=String(x.instId||"").split("-");return p[0]===base&&quotes.includes(p[1])?{pair:p[0]+p[1],quote:p[1]}:null;}).filter(Boolean).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const bitgetFuturesPair=(catalogs.bitget_futures?.data?.data||[]).filter(x=>String(x.symbol||"").toUpperCase()===base+"USDT"&&Number(x.lastPrice)>0).map(x=>({pair:String(x.symbol).toUpperCase(),quote:"USDT"}))[0]||null;
 const gateFuturesPair=(Array.isArray(catalogs.gate_futures?.data)?catalogs.gate_futures.data:[]).filter(x=>String(x.contract||"").toUpperCase()===base+"_USDT"&&Number(x.last)>0).map(x=>({pair:String(x.contract).toUpperCase(),quote:"USDT"}))[0]||null;
 const spotEntries=[["Binance",binanceSpotPair,catalogs.binance_spot],["Bybit",bybitSpotPair,catalogs.bybit_spot],["OKX",okxSpotPair,catalogs.okx_spot],["Bitget",bitgetSpotPair,catalogs.bitget_spot],["WhiteBIT",whitebitSpotPair,catalogs.whitebit_spot],["Gate.io",gateSpotPair,catalogs.gate_spot],["KuCoin",kucoinSpotPair,catalogs.kucoin_spot],["Nobitex",nobitexSpotPair,catalogs.nobitex_spot]];
 const futuresEntries=[["Binance",binanceFuturesPair,catalogs.binance_futures],["Bybit",bybitFuturesPair,catalogs.bybit_futures],["OKX",okxFuturesPair,catalogs.okx_futures],["Bitget",bitgetFuturesPair,catalogs.bitget_futures],["Gate",gateFuturesPair,catalogs.gate_futures]];
 const spot=choose(spotEntries.map(x=>x[1])),futures=choose(futuresEntries.map(x=>x[1]));
 const providerStates=entries=>Object.fromEntries(entries.map(([name,pair,source])=>[name,!source?.ok?(source?.error||"تأیید نشد"):pair?"فعال":"جفت فعال پیدا نشد"]));
 return {
  symbol:base,
  spot:{confirmed:!!spot,pair:spot?.pair||null,providers:spotEntries.filter(x=>x[1]).map(x=>x[0])},
  futures:{confirmed:!!futures,pair:futures?.pair||null,providers:futuresEntries.filter(x=>x[1]).map(x=>x[0])},
  providers:{spot:providerStates(spotEntries),futures:providerStates(futuresEntries)}
 };
}

function persianize(value){
 if(typeof value==="string"){
  const rules=[
   [/technical analysis/gi,"تحلیل تکنیکال"],
   [/wait\s+until/gi,"صبر کن تا"],
   [/wait for/gi,"منتظر"],
   [/strong/gi,"قوی"],
   [/weak/gi,"ضعیف"],
   [/signal/gi,"سیگنال"],
   [/t[íi]nال/gi,"سیگنال"],
   [/leverage/gi,"اهرم"],
   [/low/gi,"پایین"],
   [/high/gi,"بالا"],
   [/market/gi,"بازار"],
   [/entering|entry/gi,"ورود"],
   [/exit|exiting/gi,"خروج"],
   [/monitor|watch/gi,"زیر نظر بگیر"],
   [/volume/gi,"حجم معاملات"],
   [/breakout/gi,"شکست سطح"],
   [/breakdown/gi,"شکست نزولی سطح"],
   [/break/gi,"شکست"],
   [/price action/gi,"رفتار قیمت"],
   [/trend/gi,"روند"],
   [/risk management/gi,"مدیریت ریسک"],
   [/risk/gi,"ریسک"],
   [/position/gi,"موقعیت معاملاتی"],
   [/trade|trading/gi,"معامله"],
   [/confirm|confirmation/gi,"تأیید"],
   [/candle close/gi,"بسته‌شدن کندل"],
   [/support/gi,"حمایت"],
   [/resistance/gi,"مقاومت"],
   [/profit/gi,"سود"],
   [/loss/gi,"زیان"],
   [/bearish crossover bias/gi,"تمایل به تقاطع نزولی"],
   [/bullish crossover bias/gi,"تمایل به تقاطع صعودی"],
   [/conflicting signals/gi,"سیگنال‌های متعارض"],
   [/mixed signals/gi,"سیگنال‌های متناقض"],
   [/trend/gi,"روند"],
   [/mixed/gi,"متناقض"],
   [/fear/gi,"ترس"],
   [/greed/gi,"طمع"],
   [/support/gi,"حمایت"],
   [/resistance/gi,"مقاومت"],
   [/bullish/gi,"صعودی"],
   [/bearish/gi,"نزولی"],
   [/neutral/gi,"خنثی"],
   [/insufficient/gi,"ناکافی"],
   [/signals?/gi,"سیگنال"],
   [/信号/g,"سیگنال"],
   [/تrend/g,"روند"]
  ];
  for(const [pattern,replacement] of rules)value=value.replace(pattern,replacement);
  return value;
 }
 if(Array.isArray(value))return value.map(persianize);
 if(value&&typeof value==="object"){for(const key of Object.keys(value))value[key]=persianize(value[key]);}
 return value;
}


async function marketFlowJson(url,timeoutMs=4500,parentSignal=null){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),abortParent=()=>controller.abort();
 if(parentSignal?.aborted)controller.abort();else parentSignal?.addEventListener("abort",abortParent,{once:true});
 try{const response=await fetchWithTimeout(url,{headers:{"Accept":"application/json","User-Agent":"MMP-COIN-AI-FLOW/1.0"},signal:controller.signal});if(!response.ok){const detail=(await response.text()).slice(0,180).replace(/\s+/g," ");throw new Error("HTTP "+response.status+" "+detail);}return await response.json();}
 finally{clearTimeout(timer);parentSignal?.removeEventListener("abort",abortParent);}
}
async function loadMarketFlow(symbol,windowMinutes=5,signal=null){
 const get=(url,timeoutMs=4500)=>marketFlowJson(url,timeoutMs,signal);
 const pair=String(symbol||"").toUpperCase().replace(/USDT$/,"")+"USDT";
 if(!/^[A-Z0-9]{2,24}USDT$/.test(pair))throw new Error("نماد نامعتبر است.");
 const minutes=Math.max(1,Math.min(15,Number(windowMinutes)||5)),now=Date.now(),cutoff=now-minutes*60000;
 let trades=null,provider="",truncated=false,lastError="";
 const betterFlow=(candidate,candidateTruncated)=>!trades?.length||(truncated&&!candidateTruncated)||(truncated===candidateTruncated&&candidate.length>trades.length);
 for(const host of ["https://api.bybit.com","https://api.bytick.com","https://api.bybit.eu"]){
  try{
   const d=await get(host+"/v5/market/recent-trade?category=spot&symbol="+pair+"&limit=60");
   if(Number(d.retCode)!==0)throw new Error(d.retMsg||"Bybit retCode "+d.retCode);
   const raw=Array.isArray(d.result?.list)?d.result.list:[];
   const oldest=raw.reduce((v,x)=>Math.min(v,Number(x.time)||Infinity),Infinity);
   truncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
   trades=raw.map(x=>({time:Number(x.time),price:Number(x.price),size:Number(x.size),side:String(x.side||"")})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0&&["Buy","Sell"].includes(x.side));
   provider="Bybit Spot · معاملات واقعی";
   break;
  }catch(error){lastError=String(error?.message||error).slice(0,160);}
 }
 if(!trades?.length||truncated||trades.length<8){
  for(const host of ["https://api.binance.com","https://api1.binance.com","https://api2.binance.com","https://api3.binance.com","https://data-api.binance.vision"]){
   try{
    const d=await get(host+"/api/v3/aggTrades?symbol="+pair+"&startTime="+cutoff+"&endTime="+now+"&limit=1000");
    if(!Array.isArray(d)||!d.length)throw new Error("Binance Spot aggregate trades unavailable or empty");
    const oldest=d.reduce((value,x)=>Math.min(value,Number(x.T)||Infinity),Infinity);
    const binanceTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
    const binanceTrades=d.map(x=>({time:Number(x.T),price:Number(x.p),size:Number(x.q),side:x.m?"Sell":"Buy"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
    if(binanceTrades.length&&betterFlow(binanceTrades,binanceTruncated)){trades=binanceTrades;truncated=binanceTruncated;provider="Binance Spot · معاملات تجمیعی واقعی";}
    if(trades?.length&&!truncated)break;
   }catch(error){lastError=String(error?.message||error).slice(0,160);}
  }
 }
 if(!trades?.length||truncated||trades.length<8){
  try{
   const d=await get("https://www.okx.com/api/v5/market/trades?instId="+encodeURIComponent(pair.replace(/USDT$/,"")+"-USDT")+"&limit=500");
   if(String(d.code)!=="0")throw new Error(d.msg||"OKX trades unavailable");
   const raw=Array.isArray(d.data)?d.data:[];
   const oldest=raw.reduce((v,x)=>Math.min(v,Number(x.ts)||Infinity),Infinity);
   const okxTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
   const okxTrades=raw.map(x=>({time:Number(x.ts),price:Number(x.px),size:Number(x.sz),side:String(x.side||"").toLowerCase()==="buy"?"Buy":"Sell"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
   if(okxTrades.length&&betterFlow(okxTrades,okxTruncated)){trades=okxTrades;truncated=okxTruncated;provider="OKX Spot · معاملات واقعی";}
  }catch(error){lastError=String(error?.message||error).slice(0,160);}
 }
 if(!trades?.length||truncated||trades.length<8){
  try{
   const gatePair=pair.replace(/USDT$/,"")+"_USDT",raw=[],seenGateTrades=new Set();
   let gateWindowComplete=false,gateNoProgress=false;
   // Gate's time-window endpoint is paginated. Continue until the oldest returned
   // trade reaches the requested window start, a short page proves exhaustion,
   // or the provider stops advancing. Never mark a capped sample as complete.
   for(let page=1;page<=20;page++){
    const query="https://api.gateio.ws/api/v4/spot/trades?currency_pair="+encodeURIComponent(gatePair)+"&from="+Math.floor(cutoff/1000)+"&to="+Math.ceil(now/1000)+"&limit=1000&page="+page;
    const batch=await get(query,4500);
    if(!Array.isArray(batch))throw new Error("Gate trades response invalid");
    let added=0;
    for(const trade of batch){
     const id=String(trade.id??trade.create_time_ms??trade.create_time)+":"+String(trade.price)+":"+String(trade.amount)+":"+String(trade.side);
     if(!seenGateTrades.has(id)){seenGateTrades.add(id);raw.push(trade);added++;}
    }
    const batchOldest=batch.reduce((v,x)=>Math.min(v,Number(x.create_time_ms)||Number(x.create_time)*1000||Infinity),Infinity);
    if(batch.length<1000){gateWindowComplete=true;break;}
    if(Number.isFinite(batchOldest)&&batchOldest<=cutoff+5000){gateWindowComplete=true;break;}
    if(added===0){gateNoProgress=true;break;}
   }
   const oldest=raw.reduce((v,x)=>Math.min(v,Number(x.create_time_ms)||Number(x.create_time)*1000||Infinity),Infinity);
   const gateTruncated=!gateWindowComplete;
   const gateTrades=raw.map(x=>({time:Number(x.create_time_ms)||Number(x.create_time)*1000,price:Number(x.price),size:Number(x.amount),side:String(x.side||"").toLowerCase()==="buy"?"Buy":"Sell"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
   if(gateTrades.length&&betterFlow(gateTrades,gateTruncated)){trades=gateTrades;truncated=gateTruncated;provider="Gate Spot · paged real trades";if(gateNoProgress&&gateTruncated)lastError="Gate pagination stopped advancing before the requested window was fully covered";}
  }catch(error){lastError=String(error?.message||error).slice(0,160);}
 }
 if(!trades?.length||truncated||trades.length<8){
  try{
   const d=await get("https://api.mexc.com/api/v3/trades?symbol="+pair+"&limit=1000");
   if(!Array.isArray(d))throw new Error("MEXC Spot trades response invalid");
   const oldest=d.reduce((v,x)=>Math.min(v,Number(x.time)||Infinity),Infinity),mexcTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
   const rows=d.map(x=>({time:Number(x.time),price:Number(x.price),size:Number(x.qty),side:x.isBuyerMaker?"Sell":"Buy"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
   if(rows.length&&betterFlow(rows,mexcTruncated)){trades=rows;truncated=mexcTruncated;provider="MEXC Spot · معاملات واقعی";}
  }catch(error){lastError="MEXC: "+String(error?.message||error).slice(0,160);}
 }
 if(!trades?.length||truncated||trades.length<8){
  try{
   const d=await get("https://api.kucoin.com/api/v1/market/histories?symbol="+encodeURIComponent(pair.replace(/USDT$/,"")+"-USDT"));
   if(String(d.code)!=="200000"||!Array.isArray(d.data))throw new Error(d.msg||"KuCoin Spot trade history unavailable");
   const raw=d.data,stamp=x=>{const t=Number(x.time);return t>1e15?t/1e6:t>1e12?t:t*1000;};
   const oldest=raw.reduce((v,x)=>Math.min(v,stamp(x)||Infinity),Infinity),kucoinTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
   const rows=raw.map(x=>({time:stamp(x),price:Number(x.price),size:Number(x.size),side:String(x.side||"").toLowerCase()==="buy"?"Buy":"Sell"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
   if(rows.length&&betterFlow(rows,kucoinTruncated)){trades=rows;truncated=kucoinTruncated;provider="KuCoin Spot · معاملات واقعی";}
  }catch(error){lastError="KuCoin: "+String(error?.message||error).slice(0,160);}
 }
 if(!trades?.length||truncated||trades.length<8){
 try{
  const market=pair.replace(/USDT$/,"")+"_USDT";
  const [buyRows,sellRows]=await Promise.all([
   get("https://whitebit.com/api/v4/public/trades/"+encodeURIComponent(market)+"?type=buy",4500),
   get("https://whitebit.com/api/v4/public/trades/"+encodeURIComponent(market)+"?type=sell",4500)
  ]);
  if(!Array.isArray(buyRows)||!Array.isArray(sellRows))throw new Error("WhiteBIT trades response invalid");
  const normalize=(rows,side)=>rows.map(x=>{let time=Number(x.trade_timestamp);if(time>0&&time<1e12)time*=1000;return {time,price:Number(x.price),size:Number(x.quote_volume),side};}).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
  const rows=[...normalize(buyRows,"Buy"),...normalize(sellRows,"Sell")].sort((a,b)=>b.time-a.time);
  const oldest=rows.reduce((v,x)=>Math.min(v,x.time),Infinity),whitebitTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
  if(rows.length&&betterFlow(rows,whitebitTruncated)){trades=rows;truncated=whitebitTruncated;provider="WhiteBIT Spot · معاملات واقعی";}
 }catch(error){lastError="WhiteBIT: "+String(error?.message||error).slice(0,160);}
}
if(!trades?.length||truncated||trades.length<8){
 try{
  // OKX Spot history is cursor-paginated; walk back until the requested window is fully covered.
  // This avoids treating a capped 500/1000-trade sample as a complete 5-minute flow window.
  const instId=pair.replace(/USDT$/,"")+"-USDT",history=[],seen=new Set();let after="",historyTruncated=true;
  for(let page=0;page<35;page++){
   const query="https://www.okx.com/api/v5/market/history-trades?instId="+encodeURIComponent(instId)+"&limit=100"+(after?"&after="+encodeURIComponent(after):"");
   const d=await get(query,4500);
   if(String(d.code)!=="0")throw new Error(d.msg||"OKX Spot history trades unavailable");
   const batch=Array.isArray(d.data)?d.data:[];
   if(!batch.length){historyTruncated=false;break;}
   for(const x of batch){const id=String(x.tradeId||x.ts);if(!seen.has(id)){seen.add(id);history.push(x);}}
   const oldest=batch.reduce((v,x)=>Math.min(v,Number(x.ts)||Infinity),Infinity);
   if(Number.isFinite(oldest)&&oldest<=cutoff+5000){historyTruncated=false;break;}
   if(batch.length<100){historyTruncated=false;break;}
   const nextAfter=String(batch[batch.length-1]?.tradeId||"");
   if(!nextAfter||nextAfter===after)break;
   after=nextAfter;
  }
  const rows=history.map(x=>({time:Number(x.ts),price:Number(x.px),size:Number(x.sz),side:String(x.side||"").toLowerCase()==="buy"?"Buy":"Sell"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
  if(rows.length&&betterFlow(rows,historyTruncated)){trades=rows;truncated=historyTruncated;provider="OKX Spot · paged real trades";}
 }catch(error){lastError="OKX history: "+String(error?.message||error).slice(0,160);}
}
if(!trades?.length)throw new Error("داده معاملات از Bybit، Binance، OKX، Gate، MEXC، KuCoin و WhiteBIT دریافت نشد: "+lastError);
 const buckets=new Map();let buy5m=0,sell5m=0;
 for(const trade of trades){
  const quote=trade.price*trade.size;if(!Number.isFinite(quote)||quote<=0)continue;
  if(trade.side==="Buy")buy5m+=quote;else sell5m+=quote;
  const minute=Math.floor(trade.time/60000)*60000;
  const bucket=buckets.get(minute)||{time:minute,buy:0,sell:0,count:0};
  bucket[trade.side==="Buy"?"buy":"sell"]+=quote;bucket.count++;buckets.set(minute,bucket);
 }
 const rows=[...buckets.values()].sort((a,b)=>a.time-b.time).map(x=>[x.time,x.buy,x.sell,x.buy-x.sell]);
 const oldestTrade=trades.reduce((v,x)=>Math.min(v,x.time),Infinity);
 return {symbol:pair,window_minutes:minutes,buy5m,sell5m,net5m:buy5m-sell5m,trade_count:trades.length,provider,exchange:provider.startsWith("Bybit")?"Bybit":provider.startsWith("Binance")?"Binance":provider.startsWith("OKX")?"OKX":provider.startsWith("MEXC")?"MEXC":provider.startsWith("WhiteBIT")?"WhiteBIT":provider.startsWith("KuCoin")?"KuCoin":"Gate",complete:!truncated,coverage_start:Number.isFinite(oldestTrade)?oldestTrade:null,window_start:cutoff,window_end:now,updated_at:now,rows};
}
async function fetchHunterCandles(symbol,marketType="spot",asset=null){
 const pair=symbol+"USDT",get=url=>marketFlowJson(url,4500);
 const tryHosts=async(label,hosts,build,extract,map)=>{
  let lastError=null;
  for(const host of hosts.slice(0,2)){
   try{
    const payload=await get(build(host)),raw=extract(payload);
    if(!Array.isArray(raw))throw new Error(label+" returned an invalid candle payload");
    const rows=raw.map(map).filter(x=>x.every(Number.isFinite)&&x[1]>0&&x[2]>=x[3]&&x[3]>0&&x[4]>0&&x[5]>=0).sort((a,b)=>a[0]-b[0]);
    if(rows.length>=65)return [label,rows];
    throw new Error(label+" returned only "+rows.length+" candles");
   }catch(error){const message=String(error?.message||error);lastError=new Error(label+": "+message);if(/HTTP 400|invalid candle payload|Symbol Is Invalid|returned only \\d+ candles/i.test(message))break;}
  }
  throw lastError||new Error(label+" unavailable");
 };
 const futuresSources=[
  async()=>tryHosts("Binance Futures",["https://fapi.binance.com","https://fapi1.binance.com","https://fapi2.binance.com","https://fapi3.binance.com"],host=>host+"/fapi/v1/klines?symbol="+pair+"&interval=1m&limit=100",d=>Array.isArray(d)?d:null,x=>[+x[0],+x[1],+x[2],+x[3],+x[4],+x[7]]),
  async()=>tryHosts("Bybit Linear",["https://api.bybit.eu","https://api.bytick.eu","https://api.bybit.com","https://api.bytick.com"],host=>host+"/v5/market/kline?category=linear&symbol="+pair+"&interval=1&limit=100",d=>{if(Number(d.retCode)!==0)throw new Error(d.retMsg||"Bybit retCode "+d.retCode);return d.result?.list||null;},x=>[+x[0],+x[1],+x[2],+x[3],+x[4],(+x[6]||+x[5])]),
  async()=>tryHosts("OKX USDT Swap",["https://www.okx.com","https://us.okx.com"],host=>host+"/api/v5/market/candles?instId="+symbol+"-USDT-SWAP&bar=1m&limit=100",d=>String(d.code)==="0"?d.data:null,x=>[+x[0],+x[1],+x[2],+x[3],+x[4],(+x[7]||+x[6])]),
  async()=>tryHosts("Bitget USDT Futures",["https://api.bitget.com"],host=>host+"/api/v2/mix/market/candles?symbol="+pair+"&productType=USDT-FUTURES&granularity=1m&limit=100",d=>["00000","0"].includes(String(d.code))?d.data:null,x=>[+x[0],+x[1],+x[2],+x[3],+x[4],(+x[6]||+x[5])]),
  async()=>tryHosts("Gate USDT Futures",["https://api.gateio.ws","https://api.gate.us"],host=>host+"/api/v4/futures/usdt/candlesticks?contract="+symbol+"_USDT&interval=1m&limit=100",d=>Array.isArray(d)?d:null,x=>[+x.t*1000,+x.o,+x.h,+x.l,+x.c,(+x.sum||+x.v)]),
  async()=>tryHosts("MEXC USDT Futures",["https://contract.mexc.com"],host=>host+"/api/v1/contract/kline/"+symbol+"_USDT?interval=Min1",d=>d?.success===true&&Array.isArray(d.data?.time)?d.data.time.map((time,i)=>[Number(time)*1000,Number(d.data.open?.[i]),Number(d.data.high?.[i]),Number(d.data.low?.[i]),Number(d.data.close?.[i]),Number(d.data.amount?.[i]??d.data.vol?.[i])]):null,x=>x),
  async()=>tryHosts("KuCoin USDT Futures",["https://api-futures.kucoin.com"],host=>{const now=Date.now();const kucoinSymbol=(symbol==="BTC"?"XBT":symbol)+"USDTM";return host+"/api/v1/kline/query?symbol="+encodeURIComponent(kucoinSymbol)+"&granularity=1&from="+(now-180*60*1000)+"&to="+now;},d=>String(d.code)==="200000"?d.data:null,x=>[+x[0],+x[1],+x[2],+x[3],+x[4],(+x[6]||+x[5])])
 ];
 const spotSources=[
  async()=>tryHosts("Binance Spot",["https://api.binance.com"],host=>host+"/api/v3/klines?symbol="+pair+"&interval=1m&limit=100",d=>Array.isArray(d)?d:null,x=>[+x[0],+x[1],+x[2],+x[3],+x[4],+x[7]]),
  async()=>tryHosts("Bybit Spot",["https://api.bybit.com","https://api.bytick.com"],host=>host+"/v5/market/kline?category=spot&symbol="+pair+"&interval=1&limit=100",d=>Number(d.retCode)===0?d.result?.list:null,x=>[+x[0],+x[1],+x[2],+x[3],+x[4],(+x[6]||+x[5])]),
  async()=>tryHosts("Bitget Spot",["https://api.bitget.com"],host=>host+"/api/v3/market/candles?category=SPOT&symbol="+pair+"&interval=1m&limit=100",d=>["00000","0"].includes(String(d.code))?d.data:null,x=>[+x[0],+x[1],+x[2],+x[3],+x[4],+x[5]]),
  async()=>tryHosts("OKX Spot",["https://www.okx.com"],host=>host+"/api/v5/market/candles?instId="+symbol+"-USDT&bar=1m&limit=100",d=>String(d.code)==="0"?d.data:null,x=>[+x[0],+x[1],+x[2],+x[3],+x[4],(+x[7]||+x[6])]),
  async()=>tryHosts("Gate Spot",["https://api.gateio.ws"],host=>host+"/api/v4/spot/candlesticks?currency_pair="+symbol+"_USDT&interval=1m&limit=100",d=>Array.isArray(d)?d:null,x=>[+x[0]*1000,+x[5],+x[3],+x[4],+x[2],+x[1]]),
  async()=>tryHosts("KuCoin Spot",["https://api.kucoin.com"],host=>host+"/api/v1/market/candles?type=1min&symbol="+symbol+"-USDT",d=>String(d.code)==="200000"?d.data:null,x=>[+x[0]*1000,+x[1],+x[3],+x[4],+x[2],(+x[6]||+x[5])]),
  async()=>tryHosts("WhiteBIT Spot",["https://whitebit.com","https://whitebit.eu"],host=>host+"/api/v1/public/kline?market="+symbol+"_USDT&interval=1m&limit=100",d=>d?.success===true?(Array.isArray(d.result)?d.result:Array.isArray(d.result?.kline)?d.result.kline:null):null,x=>Array.isArray(x)?[+x[0]*1000,+x[1],+x[3],+x[4],+x[2],+x[5]]:[+x.time*1000,+x.open,+x.highest,+x.lowest,+x.close,+x.volume]),
  async()=>tryHosts("Binance.US Spot",["https://api.binance.us"],host=>host+"/api/v3/klines?symbol="+pair+"&interval=1m&limit=100",d=>Array.isArray(d)?d:null,x=>[+x[0],+x[1],+x[2],+x[3],+x[4],+x[7]]),
  async()=>tryHosts("MEXC Spot",["https://api.mexc.com"],host=>host+"/api/v3/klines?symbol="+pair+"&interval=1m&limit=100",d=>Array.isArray(d)?d:null,x=>[+x[0],+x[1],+x[2],+x[3],+x[4],+x[7]])
 ];
 const sources=marketType==="futures"?futuresSources:spotSources,errors=[];
 const unique=values=>[...new Set(values.filter(Number.isInteger))];
 let order=[];
 const reliableIndices=marketType==="futures"?[4,5,2]:[4,3,6,8];
 if(marketType==="futures"){
  const indexOf=name=>{const value=String(name||"").trim().toLowerCase();return value.startsWith("binance")?0:value.startsWith("bybit")?1:value.startsWith("okx")?2:value.startsWith("bitget")?3:value.startsWith("gate")?4:value.startsWith("mexc")?5:value.startsWith("kucoin")?6:null;};
  const priority=[4,5,2,6,1,3,0],available=unique(String(asset?.hunterExchange||"").split(",").map(indexOf).filter(Number.isInteger)).sort((a,b)=>priority.indexOf(a)-priority.indexOf(b)),primary=indexOf(asset?.hunterPriceExchange),primaryTrusted=[4,5,6].includes(primary);
  order=unique([...(primaryTrusted&&available.includes(primary)?[primary]:[]),...available]).sort((a,b)=>priority.indexOf(a)-priority.indexOf(b));
 }else{
  const indices={Binance:0,Bybit:1,Bitget:2,OKX:3,Gate:4,"Gate.io":4,KuCoin:5,WhiteBIT:6,"Binance.US":7,BinanceUS:7,MEXC:8};
  const preferred=(Array.isArray(asset?.marketPairs)?asset.marketPairs.slice().sort((a,b)=>Number(b.volume||0)-Number(a.volume||0)):[]).map(x=>indices[String(x.exchange||"")]).filter(Number.isInteger),priority=[4,3,6,8,5,2,1,7,0],available=unique(preferred).sort((a,b)=>priority.indexOf(a)-priority.indexOf(b)),primary=preferred[0],primaryTrusted=[4,5,6,8].includes(primary);
  order=unique([...(primaryTrusted&&available.includes(primary)?[primary]:[]),...available]).sort((a,b)=>priority.indexOf(a)-priority.indexOf(b));
 }
 const fallbackPriority=marketType==="futures"?[4,5,2,6,1,3,0]:[4,3,6,8,5,2,1,7,0];
 const preferredOrder=unique(order.filter(index=>reliableIndices.includes(index)));
 const primaryIndex=preferredOrder[0]??fallbackPriority[0],primaryOrder=[primaryIndex];
 const fallbackPool=unique([...fallbackPriority.filter(index=>!primaryOrder.includes(index)),...preferredOrder.slice(1),...sources.map((_,index)=>index)]).filter(index=>!primaryOrder.includes(index));
 const sourceLimit=Math.min(4,sources.length),orderedIndices=unique([...primaryOrder,...fallbackPool]),selectedIndices=(preferredOrder.length>=3?preferredOrder:orderedIndices).slice(0,sourceLimit),orderedSources=selectedIndices.map(index=>sources[index]).filter(Boolean),verified=[];
 let selectedPair=null,bestObservedPair=null;
 const evaluatePairs=()=>{
  const pairs=[];
  for(let i=0;i<verified.length;i++)for(let j=i+1;j<verified.length;j++){
   const primary=verified[i],secondary=verified[j],aligned=alignMarketCandles(primary.rows.slice(0,-1),secondary.rows.slice(0,-1),{maxAgeMs:210000,maxDeviationPct:0.4,now:Date.now()});
   if(!aligned)continue;
   pairs.push({primary,secondary,alignedIndex:aligned.index,a:aligned.primary,b:aligned.secondary,ageMs:aligned.ageMs,deviationPct:aligned.deviationPct});
  }
  pairs.sort((x,y)=>x.ageMs-y.ageMs||x.deviationPct-y.deviationPct);
  if(pairs.length)bestObservedPair=pairs[0];
  return pairs.find(x=>x.ageMs<=210000&&x.deviationPct<=0.4)||null;
 };
 const attempts=await Promise.allSettled(orderedSources.map(fn=>fn()));
 for(const result of attempts){if(result.status==="fulfilled"){const [provider,rows]=result.value;verified.push({provider,rows});}else errors.push(String(result.reason?.message||result.reason).slice(0,180));}
 selectedPair=evaluatePairs();
 if(!selectedPair&&preferredOrder.length>=3){
  const extraIndices=orderedIndices.filter(index=>!selectedIndices.includes(index)).slice(0,2);
  const extra=await Promise.allSettled(extraIndices.map(index=>sources[index]()));
  for(const result of extra){if(result.status==="fulfilled"){const [provider,rows]=result.value;verified.push({provider,rows});}else errors.push(String(result.reason?.message||result.reason).slice(0,180));}
  selectedPair=evaluatePairs();
 }
 if(!selectedPair){
  if(verified.length<2)throw new Error((marketType==="futures"?"Futures":"Spot")+" candles unavailable or only one exchange responded: "+errors.join(" | "));
  if(!bestObservedPair)throw new Error("QUALITY_REJECTED: کندل بسته‌شده مشترک برای تأیید چندصرافی پیدا نشد");
  if(bestObservedPair.ageMs>210000)throw new Error("QUALITY_REJECTED: تازه‌ترین کندل مشترک چندصرافی قدیمی است ("+bestObservedPair.ageMs+"ms)");
  throw new Error("QUALITY_REJECTED: اختلاف قیمت چندصرافی "+bestObservedPair.deviationPct.toFixed(3)+"٪");
 }
 const {primary,secondary,alignedIndex,a,b,ageMs:commonCandleAge,deviationPct:priceDeviationPct}=selectedPair,timeDiffMs=0;
 const alignedRows=normalizeMarketCandles(primary.rows).slice(0,alignedIndex+2);
 return {provider:primary.provider,rows:alignedRows,market:marketType,multiExchangeConfirmed:true,multiExchangeEvidence:{primary:primary.provider,secondary:secondary.provider,timeDiffMs,priceDeviationPct:Number(priceDeviationPct.toFixed(4)),primaryPrice:a[4],secondaryPrice:b[4],candleTime:a[0],commonCandleAgeMs:commonCandleAge}};
}
async function analyzeDigitalHunterSymbol(symbol,marketType="spot",asset=null,activity=null){
 // هر لایه فقط هنگام اجرای واقعی و ثبت داده معتبر، شمارنده خودش را افزایش می‌دهد.
 const m=await fetchHunterCandles(symbol,marketType,asset),rows=m.rows.slice(0,-1),now=Date.now();if(rows.length<60)return null;
 const last=rows.at(-1);if(now-last[0]>210000)return null;
 const indicators=calculateQuantumIndicators(rows);if(!indicators.available)return null;
 markQuantumEvidence(activity,"dataQuality");markQuantumEvidence(activity,"momentum");markQuantumEvidence(activity,"multiTimeframe");markQuantumEvidence(activity,"regime");markQuantumEvidence(activity,"volatility");markQuantumEvidence(activity,"liquidity");markQuantumEvidence(activity,"structure");
 const b=[];for(let i=0;i+2<rows.length;i+=3){const g=rows.slice(i,i+3);if(g.length===3)b.push({o:g[0][1],h:Math.max(...g.map(x=>x[2])),l:Math.min(...g.map(x=>x[3])),c:g[2][4],v:g.reduce((z,x)=>z+x[5],0)});}
 if(b.length<18)return null;const x=b.at(-1),m1=(last[4]/last[1]-1)*100,m3=(last[4]/rows.at(-3)[1]-1)*100,m5=(last[4]/rows.at(-5)[1]-1)*100,m15=(last[4]/rows.at(-15)[1]-1)*100,trend=m5>=0?"bull":"bear";
 const aligned=v=>trend==="bull"?v>=-.025:v<=.025;if(!aligned(m1)||!aligned(m3))return null;
 const base=b.slice(-16,-1).map(q=>q.v).filter(v=>v>0);if(base.length<10)return null;
 const avg=base.reduce((p,q)=>p+q,0)/base.length,volumeRatio=avg?x.v/avg:0,trend15=trend==="bull"?m15>.015:m15<-.015,breakout=trend==="bull"?indicators.breakoutUp:indicators.breakoutDown;
 const rangeOf=q=>Math.max(0,Number(q.h)-Number(q.l)),recentRanges=b.slice(-5).map(rangeOf),baselineRanges=b.slice(-25,-5).map(rangeOf),recentRange=recentRanges.length?recentRanges.reduce((a,v)=>a+v,0)/recentRanges.length:0,baselineRange=baselineRanges.length?baselineRanges.reduce((a,v)=>a+v,0)/baselineRanges.length:0,compression=baselineRange>0?Math.max(0,Math.min(1,1-recentRange/baselineRange)):0,explosionScore=Math.round(Math.max(0,Math.min(100,compression*40+Math.min(volumeRatio/3,1)*40+Math.min(Math.abs(m1)/Math.max(Number(indicators.atrPct)||.05,0.05),1)*20)));
 markQuantumEvidence(activity,"explosion");
 const technicalAligned=trend==="bull"?indicators.trendUp&&indicators.rsi14>=50&&indicators.rsi14<=78:indicators.trendDown&&indicators.rsi14>=22&&indicators.rsi14<=50;
 const structure=trend==="bull"?last[4]>indicators.ema21&&Number(indicators.vwapDeviationPct)>=0&&indicators.obvTrend>=0:last[4]<indicators.ema21&&Number(indicators.vwapDeviationPct)<=0&&indicators.obvTrend<=0;
 const coreAligned=Math.sign(m5)===Math.sign(m15)&&Math.abs(m5)>=.05&&Math.abs(m15)>=.08&&technicalAligned;
 const earlyTechnicalAligned=trend==="bull"?indicators.trendUp&&indicators.rsi14>=45&&indicators.rsi14<=82:indicators.trendDown&&indicators.rsi14>=18&&indicators.rsi14<=55;
 const earlyCoreAligned=earlyTechnicalAligned&&Math.sign(m3)===Math.sign(m5)&&Math.abs(m3)>=.025&&Math.abs(m5)>=.025;
 const overextended=Math.abs(m5)>=1.5||Math.abs(m1)>=.8||(trend==="bull"?indicators.rsi14>78:indicators.rsi14<22)||Math.abs(Number(indicators.vwapDeviationPct))>1.2;
 const lowLiquidity=Number(asset?.total_volume)>0&&Number(asset.total_volume)<150000;
 if((!coreAligned&&!earlyCoreAligned)||lowLiquidity)return null;
 const quantum=scoreQuantumOpportunity({trend,currentPrice:last[4],change1m:m1,change3m:m3,change5m:m5,change15m:m15,volumeRatio,explosionScore,breakout,structureAligned:structure&&coreAligned,trend15,overextended,dataAgeMs:now-last[0],flowConfirmed:false,multiExchangeConfirmed:m.multiExchangeConfirmed,totalVolume24h:asset?.total_volume,rsi14:indicators.rsi14,ema9:indicators.ema9,ema21:indicators.ema21,ema50:indicators.ema50,macdHistogram:indicators.macdHistogram,atrPct:indicators.atrPct});
 const score=quantum.score;if(score<48||!m.multiExchangeConfirmed)return null;
 markQuantumEvidence(activity,"earlyOpportunity");
 return {symbol,trend,score,explosionScore,compression,change1m:m1,change3m:m3,change5m:m5,change15m:m15,volumeRatio,breakout,technicalAligned,earlyCoreAligned,candidateGate:quantum.candidateGate,quantum,indicators,price:last[4],totalVolume24h:Number(asset?.total_volume)||0,provider:m.provider,multiExchangeConfirmed:m.multiExchangeConfirmed,multiExchangeEvidence:m.multiExchangeEvidence,lowLiquidity,rows:rows.slice(-30),updatedAt:now,candleTime:last[0],engine:"quantum-hunter-v3",market:marketType,timeframes:{m1,m3,m5,m15},evidence:{volumeRatio:+volumeRatio.toFixed(2),breakout,trend15m:trend15,structure,coreAligned,technical:{rsi14:indicators.rsi14,ema9:indicators.ema9,ema21:indicators.ema21,ema50:indicators.ema50,macdHistogram:indicators.macdHistogram,vwapDeviationPct:indicators.vwapDeviationPct,obvTrend:indicators.obvTrend},multiExchange:m.multiExchangeEvidence},overextended};
}
async function loadFuturesMarketFlow(symbol,windowMinutes=5,signal=null){
 const get=(url,timeoutMs=4500)=>marketFlowJson(url,timeoutMs,signal);
 const base=String(symbol||"").toUpperCase().replace(/USDT$/,""),pair=base+"USDT";
 if(!/^[A-Z0-9]{2,24}USDT$/.test(pair))throw new Error("Invalid Futures symbol");
 const minutes=Math.max(1,Math.min(15,Number(windowMinutes)||5)),now=Date.now(),cutoff=now-minutes*60000;
 let trades=null,provider="",truncated=false,lastError="";
 const normalize=(rows,mapper,oldestOf)=>{const oldest=rows.reduce((v,x)=>Math.min(v,oldestOf(x)||Infinity),Infinity);truncated=Number.isFinite(oldest)&&oldest>cutoff+5000;return rows.map(mapper).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0&&["Buy","Sell"].includes(x.side));};
 const betterFlow=(candidate,candidateTruncated)=>!trades?.length||(truncated&&!candidateTruncated)||(truncated===candidateTruncated&&candidate.length>trades.length);
 if(!trades?.length||truncated||trades.length<8){
  for(const host of ["https://www.okx.com"]){
   try{
    const d=await get(host+"/api/v5/market/trades?instId="+base+"-USDT-SWAP&limit=500");
    if(String(d.code)!=="0")throw Error(d.msg||"OKX Swap trades unavailable");
    const rows=d.data||[],oldest=rows.reduce((v,x)=>Math.min(v,Number(x.ts)||Infinity),Infinity);
    const okxTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
    const okxTrades=rows.map(x=>({time:Number(x.ts),price:Number(x.px),size:Number(x.sz),side:String(x.side||"").toLowerCase()==="buy"?"Buy":"Sell"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
    if(!okxTrades.length)throw Error("OKX returned no recent Futures trades");
    if(betterFlow(okxTrades,okxTruncated)){trades=okxTrades;truncated=okxTruncated;provider="OKX USDT Swap · recent trades";}
    if(!truncated)break;
   }catch(error){lastError="OKX recent: "+String(error?.message||error).slice(0,120);}
  }
 }

 if(!trades?.length||truncated||trades.length<8){
 for(const host of ["https://api.bybit.eu","https://api.bytick.eu","https://api.bybit.com","https://api.bytick.com"]){
  try{
   const d=await get(host+"/v5/market/recent-trade?category=linear&symbol="+pair+"&limit=1000");
   if(Number(d.retCode)!==0)throw Error(d.retMsg||"Bybit Linear trades unavailable");
   const rows=d.result?.list||[],normalized=normalize(rows,x=>({time:Number(x.time),price:Number(x.price),size:Number(x.size),side:String(x.side||"")}),x=>Number(x.time));
   if(!normalized.length)throw Error("Bybit Futures returned no recent trades");
   trades=normalized;provider="Bybit Linear · real trades";if(!truncated)break;
  }catch(error){lastError="Bybit: "+String(error?.message||error).slice(0,120);}
 }
 }
 if(!trades?.length||truncated||trades.length<8){
  for(const host of ["https://api.bitget.com"]){
   try{
    const d=await get(host+"/api/v3/market/fills?category=USDT-FUTURES&symbol="+pair+"&limit=100");
    if(String(d.code)!=="00000")throw Error(d.msg||"Bitget Futures fills unavailable");
    const raw=Array.isArray(d.data)?d.data:[];
    const oldest=raw.reduce((v,x)=>Math.min(v,Number(x.ts)||Infinity),Infinity);
    const bitgetTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
    const bitgetTrades=raw.map(x=>({time:Number(x.ts),price:Number(x.price),size:Number(x.size),side:String(x.side||"").toLowerCase()==="buy"?"Buy":"Sell"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
    if(!bitgetTrades.length)throw Error("Bitget returned no recent Futures fills");
    if(betterFlow(bitgetTrades,bitgetTruncated)){trades=bitgetTrades;truncated=bitgetTruncated;provider="Bitget USDT Futures · real fills";}
    if(!truncated)break;
   }catch(error){lastError="Bitget V3: "+String(error?.message||error).slice(0,120);}
  }
 }
 if(!trades?.length||truncated||trades.length<8){
  try{
   const d=await get("https://api.bitget.com/api/v2/mix/market/fills?symbol="+pair+"&productType=USDT-FUTURES&limit=100");
   if(String(d.code)!=="00000")throw Error(d.msg||"Bitget V2 Futures fills unavailable");
   const raw=Array.isArray(d.data)?d.data:[];
   const oldest=raw.reduce((v,x)=>Math.min(v,Number(x.ts)||Infinity),Infinity),bitgetV2Truncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
   const rows=raw.map(x=>({time:Number(x.ts),price:Number(x.price),size:Number(x.size),side:String(x.side||"").toLowerCase()==="buy"?"Buy":"Sell"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
   if(rows.length&&betterFlow(rows,bitgetV2Truncated)){trades=rows;truncated=bitgetV2Truncated;provider="Bitget USDT Futures V2 · real fills";}
  }catch(error){lastError="Bitget V2: "+String(error?.message||error).slice(0,120);}
 }
 if(!trades?.length||truncated||trades.length<8){
  for(const host of ["https://fapi.binance.com","https://fapi1.binance.com","https://fapi2.binance.com","https://fapi3.binance.com"]){
   try{
    const rows=await get(host+"/fapi/v1/aggTrades?symbol="+pair+"&startTime="+cutoff+"&endTime="+now+"&limit=1000");
    if(!Array.isArray(rows)||!rows.length)throw Error("Binance Futures trades invalid or empty");
    const oldest=rows.reduce((v,x)=>Math.min(v,Number(x.T)||Infinity),Infinity),binanceTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
    const binanceTrades=rows.map(x=>({time:Number(x.T),price:Number(x.p),size:Number(x.q),side:x.m?"Sell":"Buy"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
    if(!binanceTrades.length)throw Error("Binance Futures returned no recent trades");
    if(betterFlow(binanceTrades,binanceTruncated)){trades=binanceTrades;truncated=binanceTruncated;provider="Binance USD-M Futures · aggregate trades";}
    if(!truncated)break;
   }catch(error){lastError="Binance: "+String(error?.message||error).slice(0,120);}
  }
 }
 if(!trades?.length||truncated||trades.length<8){
  try{
   const d=await get("https://contract.mexc.com/api/v1/contract/deals/"+encodeURIComponent(base+"_USDT")+"?limit=100");
   if(d?.success!==true||!Array.isArray(d.data))throw Error(d?.message||"MEXC Futures deals unavailable");
   const raw=d.data,oldest=raw.reduce((v,x)=>Math.min(v,Number(x.t)||Infinity),Infinity),mexcTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
   const rows=raw.map(x=>({time:Number(x.t),price:Number(x.p),size:Number(x.v),side:Number(x.T)===1?"Buy":"Sell"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
   if(rows.length&&(!trades?.length||!mexcTruncated||rows.length>trades.length)){trades=rows;truncated=mexcTruncated;provider="MEXC USDT Futures · real deals";}
  }catch(error){lastError="MEXC: "+String(error?.message||error).slice(0,120);}
 }
 if(!trades?.length||truncated||trades.length<8){
  try{
   const instId=base+"-USDT-SWAP",history=[],seen=new Set();let after="",historyTruncated=true;
   for(let page=0;page<35;page++){
    const query="https://www.okx.com/api/v5/market/history-trades?instId="+encodeURIComponent(instId)+"&limit=100"+(after?"&after="+encodeURIComponent(after):"");
    const d=await get(query,4500);
    if(String(d.code)!=="0")throw Error(d.msg||"OKX history Futures trades unavailable");
    const batch=Array.isArray(d.data)?d.data:[];
    if(!batch.length)break;
    if(batch.length<100){historyTruncated=false;break;}
    for(const x of batch){const id=String(x.tradeId||x.ts);if(!seen.has(id)){seen.add(id);history.push(x);}}
    const oldest=batch.reduce((v,x)=>Math.min(v,Number(x.ts)||Infinity),Infinity);
    if(Number.isFinite(oldest)&&oldest<=cutoff+5000){historyTruncated=false;break;}
    const nextAfter=String(batch[batch.length-1]?.tradeId||"");
    if(!nextAfter||nextAfter===after)break;
    after=nextAfter;
   }
   const rows=history.map(x=>({time:Number(x.ts),price:Number(x.px),size:Number(x.sz),side:String(x.side||"").toLowerCase()==="buy"?"Buy":"Sell"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
   if(rows.length&&betterFlow(rows,historyTruncated)){trades=rows;truncated=historyTruncated;provider="OKX USDT Swap · paged real trades";}
  }catch(error){lastError="OKX history: "+String(error?.message||error).slice(0,120);}
 }
 if(!trades?.length||truncated||trades.length<8){
  try{
   const contract=base+"_USDT";
   const loadGate=async host=>{
    const [details,raw]=await Promise.all([
     get(host+"/api/v4/futures/usdt/contracts/"+encodeURIComponent(contract),4500),
     get(host+"/api/v4/futures/usdt/trades?contract="+encodeURIComponent(contract)+"&from="+Math.floor(cutoff/1000)+"&to="+Math.floor(now/1000)+"&limit=1000",4500)
    ]);
    return {details,raw};
   };
   let gateData;try{gateData=await loadGate("https://api.gateio.ws");}catch{gateData=await loadGate("https://fx-api.gateio.ws");}
   const multiplier=Number(gateData.details?.quanto_multiplier)||0,raw=gateData.raw;
   if(!raw.length||!multiplier)throw new Error("Gate Futures contract multiplier or time-ranged trades unavailable");
   const oldest=raw.reduce((v,x)=>Math.min(v,Number(x.create_time_ms)||Number(x.create_time)*1000||Infinity),Infinity),gateTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
   const gateTrades=raw.map(x=>({time:Number(x.create_time_ms)||Number(x.create_time)*1000,price:Number(x.price),size:Math.abs(Number(x.size))*multiplier,side:Number(x.size)>0?"Buy":"Sell"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
   if(gateTrades.length&&betterFlow(gateTrades,gateTruncated)){trades=gateTrades;truncated=gateTruncated;provider="Gate USDT Futures · paged real trades";}
  }catch(error){lastError="Gate: "+String(error?.message||error).slice(0,120);}
 }
 if(!trades?.length||truncated||trades.length<8){
  try{
   const kucoinSymbol=(base==="BTC"?"XBT":base)+"USDTM";
   const [contractInfo,d]=await Promise.all([
    get("https://api-futures.kucoin.com/api/v1/contracts/"+encodeURIComponent(kucoinSymbol),4500),
    get("https://api-futures.kucoin.com/api/v1/trade/history?symbol="+encodeURIComponent(kucoinSymbol),4500)
   ]);
   const multiplier=Number(contractInfo?.data?.multiplier);
   if(String(contractInfo.code)!=="200000"||!(multiplier>0))throw Error("KuCoin Futures contract multiplier unavailable");
   if(String(d.code)!=="200000"||!Array.isArray(d.data))throw Error(d.msg||"KuCoin Futures trade history unavailable");
   const raw=d.data,stamp=x=>{const t=Number(x.ts??x.time);return t>1e15?t/1e6:t>1e12?t:t*1000;};
   const oldest=raw.reduce((v,x)=>Math.min(v,stamp(x)||Infinity),Infinity),kucoinTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
   const rows=raw.map(x=>({time:stamp(x),price:Number(x.price),size:Number(x.size)*multiplier,side:String(x.side||"").toLowerCase()==="buy"?"Buy":"Sell"})).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
   if(rows.length&&betterFlow(rows,kucoinTruncated)){trades=rows;truncated=kucoinTruncated;provider="KuCoin USDT Futures · real trades";}
  }catch(error){lastError="KuCoin Futures: "+String(error?.message||error).slice(0,120);}
 }
 if(!trades?.length||truncated||trades.length<8){
 try{
  const market=base+"_PERP";
  const [buyRows,sellRows]=await Promise.all([
   get("https://whitebit.com/api/v4/public/trades/"+encodeURIComponent(market)+"?type=buy",4500),
   get("https://whitebit.com/api/v4/public/trades/"+encodeURIComponent(market)+"?type=sell",4500)
  ]);
  if(!Array.isArray(buyRows)||!Array.isArray(sellRows))throw new Error("WhiteBIT Futures trades response invalid");
  const normalizeWhitebit=(rows,side)=>rows.map(x=>{let time=Number(x.trade_timestamp);if(time>0&&time<1e12)time*=1000;return {time,price:Number(x.price),size:Number(x.quote_volume),side};}).filter(x=>x.time>=cutoff&&x.time<=now&&x.price>0&&x.size>0);
  const rows=[...normalizeWhitebit(buyRows,"Buy"),...normalizeWhitebit(sellRows,"Sell")].sort((a,b)=>b.time-a.time);
  const oldest=rows.reduce((v,x)=>Math.min(v,x.time),Infinity),whitebitTruncated=Number.isFinite(oldest)&&oldest>cutoff+5000;
  if(rows.length&&betterFlow(rows,whitebitTruncated)){trades=rows;truncated=whitebitTruncated;provider="WhiteBIT USDT Futures · real trades";}
 }catch(error){lastError="WhiteBIT Futures: "+String(error?.message||error).slice(0,120);}
}
if(!trades?.length)throw new Error("Futures trade flow unavailable from Bybit, Bitget V2/V3, Binance, OKX, Gate, KuCoin and WhiteBIT: "+lastError);
 const buckets=new Map();let buy5m=0,sell5m=0;
 for(const trade of trades){const quote=trade.price*trade.size;if(!(quote>0))continue;if(trade.side==="Buy")buy5m+=quote;else sell5m+=quote;const minute=Math.floor(trade.time/60000)*60000,bucket=buckets.get(minute)||{time:minute,buy:0,sell:0,count:0};bucket[trade.side==="Buy"?"buy":"sell"]+=quote;bucket.count++;buckets.set(minute,bucket);}
 const rows=[...buckets.values()].sort((a,b)=>a.time-b.time).map(x=>[x.time,x.buy,x.sell,x.buy-x.sell]);
 return {symbol:pair,window_minutes:minutes,buy5m,sell5m,net5m:buy5m-sell5m,trade_count:trades.length,provider,exchange:provider.startsWith("Bybit")?"Bybit":provider.startsWith("Bitget")?"Bitget":provider.startsWith("Binance")?"Binance":provider.startsWith("Gate")?"Gate":provider.startsWith("MEXC")?"MEXC":provider.startsWith("KuCoin")?"KuCoin":"OKX",complete:!truncated,coverage_start:trades.reduce((v,x)=>Math.min(v,x.time),Infinity),window_start:cutoff,window_end:now,updated_at:now,fallback_error:lastError||null,rows};
}
async function loadHunterDepth(symbol,marketType="spot",preferredProviders=[],signal=null){
 const get=(url,timeoutMs=4500)=>marketFlowJson(url,timeoutMs,signal);
 const base=String(symbol||"").toUpperCase().replace(/USDT$/,""),pair=base+"USDT";
 if(!/^[A-Z0-9]{2,24}$/.test(pair))throw new Error("Invalid depth symbol");
 const sources=marketType==="futures"?[
  {key:"WhiteBIT",name:"WhiteBIT USDT Futures",load:async()=>{const d=await get("https://whitebit.com/api/v4/public/orderbook/"+base+"_PERP?limit=100&level=2");return {bids:d.bids,asks:d.asks};}},
  {key:"MEXC",name:"MEXC USDT Futures",load:async()=>{const d=await get("https://contract.mexc.com/api/v1/contract/depth/"+base+"_USDT");if(d?.success!==true)throw Error(d?.msg||"MEXC Futures order book unavailable");return {bids:d.data?.bids,asks:d.data?.asks};}},
  {key:"Bitget",name:"Bitget USDT Futures",load:async()=>{const d=await get("https://api.bitget.com/api/v2/mix/market/merge-depth?symbol="+pair+"&productType=USDT-FUTURES&limit=100");if(!["00000","0"].includes(String(d.code)))throw Error(d.msg||"Bitget Futures order book unavailable");return {bids:d.data?.bids,asks:d.data?.asks};}},
  {key:"OKX",name:"OKX USDT Swap",load:async()=>{const d=await get("https://www.okx.com/api/v5/market/books?instId="+base+"-USDT-SWAP&sz=100");if(String(d.code)!=="0")throw Error(d.msg||"OKX Swap order book unavailable");return {bids:d.data?.[0]?.bids,asks:d.data?.[0]?.asks};}},
  {key:"Gate",name:"Gate USDT Futures",load:async()=>{const contract=base+"_USDT";let details,book;try{[details,book]=await Promise.all([get("https://api.gateio.ws/api/v4/futures/usdt/contracts/"+contract),get("https://api.gateio.ws/api/v4/futures/usdt/order_book?contract="+contract+"&limit=100")]);}catch{[details,book]=await Promise.all([get("https://api.gate.us/api/v4/futures/usdt/contracts/"+contract),get("https://api.gate.us/api/v4/futures/usdt/order_book?contract="+contract+"&limit=100")]);}const multiplier=Number(details?.quanto_multiplier)||0;if(!multiplier)throw Error("Gate contract multiplier unavailable");return {bids:(book.bids||[]).map(x=>[Number(x.p??x[0]),Number(x.s??x[1])*multiplier]),asks:(book.asks||[]).map(x=>[Number(x.p??x[0]),Number(x.s??x[1])*multiplier])};}},
  {key:"Bybit",name:"Bybit Linear Futures",load:async()=>{const d=await get("https://api.bybit.com/v5/market/orderbook?category=linear&symbol="+pair+"&limit=100");if(Number(d.retCode)!==0)throw Error(d.retMsg||"Bybit order book unavailable");return {bids:d.result?.b,asks:d.result?.a};}},
  {key:"Binance",name:"Binance USD-M Futures",load:async()=>{const d=await get("https://fapi.binance.com/fapi/v1/depth?symbol="+pair+"&limit=100");return {bids:d.bids,asks:d.asks};}}
 ]:[
  {key:"WhiteBIT",name:"WhiteBIT Spot",load:async()=>{const d=await get("https://whitebit.com/api/v4/public/orderbook/"+base+"_USDT?limit=100&level=2");return {bids:d.bids,asks:d.asks};}},
  {key:"MEXC",name:"MEXC Spot",load:async()=>{const d=await get("https://api.mexc.com/api/v3/depth?symbol="+pair+"&limit=100");return {bids:d.bids,asks:d.asks};}},
  {key:"Binance.US",name:"Binance.US Spot",load:async()=>{const d=await get("https://api.binance.us/api/v3/depth?symbol="+pair+"&limit=100");return {bids:d.bids,asks:d.asks};}},
  {key:"Binance",name:"Binance Spot",load:async()=>{const d=await get("https://api.binance.com/api/v3/depth?symbol="+pair+"&limit=100");return {bids:d.bids,asks:d.asks};}},
  {key:"OKX",name:"OKX Spot",load:async()=>{const d=await get("https://www.okx.com/api/v5/market/books?instId="+base+"-USDT&sz=100");if(String(d.code)!=="0")throw Error(d.msg||"OKX order book unavailable");return {bids:d.data?.[0]?.bids,asks:d.data?.[0]?.asks};}},
  {key:"Gate",name:"Gate Spot",load:async()=>{const d=await get("https://api.gateio.ws/api/v4/spot/order_book?currency_pair="+base+"_USDT&limit=100");return {bids:d.bids,asks:d.asks};}},
  {key:"Bybit",name:"Bybit Spot",load:async()=>{const d=await get("https://api.bybit.eu/v5/market/orderbook?category=spot&symbol="+pair+"&limit=50");if(Number(d.retCode)!==0)throw Error(d.retMsg||"Bybit order book unavailable");return {bids:d.result?.b,asks:d.result?.a};}}
 ];
 const preferred=preferredProviders.map(value=>sources.findIndex(x=>String(value||"").toLowerCase().includes(x.key.toLowerCase()))).filter(index=>index>=0);
 const order=[...new Set([...preferred,...sources.map((_,index)=>index)])].slice(0,2);
 let best=null,lastError="";
 for(const index of order){
  const source=sources[index];
  try{
   const book=await source.load(),levels=items=>(Array.isArray(items)?items:[]).map(x=>[Number(Array.isArray(x)?x[0]:x.p),Number(Array.isArray(x)?x[1]:x.s)]).filter(x=>x[0]>0&&x[1]>0);
   const bids=levels(book.bids).sort((a,b)=>b[0]-a[0]),asks=levels(book.asks).sort((a,b)=>a[0]-b[0]);
   if(!bids.length||!asks.length)throw Error("Empty order book");
   const bestBid=bids[0][0],bestAsk=asks[0][0],mid=(bestBid+bestAsk)/2,spreadPct=mid>0?(bestAsk-bestBid)/mid*100:Infinity;
   const bidUsdt=bids.filter(x=>x[0]>=mid*.99).reduce((sum,x)=>sum+x[0]*x[1],0);
   const askUsdt=asks.filter(x=>x[0]<=mid*1.01).reduce((sum,x)=>sum+x[0]*x[1],0);
   const totalDepthUsdt=bidUsdt+askUsdt,confirmed=spreadPct<=.35&&bidUsdt>=5000&&askUsdt>=5000&&totalDepthUsdt>=20000;
   const result={confirmed,source:source.name,spreadPct:Number(spreadPct.toFixed(4)),bidUsdt:Number(bidUsdt.toFixed(2)),askUsdt:Number(askUsdt.toFixed(2)),totalDepthUsdt:Number(totalDepthUsdt.toFixed(2)),bandPct:1,updatedAt:Date.now(),reason:confirmed?null:spreadPct>.35?"spread_too_wide":bidUsdt<5000||askUsdt<5000?"one_side_depth_too_low":"total_depth_too_low"};
   if(confirmed)return result;
   if(!best||result.totalDepthUsdt>best.totalDepthUsdt)best=result;
  }catch(error){lastError=String(error?.message||error).slice(0,120);}
 }
 if(best)return best;
 throw new Error("Order-book depth unavailable: "+lastError);
}
const QUANTUM_ACTIVITY_KEYS=["momentum","flow","structure","liquidity","multiTimeframe","regime","volatility","sentiment","smartMoney","scenario","risk","dataQuality","explosion","earlyOpportunity","decision","learning"];
async function loadHunterFundingSentiment(symbol,trend,preferredProviders=[],signal=null){
 const get=(url,timeoutMs=4500)=>marketFlowJson(url,timeoutMs,signal);
 const base=String(symbol||"").toUpperCase().replace(/USDT$/,"");
 if(!/^[A-Z0-9]{2,15}$/.test(base))return {available:false,score:null,sourceCount:0,sources:[]};
 const instId=base+"-USDT-SWAP",gateContract=base+"_USDT",kucoinSymbol=(base==="BTC"?"XBT":base)+"USDTM";
 const probes=[
  ["OKX",()=>get("https://www.okx.com/api/v5/public/funding-rate?instId="+encodeURIComponent(instId),5000),d=>String(d?.code)==="0"?d.data?.[0]?.fundingRate:null],
  ["Gate",()=>get("https://api.gateio.ws/api/v4/futures/usdt/tickers?contract="+encodeURIComponent(gateContract),5000),d=>Array.isArray(d)?d[0]?.funding_rate:null],
  ["KuCoin",()=>get("https://api-futures.kucoin.com/api/v1/funding-rate/"+encodeURIComponent(kucoinSymbol)+"/current",5000),d=>String(d?.code)==="200000"?(d.data?.value??d.data?.fundingRate):null]
 ];
 const preferred=preferredProviders.map(value=>probes.findIndex(([source])=>String(value||"").toLowerCase().includes(source.toLowerCase()))).filter(index=>index>=0),probeOrder=[...new Set([...preferred,...probes.map((_,index)=>index)])].slice(0,2);
 const results=await Promise.allSettled(probeOrder.map(index=>probes[index]).map(async([source,request,read])=>{
  const data=await request(),raw=read(data),rate=raw===null||raw===undefined?NaN:Number(raw);
  if(!Number.isFinite(rate))throw new Error(source+" funding unavailable");
  return {source,rate};
 }));
 const samples=results.filter(x=>x.status==="fulfilled").map(x=>x.value);
 if(samples.length<2)return {available:false,score:null,sourceCount:samples.length,sources:samples.map(x=>x.source),reason:"حداقل دو منبع مستقل Funding در دسترس نیست"};
 const average=samples.reduce((sum,x)=>sum+x.rate,0)/samples.length;
 const dispersion=Math.max(...samples.map(x=>x.rate))-Math.min(...samples.map(x=>x.rate));
 const direction=trend==="bull"?1:-1;
 const score=Math.max(0,Math.min(100,Math.round(50-average*direction*100000)));
 return {available:true,score,fundingRate:Number(average.toFixed(8)),dispersion:Number(dispersion.toFixed(8)),sourceCount:samples.length,sources:samples.map(x=>x.source),bias:score>=58?"supportive":score<=42?"crowded_against":"neutral"};
}
function markQuantumEvidence(activity,key){if(activity?.[key]){activity[key].processed++;activity[key].evidence++;}}
async function scanHunterSymbols(symbols,marketType="spot",assetList=[],env=null,options={}){
 const assetMap=new Map((Array.isArray(assetList)?assetList:[]).map(x=>[String(x.symbol||"").toUpperCase(),x]));
 let i=0,failed=0,rejected=0,flowChecked=0;const candidates=[],errors=[],rejections=[],engineActivity=Object.fromEntries(QUANTUM_ACTIVITY_KEYS.map(key=>[key,{processed:0,evidence:0}]));
 const concurrency=4;
 await Promise.all(Array.from({length:Math.min(concurrency,symbols.length)},async()=>{while(i<symbols.length){const symbol=symbols[i++];try{const x=await analyzeDigitalHunterSymbol(symbol,marketType,assetMap.get(symbol),engineActivity);if(x)candidates.push(x);}catch(e){const message=String(e?.message||e);if(message.startsWith("QUALITY_REJECTED:")){rejected++;rejections.push({symbol,error:message.slice(0,180)});}else{failed++;errors.push({symbol,error:message.slice(0,220)});}}}}));
 candidates.sort((a,b)=>b.score-a.score);const signals=[];
 const flowEligible=x=>!x.lowLiquidity&&(x.candidateGate===true||(x.earlyCoreAligned===true&&x.score>=(marketType==="futures"?62:60)));const flowCandidates=(marketType==="futures"?[...candidates.filter(flowEligible)].sort((a,b)=>b.score-a.score).slice(0,1):["bull","bear"].flatMap(trend=>candidates.filter(x=>x.trend===trend&&flowEligible(x)).sort((a,b)=>b.score-a.score).slice(0,1))).filter(x=>x.score>=50);
 await Promise.all(flowCandidates.map(async x=>{
  flowChecked++;x.flowReviewAttempted=true;
  const flowController=new AbortController(),flowTimer=setTimeout(()=>flowController.abort(),12000);
  try{
   const preferred=[x.multiExchangeEvidence?.primary,x.multiExchangeEvidence?.secondary];
   if(marketType==="futures"&&engineActivity?.sentiment)engineActivity.sentiment.processed++;
   const [sentimentResult,flowResult,depthResult]=await Promise.allSettled([
    marketType==="futures"?loadHunterFundingSentiment(x.symbol,x.trend,preferred,flowController.signal):Promise.resolve({available:false,score:null,sourceCount:0,sources:[]}),
    marketType==="futures"?loadFuturesMarketFlow(x.symbol,1,flowController.signal):loadMarketFlow(x.symbol,5,flowController.signal),
    loadHunterDepth(x.symbol,marketType,preferred,flowController.signal)
   ]);
   const sentiment=sentimentResult.status==="fulfilled"?sentimentResult.value:{available:false,score:null,sourceCount:0,sources:[]};
   let f=flowResult.status==="fulfilled"?flowResult.value:null;
   const depth=depthResult.status==="fulfilled"?depthResult.value:null;
   if(marketType==="futures"){
    if(sentiment.available&&engineActivity?.sentiment)engineActivity.sentiment.evidence++;
    x.sentiment=sentiment.available?sentiment:null;
    if(sentiment.available){const earlyQuantum=scoreQuantumOpportunity({...x,sentimentScore:sentiment.score,sentimentConfirmed:true,sentimentSource:sentiment.sources.join(" + ")});x.quantum=earlyQuantum;x.score=earlyQuantum.score;}
   }
   if(!f)f={buy5m:0,sell5m:0,net5m:0,trade_count:0,provider:null,complete:false,window_minutes:5};
   if(f.complete!==true&&!flowController.signal.aborted&&marketType!=="futures"){const shorter=await loadMarketFlow(x.symbol,1,flowController.signal);if(shorter.complete===true&&shorter.trade_count>=8)f=shorter;}
   const gross=f.buy5m+f.sell5m,imb=gross?f.net5m/gross:0,ok=x.trend==="bull"?imb>=.045:imb<=-.045;
   x.flow={buy5m:f.buy5m,sell5m:f.sell5m,net5m:f.net5m,windowMinutes:f.window_minutes||5,tradeCount:f.trade_count,provider:f.provider,complete:f.complete,coverageStart:f.coverage_start,imbalance:+imb.toFixed(4)};
   x.flowSignal=f.net5m>0?"inflow":"outflow";
   x.flowStatus=flowController.signal.aborted?"flow_timeout":f.complete!==true?"flow_incomplete":f.trade_count<8?"insufficient_trades":!ok?"flow_direction_mismatch":"flow_confirmed_pending_depth";
   if(f.trade_count<8||!ok||f.complete===false)return;
   markQuantumEvidence(engineActivity,"flow");
   if(depthResult.status==="rejected"||!depth){x.depthError=String(depthResult.reason?.message||"Order-book depth unavailable").slice(0,140);x.flowStatus="depth_unavailable";return;}
   x.depth=depth;
   if(!depth.confirmed){x.flowStatus="depth_not_confirmed";return;}
   x.flowStatus="depth_confirmed_pending_quality";
   markQuantumEvidence(engineActivity,"smartMoney");
   const qBars=Array.isArray(x.rows)?x.rows.slice(-70):[],qRanges=qBars.slice(1).map((bar,i)=>Math.max(Number(bar[2])-Number(bar[3]),Math.abs(Number(bar[2])-Number(qBars[i][4])),Math.abs(Number(bar[3])-Number(qBars[i][4])))).filter(v=>Number.isFinite(v)&&v>0),qAtr=qRanges.length?qRanges.slice(-14).reduce((a,b)=>a+b,0)/Math.min(14,qRanges.length):0,qEntry=Number(x.price),qAtrPct=qEntry>0?qAtr/qEntry*100:null,qStopPct=qEntry>0?Math.max(qAtr*1.25,qEntry*.002)/qEntry*100:null,qDepthImbalance=Number(depth.totalDepthUsdt)>0?(Number(depth.bidUsdt)-Number(depth.askUsdt))/Number(depth.totalDepthUsdt):0,qSmartMoneyScore=Math.max(0,Math.min(100,50+Math.sign(imb)*(x.trend==="bull"?1:-1)*Math.min(22,Math.abs(imb)*90)+qDepthImbalance*(x.trend==="bull"?1:-1)*18+Math.min(10,Math.log2(Math.max(1,f.trade_count))*2))),qExplosionScore=Math.max(0,Math.min(100,Math.max(0,Number(x.volumeRatio)-1)*28+Math.abs(imb)*45+Math.min(25,Math.log2(Math.max(1,f.trade_count))*5)));
   const scenarioScore=Math.max(0,Math.min(100,42+(x.breakout?18:0)+(x.technicalAligned?18:0)+Math.min(15,Math.max(0,x.volumeRatio-1)*12)-(x.overextended?25:0)));markQuantumEvidence(engineActivity,"scenario");markQuantumEvidence(engineActivity,"risk");
   const quantum=scoreQuantumOpportunity({...x,rsi14:x.indicators?.rsi14,ema9:x.indicators?.ema9,ema21:x.indicators?.ema21,ema50:x.indicators?.ema50,macdHistogram:x.indicators?.macdHistogram,structureAligned:x.evidence?.structure===true&&x.evidence?.coreAligned===true,totalVolume24h:Number(x.coin?.total_volume??x.totalVolume24h)||0,flowImbalance:imb,flowConfirmed:true,multiExchangeConfirmed:x.multiExchangeConfirmed,volumeRatio:x.volumeRatio,depthConfirmed:true,depthImbalance:qDepthImbalance,atrPct:qAtrPct,explosionScore:qExplosionScore,smartMoneyScore:qSmartMoneyScore,smartMoneyConfirmed:true,scenarioScore,stopDistancePct:qStopPct,requireDepthConfirmation:true,dataAgeMs:Date.now()-x.candleTime,sentimentScore:sentiment.available?sentiment.score:undefined,sentimentConfirmed:sentiment.available,sentimentSource:sentiment.available?sentiment.sources.join(" + "):undefined});
   const decision=decideQuantumSignal({quantum,trend:x.trend,score:quantum.score,stopDistancePct:qStopPct,flowConfirmed:true,multiExchangeConfirmed:x.multiExchangeConfirmed,depthConfirmed:depth.confirmed===true,dataAgeMs:Date.now()-x.candleTime});
   x.quantum=quantum;x.decision=decision;x.score=decision.score;x.depth=depth;x.sentiment=sentiment.available?sentiment:null;
   if(decision.action==="WAIT")return;
   markQuantumEvidence(engineActivity,"decision");
   x.flow={buy5m:f.buy5m,sell5m:f.sell5m,net5m:f.net5m,windowMinutes:f.window_minutes||5,tradeCount:f.trade_count,provider:f.provider,complete:f.complete,coverageStart:f.coverage_start,rows:f.rows,imbalance:+imb.toFixed(4)};
   x.flowSignal=f.net5m>0?"inflow":"outflow";
   const bars=Array.isArray(x.rows)?x.rows.slice(-16):[],ranges=bars.slice(1).map((bar,i)=>Math.max(Number(bar[2])-Number(bar[3]),Math.abs(Number(bar[2])-Number(bars[i][4])),Math.abs(Number(bar[3])-Number(bars[i][4])))).filter(v=>Number.isFinite(v)&&v>0);
   const atr=ranges.length?ranges.reduce((a,b)=>a+b,0)/ranges.length:0,entry=Number(x.price),risk=Math.max(atr*1.25,entry*.002),sign=x.trend==="bull"?1:-1;
   const precision=entry>=1000?2:entry>=1?4:entry>=.01?6:8,round=v=>Number(v.toFixed(precision));
   x.tradePlan={direction:sign>0?"LONG":"SHORT",entry:round(entry),stopLoss:round(entry-sign*risk),target1:round(entry+sign*risk*1.5),target2:round(entry+sign*risk*2.2),riskPercent:entry>0?Number((risk/entry*100).toFixed(2)):null,method:"1m ATR-based risk model; execution remains conditional"};
   x.confirmed=true;if(x.score>=68)signals.push(x);
  }catch(e){x.flowError=String(e?.message||e).slice(0,140);x.flowStatus=flowController.signal.aborted?"flow_timeout":"flow_error";}
  finally{clearTimeout(flowTimer);}
 }));
 signals.sort((a,b)=>b.score-a.score);
 if(signals.length&&env&&options.reviewAI!==false){
  const x=signals[0],prompt=JSON.stringify({task:"Independent second-opinion review of a fully data-confirmed quantitative market setup. Do not invent data, indicators, levels, or news. Do not modify any numeric fields. If evidence conflicts, say caution. Return JSON only: {verdict:'confirm'|'caution'|'reject',confidence:0-100,thesis:string,risks:string[],invalidation:string}.",symbol:x.symbol,market:marketType,direction:x.trend,score:x.score,price:x.price,timeframes:x.timeframes,indicators:x.indicators,evidence:x.evidence,flow:x.flow,orderBook:x.depth,tradePlan:x.tradePlan,quantum:x.quantum});
  try{const review=await runAIWithFallback(env,prompt),parsed=JSON.parse(review.raw);if(!["confirm","caution","reject"].includes(parsed.verdict)||!Number.isFinite(Number(parsed.confidence))||typeof parsed.thesis!=="string")throw new Error("AI review schema invalid");x.aiReview={status:"reviewed",provider:review.provider,verdict:parsed.verdict,confidence:Math.max(0,Math.min(100,Number(parsed.confidence))),thesis:parsed.thesis.slice(0,700),risks:Array.isArray(parsed.risks)?parsed.risks.slice(0,6).map(v=>String(v).slice(0,180)):[],invalidation:String(parsed.invalidation||"").slice(0,300),fallbacks:review.fallbacks};}
  catch(error){x.aiReview={status:"unavailable",reason:String(error?.message||error).slice(0,180)};}
 }
 const preliminary_signals=candidates.filter(x=>x.confirmed!==true).slice(0,12).map(x=>({...x,stage:"preliminary",missingEvidence:x.quantum?.missingEvidence||[],preliminaryReason:x.candidateGate?"نامزد فنی قوی؛ هنوز جریان واقعی معاملات و عمق سفارش تأیید نشده است":"نامزد زودهنگام؛ هم‌جهتی ۱۵ دقیقه یا بخشی از شروط فنی هنوز کامل نیست"}));
 return {market:marketType,requested:symbols.length,scanned:symbols.length-failed,candidates:candidates.length,failed,rejected,rejections,errors,signals,preliminary_signals,flow_review_count:flowCandidates.length,flow_checked_count:flowChecked,flow_review_symbols:flowCandidates.map(x=>x.symbol),engine_activity:engineActivity,checked_at:new Date().toISOString()};
}

async function loadDigitalHunterFuturesUniverse(){
 const get=url=>marketFlowJson(url,9000),jobs=[
  async()=>{const [info,tickers]=await Promise.all([get("https://fapi.binance.com/fapi/v1/exchangeInfo"),get("https://fapi.binance.com/fapi/v1/ticker/24hr")]);const allowed=new Set((info.symbols||[]).filter(x=>x.status==="TRADING"&&x.contractType==="PERPETUAL"&&x.quoteAsset==="USDT").map(x=>x.symbol));return ["Binance USD-M Futures",(Array.isArray(tickers)?tickers:[]).filter(x=>allowed.has(x.symbol)).map(x=>({symbol:String(x.symbol).replace(/USDT$/,""),pair:x.symbol,price:Number(x.lastPrice)||0,volume:Number(x.quoteVolume)||0,change24h:Number(x.priceChangePercent)||0}))];},
  async()=>{const d=await get("https://api.bybit.com/v5/market/tickers?category=linear");if(Number(d.retCode)!==0)throw Error(d.retMsg||"Bybit Futures tickers unavailable");return ["Bybit Linear",(d.result?.list||[]).filter(x=>String(x.symbol).endsWith("USDT")&&x.status!=="PreLaunch").map(x=>({symbol:String(x.symbol).replace(/USDT$/,""),pair:x.symbol,price:Number(x.lastPrice)||0,volume:Number(x.turnover24h)||0,change24h:(Number(x.price24hPcnt)||0)*100}))];},
  async()=>{const d=await get("https://www.okx.com/api/v5/market/tickers?instType=SWAP");if(String(d.code)!=="0")throw Error(d.msg||"OKX Swap tickers unavailable");return ["OKX USDT Swap",(d.data||[]).filter(x=>String(x.instId).endsWith("-USDT-SWAP")).map(x=>({symbol:String(x.instId).replace("-USDT-SWAP",""),pair:x.instId,price:Number(x.last)||0,volume:(Number(x.volCcy24h)||0)*(Number(x.last)||0),change24h:Number(x.open24h)>0?(Number(x.last)/Number(x.open24h)-1)*100:0}))];},
  async()=>{const d=await get("https://api.bitget.com/api/v3/market/tickers?category=USDT-FUTURES");if(String(d.code)!=="00000")throw Error(d.msg||"Bitget USDT Futures tickers unavailable");return ["Bitget USDT Futures",(d.data||[]).filter(x=>String(x.symbol||"").endsWith("USDT")&&Number(x.lastPrice)>0).map(x=>({symbol:String(x.symbol).replace(/USDT$/,""),pair:x.symbol,price:Number(x.lastPrice)||0,volume:Number(x.turnover24h)||0,change24h:(Number(x.price24hPcnt)||0)*100}))];},
  async()=>{let d;try{d=await get("https://api.gateio.ws/api/v4/futures/usdt/tickers");}catch{d=await get("https://api.gate.us/api/v4/futures/usdt/tickers");}if(!Array.isArray(d))throw Error("Gate USDT Futures tickers unavailable");return ["Gate USDT Futures",d.filter(x=>String(x.contract||"").endsWith("_USDT")&&Number(x.last)>0).map(x=>({symbol:String(x.contract).replace(/_USDT$/,""),pair:x.contract,price:Number(x.last)||0,volume:Number(x.volume_24h_quote||x.volume_24h_usd)||0,change24h:Number(x.change_percentage)||0}))];},
  async()=>{const [info,tickers]=await Promise.all([get("https://contract.mexc.com/api/v1/contract/detail"),get("https://contract.mexc.com/api/v1/contract/ticker")]);if(info?.success!==true||!Array.isArray(info.data))throw Error("MEXC Futures contract catalog unavailable");const allowed=new Set(info.data.filter(x=>x.state===0&&x.quoteCoin==="USDT"&&x.settleCoin==="USDT").map(x=>String(x.symbol||"")));const rows=Array.isArray(tickers?.data)?tickers.data:(tickers?.data?[tickers.data]:[]);return ["MEXC USDT Futures",rows.filter(x=>allowed.has(x.symbol)).map(x=>({symbol:String(x.symbol).replace(/_USDT$/,""),pair:x.symbol,price:Number(x.lastPrice)||0,volume:Number(x.amount24)||0,change24h:(Number(x.riseFallRate)||0)*100}))];}
 ];
 const settled=await Promise.allSettled(jobs.map(fn=>fn())),map=new Map(),sources={};let providerCount=0;
 settled.forEach((r,i)=>{const name=["Binance USD-M Futures","Bybit Linear","OKX USDT Swap","Bitget USDT Futures","Gate USDT Futures","MEXC USDT Futures"][i];if(r.status!=="fulfilled"){sources[name]={ok:false,error:String(r.reason?.message||r.reason).slice(0,130)};return;}providerCount++;sources[name]={ok:true,count:r.value[1].length};for(const q of r.value[1]){if(!/^[A-Z0-9]{2,20}$/.test(q.symbol)||!(q.price>0)||!(q.volume>=50000))continue;const old=map.get(q.symbol)||{symbol:q.symbol,name:q.symbol,id:"futures:"+q.symbol,venues:new Set(),volume:0,price:0,change24h:0,priceExchange:name};old.venues.add(name);if(q.volume>=old.volume){old.volume=q.volume;old.price=q.price;old.change24h=q.change24h;old.priceExchange=name;}map.set(q.symbol,old);}});
 const assets=normalizeQuantumUniverse([...map.values()].filter(x=>x.venues.size>=2).map(x=>({id:x.id,symbol:x.symbol,name:x.name,current_price:x.price,total_volume:x.volume,hunterExchange:[...x.venues].join(", "),hunterPriceExchange:x.priceExchange||[...x.venues][0],hunterChange24h:x.change24h,marketPairs:[]})),"futures");
 if(!assets.length||providerCount===0)throw Error("No active USDT perpetual markets from Binance, Bybit, OKX, Bitget or Gate");
 return {assets,sources,metadata_provider:"multi-exchange futures"};
}
async function loadDigitalHunterUniverse(env,marketType){
 if(marketType==="futures")return await loadDigitalHunterFuturesUniverse();
 const response=await handle(new Request("https://mmp-coin-ai-analyzer.mehrdadmohammadi1988.workers.dev/hunter-universe",{headers:{"Accept":"application/json","User-Agent":"MMP-Digital-Hunter/2.0","X-MMP-Internal-Token":env.FUTURES_ENGINE_TOKEN||""}}),env);
 if(!response.ok)throw Error("Universe HTTP "+response.status);
 const data=await response.json();
 return {assets:data.hunter_assets||[],sources:data.sources||data.live_source_status||{},metadata_provider:data.metadata_provider||"multi-exchange",stale:data.universe_stale===true||data.cached_fallback===true,universe_age_ms:Number(data.universe_age_ms),universe_updated_at:data.universe_updated_at||data.checked_at||null};
}
async function cacheDigitalHunterUniverse(env,marketType){
 const stateId=marketType==="futures"?"digital-hunter-v2-futures":"digital-hunter-v2",cacheId=stateId+"-universe-cache";
 const universe=await loadDigitalHunterUniverse(env,marketType),assets=normalizeQuantumUniverse(universe.assets||[],marketType).map(x=>({id:String(x.id||x.symbol),symbol:x.symbol,name:x.name||x.symbol,image:x.image||"",current_price:Number(x.current_price)||0,total_volume:Number(x.total_volume)||0,hunterExchange:x.hunterExchange||"",hunterPriceExchange:x.hunterPriceExchange||"",hunterChange24h:Number(x.hunterChange24h)||0,marketPairs:(x.marketPairs||[]).slice(0,4),hunterVenueVolume:x.hunterVenueVolume||{}}));
 if(!assets.length)throw Error("Universe refresh returned no valid "+marketType+" assets");
 assets.sort((a,b)=>calculateMarketScanPriority(b)-calculateMarketScanPriority(a)||Number(b.total_volume||0)-Number(a.total_volume||0));
 const staleAge=Number(universe.universe_age_ms);
 if(universe.stale&&(!Number.isFinite(staleAge)||staleAge<0))throw Error("Stale universe response has no trustworthy age; preserving the previous cache");
 const updatedAt=universe.stale?Date.now()-staleAge:Date.now(),payload={assets,universeUpdatedAt:updatedAt,universeSources:universe.sources||{},universeProvider:universe.metadata_provider||"multi-exchange",scanPriorityVersion:1,universeStale:universe.stale===true};
 await env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind(cacheId,JSON.stringify(payload),new Date(updatedAt).toISOString()).run();
 return {market:marketType,universe_count:assets.length,provider:payload.universeProvider,updated_at:new Date(updatedAt).toISOString(),fresh:!universe.stale,cached_fallback:universe.stale===true,universe_age_ms:universe.stale?staleAge:0};
}
export async function refreshDigitalHunterUniverses(env){
 const results=await Promise.allSettled(["spot","futures"].map(market=>cacheDigitalHunterUniverse(env,market))),markets={},errors={};
 for(let i=0;i<results.length;i++){
  const market=i===0?"spot":"futures",stateId=market==="futures"?"digital-hunter-v2-futures":"digital-hunter-v2";
  if(results[i].status==="fulfilled"){markets[market]=results[i].value;if(results[i].value.fresh===false)errors[market]="Using last-known cached universe; upstream refresh is still degraded";continue;}
  const message=String(results[i].reason?.message||results[i].reason).slice(0,220);errors[market]=message;
  // Keep the last known universe usable, but never relabel stale cache as fresh.
  try{
   const row=await env.ADMIN_DB.prepare("SELECT payload FROM hunter_engine_state WHERE id = ?").bind(stateId+"-universe-cache").first();
   const cached=row?.payload?JSON.parse(row.payload):null;
   if(Array.isArray(cached?.assets)&&cached.assets.length){
    markets[market]={market,universe_count:cached.assets.length,provider:cached.universeProvider||"cached",updated_at:Number(cached.universeUpdatedAt)>0?new Date(Number(cached.universeUpdatedAt)).toISOString():null,fresh:false,cached_fallback:true};
   }
  }catch(cacheError){errors[market]+="; cache read failed: "+String(cacheError?.message||cacheError).slice(0,100);}
 }
 const payload={status:Object.keys(errors).length?(Object.keys(markets).length?"partial":"error"):"success",updated_at:new Date().toISOString(),markets,errors};
 await env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind("digital-hunter-universe-refresh",JSON.stringify(payload),payload.updated_at).run();
 return payload;
}
export async function runDigitalHunterMarketCycle(env,marketType="spot"){
 if(!env.ADMIN_DB)throw Error("ADMIN_DB binding missing");
 const stateId=marketType==="futures"?"digital-hunter-v2-futures":"digital-hunter-v2",stored=await env.ADMIN_DB.prepare("SELECT payload FROM hunter_engine_state WHERE id = ?").bind(stateId).first(),previous=stored?.payload?JSON.parse(stored.payload):{},now=Date.now();
 if(previous.lastRun&&now-Number(previous.lastRun)<45000&&previous.snapshot)return {...previous.snapshot,cycle_skipped:true};
 const batchLimit=marketType==="futures"?FUTURES_HUNTER_BATCH_SIZE:HUNTER_BATCH_SIZE;
 const learningId="mmp-learning-ledger-v1-"+marketType;let priorLedger={};
 try{const learningRow=await env.ADMIN_DB.prepare("SELECT payload FROM hunter_engine_state WHERE id = ?").bind(learningId).first();priorLedger=learningRow?.payload?JSON.parse(learningRow.payload):{};}catch{}
 const dueLearningRecords=(priorLedger.records||[]).filter(record=>{if(record.market!==marketType||record.status!=="open")return false;const horizon=[5,15,60].find(minutes=>(record["outcome_"+minutes+"m"]===null||record["outcome_"+minutes+"m"]===undefined)&&record["missed_"+minutes+"m"]!==true);return !!horizon&&now>=Number(record.signal_at||now)+horizon*60000&&now<=Number(record.signal_at||now)+horizon*60000+120000;}).sort((a,b)=>Number(a.signal_at)-Number(b.signal_at)).slice(0,2);
 const cacheId=stateId+"-universe-cache",cachedRow=await env.ADMIN_DB.prepare("SELECT payload FROM hunter_engine_state WHERE id = ?").bind(cacheId).first(),cached=cachedRow?.payload?JSON.parse(cachedRow.payload):null;
 let assets=Array.isArray(previous.assets)?previous.assets:[],universeUpdatedAt=Number(previous.universeUpdatedAt)||0,universeSources=previous.universeSources||{},universeProvider=previous.universeProvider||"multi-exchange",adoptedUniverse=false;
 const cacheIsNewer=Number(cached?.universeUpdatedAt)>universeUpdatedAt;
 if(Array.isArray(cached?.assets)&&cached.assets.length&&(!assets.length||cacheIsNewer)){
  assets=cached.assets;universeUpdatedAt=Number(cached.universeUpdatedAt)||now;universeSources=cached.universeSources||{};universeProvider=cached.universeProvider||"multi-exchange";adoptedUniverse=cacheIsNewer;
 }
 if(assets.length&&!Array.isArray(cached?.assets)){const cachePayload=JSON.stringify({assets,universeUpdatedAt,universeSources,universeProvider});await env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind(cacheId,cachePayload,new Date(now).toISOString()).run();}
 if(!assets.length){
  const universe=await loadDigitalHunterUniverse(env,marketType);
  assets=normalizeQuantumUniverse(universe.assets||[],marketType).map(x=>({id:String(x.id||x.symbol),symbol:x.symbol,name:x.name||x.symbol,image:x.image||"",current_price:Number(x.current_price)||0,total_volume:Number(x.total_volume)||0,hunterExchange:x.hunterExchange||"",hunterPriceExchange:x.hunterPriceExchange||"",hunterChange24h:Number(x.hunterChange24h)||0,marketPairs:(x.marketPairs||[]).slice(0,4),hunterVenueVolume:x.hunterVenueVolume||{}}));
  if(!assets.length)throw Error("No liquid USDT "+(marketType==="futures"?"perpetual":"Spot")+" assets");
  assets.sort((a,b)=>calculateMarketScanPriority(b)-calculateMarketScanPriority(a)||Number(b.total_volume||0)-Number(a.total_volume||0));
  universeUpdatedAt=now;universeSources=universe.sources||{};universeProvider=universe.metadata_provider||"multi-exchange";
  const prior=previous.snapshot||{},snapshot={...prior,status:"online",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,market:marketType,checked_at:new Date(now).toISOString(),universe_count:assets.length,batch_size:batchLimit,candidate_count:0,scanned_count:0,failed_count:0,rejected_count:0,cooldown_count:0,universe_refreshed:true,signals:Array.isArray(prior.signals)?prior.signals:[],preliminary_signals:Array.isArray(prior.preliminary_signals)?prior.preliminary_signals:[],flow_review_count:0,flow_checked_count:0,flow_review_symbols:[],last_errors:[],last_rejections:[],sources:universeSources,universe_provider:universeProvider,cycle_seconds:60};
  const cachePayload=JSON.stringify({assets,universeUpdatedAt,universeSources,universeProvider});
  await env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind(cacheId,cachePayload,new Date(now).toISOString()).run();
  const payload=JSON.stringify({cursor:0,lastRun:now,universeUpdatedAt,universeSources,universeProvider,failureCooldown:{},scanPriorityVersion:1,snapshot});
  await env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind(stateId,payload,new Date(now).toISOString()).run();
  return snapshot;
 }
 // Prioritize the active edge of the market instead of scanning only by 24h turnover.
 // This changes queue order, never the final evidence/quality gates.
 assets.sort((a,b)=>calculateMarketScanPriority(b)-calculateMarketScanPriority(a)||Number(b.total_volume||0)-Number(a.total_volume||0));
 const priorityVersion=1;
 const cursor=(adoptedUniverse?0:previous.scanPriorityVersion===priorityVersion?Number(previous.cursor)||0:0)%assets.length,failureCooldown={...(previous.failureCooldown||{})};
 for(const [symbol,until] of Object.entries(failureCooldown))if(Number(until)<=now)delete failureCooldown[symbol];
 // Do not put cooling-down symbols back into the batch: the old fallback below
 // accidentally re-added them and caused repeated failures every cycle.
 const batch=[],selectedSymbols=new Set();let examined=0;
  const priorityRechecks=(previous.snapshot?.preliminary_signals||[]).filter(x=>x.flowStatus==="depth_confirmed_pending_quality"&&x.flow?.complete===true&&x.depth?.confirmed===true&&Number(x.score)>=60&&now-Number(x.updatedAt||0)<=3*60*1000).sort((a,b)=>b.score-a.score).slice(0,2);
  for(const candidate of priorityRechecks){const symbol=String(candidate.symbol||"").toUpperCase(),asset=assets.find(x=>x.symbol===symbol);if(asset&&symbol&&!selectedSymbols.has(symbol)&&Number(failureCooldown[symbol]||0)<=now){batch.push(asset);selectedSymbols.add(symbol);}}
 for(let offset=0;offset<assets.length&&batch.length<batchLimit;offset++){
  examined=offset+1;
  const asset=assets[(cursor+offset)%assets.length],symbol=String(asset.symbol||"").toUpperCase();
  if(!symbol||selectedSymbols.has(symbol)||Number(failureCooldown[symbol]||0)>now)continue;
  batch.push(asset);selectedSymbols.add(symbol);
 }
 const result=await scanHunterSymbols(batch.map(x=>x.symbol),marketType,batch,env,{reviewAI:false});
 const learningMarkResults=await Promise.allSettled(dueLearningRecords.map(async record=>{const asset=assets.find(x=>x.symbol===record.symbol)||null,market=await fetchHunterCandles(record.symbol,marketType,asset),closed=market.rows.slice(0,-1),last=closed.at(-1),price=Number(last?.[4]);if(!(price>0))throw new Error("No fresh closed candle for learning mark");return {symbol:record.symbol,price,currentPrice:price,checked_at:now,provider:market.provider};}));
 const learningMarks=learningMarkResults.filter(x=>x.status==="fulfilled").map(x=>x.value);
 // Retry transient exchange/network failures sooner; quality rejects are not
 // permanent exclusions and are reconsidered after a short cooling period.
 for(const item of result.errors||[])failureCooldown[item.symbol]=now+90*1000;
 for(const item of result.rejections||[])failureCooldown[item.symbol]=now+60*1000;
 const map=new Map((previous.snapshot?.signals||[]).map(x=>[x.symbol,x])),scanned=new Set(batch.map(x=>x.symbol));
 for(const symbol of scanned){const old=map.get(symbol);if(old)old.weakScans=Number(old.weakScans||0)+1;}
 for(const signal of result.signals){const asset=batch.find(x=>x.symbol===signal.symbol)||assets.find(x=>x.symbol===signal.symbol);signal.coin=asset?{...asset,current_price:Number(asset.current_price)||signal.price}:{id:signal.symbol,symbol:signal.symbol,name:signal.symbol,current_price:signal.price};signal.dailyChange24h=Number(asset?.hunterChange24h)||0;signal.weakScans=0;map.set(signal.symbol,signal);}
 for(const symbol of scanned){const old=map.get(symbol);if(old&&!(result.signals||[]).some(x=>x.symbol===symbol)&&Number(old.weakScans||0)>=2)map.delete(symbol);}
 for(const [symbol,signal] of map){if(now-Number(signal.updatedAt||0)>5*60*1000)map.delete(symbol);}
 const preliminaryMap=new Map((previous.snapshot?.preliminary_signals||[]).map(x=>[x.symbol,x]));
 for(const symbol of scanned){const old=preliminaryMap.get(symbol);if(old)old.weakScans=Number(old.weakScans||0)+1;}
 for(const candidate of result.preliminary_signals||[]){const asset=batch.find(x=>x.symbol===candidate.symbol)||assets.find(x=>x.symbol===candidate.symbol);candidate.coin=asset?{...asset,current_price:Number(asset.current_price)||candidate.price}:{id:candidate.symbol,symbol:candidate.symbol,name:candidate.symbol,current_price:candidate.price};candidate.weakScans=0;preliminaryMap.set(candidate.symbol,candidate);}
 for(const symbol of scanned){const old=preliminaryMap.get(symbol);if(old&&!(result.preliminary_signals||[]).some(x=>x.symbol===symbol)&&Number(old.weakScans||0)>=2)preliminaryMap.delete(symbol);}
 for(const [symbol,candidate] of preliminaryMap){if(now-Number(candidate.updatedAt||0)>3*60*1000)preliminaryMap.delete(symbol);}
 const preliminary=[...preliminaryMap.values()].filter(x=>now-Number(x.updatedAt||0)<=3*60*1000).sort((a,b)=>b.score-a.score).slice(0,12);
 const fresh=[...map.values()].filter(x=>now-Number(x.updatedAt||0)<=5*60*1000&&Number(x.score)>=68&&x.confirmed===true&&x.multiExchangeConfirmed===true&&x.flow?.complete===true&&Number(x.flow?.tradeCount)>=8&&Number(x.volumeRatio)>=1.1&&x.depth?.confirmed===true&&x.quantum?.qualityGate===true).sort((a,b)=>b.score-a.score);
 const selected=[...fresh.filter(x=>x.trend==="bull").slice(0,6),...fresh.filter(x=>x.trend==="bear").slice(0,6)];
 let learningSummary={market:marketType,totalSignals:0,matured5m:0,calibrationStatus:"collecting",calibrationAdjustment:0,processed:0};
 try{
  const ledger=updateLearningLedger(priorLedger,{observations:[...(result.signals||[]),...(result.preliminary_signals||[]),...learningMarks],signals:selected,market:marketType,engine:"hunter",now});
  learningSummary=ledger.summary;
  if(ledger.changed)await env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind(learningId,JSON.stringify(ledger),new Date(now).toISOString()).run();
 }catch(error){learningSummary={...learningSummary,status:"unavailable",error:String(error?.message||error).slice(0,140)};}
 const calibratedSelected=selected.map(signal=>applyLearningCalibration(signal,learningSummary));
 const nextCursor=(cursor+Math.max(1,examined))%assets.length,priorActivity=cursor===0?{}:(previous.snapshot?.engine_activity||{}),engineActivity=Object.fromEntries(QUANTUM_ACTIVITY_KEYS.map(key=>{const a=priorActivity[key]||{},b=result.engine_activity?.[key]||{};return [key,{processed:Number(a.processed||0)+Number(b.processed||0),evidence:Number(a.evidence||0)+Number(b.evidence||0)}];}));
 engineActivity.learning={processed:Number(learningSummary.totalSignals)||0,total:Number(learningSummary.totalSignals)||0,evidence:Number(learningSummary.matured5m)||0,calibrationStatus:learningSummary.calibrationStatus||"collecting"};
 const snapshot={status:"online",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,market:marketType,checked_at:new Date().toISOString(),scanned_at:new Date().toISOString(),universe_count:assets.length,universe_age_ms:Math.max(0,now-universeUpdatedAt),universe_stale:now-universeUpdatedAt>20*60*1000,next_cursor:nextCursor,queue_position:nextCursor===0?assets.length:nextCursor,queue_total:assets.length,batch_size:batch.length,scanned_count:result.scanned,candidate_count:result.candidates,failed_count:result.failed,rejected_count:result.rejected||0,cooldown_count:Object.keys(failureCooldown).length,universe_refreshed:false,signals:calibratedSelected,preliminary_signals:preliminary,learning:learningSummary,flow_review_count:result.flow_review_count||0,flow_checked_count:result.flow_checked_count||0,flow_review_symbols:result.flow_review_symbols||[],engine_activity:engineActivity,last_errors:result.errors||[],last_rejections:result.rejections||[],sources:universeSources,universe_provider:universeProvider,cycle_seconds:60};
 const payload=JSON.stringify({cursor:snapshot.next_cursor,lastRun:now,universeUpdatedAt,universeSources,universeProvider,failureCooldown,scanPriorityVersion:priorityVersion,snapshot});
 await env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind(stateId,payload,new Date(now).toISOString()).run();
 return snapshot;
}
async function runDigitalHunterCycle(env){return runDigitalHunterMarketCycle(env,"spot");}

async function handle(request,env){
 if(request.method==="OPTIONS"){
  const origin=request.headers.get("Origin");
  if(origin&&!ALLOWED_ORIGINS.has(origin))return new Response(null,{status:403,headers:{"Vary":"Origin"}});
  return new Response(null,{status:204,headers:{...corsHeaders(request),"X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
 }

 if(request.method==="GET"&&new URL(request.url).pathname==="/market-flow"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"market-flow"),request);if(limited)return limited;
  const url=new URL(request.url),symbol=String(url.searchParams.get("symbol")||"").toUpperCase(),marketType=url.searchParams.get("market")==="futures"?"futures":"spot";
  if(!/^[A-Z0-9]{2,24}(USDT)?$/.test(symbol))return json({error:"نماد نامعتبر است."},400,request);
  const flowWindow=url.searchParams.get("window")||(marketType==="futures"?1:5);try{return json(marketType==="futures"?await loadFuturesMarketFlow(symbol,flowWindow):await loadMarketFlow(symbol,flowWindow),200,request);}
  catch(error){return json({error:String(error?.message||"دریافت جریان معاملات ناموفق بود").slice(0,260)},502,request);}
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/hunter-combined-snapshot"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"hunter-combined-snapshot"),request);if(limited)return limited;
  if(!env.ADMIN_DB)return json({status:"offline",error:"ADMIN_DB binding missing"},503,request);
  const [spotRow,futuresRow]=await Promise.all([
   env.ADMIN_DB.prepare("SELECT payload,updated_at FROM hunter_engine_state WHERE id = ?").bind("digital-hunter-v2").first(),
   env.ADMIN_DB.prepare("SELECT payload,updated_at FROM hunter_engine_state WHERE id = ?").bind("digital-hunter-v2-futures").first()
  ]);
  let spotSaved=null,futuresSaved=null;try{spotSaved=spotRow?.payload?JSON.parse(spotRow.payload):null;}catch{}try{futuresSaved=futuresRow?.payload?JSON.parse(futuresRow.payload):null;}catch{}
  const spot=spotSaved?.snapshot||{status:"warming_up",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,signals:[],scanned_count:0,universe_count:0};
  const futures=futuresSaved?.snapshot||{status:"warming_up",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,market:"futures",signals:[],scanned_count:0,universe_count:0};
  return json({status:spot.status==="online"&&futures.status==="online"?"online":"warming_up",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,spot,futures,updated_at:{spot:spotRow?.updated_at||null,futures:futuresRow?.updated_at||null}},200,request);
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/hunter-snapshot"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"hunter-snapshot"),request);if(limited)return limited;if(!env.ADMIN_DB)return json({status:"offline",error:"ADMIN_DB binding missing"},503,request);
  const row=await env.ADMIN_DB.prepare("SELECT payload FROM hunter_engine_state WHERE id = ?").bind("digital-hunter-v2").first();let saved=null;try{saved=row?.payload?JSON.parse(row.payload):null;}catch{}
  return json(saved?.snapshot||{status:"warming_up",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,signals:[],scanned_count:0,universe_count:0},200,request);
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/hunter-run"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"hunter-run"),request);if(limited)return limited;try{return json(await runDigitalHunterCycle(env),200,request);}catch(e){return json({status:"error",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,error:String(e?.message||e).slice(0,220)},502,request);}
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/hunter-cron-status"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"hunter-cron-status"),request);if(limited)return limited;
  if(!env.ADMIN_DB)return json({status:"offline",error:"ADMIN_DB binding missing"},503,request);
  const [spotRow,futuresRow,universeRow]=await Promise.all([
   env.ADMIN_DB.prepare("SELECT payload, updated_at FROM hunter_engine_state WHERE id = ?").bind("digital-hunter-cron-heartbeat").first(),
   env.ADMIN_DB.prepare("SELECT payload, updated_at FROM hunter_engine_state WHERE id = ?").bind("digital-hunter-futures-cron-heartbeat").first(),
   env.ADMIN_DB.prepare("SELECT payload, updated_at FROM hunter_engine_state WHERE id = ?").bind("digital-hunter-universe-refresh").first()
  ]);
  let spotSaved=null,futuresSaved=null,universeSaved=null;try{spotSaved=spotRow?.payload?JSON.parse(spotRow.payload):null;}catch{}try{futuresSaved=futuresRow?.payload?JSON.parse(futuresRow.payload):null;}catch{}try{universeSaved=universeRow?.payload?JSON.parse(universeRow.payload):null;}catch{}
  const spot=spotSaved?.markets?.spot||{status:spotSaved?.status||"warming_up",universe:0};
  const futures=futuresSaved?.market_data||{status:futuresSaved?.status||"warming_up",universe:0};
  const status=spotSaved?.status==="success"&&futuresSaved?.status==="success"?"success":spotSaved||futuresSaved?"partial":"warming_up";
  const updated_at=[spotRow?.updated_at,futuresRow?.updated_at].filter(Boolean).sort().at(-1)||null;
  return json({status,engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,cron:spotSaved?.cron||futuresSaved?.cron||"* * * * *",startedAt:spotSaved?.startedAt||futuresSaved?.startedAt||null,finishedAt:spotSaved?.finishedAt||futuresSaved?.finishedAt||null,updated_at,markets:{spot,futures},universe_refresh:{status:universeSaved?.status||"warming_up",updated_at:universeRow?.updated_at||null,markets:universeSaved?.markets||{},errors:universeSaved?.errors||{}},errors:{...(spotSaved?.errors||{}),...(futuresSaved?.status==="error"?{futures:futuresSaved.error}:futuresSaved?.errors||{})}},200,request);
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/hunter-futures-snapshot"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"hunter-futures-snapshot"),request);if(limited)return limited;if(!env.ADMIN_DB)return json({status:"offline",error:"ADMIN_DB binding missing"},503,request);
  const row=await env.ADMIN_DB.prepare("SELECT payload FROM hunter_engine_state WHERE id = ?").bind("digital-hunter-v2-futures").first();let saved=null;try{saved=row?.payload?JSON.parse(row.payload):null;}catch{}
  return json(saved?.snapshot||{status:"warming_up",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,market:"futures",signals:[],scanned_count:0,universe_count:0},200,request);
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/hunter-futures-universe"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"hunter-futures-universe"),request);if(limited)return limited;
  if(!env.ADMIN_DB)return json({status:"offline",error:"ADMIN_DB binding missing"},503,request);
  const row=await env.ADMIN_DB.prepare("SELECT payload, updated_at FROM hunter_engine_state WHERE id = ?").bind("digital-hunter-v2-futures").first();
  let saved=null;try{saved=row?.payload?JSON.parse(row.payload):null;}catch{}
  let cached=null;try{const cacheRow=await env.ADMIN_DB.prepare("SELECT payload FROM hunter_engine_state WHERE id = ?").bind("digital-hunter-v2-futures-universe-cache").first();cached=cacheRow?.payload?JSON.parse(cacheRow.payload):null;}catch{} const assets=Array.isArray(saved?.assets)?saved.assets:Array.isArray(cached?.assets)?cached.assets:[];
  if(!assets.length)return json({status:"warming_up",market:"futures",universe_count:0,assets:[]},503,request);
  return json({status:"online",engine:QUANTUM_ENGINE_NAME,market:"futures",universe_count:assets.length,universe_updated_at:saved.universeUpdatedAt||null,updated_at:row?.updated_at||null,source:saved.universeProvider||"multi-exchange",assets},200,request);
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/hunter-futures-run"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"hunter-futures-run"),request);if(limited)return limited;try{return json(await runDigitalHunterMarketCycle(env,"futures"),200,request);}catch(e){return json({status:"error",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,market:"futures",error:String(e?.message||e).slice(0,220)},502,request);}
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/hunter-scan"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"hunter-scan"),request);if(limited)return limited;const url=new URL(request.url),symbols=[...new Set((url.searchParams.get("symbols")||"").split(",").map(x=>x.toUpperCase().replace(/[^A-Z0-9]/g,"")).filter(x=>/^[A-Z0-9]{2,24}$/.test(x)))].slice(0,12);if(!symbols.length)return json({error:"حداقل یک نماد معتبر ارسال کنید."},400,request);const marketType=url.searchParams.get("market")==="futures"?"futures":"spot";try{return json({engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,...await scanHunterSymbols(symbols,marketType,[],env)},200,request);}catch(e){return json({error:String(e?.message||e).slice(0,220)},502,request);}
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/hunter-universe"){
  // Scheduled engine refreshes authenticate internally with a Worker secret and do not
  // consume the public IP rate-limit bucket. External requests remain rate-limited.
  const internalAuthorized=!!env.FUTURES_ENGINE_TOKEN&&request.headers.get("X-MMP-Internal-Token")===env.FUTURES_ENGINE_TOKEN;
  if(!internalAuthorized){
   const limitResult=await checkRateLimit(env.PUBLIC_API_LIMITER,request,"hunter-universe");
   const limited=rateLimitReply(limitResult,request);if(limited)return limited;
  }
  // Share the expensive multi-exchange catalog across web and Android clients for 90 seconds.
  const universeCacheKey=await marketFallbackKey("hunter-universe:v1");
  const cachedUniverse=await readMarketFallback(env,universeCacheKey);
  if(cachedUniverse?.payload&&cachedUniverse.ageMs<90000){
   return json({...cachedUniverse.payload,universe_stale:false,universe_age_ms:cachedUniverse.ageMs,universe_updated_at:cachedUniverse.payload.checked_at||null},200,request,{"X-MMP-Cache":"HIT","X-MMP-Data-Age":String(Math.floor(cachedUniverse.ageMs)),"Cache-Control":"no-store"});
  }
  const timedJson=async(url,timeout=12000,cacheTtl=30,extraHeaders={})=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
   try{
    const response=await fetch(url,{headers:{"Accept":"application/json","User-Agent":"MMP-COIN-AI/1.0","Accept-Language":"en-US,en;q=0.9",...extraHeaders},signal:controller.signal,cf:{cacheTtl,cacheEverything:true}});
    if(!response.ok)throw new Error("HTTP "+response.status);
    return await response.json();
   }finally{clearTimeout(timer);}
  };
  const timedJsonAny=async(urls,timeout=12000,cacheTtl=30,extraHeaders={})=>{
   let lastError=null;
   for(const url of urls){try{return await timedJson(url,timeout,cacheTtl,extraHeaders);}catch(error){lastError=error;}}
   throw lastError||new Error("all market endpoints unavailable");
  };
  const cmcUrl=start=>"https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/listings/latest?start="+start+"&limit=5000&convert=USD";
  const primary=await Promise.allSettled([
   timedJsonAny(["https://data-api.binance.vision/api/v3/exchangeInfo?permissions=%5B%22SPOT%22%5D","https://api.binance.com/api/v3/exchangeInfo?permissions=%5B%22SPOT%22%5D","https://api-gcp.binance.com/api/v3/exchangeInfo?permissions=%5B%22SPOT%22%5D","https://api1.binance.com/api/v3/exchangeInfo?permissions=%5B%22SPOT%22%5D","https://api2.binance.com/api/v3/exchangeInfo?permissions=%5B%22SPOT%22%5D","https://api3.binance.com/api/v3/exchangeInfo?permissions=%5B%22SPOT%22%5D"],12000,300),
   timedJson(cmcUrl(1),18000,60),
   timedJson(cmcUrl(5001),18000,60)
  ]);
  // در صورت خطای CMC، کاتالوگ جایگزین CoinLore در ادامه بررسی می‌شود.
  const binanceInfo=primary[0].status==="fulfilled"?primary[0].value:{symbols:[]};
  let cmcRows=[...(Array.isArray(primary[1].value?.data)?primary[1].value.data:[]),...(primary[2].status==="fulfilled"&&Array.isArray(primary[2].value?.data)?primary[2].value.data:[])];
  let metadataProvider="CoinMarketCap";
  if(!cmcRows.length){
   // اگر کاتالوگ CMC از Worker پاسخ نداد، کاتالوگ عمومی CoinLore به‌عنوان مسیر جایگزین استفاده می‌شود.
   const fallbackPages=await Promise.allSettled(Array.from({length:10},(_,i)=>timedJson("https://api.coinlore.net/api/tickers/?start="+(i*100)+"&limit=100",15000,60)));
   cmcRows=fallbackPages.flatMap(result=>result.status==="fulfilled"&&Array.isArray(result.value)?result.value.map(item=>({
    id:item.id,symbol:item.symbol,name:item.name,cmc_rank:Number(item.rank)||null,metadata_source:"CoinLore",
    quote:{USD:{price:Number(item.price_usd)||0,market_cap:Number(item.market_cap_usd)||0,percent_change_24h:Number(item.percent_change_24h)||0}}}
   )):[]);
   metadataProvider="CoinLore fallback";
  }
  const binanceSymbols=new Set((binanceInfo.symbols||[]).filter(x=>x.status==="TRADING"&&x.isSpotTradingAllowed!==false&&String(x.quoteAsset||"").toUpperCase()==="USDT").map(x=>String(x.baseAsset||"").toUpperCase()).filter(Boolean));
  const cmcBySymbol=new Map(),cmcDuplicateCount=new Map();
  cmcRows.forEach(item=>{
   const symbol=String(item?.symbol||"").toUpperCase();
   if(!symbol)return;
   cmcDuplicateCount.set(symbol,(cmcDuplicateCount.get(symbol)||0)+1);
   const old=cmcBySymbol.get(symbol),rank=Number(item.cmc_rank)||999999,oldRank=Number(old?.cmc_rank)||999999;
   // نمادهای تکراری را حذف کامل نمی‌کنیم؛ رکورد دارای رتبه معتبرتر CMC انتخاب می‌شود.
   if(!old||rank<oldRank)cmcBySymbol.set(symbol,item);
  });
  const excluded=new Set(["UP","DOWN","BULL","BEAR","3L","3S"]);
  // یونیورس چندصرافی: نمادها فقط به Binance محدود نیستند؛ فهرست CMC با بازارهای واقعی USDT در شش صرافی تطبیق داده می‌شود.
  const eligible=[...cmcBySymbol.keys()].filter(symbol=>!/^[0-9]+$/.test(symbol)&&!excluded.has(symbol)&&!/(UP|DOWN|BULL|BEAR|3L|3S)$/.test(symbol));
  const jobs=[
   ["Binance",["https://data-api.binance.vision/api/v3/ticker/24hr","https://api.binance.com/api/v3/ticker/24hr","https://api-gcp.binance.com/api/v3/ticker/24hr","https://api1.binance.com/api/v3/ticker/24hr","https://api2.binance.com/api/v3/ticker/24hr","https://api3.binance.com/api/v3/ticker/24hr"],d=>(Array.isArray(d)?d:[]).filter(x=>String(x.symbol).endsWith("USDT")).map(x=>({symbol:String(x.symbol).slice(0,-4),pair:String(x.symbol),quoteAsset:"USDT",volume:Number(x.quoteVolume)||0,price:Number(x.lastPrice)||0,change24h:Number(x.priceChangePercent)||0}))],
   ["Bybit",["https://api.bybit.com/v5/market/tickers?category=spot","https://api.bytick.com/v5/market/tickers?category=spot","https://api.bybit.eu/v5/market/tickers?category=spot"],d=>(d.result?.list||[]).filter(x=>String(x.symbol).endsWith("USDT")).map(x=>({symbol:String(x.symbol).slice(0,-4),pair:String(x.symbol),quoteAsset:"USDT",volume:Number(x.turnover24h)||0,price:Number(x.lastPrice)||0,change24h:(Number(x.price24hPcnt)||0)*100}))],
   ["OKX","https://www.okx.com/api/v5/market/tickers?instType=SPOT",d=>(d.data||[]).filter(x=>String(x.instId).endsWith("-USDT")).map(x=>({symbol:String(x.instId).replace("-USDT",""),pair:String(x.instId),quoteAsset:"USDT",volume:Number(x.volCcy24h)||0,price:Number(x.last)||0,change24h:Number(x.open24h)>0?(Number(x.last)/Number(x.open24h)-1)*100:0}))],
   ["Bitget","https://api.bitget.com/api/v2/spot/market/tickers",d=>(d.data||[]).filter(x=>String(x.symbol).endsWith("USDT")).map(x=>({symbol:String(x.symbol).slice(0,-4),pair:String(x.symbol),quoteAsset:"USDT",volume:Number(x.usdtVolume||x.quoteVolume)||0,price:Number(x.lastPr)||0,change24h:(Number(x.change24h)||0)*100})),{"Origin":"https://www.bitget.com","Referer":"https://www.bitget.com/","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"}],
   ["Gate","https://api.gateio.ws/api/v4/spot/tickers",d=>(Array.isArray(d)?d:[]).filter(x=>String(x.currency_pair).endsWith("_USDT")).map(x=>({symbol:String(x.currency_pair).replace("_USDT",""),pair:String(x.currency_pair),quoteAsset:"USDT",volume:Number(x.quote_volume)||0,price:Number(x.last)||0,change24h:Number(x.change_percentage)||0}))],
   ["KuCoin","https://api.kucoin.com/api/v1/market/allTickers",d=>(d.data?.ticker||[]).filter(x=>String(x.symbol).endsWith("-USDT")).map(x=>({symbol:String(x.symbol).replace("-USDT",""),pair:String(x.symbol),quoteAsset:"USDT",volume:Number(x.volValue)||0,price:Number(x.last)||0,change24h:(Number(x.changeRate)||0)*100}))],
   ["WhiteBIT","https://whitebit.com/api/v4/public/ticker",d=>Object.entries(d||{}).filter(([pair,x])=>pair.endsWith("_USDT")&&!x.isFrozen).map(([pair,x])=>({symbol:pair.slice(0,-5),pair,quoteAsset:"USDT",volume:Number(x.quote_volume)||0,price:Number(x.last_price)||0,change24h:Number(x.change)||0}))],
   ["Nobitex","https://apiv2.nobitex.ir/market/stats?dstCurrency=rls",d=>{const stats=d?.stats||{},usdtRls=Number(stats["usdt-rls"]?.latest)||0;if(d?.status!=="ok"||usdtRls<=0)return [];return Object.entries(stats).filter(([pair,x])=>pair.endsWith("-rls")&&pair!=="usdt-rls"&&Number(x?.latest)>0).map(([pair,x])=>({symbol:pair.split("-")[0].toUpperCase(),pair:pair.toUpperCase(),quoteAsset:"IRT",volume:Number(x.volumeDst)>0?Number(x.volumeDst)/usdtRls:0,price:Number(x.latest)/usdtRls,change24h:Number(x.dayChange)||0}));}],
   ["Wallex",["https://api.wallex.ir/hector/web/v1/markets","https://api.wallex.ir/v1/markets","https://api.wallex.ir/v1/otc/markets"],d=>{const raw=d?.result?.symbols||d?.result?.markets||{},rows=Array.isArray(raw)?raw:Object.values(raw),usdtRial=Number((Array.isArray(raw)?rows.find(x=>String(x.symbol).toUpperCase()==="USDTIRT"):raw.USDTIRT)?.stats?.lastPrice)||0;return d?.success===true?rows.map(x=>{const base=String(x.baseAsset||"").toUpperCase(),quote=String(x.quoteAsset||"").toUpperCase(),last=Number(x.stats?.lastPrice??x.lastPrice)||0,local=["IRT","IRR","RLS","TMN"].includes(quote),rate=local?usdtRial:1,quoteVolume=Number(x.stats?.["24h_quoteVolume"]??x.stats?.quoteVolume)||0;return {symbol:base,pair:String(x.symbol||base+quote),quoteAsset:local?"IRT":quote,volume:rate>0?quoteVolume/rate:quoteVolume,price:rate>0?last/rate:last,change24h:Number(x.stats?.["24h_ch"]??x.stats?.change24h)||0};}).filter(x=>x.symbol&&x.price>0&&["USDT","IRT"].includes(x.quoteAsset)):[];},{"Origin":"https://wallex.ir","Referer":"https://wallex.ir/","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"}]
  ];
  const tickerResults=await Promise.allSettled(jobs.map(async([name,url,normalize,headers])=>({name,rows:normalize(await (Array.isArray(url)?timedJsonAny(url,11000,10,headers||{}):timedJson(url,11000,10,headers||{})))})));
  const markets=new Map(),discoveryMarkets=new Map(),sources={BinanceExchangeInfo:{ok:primary[0].status==="fulfilled",status:primary[0].status==="fulfilled"?200:0,error:primary[0].status==="rejected"?String(primary[0].reason?.message||primary[0].reason).slice(0,140):null},MetadataCatalog:{ok:cmcRows.length>0,provider:metadataProvider},CoinMarketCap:{ok:primary[1].status==="fulfilled",status:primary[1].status==="fulfilled"?200:0,page2:primary[2].status==="fulfilled"}};
  tickerResults.forEach((result,i)=>{
   const name=jobs[i][0];
   if(result.status!=="fulfilled"){sources[name]={ok:false,error:String(result.reason?.message||result.reason).slice(0,140)};return;}
   sources[name]={ok:true,status:200};
   result.value.rows.forEach(row=>{
    if(!(row.price>0)||!(row.volume>=0)||!/^[A-Z0-9]{2,20}$/.test(String(row.symbol||"")))return;
    const normalized={...row,pair:row.pair||row.symbol+"USDT",quoteAsset:row.quoteAsset||"USDT",exchange:name};
    if(!eligible.includes(row.symbol)){
     // Independent hunter discovery: unknown-to-metadata USDT instruments are kept out of the canonical asset catalog.
     // They enter the scan universe only after corroboration by at least two independent exchanges.
     if(normalized.quoteAsset==="USDT"&&!excluded.has(row.symbol)&&!/(UP|DOWN|BULL|BEAR|3L|3S)$/.test(row.symbol)){
      let found=discoveryMarkets.get(row.symbol);if(!found){found={venues:new Set(),quotes:[]};discoveryMarkets.set(row.symbol,found);}
      found.venues.add(name);found.quotes.push(normalized);
     }
     return;
    }
    let item=markets.get(row.symbol);if(!item){item={venues:new Set(),quotes:[]};markets.set(row.symbol,item);}
    item.venues.add(name);item.quotes.push(normalized);
   });
  });
  const assets=[...markets.keys()].map(symbol=>{
   const meta=cmcBySymbol.get(symbol),market=markets.get(symbol);
   const quotes=market.quotes.slice().sort((a,b)=>b.volume-a.volume),best=quotes.find(x=>x.price>0)||{};
   const cmcQuote=Array.isArray(meta.quote)?(meta.quote.find(q=>String(q.symbol||"").toUpperCase()==="USD")||{}):(meta.quote?.USD||meta.quote||{});
   const venueVolume={};
   for(const quote of quotes)venueVolume[quote.exchange]=Math.max(venueVolume[quote.exchange]||0,Number(quote.volume)||0);
   return {
    id:"cmc:"+String(meta.id),cmcId:Number(meta.id),symbol,name:meta.name||symbol,
    image:meta.metadata_source==="CoinLore"?"":"https://s2.coinmarketcap.com/static/img/coins/"+String(meta.id)+"/64x64.png",
    current_price:best.price||Number(cmcQuote.price)||0,total_volume:quotes.reduce((sum,x)=>sum+(Number(x.volume)||0),0),
    market_cap:Number(cmcQuote.market_cap)||null,market_cap_rank:Number(meta.cmc_rank)||null,
    hunterExchange:[...market.venues].join(", "),hunterPriceExchange:best.exchange||"CoinMarketCap",
    hunterChange24h:Number.isFinite(best.change24h)?best.change24h:Number(cmcQuote.percent_change_24h)||0,
    hunterVenueVolume:venueVolume,marketPairs:quotes.map(q=>({exchange:q.exchange,pair:q.pair,quote:q.quoteAsset,price:Number(q.price)||0,volume:Number(q.volume)||0})),hasUsdtMarket:quotes.some(q=>String(q.quoteAsset).toUpperCase()==="USDT"),hasDomesticMarket:quotes.some(q=>["Nobitex","Wallex"].includes(q.exchange)),cmcDuplicateCount:cmcDuplicateCount.get(symbol)||1
   };
  }).filter(x=>x.current_price>0).sort((a,b)=>Math.abs(Number(b.hunterChange24h)||0)-Math.abs(Number(a.hunterChange24h)||0)||b.total_volume-a.total_volume||Number(a.market_cap_rank||999999)-Number(b.market_cap_rank||999999));
  // Canonical assets retain metadata identity where available; independent discoveries remain a separate market-instrument universe.
  const rankedAssets=assets.sort((a,b)=>b.total_volume-a.total_volume||Number(a.market_cap_rank||999999)-Number(b.market_cap_rank||999999));
  const discoveredAssets=[...discoveryMarkets.entries()].map(([symbol,market])=>{
   const quotes=market.quotes.slice().sort((a,b)=>b.volume-a.volume),best=quotes[0]||{};
   return {id:"market-discovery:"+symbol,symbol,name:symbol,image:"",current_price:Number(best.price)||0,total_volume:quotes.reduce((sum,x)=>sum+(Number(x.volume)||0),0),market_cap:null,market_cap_rank:null,hunterExchange:[...market.venues].join(", "),hunterPriceExchange:best.exchange||"Exchange discovery",hunterChange24h:Number(best.change24h)||0,hunterVenueVolume:Object.fromEntries(quotes.map(x=>[x.exchange,Number(x.volume)||0])),marketPairs:quotes.map(q=>({exchange:q.exchange,pair:q.pair,quote:q.quoteAsset,price:Number(q.price)||0,volume:Number(q.volume)||0})),hasUsdtMarket:true,hasDomesticMarket:false,isDiscovery:true};
  }).filter(asset=>asset.current_price>0&&discoveryMarkets.get(asset.symbol).venues.size>=2&&asset.total_volume>=50000);
  const hunterAssets=[...rankedAssets.filter(asset=>asset.hasUsdtMarket===true),...discoveredAssets].sort((a,b)=>Number(b.total_volume||0)-Number(a.total_volume||0));
  const radarAssets=[...rankedAssets,...discoveredAssets].sort((a,b)=>Number(b.total_volume||0)-Number(a.total_volume||0));
  if(!rankedAssets.length&&!hunterAssets.length&&!radarAssets.length){
   if(cachedUniverse?.payload){
    const stalePayload={...cachedUniverse.payload,cached_fallback:true,universe_stale:true,universe_age_ms:cachedUniverse.ageMs,universe_updated_at:cachedUniverse.payload.checked_at||null,live_source_status:sources};
    return json(stalePayload,200,request,{"X-MMP-Cache":"STALE","X-MMP-Data-Age":String(Math.floor(cachedUniverse.ageMs)),"Cache-Control":"no-store","Warning":'110 - "Response is stale"'});
   }
   if(env.ADMIN_DB){
    try{
     const row=await env.ADMIN_DB.prepare("SELECT payload,updated_at FROM hunter_engine_state WHERE id = ?").bind("digital-hunter-v2-universe-cache").first();
     const saved=row?.payload?JSON.parse(row.payload):null;
     const savedAt=Number(saved?.universeUpdatedAt)||Date.parse(row?.updated_at||"")||0;
     const staleAssets=normalizeQuantumUniverse(saved?.assets||[],"spot");
     if(staleAssets.length&&savedAt>0){
      const ageMs=Math.max(0,Date.now()-savedAt),stalePayload={checked_at:new Date(savedAt).toISOString(),universe_updated_at:new Date(savedAt).toISOString(),universe_age_ms:ageMs,universe_stale:true,cached_fallback:true,warning:"Live exchange catalog is unavailable; serving the last validated Spot universe.",count:staleAssets.length,hunter_count:staleAssets.length,radar_count:staleAssets.length,discovered_count:0,binance_spot_symbols:0,cmc_listings:0,universe_mode:"cached_fallback",metadata_provider:saved.universeProvider||"cached",assets:staleAssets,hunter_assets:staleAssets,radar_assets:staleAssets,sources:saved.universeSources||{},live_source_status:sources};
      return json(stalePayload,200,request,{"X-MMP-Cache":"STALE","X-MMP-Data-Age":String(Math.floor(ageMs)),"Cache-Control":"no-store","Warning":'110 - "Response is stale"'});
     }
    }catch(error){console.warn("Hunter admin universe fallback failed:",String(error?.message||error).slice(0,140));}
   }
   return json({error:"هیچ بازار معتبر و قابل‌تأییدی از صرافی‌ها دریافت نشد.",sources},502,request);
  }
  const universePayload={checked_at:new Date().toISOString(),count:rankedAssets.length,hunter_count:hunterAssets.length,radar_count:radarAssets.length,discovered_count:discoveredAssets.length,binance_spot_symbols:binanceSymbols.size,cmc_listings:cmcRows.length,universe_mode:"unified_catalog_plus_independent_exchange_discovery",metadata_provider:metadataProvider,assets:rankedAssets,hunter_assets:hunterAssets,radar_assets:radarAssets,sources};
  if(env.MARKET_CACHE_DB){
   try{await env.MARKET_CACHE_DB.prepare("INSERT INTO market_data_cache (cache_key,payload,cached_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,cached_at=excluded.cached_at").bind(universeCacheKey,JSON.stringify(universePayload),Date.now()).run();}
   catch(error){console.warn("Hunter universe shared cache write failed:",String(error?.message||error).slice(0,140));}
  }
  return json(universePayload,200,request,{"X-MMP-Data-Source":"Binance, Bybit, OKX, Bitget, Gate, KuCoin, WhiteBIT, Nobitex, Wallex + "+metadataProvider,"X-MMP-Cache":"MISS","Cache-Control":"no-store"});
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/support-check"){
  const limitResult=await checkRateLimit(env.PUBLIC_API_LIMITER,request,"support-check");
  const limited=rateLimitReply(limitResult,request);if(limited)return limited;
  const url=new URL(request.url);
  const symbols=[...new Set((url.searchParams.get("symbols")||"").split(",").map(x=>x.toUpperCase().replace(/[^A-Z0-9_]/g,"")).filter(validSymbol))].slice(0,150);
  if(!symbols.length)return json({error:"Provide comma-separated symbols"},400,request);
  const catalogs=await getExchangeCatalogs();
  const assets=symbols.map(symbol=>exchangeSupport(symbol,catalogs));
  const sources=Object.fromEntries(Object.entries(catalogs).map(([k,v])=>[k,{ok:!!v?.ok,status:v?.status||0,error:v?.error||null,source:v?.source||null}]));
  return json({checked_at:new Date().toISOString(),assets,sources},200,request);
 }


 if(request.method==="GET"&&new URL(request.url).pathname==="/market-derivatives"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"market-derivatives"),request);if(limited)return limited;
  const url=new URL(request.url),raw=String(url.searchParams.get("symbol")||"BTC").toUpperCase();
  if(!/^[A-Z0-9]{2,15}$/.test(raw))return json({error:"نماد نامعتبر است."},400,request);
  const base=raw.replace(/USDT$/,""),symbol=base+"USDT",instId=base+"-USDT-SWAP";
  const get=async(u,ms=6500)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(u,{signal:c.signal,headers:{"Accept":"application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);return await r.json();}finally{clearTimeout(t);}};
  const data={funding_rate:null,open_interest:null,long_short_ratio:null,mark_price:null},sources={},errors=[];
  const set=(key,value,source)=>{const n=Number(value);if(data[key]===null&&value!==null&&value!==undefined&&Number.isFinite(n)){data[key]=n;sources[key]=source;}};
  // Binance USD-M: try alternate API hosts; one failed metric must not discard the other valid metrics.
  for(const host of ["https://fapi.binance.com","https://fapi1.binance.com","https://fapi2.binance.com"]){
   try{
    const rs=await Promise.allSettled([get(host+"/fapi/v1/premiumIndex?symbol="+symbol),get(host+"/fapi/v1/openInterest?symbol="+symbol),get(host+"/futures/data/globalLongShortAccountRatio?symbol="+symbol+"&period=5m&limit=1")]);
    if(rs[0].status==="fulfilled"){set("funding_rate",rs[0].value.lastFundingRate,"Binance USD-M");set("mark_price",rs[0].value.markPrice,"Binance USD-M");}
    if(rs[1].status==="fulfilled")set("open_interest",rs[1].value.openInterest,"Binance USD-M · "+base);
    if(rs[2].status==="fulfilled"&&Array.isArray(rs[2].value))set("long_short_ratio",rs[2].value[0]?.longShortRatio,"Binance USD-M");
    if(data.funding_rate!==null&&data.open_interest!==null&&data.mark_price!==null&&data.long_short_ratio!==null)break;
   }catch(e){errors.push("Binance: "+String(e.message||e).slice(0,90));}
  }
  // Bybit Linear fallback, independently fill missing values.
  for(const host of ["https://api.bybit.com","https://api.bytick.com","https://api.bybit.eu"]){
   if(data.funding_rate!==null&&data.open_interest!==null&&data.mark_price!==null&&data.long_short_ratio!==null)break;
   try{
    const rs=await Promise.allSettled([get(host+"/v5/market/tickers?category=linear&symbol="+symbol),get(host+"/v5/market/account-ratio?category=linear&symbol="+symbol+"&period=5min&limit=1")]);
    const t=rs[0].status==="fulfilled"&&rs[0].value.retCode===0?rs[0].value.result?.list?.[0]:null;
    const r=rs[1].status==="fulfilled"&&rs[1].value.retCode===0?rs[1].value.result?.list?.[0]:null;
    if(t){set("funding_rate",t.fundingRate,"Bybit Linear");set("mark_price",t.markPrice,"Bybit Linear");set("open_interest",t.openInterest,"Bybit Linear · "+base);}
    if(r)set("long_short_ratio",Number(r.buyRatio)/Math.max(Number(r.sellRatio),1e-9),"Bybit Linear");
   }catch(e){errors.push("Bybit: "+String(e.message||e).slice(0,90));}
  }
  // OKX swap can provide funding and coin-denominated open interest.
  if(data.funding_rate===null||data.open_interest===null){
   try{
    const rs=await Promise.allSettled([get("https://www.okx.com/api/v5/public/funding-rate?instId="+instId),get("https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId="+instId)]);
    const p=rs[0].status==="fulfilled"&&rs[0].value.code==="0"?rs[0].value.data?.[0]:null;
    const o=rs[1].status==="fulfilled"&&rs[1].value.code==="0"?rs[1].value.data?.[0]:null;
    if(p)set("funding_rate",p.fundingRate,"OKX Swap");
    if(o)set("open_interest",o.oiCcy||null,"OKX Swap · "+base);
   }catch(e){errors.push("OKX: "+String(e.message||e).slice(0,90));}
  }
  // Bitget V2 is an additional funding/mark-price fallback.
  if(data.funding_rate===null||data.mark_price===null){
   try{
    const d=await get("https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol="+symbol),t=d?.code==="00000"?d.data?.[0]:null;
    if(t){set("funding_rate",t.fundingRate,"Bitget USDT Futures");set("mark_price",t.markPrice||t.lastPr,"Bitget USDT Futures");}
   }catch(e){errors.push("Bitget: "+String(e.message||e).slice(0,90));}
  }
  if(Object.values(data).every(v=>v===null))return json({error:"داده مشتقات از منابع بررسی‌شده دریافت نشد.",sources,errors:errors.slice(0,6)},502,request);
  return json({symbol:base,...data,open_interest_unit:base,source:[...new Set(Object.values(sources))].join(" + "),sources,missing:Object.keys(data).filter(k=>data[k]===null),checked_at:new Date().toISOString()},200,request);
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/market-orderflow"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"market-orderflow"),request);if(limited)return limited;
  const url=new URL(request.url),raw=String(url.searchParams.get("symbol")||"BTC").toUpperCase(),marketType=url.searchParams.get("market")==="futures"?"futures":"spot";
  if(!/^[A-Z0-9]{2,15}$/.test(raw))return json({error:"نماد نامعتبر است."},400,request);
  const base=raw.replace(/USDT$/,""),symbol=base+"USDT";
  const get=async(u,ms=7500)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(u,{signal:c.signal,headers:{"Accept":"application/json","User-Agent":"MMP-COIN-AI/1.0"}});if(!r.ok)throw new Error("HTTP "+r.status);return await r.json();}finally{clearTimeout(t);}};
  const spotDepthSources=[
   ["Binance Spot",async()=>{let last;for(const host of ["https://api.binance.com","https://api1.binance.com","https://api2.binance.com","https://data-api.binance.vision"]){try{return await get(host+"/api/v3/depth?symbol="+symbol+"&limit=100");}catch(e){last=e;}}throw last||new Error("Binance depth unavailable");},d=>Array.isArray(d?.bids)&&Array.isArray(d?.asks)?d:null],
   ["OKX Spot",()=>get("https://www.okx.com/api/v5/market/books?instId="+base+"-USDT&sz=100"),d=>d?.code==="0"&&d.data?.[0]?{bids:d.data[0].bids,asks:d.data[0].asks}:null],
   ["Bitget Spot",()=>get("https://api.bitget.com/api/v2/spot/market/orderbook?symbol="+symbol+"&type=step0&limit=100"),d=>d?.code==="00000"?{bids:d.data?.bids,asks:d.data?.asks}:null],
   ["Gate Spot",()=>get("https://api.gateio.ws/api/v4/spot/order_book?currency_pair="+base+"_USDT&limit=100"),d=>Array.isArray(d?.bids)&&Array.isArray(d?.asks)?d:null]
  ];
  const futuresDepthSources=[
   ["Gate USDT Futures",async()=>{
    let details,book;
    try{[details,book]=await Promise.all([get("https://api.gateio.ws/api/v4/futures/usdt/contracts/"+base+"_USDT"),get("https://api.gateio.ws/api/v4/futures/usdt/order_book?contract="+base+"_USDT&limit=100")]);}
    catch{[details,book]=await Promise.all([get("https://api.gate.us/api/v4/futures/usdt/contracts/"+base+"_USDT"),get("https://api.gate.us/api/v4/futures/usdt/order_book?contract="+base+"_USDT&limit=100")]);}
    const multiplier=Number(details?.quanto_multiplier)||0;if(!multiplier)throw new Error("Gate Futures contract multiplier unavailable");
    const levels=items=>(items||[]).map(x=>Array.isArray(x)?[Number(x[0]),Number(x[1])*multiplier]:[Number(x.p),Number(x.s)*multiplier]).filter(x=>x[0]>0&&x[1]>0);
    return {bids:levels(book?.bids),asks:levels(book?.asks)};
   },d=>d],
   ["Bitget USDT Futures",()=>get("https://api.bitget.com/api/v3/market/orderbook?category=USDT-FUTURES&symbol="+symbol+"&limit=100"),d=>d?.code==="00000"?{bids:d.data?.b,asks:d.data?.a}:null],
   ["Bybit Global Futures",()=>get("https://api.bybit.com/v5/market/orderbook?category=linear&symbol="+symbol+"&limit=100"),d=>d?.retCode===0?{bids:d.result?.b,asks:d.result?.a}:null],
   ["Bybit EU Futures",()=>get("https://api.bybit.eu/v5/market/orderbook?category=linear&symbol="+symbol+"&limit=100"),d=>d?.retCode===0?{bids:d.result?.b,asks:d.result?.a}:null],
   ["Bybit Bytick Futures",()=>get("https://api.bytick.com/v5/market/orderbook?category=linear&symbol="+symbol+"&limit=100"),d=>d?.retCode===0?{bids:d.result?.b,asks:d.result?.a}:null]
  ];
  const depthSources=marketType==="futures"?futuresDepthSources:spotDepthSources;
  let depth=null,depthSource=null,depthError=null;
  for(const [name,load,normalize] of depthSources){
   try{const data=await load(),book=normalize(data);if(!book||!Array.isArray(book.bids)||!Array.isArray(book.asks)||!book.bids.length||!book.asks.length)throw new Error(name+" order book invalid");depth=book;depthSource=name;break;}
   catch(error){depthError=String(error?.message||error).slice(0,180);}
  }
  let bid=0,ask=0,mid=0;
  if(depth){const bp=Number(depth.bids?.[0]?.[0]||0),ap=Number(depth.asks?.[0]?.[0]||0);mid=(bp+ap)/2;
   for(const [p,q] of depth.bids||[])if(mid&&Number(p)>=mid*.99)bid+=Number(p)*Number(q);
   for(const [p,q] of depth.asks||[])if(mid&&Number(p)<=mid*1.01)ask+=Number(p)*Number(q);
  }
  let flowData=null,flowError=null;
  const flowWindow=marketType==="futures"?1:5;try{flowData=marketType==="futures"?await loadFuturesMarketFlow(base,flowWindow):await loadMarketFlow(base,flowWindow);}
  catch(error){flowError=String(error?.message||error).slice(0,220);}
  const imbalance=bid+ask?(bid-ask)/(bid+ask)*100:null;
  return json({
   symbol:base,market:marketType,
   depth:{available:!!depth,source:depthSource,bid_usdt:depth?bid:null,ask_usdt:depth?ask:null,imbalance_pct:imbalance,updated_at:depth?new Date().toISOString():null},
   flow:{available:!!flowData&&Number(flowData.trade_count)>0,source:flowData?.provider||null,buy_usdt:flowData?.buy5m??null,sell_usdt:flowData?.sell5m??null,cvd_usdt:flowData?.net5m??null,trade_count:flowData?.trade_count||0,complete:flowData?.complete===true,coverage_start:flowData?.coverage_start||null,window_minutes:flowData?.window_minutes||5,updated_at:flowData?.updated_at||null},
   errors:{depth:depth?null:depthError,flow:flowData?null:flowError},checked_at:new Date().toISOString()
  },200,request);
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/whale-watch"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"whale-watch"),request);if(limited)return limited;
  try{
   const c=new AbortController(),timer=setTimeout(()=>c.abort(),9000);
   let rows;try{const r=await fetch("https://mempool.space/api/mempool/recent",{signal:c.signal,headers:{"Accept":"application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);rows=await r.json();}finally{clearTimeout(timer);}
   const txs=(Array.isArray(rows)?rows:[]).map(x=>({txid:String(x.txid||""),value_btc:Number(x.value)/1e8,fee:Number(x.fee)||0,fee_rate:Number(x.feeRate)||0})).filter(x=>x.txid&&x.value_btc>=10).sort((a,b)=>b.value_btc-a.value_btc).slice(0,20);
   return json({asset:"BTC",scope:"unconfirmed_mempool_recent_sample",provider:"mempool.space",scanned_count:Array.isArray(rows)?rows.length:0,sample_count:Array.isArray(rows)?rows.length:0,count:txs.length,threshold_btc:10,transfers:txs,checked_at:new Date().toISOString(),limitation:"این داده فقط تراکنش‌های بزرگِ در انتظار تأیید شبکه بیت‌کوین را نشان می‌دهد؛ آدرس‌های صرافی برچسب‌گذاری نشده‌اند و جریان ورودی/خروجی صرافی از آن استنباط نمی‌شود."},200,request);
  }catch(e){return json({error:"داده عمومی تراکنش‌های بزرگ بیت‌کوین در دسترس نیست.",detail:String(e?.message||e).slice(0,180)},502,request);}
 }

 if(request.method==="GET"&&new URL(request.url).pathname==="/early-pressure"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"early-pressure"),request);if(limited)return limited;
  const url=new URL(request.url),raw=String(url.searchParams.get("symbol")||"BTC").toUpperCase();
  if(!/^[A-Z0-9]{2,24}$/.test(raw))return json({error:"نماد نامعتبر است."},400,request);
  const symbol=splitQuotePair(raw)?raw:raw+"USDT";
  try{
   const market=await candles(symbol,"1m",env,"spot"),bars=market.candles||[];
   if(bars.length<25)throw new Error("کندل یک‌دقیقه‌ای کافی نیست");
   const ranges=bars.map(x=>Math.max(0,Number(x.h)-Number(x.l))),volumes=bars.map(x=>Math.max(0,Number(x.v)));
   const avg=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:0;
   const recentRange=avg(ranges.slice(-5)),baseRange=avg(ranges.slice(-25,-5)),recentVol=avg(volumes.slice(-5)),baseVol=avg(volumes.slice(-25,-5));
   const compression=baseRange>0?recentRange/baseRange:null,volumeAcceleration=baseVol>0?recentVol/baseVol:null;
   const recent=bars.slice(-5),signed=recent.reduce((sum,x)=>sum+(Number(x.c)-Number(x.o))*Number(x.v),0),gross=recent.reduce((sum,x)=>sum+Math.abs(Number(x.c)-Number(x.o))*Number(x.v),0);
   const candlePressure=gross>0?signed/gross:null,age=Date.now()-Number(bars.at(-1)?.t||0),fresh=age<=180000;
   let orderflow=null,orderflowStatus="unavailable";
   try{const internal=new Request("https://mmp-internal/market-orderflow?symbol="+encodeURIComponent(raw),{headers:request.headers});const response=await handle(internal,env);if(response.ok){orderflow=await response.json();orderflowStatus="available";}}catch{}
   const buy=Number(orderflow?.flow?.buy_usdt),sell=Number(orderflow?.flow?.sell_usdt),tradeTotal=buy+sell;
   const executedFlow=orderflow?.flow?.available===true&&tradeTotal>0?(buy-sell)/tradeTotal:null;
   const depthPct=orderflow?.depth?.available===true&&Number.isFinite(Number(orderflow.depth.imbalance_pct))?Number(orderflow.depth.imbalance_pct):null;
   const flowBasis=executedFlow!==null?"executed_trades":"candle_body_volume_proxy",flowInput=executedFlow!==null?executedFlow:candlePressure;
   const depthInput=depthPct===null?null:depthPct/100;
   const pressure=detectEarlyMovePressure({rangeCompression:compression,volumeAcceleration,flowImbalance:flowInput,depthImbalance:depthInput,dataFresh:fresh});
   return json({symbol:raw,market:"spot",provider:market.data_provider,price:market.price,data_age_ms:age,
    pressure:{...pressure,evidence_note:"پیش‌آگاهی از فشردگی دامنه، شتاب حجم، فشار معاملات اجراشده و عدم‌تعادل دفتر سفارش؛ هر شاهدِ در دسترس جداگانه مشخص شده است."},
    microstructure:{flow_basis:flowBasis,flow_source:orderflow?.flow?.source||null,trade_count:Number(orderflow?.flow?.trade_count)||0,flow_complete:orderflow?.flow?.complete===true,depth_source:orderflow?.depth?.source||null,depth_imbalance_pct:depthPct,candle_pressure_proxy:candlePressure,orderflow_status:orderflowStatus},
    sampled_at:new Date().toISOString()},200,request);
  }catch(error){return json({symbol:raw,state:"insufficient_data",error:String(error?.message||error).slice(0,180),sampled_at:new Date().toISOString()},502,request);}
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/market-candles"){
  const limitResult=await checkRateLimit(env.PUBLIC_API_LIMITER,request,"market-candles");
  const limited=rateLimitReply(limitResult,request);if(limited)return limited;
  const url=new URL(request.url),rawSymbol=String(url.searchParams.get("symbol")||"").toUpperCase(),marketType=url.searchParams.get("market")==="futures"?"futures":"spot";
  const interval=String(url.searchParams.get("interval")||"15m");
  if(!/^[A-Z0-9]{2,30}$/.test(rawSymbol)||!["1m","3m","5m","15m","1h","4h","1d"].includes(interval))return json({error:"نماد یا بازه زمانی نامعتبر است."},400,request);
  const symbol=splitQuotePair(rawSymbol)?rawSymbol:rawSymbol+"USDT";
  const candleCacheKey=await marketFallbackKey("candles|"+marketType+"|"+symbol+"|"+interval);
  const staleCandles=await readMarketFallback(env,candleCacheKey);
  try{
   const result=await candles(symbol,interval,env,marketType);
   if(result.chart_data_fresh!==true)throw new Error("کندل زنده منبع "+String(result.data_provider||"بازار")+" قدیمی است: "+String(result.chart_data_freshness_reason||"freshness check failed"));
   const chartCandles=Array.isArray(result.chart_candles)&&result.chart_candles.length?result.chart_candles:result.candles.map(c=>({time:Math.floor(c.t/1000),open:c.o,high:c.h,low:c.l,close:c.c,volume:c.v}));
   const lastChartCandle=chartCandles[chartCandles.length-1],checkedAt=new Date().toISOString();
   const payload={symbol,interval,market:marketType,provider:result.data_provider,price:result.price,change_pct:result.change_pct,candles:chartCandles,candle_time:lastChartCandle?.time?new Date(Number(lastChartCandle.time)*1000).toISOString():null,data_checked_at:checkedAt,data_age_ms:Number(result.chart_data_age_ms)||0,data_stale:false};
   await writeMarketFallback(env,candleCacheKey,payload,staleCandles,3600000);
   return json(payload,200,request,{"X-MMP-Cache":"fresh","X-MMP-Data-Age":String(payload.data_age_ms)});
  }catch(error){
   if(staleCandles?.payload?.candles?.length)return json({...staleCandles.payload,data_stale:true,data_age_ms:staleCandles.ageMs,stale_reason:String(error?.message||"upstream unavailable").slice(0,160)},200,request,{"X-MMP-Cache":"stale","X-MMP-Data-Age":String(staleCandles.ageMs)});
   return json({error:"داده کندلی این ارز فعلاً در دسترس نیست.",detail:String(error?.message||"upstream error").slice(0,220),symbol,interval},502,request);
  }
 }

 if(request.method==="GET"&&new URL(request.url).pathname==="/local-market-watch"){
   const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"local-market-watch"),request);if(limited)return limited;
   const saved=await readLocalTetherState(env),sample=saved||{market:"USDT/IRR",unit:"Toman",sources:[],source_count:0,median_toman:null,status:"warming_up",warning:"منتظر اولین چرخه پایش مستقل هستیم.",checked_at:null};
   const checkedAt=Date.parse(sample.checked_at||""),sampleAge=Number.isFinite(checkedAt)?Math.max(0,Date.now()-checkedAt):null,dataStale=sampleAge===null||sampleAge>120000;
   const alertAt=Date.parse(saved?.alert_at||""),serverAlert=!!(saved?.alert&&Number.isFinite(alertAt)&&Date.now()-alertAt<=120000);
   const lastKnownToman=Number(saved?.last_known_toman??saved?.median_toman)||null,lastKnownAt=saved?.last_known_checked_at||saved?.checked_at||null,lastKnownAge=lastKnownAt?Math.max(0,Date.now()-Date.parse(lastKnownAt)):null;
   return json({...sample,data_stale:dataStale,data_age_ms:sampleAge,fresh:!dataStale,last_known_toman:lastKnownToman,last_known_checked_at:lastKnownAt,last_known_age_ms:Number.isFinite(lastKnownAge)?lastKnownAge:null,server_change_pct:Number.isFinite(Number(saved?.change_pct))?Number(saved.change_pct):null,server_alert:serverAlert,server_alert_at:saved?.alert_at||null,server_monitor:saved?.monitor||"warming_up",server_monitor_updated_at:saved?.monitor_updated_at||null},200,request,{"Cache-Control":"no-store","X-MMP-Data-Source":"Dedicated Tether Worker · Nobitex/Wallex/Bitpin/Exir/Ramzinex"});
  }
if(request.method==="GET"&&new URL(request.url).pathname==="/market-proxy"){
  const limitResult=await checkRateLimit(env.PUBLIC_API_LIMITER,request,"market-proxy");
  const limited=rateLimitReply(limitResult,request);if(limited)return limited;
  const url=new URL(request.url),source=url.searchParams.get("source")||"";
  const requestedTopPage=Number(url.searchParams.get("page")||1);
  const requestedOffset=Number(url.searchParams.get("offset")||0);
  // Pagination is data-driven: callers continue until the provider returns an empty/short page.
  // Validate safe integers, but do not impose an artificial 100-coin or fixed-page ceiling.
  if(source==="coingecko-top"&&!Number.isSafeInteger(requestedTopPage)||source==="coingecko-top"&&requestedTopPage<1)return json({error:"Invalid CoinGecko page"},400,request);
  if(source==="coinlore-top"&&(!Number.isSafeInteger(requestedOffset)||requestedOffset<0||requestedOffset%100!==0))return json({error:"Invalid CoinLore offset"},400,request);
  const urls={
   "binance-tickers":["https://data-api.binance.vision/api/v3/ticker/24hr","https://api.binance.com/api/v3/ticker/24hr","https://api-gcp.binance.com/api/v3/ticker/24hr","https://api1.binance.com/api/v3/ticker/24hr","https://api2.binance.com/api/v3/ticker/24hr","https://api3.binance.com/api/v3/ticker/24hr"],
   "bitget-tickers":["https://api.bitget.com/api/v3/market/tickers?category=SPOT","https://api.bitget.com/api/v2/spot/market/tickers"],
   "okx-tickers":["https://www.okx.com/api/v5/market/tickers?instType=SPOT","https://us.okx.com/api/v5/market/tickers?instType=SPOT"],
   "bybit-tickers":["https://api.bybit.com/v5/market/tickers?category=spot","https://api.bytick.com/v5/market/tickers?category=spot","https://api.bybit.eu/v5/market/tickers?category=spot"],
   "gate-tickers":["https://api.gateio.ws/api/v4/spot/tickers","https://api.gate.us/api/v4/spot/tickers"],
   "kucoin-tickers":["https://api.kucoin.com/api/v1/market/allTickers","https://api.kucoin.tr/api/v1/market/allTickers"],
   "mexc-tickers":["https://api.mexc.com/api/v3/ticker/24hr"],
   "coingecko-top":["https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page="+requestedTopPage+"&sparkline=false&price_change_percentage=1h%2C24h%2C7d"],
   "coinlore-top":["https://api.coinlore.net/api/tickers/?start="+requestedOffset+"&limit=100"],
   "nobitex-tether":["https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls","https://apiv2.nobitex.ir/market/stats?dstCurrency=rls","https://apiv2.nobitex.ir/v3/orderbook/USDTIRT","https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls","https://api.nobitex.ir/v3/orderbook/USDTIRT"],
   "wallex-markets":["https://api.wallex.ir/hector/web/v1/markets","https://api.wallex.ir/v1/markets","https://api.wallex.ir/v1/otc/markets"]
  };
  let candidates=urls[source]||null;
  if(source==="coingecko-extra"){
   const ids=url.searchParams.get("ids")||"";
   if(!/^[a-z0-9,-]{1,1800}$/i.test(ids)||ids.split(",").length>60)return json({error:"Invalid asset id list"},400,request);
   candidates=["https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids="+encodeURIComponent(ids)+"&order=market_cap_desc&sparkline=false&price_change_percentage=1h%2C24h%2C7d"];
  }
  if(!candidates)return json({error:"Unsupported market data source"},400,request);
  const cacheIdentity=["market-proxy",source,
   source==="coingecko-top"?"page="+requestedTopPage:"",
   source==="coinlore-top"?"offset="+requestedOffset:"",
   source==="coingecko-extra"?"ids="+(url.searchParams.get("ids")||""):""
  ].filter(Boolean).join("|");
  const marketCacheKey=await marketFallbackKey(cacheIdentity);
  const staleMarketResponse=await readMarketFallback(env,marketCacheKey);
  const responseCacheTtl=source.startsWith("coingecko")?180:source==="coinlore-top"?60:source.includes("tether")||source.includes("wallex")?10:5;
  let lastError=null;
  for(const endpoint of candidates){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
   try{
    const upstreamHeaders={"Accept":"application/json, text/plain, */*","User-Agent":"MMP-COIN-AI/1.0","Accept-Language":"en-US,en;q=0.9"};
   if(source==="wallex-markets"){upstreamHeaders.Origin="https://wallex.ir";upstreamHeaders.Referer="https://wallex.ir/";upstreamHeaders["User-Agent"]="curl/8.14.1";}
   const upstream=await fetch(endpoint,{headers:upstreamHeaders,signal:controller.signal,cf:{cacheTtl:responseCacheTtl,cacheEverything:true}});
    if(!upstream.ok){lastError="Upstream HTTP "+upstream.status;continue;}
    let data=await upstream.json();
    if(data===null||typeof data!=="object")throw new Error("Invalid upstream JSON");
    if(source==="nobitex-tether"){
     const stats=data?.stats||{};
     let rate=Number(stats["usdt-rls"]?.latest??stats["usdt-irt"]?.latest??stats["usdt-tmn"]?.latest);
     if(!(data?.status==="ok"&&Number.isFinite(rate)&&rate>0)){
      const bid=Number(data?.bids?.[0]?.[0]),ask=Number(data?.asks?.[0]?.[0]),last=Number(data?.lastTradePrice);
      rate=last>0?last:bid>0&&ask>0?(bid+ask)/2:0;
      if(data?.status!=="ok"||!(rate>0)){
       lastError="Nobitex returned no valid USDT/IRT rate";
       continue;
      }
      data={status:"ok",stats:{"usdt-rls":{latest:String(rate)}},_mmp_source:"Nobitex USDTIRT orderbook"};
     }
    }
    await writeMarketFallback(env,marketCacheKey,data,staleMarketResponse,3600000);
    return json(data,200,request,{"X-MMP-Data-Source":source,"X-MMP-Cache":"fresh","Cache-Control":"public, max-age="+responseCacheTtl});
   }catch(error){lastError=String(error?.message||"network error");}
   finally{clearTimeout(timer);}
  }
  if(source==="coingecko-top"){
   // CoinGecko can rate-limit deep pagination. Build the same 250-row page
   // from three independent CoinLore slices so the asset catalog keeps paging.
   const baseOffset=(requestedTopPage-1)*250,offsets=[baseOffset,baseOffset+100,baseOffset+200],limits=[100,100,50];
   const pages=await Promise.allSettled(offsets.map(async(offset,index)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
    try{
     const response=await fetch("https://api.coinlore.net/api/tickers/?start="+offset+"&limit="+limits[index],{headers:{"Accept":"application/json","User-Agent":"MMP-COIN-AI/1.0"},signal:controller.signal,cf:{cacheTtl:60,cacheEverything:true}});
     if(!response.ok)throw new Error("CoinLore HTTP "+response.status);
     const rows=await response.json();if(!Array.isArray(rows))throw new Error("CoinLore page invalid");return rows;
    }finally{clearTimeout(timer);}
   }));
   const rows=pages.flatMap(result=>result.status==="fulfilled"?result.value:[]);
   if(rows.length){
    const data=rows.map(item=>({id:String(item.id),symbol:String(item.symbol||"").toLowerCase(),name:String(item.name||item.symbol||""),image:"",current_price:Number(item.price_usd)||0,market_cap:Number(item.market_cap_usd)||0,market_cap_rank:Number(item.rank)||null,fully_diluted_valuation:null,total_volume:Number(item.volume24)||0,high_24h:null,low_24h:null,price_change_24h:null,price_change_percentage_24h:Number(item.percent_change_24h)||0,market_cap_change_24h:null,market_cap_change_percentage_24h:null,circulating_supply:Number(item.csupply)||null,total_supply:Number(item.tsupply)||null,max_supply:Number(item.msupply)||null,ath:null,ath_change_percentage:null,ath_date:null,atl:null,atl_change_percentage:null,atl_date:null,roi:null,last_updated:new Date().toISOString()})).filter(item=>item.symbol&&item.current_price>0);
    if(data.length){
     await writeMarketFallback(env,marketCacheKey,data,staleMarketResponse,3600000);
     return json(data,200,request,{"X-MMP-Data-Source":"CoinLore fallback","X-MMP-Cache":"fresh","Cache-Control":"public, max-age=60"});
    }
   }
  }
  if(staleMarketResponse?.payload&&typeof staleMarketResponse.payload==="object"){
   const stalePayload=staleMarketResponse.payload;
   const staleNobitexRate=Number(stalePayload?.stats?.["usdt-rls"]?.latest??stalePayload?.stats?.["usdt-irt"]?.latest??stalePayload?.stats?.["usdt-tmn"]?.latest);
   if(source!=="nobitex-tether"||stalePayload?.status==="ok"&&Number.isFinite(staleNobitexRate)&&staleNobitexRate>0)
    return json(stalePayload,200,request,{"X-MMP-Data-Source":source,"X-MMP-Cache":"stale","X-MMP-Data-Age":String(staleMarketResponse.ageMs),"Warning":"110 - \"Response is stale\""});
  }
  return json({error:"Market data source unavailable",source,detail:String(lastError||"upstream error").slice(0,120)},502,request);
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/connections-health"){
  const limitResult=await checkRateLimit(env.PUBLIC_API_LIMITER,request,"connections-health");
  const limited=rateLimitReply(limitResult,request);if(limited)return limited;
  const timeoutFetch=async(url,valid,timeout=9000,extraHeaders={})=>{
   const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
   try{
    const response=await fetch(url,{headers:{"Accept":"application/json, text/plain, */*","User-Agent":"MMP-COIN-AI/1.0","Accept-Language":"en-US,en;q=0.9",...extraHeaders},signal:controller.signal,cf:{cacheTtl:5,cacheEverything:true}});
    if(!response.ok)throw new Error("HTTP "+response.status);
    const data=await response.json();
    if(!valid(data))throw new Error("پاسخ معتبر دریافت نشد");
    return {status:Date.now()-started>2500?"slow":"ok",ping:Date.now()-started};
   }catch(error){return {status:"down",ping:null,error:String(error?.message||"network error").slice(0,100)};}
   finally{clearTimeout(timer);}
  };
  const probeAny=async(urls,valid,timeout=9000,extraHeaders={})=>{
   let last={status:"down",ping:null,error:"no endpoint responded"};
   for(const url of urls){
    const result=await timeoutFetch(url,valid,timeout,extraHeaders);
    if(result.status!=="down")return {...result,endpoint:url};
    last=result;
   }
   return last;
  };
  const [binance,bybit,okx,nobitex,wallex,bitget,gate,kucoin,mexc,whitebit,binanceFutures,bybitFutures,okxFutures,bitgetFutures,gateFutures,mexcFutures,kucoinFutures,whitebitFutures]=await Promise.all([
   probeAny(["https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://api.binance.us/api/v3/ticker/price?symbol=BTCUSDT","https://api1.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://api2.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://api3.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT"],d=>Number(d?.price)>0),
   probeAny(["https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT","https://api.bytick.com/v5/market/tickers?category=spot&symbol=BTCUSDT","https://api.bybit.eu/v5/market/tickers?category=spot&symbol=BTCUSDT","https://api.bytick.eu/v5/market/tickers?category=spot&symbol=BTCUSDT"],d=>d?.retCode===0&&Number(d?.result?.list?.[0]?.lastPrice)>0),
   probeAny(["https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT","https://us.okx.com/api/v5/market/ticker?instId=BTC-USDT","https://openapi.okx.com/api/v5/market/ticker?instId=BTC-USDT"],d=>d?.code==="0"&&Number(d?.data?.[0]?.last)>0),
   probeAny(["https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls","https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls"],d=>d?.status==="ok"&&Number(d?.stats?.["usdt-rls"]?.latest)>0,12000),
   probeAny(["https://api.wallex.ir/hector/web/v1/markets","https://api.wallex.ir/v1/markets","https://api.wallex.ir/v1/otc/markets"],d=>{if(d?.success!==true)return false;const raw=d?.result?.symbols??d?.result?.markets;if(Array.isArray(raw))return raw.length>0;if(raw&&typeof raw==="object")return Object.keys(raw).length>0;return false;},12000,{"Origin":"https://wallex.ir","Referer":"https://wallex.ir/","User-Agent":"curl/8.14.1"}),
   probeAny(["https://api.bitget.com/api/v3/market/tickers?category=SPOT&symbol=BTCUSDT","https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT"],d=>["00000","0"].includes(String(d?.code))&&Number(d?.data?.[0]?.lastPrice||d?.data?.[0]?.lastPr)>0,9000,{"Origin":"https://mmp-coin.github.io","Referer":"https://mmp-coin.github.io/","User-Agent":"curl/8.14.1"}),
   probeAny(["https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT","https://api.gate.us/api/v4/spot/tickers?currency_pair=BTC_USDT"],d=>Array.isArray(d)&&Number(d?.[0]?.last)>0,9000),
   probeAny(["https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT","https://api.kucoin.tr/api/v1/market/orderbook/level1?symbol=BTC-USDT"],d=>d?.code==="200000"&&Number(d?.data?.price)>0,9000),
   probeAny(["https://api.mexc.com/api/v3/ticker/price?symbol=BTCUSDT"],d=>Number(d?.price)>0,9000),
   probeAny(["https://whitebit.com/api/v4/public/ticker"],d=>Number(d?.BTC_USDT?.last_price)>0,9000),
   probeAny(["https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT","https://fapi1.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT","https://fapi2.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT","https://fapi3.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT"],d=>Number(d?.price)>0,7000),
   probeAny(["https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT","https://api.bytick.com/v5/market/tickers?category=linear&symbol=BTCUSDT","https://api.bybit.eu/v5/market/tickers?category=linear&symbol=BTCUSDT","https://api.bytick.eu/v5/market/tickers?category=linear&symbol=BTCUSDT"],d=>d?.retCode===0&&Number(d?.result?.list?.[0]?.lastPrice)>0,7000),
   probeAny(["https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP","https://us.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP","https://openapi.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP"],d=>d?.code==="0"&&Number(d?.data?.[0]?.last)>0,7000),
   probeAny(["https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=BTCUSDT"],d=>["00000","0"].includes(String(d?.code))&&Number(d?.data?.[0]?.lastPr)>0,9000),
   probeAny(["https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=BTC_USDT","https://api.gate.us/api/v4/futures/usdt/tickers?contract=BTC_USDT"],d=>Array.isArray(d)&&Number(d?.[0]?.last)>0,9000),
   probeAny(["https://contract.mexc.com/api/v1/contract/ticker?symbol=BTC_USDT"],d=>d?.success===true&&Number(d?.data?.lastPrice)>0,9000),
   probeAny(["https://api-futures.kucoin.com/api/v1/ticker?symbol=XBTUSDTM"],d=>d?.code==="200000"&&Number(d?.data?.price)>0,9000),
   probeAny(["https://whitebit.com/api/v4/public/futures"],d=>d?.success===true&&Array.isArray(d?.result)&&d.result.some(x=>x?.ticker_id==="BTC_PERP"&&Number(x?.last_price)>0),9000)
  ]);
  const checks=[
   {name:"Binance Spot",market:"spot",purpose:"قیمت، حجم و کندل اسپات",...binance},
   {name:"Bybit Spot",market:"spot",purpose:"قیمت، حجم و کندل اسپات",...bybit},
   {name:"OKX Spot",market:"spot",purpose:"قیمت، حجم و کندل اسپات",...okx},
   {name:"Bitget Spot",market:"spot",purpose:"قیمت، حجم و کندل اسپات",...bitget},
   {name:"Gate.io Spot",market:"spot",purpose:"قیمت، حجم و کندل اسپات",...gate},
   {name:"KuCoin Spot",market:"spot",purpose:"قیمت، حجم و کندل اسپات",...kucoin},
   {name:"MEXC Spot",market:"spot",purpose:"قیمت و معاملات اسپات",...mexc},
   {name:"WhiteBIT Spot",market:"spot",purpose:"قیمت و معاملات اسپات",...whitebit},
   {name:"Binance Futures",market:"futures",purpose:"قیمت قرارداد دائمی",...binanceFutures},
   {name:"Bybit Futures",market:"futures",purpose:"قیمت قرارداد دائمی",...bybitFutures},
   {name:"OKX Futures",market:"futures",purpose:"قیمت قرارداد دائمی",...okxFutures},
   {name:"Bitget Futures",market:"futures",purpose:"قیمت قرارداد دائمی",...bitgetFutures},
   {name:"Gate Futures",market:"futures",purpose:"قیمت قرارداد دائمی",...gateFutures},
   {name:"MEXC Futures",market:"futures",purpose:"قیمت قرارداد دائمی",...mexcFutures},
   {name:"KuCoin Futures",market:"futures",purpose:"قیمت قرارداد دائمی",...kucoinFutures},
   {name:"WhiteBIT Futures",market:"futures",purpose:"قیمت قرارداد دائمی",...whitebitFutures},
   {name:"Nobitex",market:"iran",purpose:"نرخ تتر به تومان",...nobitex},
   {name:"Wallex",market:"iran",purpose:"نرخ تتر به تومان",...wallex}
  ];
  return json({checked_at:new Date().toISOString(),checks},200,request);
 }
if(request.method==="GET"&&new URL(request.url).pathname==="/futures-engine-health"){
  if(!env.FUTURES_ENGINE)return json({service_binding:"missing",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION},503,request);
  try{const response=await env.FUTURES_ENGINE.fetch(new Request("https://futures-engine/health"));const payload=await response.json();return json({...payload,service_binding:"connected"},response.status,request);}catch(error){return json({service_binding:"error",detail:String(error?.message||error).slice(0,180)},502,request);}
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/health"){
  // Keep liveness checks deterministic and independent of upstream exchange/CDN availability.
  // Provider reachability is reported by /connections-health, not by this lightweight route.
  return json({service:"MMP COIN AI",worker:"online",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,
   ai_binding:!!env.AI,futures_engine_binding:!!env.FUTURES_ENGINE,market_cache_binding:!!env.MARKET_CACHE_DB,
   checked_at:new Date().toISOString()},200,request);
 }
 if(request.method!=="POST")return json({error:"Method not allowed"},405,request);
 const limitResult=await checkRateLimit(env.AI_ANALYSIS_LIMITER,request,"ai-analysis");
 const limited=rateLimitReply(limitResult,request);if(limited)return limited;

 const contentType=request.headers.get("Content-Type")||"";
 if(!contentType.toLowerCase().includes("application/json"))return json({error:"Content-Type must be application/json"},415,request);
 const declaredLength=Number(request.headers.get("Content-Length")||0);
 if(declaredLength>16384)return json({error:"Request body is too large"},413,request);
 let body;try{const rawBody=await request.text();if(new TextEncoder().encode(rawBody).length>16384)return json({error:"Request body is too large"},413,request);body=JSON.parse(rawBody);}catch{return json({error:"Invalid JSON"},400,request);}
 if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"Invalid request body"},400,request);
 const coinId=String(body.coin_id||"").toLowerCase();
 const symbol=String(ASSET_SYMBOL_OVERRIDES[coinId]||body.symbol||"").toUpperCase().replace(/[^A-Z0-9_]/g,"");
 if(!validSymbol(symbol))return json({error:"Invalid asset symbol"},400,request);
 let pair=symbol.endsWith("USDT")?symbol:symbol+"USDT";
 const mode=["spot","futures","both"].includes(body.market_mode)?body.market_mode:"both";
 let stage="شناسایی جفت‌های فعال";
 try{
  const catalogs=await getExchangeCatalogs();
  const support=exchangeSupport(symbol,catalogs);
  const spotPair=support.spot.pair||pair;
  const futuresPair=support.futures.pair||pair;
  pair=mode==="futures"?futuresPair:spotPair;
  stage="دریافت کندل‌های بازار";
  const intervals=["15m","1h","4h","1d"];
  let spotMarket=null,futuresMarket=null,market={},candleMarket=mode==="futures"?"futures":"spot";
  if(mode==="both"){
   const fetchMarket=async(selectedPair,type)=>{
    const settled=await Promise.allSettled(intervals.map(async tf=>[tf,await candles(selectedPair,tf,env,type)]));
    const failed=settled.filter(x=>x.status==="rejected");
    if(failed.length)throw new Error(failed.map(x=>String(x.reason?.message||"candle unavailable")).join(" | "));
    return Object.fromEntries(settled.map(x=>x.value));
   };
   // Always try Spot first. Instrument catalogs can be blocked or stale;
   // they must never prevent a real spot-only asset from being analyzed.
   try{
    spotMarket=await fetchMarket(spotPair,"spot");
    market=spotMarket;candleMarket="spot";
   }catch(spotFailure){
    if(support.futures.confirmed){
     try{futuresMarket=await fetchMarket(futuresPair,"futures");market=futuresMarket;candleMarket="futures";pair=futuresPair;}
     catch(futuresFailure){throw new Error("داده اسپات و فیوچرز برای "+symbol+" در دسترس نیست. اسپات: "+spotFailure.message+"؛ فیوچرز: "+futuresFailure.message);}
    }else{
     const assetNote=symbol==="JAAA"?" این نماد به صندوق/دارایی توکنیزه‌شده مرتبط است و بدون جفت معتبر نباید به دارایی دیگری نگاشت شود.":"";
     throw new Error("داده کندلی کافی برای "+symbol+" پیدا نشد. "+spotFailure.message+assetNote);
    }
   }
   // Futures is optional in both mode: never discard valid Spot analysis if Futures fails.
   if(spotMarket&&support.futures.confirmed){
    try{futuresMarket=await fetchMarket(futuresPair,"futures");}
    catch{futuresMarket=null;}
   }
  }else{
   const selectedPair=candleMarket==="futures"?futuresPair:spotPair;pair=selectedPair;
   const results=await Promise.all(intervals.map(async tf=>[tf,await candles(selectedPair,tf,env,candleMarket)]));
   market=Object.fromEntries(results);
   if(mode==="spot")spotMarket=market;else futuresMarket=market;
  }
  stage="دریافت اطلاعات تکمیلی بازار";
  const latest=market["4h"];
  const optionalJson=async url=>{try{const r=await fetch(url);if(!r.ok)return null;return await r.json();}catch{return null;}};
  let [funding,openInterest,fng,global]=await Promise.all([
   mode==="spot"?Promise.resolve(null):optionalJson("https://fapi.binance.com/fapi/v1/premiumIndex?symbol="+pair),
   mode==="spot"?Promise.resolve(null):optionalJson("https://fapi.binance.com/fapi/v1/openInterest?symbol="+pair),
   optionalJson("https://api.alternative.me/fng/?limit=1"),
   optionalJson("https://api.coingecko.com/api/v3/global")
  ]);
  if(mode!=="spot"&&(!funding||!openInterest)){
   const [bybitFunding,bybitOi]=await Promise.all([
    optionalJson("https://api.bybit.com/v5/market/funding/history?category=linear&symbol="+pair+"&limit=1"),
    optionalJson("https://api.bybit.com/v5/market/open-interest?category=linear&symbol="+pair+"&intervalTime=1h&limit=1")
   ]);
   if(!funding&&bybitFunding?.retCode===0&&bybitFunding.result?.list?.[0])funding={lastFundingRate:bybitFunding.result.list[0].fundingRate,markPrice:null};
   if(!openInterest&&bybitOi?.retCode===0&&bybitOi.result?.list?.[0])openInterest={openInterest:bybitOi.result.list[0].openInterest};
  }
  const providers=[...(spotMarket?Object.values(spotMarket).map(x=>x.data_provider):[]),...(futuresMarket?Object.values(futuresMarket).map(x=>x.data_provider):[])];
  const compactTimeframes=source=>Object.fromEntries(Object.entries(source||{}).map(([tf,x])=>[tf,{price:x.price,change_pct:x.change_pct,rsi:x.rsi,ema_trend:x.ema_trend,macd_signal:x.macd_signal,atr_percent:x.atr_percent,support:x.support,resistance:x.resistance,volume_ratio:x.volume_ratio,candle_time:x.candle_time,candle_closed_at:x.candle_closed_at,data_age_ms:x.data_age_ms,data_provider:x.data_provider}]));
  const timeframeMs={"15m":900000,"1h":3600000,"4h":14400000,"1d":86400000};
  const freshness=Object.entries(market).map(([tf,x])=>({timeframe:tf,age:Number(x?.data_age_ms),maxAge:timeframeMs[tf]+300000}));
  const marketDataFresh=freshness.length===4&&freshness.every(x=>Number.isFinite(x.age)&&x.age>=0&&x.age<=x.maxAge);
  const providerCount=new Set(providers.filter(Boolean)).size;
  const snapshot={asset:String(body.name||symbol).slice(0,60),symbol:pair,market_mode:mode,source:[...new Set(providers)].join(" + ")+"; derivatives metrics when available; Alternative.me Fear & Greed; CoinGecko global market",market_timestamp:latest.candle_closed_at||latest.candle_time,market_data_fresh:marketDataFresh,timeframe_freshness:freshness,provider_count:providerCount,timeframes:compactTimeframes(market),futures_timeframes:mode==="both"&&futuresMarket?compactTimeframes(futuresMarket):null,futures_data_available:mode==="both"?!!futuresMarket:mode==="futures",derivatives:funding?{funding_rate:funding.lastFundingRate,mark_price:funding.markPrice??null,next_funding_time:funding.nextFundingTime??null,open_interest:openInterest?.openInterest||null}:null,sentiment:fng?.data?.[0]?{fear_greed_value:Number(fng.data[0].value),classification:fng.data[0].value_classification}:null,global_market:global?.data?{btc_dominance:global.data.market_cap_percentage?.btc,total_market_cap_usd:global.data.total_market_cap?.usd,total_volume_usd:global.data.total_volume?.usd}:null}
  const prompt="You are MMP COIN AI, a professional quantitative crypto analyst. Use ONLY the supplied market snapshot and its numeric values. Write every human-readable sentence in fluent, natural Persian. Do not mix Persian with Russian, Chinese, or English words. All explanatory text must be fluent Persian. Never write English words such as signal, leverage, market, entry, exit, volume, wait, monitor, breakout, breakdown, support, resistance, risk, or trade; translate them into Persian. Avoid mixed-language sentences entirely. Preserve only tickers and standard indicators: BTCUSDT, RSI, MACD, EMA, ATR, LONG, SHORT, BUY, SELL, WAIT, TP1, TP2, TP3. Never invent news, events, order-book data, on-chain metrics, funding, open interest, volume, prices, or indicators.\n\nUse only fully closed candles. Never infer a candle close from an in-progress bar. First inspect market_data_fresh and timeframe_freshness; if any required timeframe is stale or missing, choose WAIT. Analyze all four timeframes (15m, 1h, 4h, 1d), distinguish short-term noise from the main trend, compare EMA alignment, RSI, MACD, volume ratio, ATR, support and resistance. In both mode, compare spot timeframes against futures_timeframes and explicitly identify agreement or divergence; never claim futures data was checked when futures_data_available is false. Evaluate derivatives funding and open interest only when present; explain Fear & Greed only when present.\n\nReturn ONLY one valid JSON object with keys: action (BUY, SELL, WAIT), primary_timeframe, confidence (integer 0-100 representing strength/alignment of evidence, NOT probability of profit), risk_level, market {price_usd}, levels {entry_zone:{low,high},stop_loss,tp1,tp2,tp3}, risk_reward, holding_horizon, position_risk, summary, technical_analysis, indicators {rsi,macd_signal,ema_trend,atr_percent}, scenarios [{name,description}], recommendations [3-6 concise actionable Persian suggestions], reasons [3-6 evidence-based Persian strings], risk_management, invalidation, market_context, data_source, market_timestamp.\n\nScenarios must cover bullish, bearish, and sideways cases, each with the condition that would confirm it and the relevant supplied support/resistance or indicator evidence. Recommendations should include what to monitor next, what would confirm entry, what invalidates the setup, and whether to wait for candle close. Never promise a return or call confidence a win probability.\n\nChoose WAIT when timeframes conflict, evidence is weak, risk/reward is below 1.5, volume confirmation is missing, or data is insufficient. When action is WAIT, set all entry/stop/target values to null. For BUY, entry and targets must be logically consistent around current price; for SELL, reverse the direction. Derive levels only from supplied support, resistance, ATR and current price. In spot-only mode never recommend SHORT or SELL. For futures, warn that leverage creates liquidation risk and advise low or no leverage. Use concise but substantive analysis, not generic filler.\n\nSnapshot: "+JSON.stringify(snapshot);
  const buildLocalAnalysisFallback=()=>{
   const frames=snapshot.timeframes||{},trendFa=value=>value==="bullish"?"صعودی":value==="bearish"?"نزولی":"خنثی یا نامشخص";
   const frameSummary=["15m","1h","4h","1d"].map(tf=>tf+": "+trendFa(frames[tf]?.ema_trend)).join("؛ ");
   const volumeRatio=Number(frames["15m"]?.volume_ratio||0),hourlyRsi=Number(frames["1h"]?.rsi||latest.rsi||0);
   return {action:"WAIT",primary_timeframe:"4h",confidence:marketDataFresh?28:10,risk_level:"زیاد",market:{price_usd:latest.price},levels:{entry_zone:null,stop_loss:null,tp1:null,tp2:null,tp3:null},risk_reward:null,holding_horizon:"تا بسته‌شدن کندل ۴ ساعته بعدی",position_risk:"فعلاً بدون ورود؛ تا تأیید مستقل روند و حجم، ریسک سرمایه صفر",summary:"تحلیل محلی محافظه‌کارانه اجرا شد؛ سرویس‌های مدل زبانی بیرونی موقتاً پاسخ معتبر ندادند، بنابراین هیچ ورود معاملاتی صادر نمی‌شود.",technical_analysis:"وضعیت روند بازه‌ها: "+frameSummary+"؛ شاخص قدرت نسبی: "+(Number.isFinite(hourlyRsi)?hourlyRsi.toFixed(1):"نامشخص")+"؛ نسبت حجم ۱۵ دقیقه: "+(Number.isFinite(volumeRatio)?volumeRatio.toFixed(2):"نامشخص")+".",indicators:{rsi:latest.rsi,macd_signal:latest.macd_signal,ema_trend:latest.ema_trend,atr_percent:latest.atr_percent},scenarios:[{name:"سناریوی صعودی",description:"فقط پس از بسته‌شدن کندل ۴ ساعته بالای مقاومت و تأیید حجم بررسی شود."},{name:"سناریوی نزولی",description:"فقط پس از بسته‌شدن کندل ۴ ساعته زیر حمایت و تأیید حجم بررسی شود."},{name:"سناریوی خنثی",description:"تا زمانی که قیمت میان حمایت و مقاومت نوسان می‌کند، از ورود عجولانه خودداری شود."}],recommendations:["تا بسته‌شدن کندل ۴ ساعته بعدی صبر کن.","هم‌جهتی روند یک‌ساعته، چهار‌ساعته و روزانه را بررسی کن.","نسبت حجم معاملات را پیش از هر تصمیم دوباره کنترل کن.","در نبود تأیید روشن، وارد معامله نشو و از اهرم استفاده نکن."],reasons:[marketDataFresh?"داده‌های زمانی در دسترس‌اند، اما ورود بدون تأیید کامل چندبازه‌ای مجاز نیست.":"داده یک یا چند بازه زمانی تازه و کامل نیست؛ ورود متوقف می‌ماند.","سرویس مدل زبانی پاسخ معتبر نداد؛ نتیجه محافظه‌کارانه از محاسبات محلی ساخته شد.",volumeRatio>=1.1?"حجم کوتاه‌مدت نیازمند تأیید مجدد در کندل بسته‌شده است.":"نسبت حجم کوتاه‌مدت به حد تأیید نرسیده است."],risk_management:"تا دریافت تحلیل معتبر و تأیید کندل بسته‌شده، هیچ موقعیتی باز نکن؛ در معاملات اهرمی خطر لیکوییدشدن وجود دارد.",invalidation:"هرگونه تغییر محسوس در قیمت یا بسته‌شدن کندل جدید، این جمع‌بندی محلی را نیازمند محاسبه مجدد می‌کند.",market_context:"این خروجی فقط بر داده‌های بازار موجود در Snapshot متکی است و خبر یا داده بیرونی به آن افزوده نشده است.",data_source:"محاسبات فنی محلی؛ مدل زبانی در دسترس نیست",market_timestamp:latest.candle_closed_at||latest.candle_time};
  };
  stage="اجرای هوش مصنوعی";
  let aiResult,aiProvider;
  try{aiResult=await runAIWithFallback(env,prompt);aiProvider=aiResult.provider;}
  catch(error){aiProvider="Local quantitative fallback";aiResult={provider:aiProvider,raw:JSON.stringify(buildLocalAnalysisFallback()),cloudflareBudget:error?.cloudflareBudget||null,fallbacks:[String(error?.message||error).slice(0,700)]};}
  stage="پردازش پاسخ هوش مصنوعی";
  let raw=aiResult.raw;
  if(typeof raw!=="string")raw=JSON.stringify(raw);
  raw=raw.replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,"").trim();
  const start=raw.indexOf("{"),end=raw.lastIndexOf("}");
  let analysis;
  try{if(start<0||end<=start)throw new Error("AI returned an invalid structured response");analysis=persianize(JSON.parse(raw.slice(start,end+1)));}
  catch(error){aiProvider="Local quantitative fallback";aiResult.fallbacks=[...(aiResult.fallbacks||[]),"Invalid AI JSON: "+String(error?.message||error).slice(0,180)];analysis=persianize(buildLocalAnalysisFallback());}
  if(!["BUY","SELL","WAIT"].includes(String(analysis.action||"").toUpperCase()))analysis.action="WAIT";
  analysis.confidence=Math.max(0,Math.min(100,Math.round(Number(analysis.confidence)||0)));
  analysis.market=analysis.market||{};analysis.market.price_usd=latest.price;
  analysis.indicators={...(analysis.indicators||{}),rsi:latest.rsi==null?null:Number(latest.rsi.toFixed(2)),macd_signal:latest.macd_signal,ema_trend:latest.ema_trend,atr_percent:latest.atr_percent==null?null:Number(latest.atr_percent.toFixed(2))};
  analysis.market_timestamp=latest.candle_closed_at||latest.candle_time;analysis.market_data_fresh=marketDataFresh;analysis.timeframe_freshness=freshness;analysis.data_source=[...new Set(providers)].join(" + ")+ " · "+aiProvider;analysis.ai_provider=aiProvider;analysis.ai_provider_fallbacks=aiResult.fallbacks||[];analysis.cf_ai_budget=aiResult.cloudflareBudget||null;
  analysis.recommendations=Array.isArray(analysis.recommendations)?analysis.recommendations.slice(0,6):[];
  analysis.scenarios=Array.isArray(analysis.scenarios)?analysis.scenarios.slice(0,3):[];
  analysis.reasons=Array.isArray(analysis.reasons)?analysis.reasons.slice(0,6):[];
  stage="محاسبه وضعیت سیگنال";
  const alignmentMarket=mode==="futures"?(futuresMarket||market):market;
  let longAligned=alignmentMarket["4h"].ema_trend==="bullish"&&alignmentMarket["1d"].ema_trend!=="bearish";
  let shortAligned=alignmentMarket["4h"].ema_trend==="bearish"&&alignmentMarket["1d"].ema_trend!=="bullish";
  if(mode==="both"&&futuresMarket){longAligned=longAligned&&futuresMarket["4h"].ema_trend==="bullish"&&futuresMarket["1d"].ema_trend!=="bearish";shortAligned=shortAligned&&futuresMarket["4h"].ema_trend==="bearish"&&futuresMarket["1d"].ema_trend!=="bullish";}
  const volumeConfirmed=Number(market["15m"]?.volume_ratio)>=1.1||Number(market["1h"]?.volume_ratio)>=1.1;
  if(!marketDataFresh||!volumeConfirmed||(analysis.action==="BUY"&&!longAligned)||(analysis.action==="SELL"&&!shortAligned)||(mode==="spot"&&analysis.action==="SELL")){
   analysis.action="WAIT";analysis.confidence=Math.min(analysis.confidence,marketDataFresh?45:20);
   analysis.reasons.unshift(!marketDataFresh?"داده یکی از بازه‌های زمانی کهنه یا ناقص است؛ تا دریافت کندل‌های بسته‌شده تازه، ورود تأیید نمی‌شود.":!volumeConfirmed?"حجم معاملات در بازه کوتاه‌مدت تأیید کافی ندارد؛ ورود به تعویق می‌افتد.":"هم‌جهتی کافی میان روند ۴ ساعته و روزانه وجود ندارد؛ ورود فوری تأیید نمی‌شود.");
  }
  const longPlanMarket=(mode==="futures"&&futuresMarket?futuresMarket:market)["4h"];
  const shortPlanMarket=mode==="spot"?null:(mode==="both"?(futuresMarket?futuresMarket["4h"]:null):longPlanMarket);
  const plans=buildTradePlans(longPlanMarket,analysis.action,mode,shortPlanMarket);
  if(plans.active){
   analysis.levels={entry_zone:plans.active.entry_zone,stop_loss:plans.active.stop_loss,tp1:plans.active.tp1,tp2:plans.active.tp2,tp3:plans.active.tp3};
   analysis.risk_reward=plans.active.risk_reward;
   analysis.position_risk=analysis.position_risk||"حداکثر ۱٪ سرمایه در هر معامله؛ اهرم پایین یا بدون اهرم";
   analysis.entry_trigger=plans.active.trigger;analysis.invalidation=plans.active.invalidation;
  }else{
   analysis.levels={entry_zone:null,stop_loss:null,tp1:null,tp2:null,tp3:null};
   analysis.position_risk="فعلاً بدون ورود؛ ریسک سرمایه صفر تا تأیید سناریو";
  }
  analysis.conditional_setups=plans.conditional;
  analysis.plan_status=plans.active?"active_signal":"conditional_wait";
  analysis.plan_method="سطوح محاسبه‌شده از داده ۴ ساعته، ATR و حمایت/مقاومت؛ ورود مشروط به بسته‌شدن کندل ۴ ساعته";
  analysis.holding_horizon=analysis.holding_horizon||"تا بسته‌شدن و تأیید کندل ۴ ساعته بعدی";
  if(!analysis.recommendations.length)analysis.recommendations=["برای ورود LONG منتظر بسته‌شدن کندل ۱ ساعته بالای مقاومت و تثبیت قیمت بمان.","برای ورود SHORT منتظر بسته‌شدن کندل ۱ ساعته زیر حمایت و تثبیت قیمت بمان.","پس از ورود، حد ضرر و اهداف عددی برنامه را رعایت کن.","اگر هیچ‌کدام از شکست‌ها تأیید نشد، معامله نکن."];
  return json({analysis,market:snapshot},200,request);
 }catch(e){return json({error:String(e?.message||"Analysis failed").slice(0,300),stage,symbol:pair,market_mode:mode},502,request)}
}
async function settleHunterCycle(task,label,timeoutMs=50000,onTimeout=null){
 let timer;
 const timedOut=new Promise(resolve=>{timer=setTimeout(()=>{try{onTimeout?.();}catch{}resolve({status:"rejected",reason:new Error(label+" cycle timeout after "+timeoutMs+"ms")});},timeoutMs);});
 try{return await Promise.race([Promise.resolve().then(task).then(value=>({status:"fulfilled",value}),reason=>({status:"rejected",reason})),timedOut]);}
 finally{clearTimeout(timer);}
}
async function readLocalTetherState(env){
 if(!env.ADMIN_DB)return null;
 try{const row=await env.ADMIN_DB.prepare("SELECT payload FROM hunter_engine_state WHERE id = ?").bind("local-tether-watch").first();return row?.payload?JSON.parse(row.payload):null;}catch{return null;}
}
async function runDigitalHunterCron(event,env){
 const id="digital-hunter-cron-heartbeat",started=Date.now(),stamp=new Date(started).toISOString();
 const save=payload=>env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind(id,JSON.stringify(payload),payload.updated_at||new Date().toISOString()).run();
 await save({status:"started",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,cron:event?.cron||"* * * * *",scheduledTime:event?.scheduledTime||null,markets:["spot","futures-independent-cron"],updated_at:stamp});
 try{
  const result=await settleHunterCycle(()=>runDigitalHunterMarketCycle(env,"spot"),"spot",48000);
  const finished=Date.now(),spot=result.status==="fulfilled"?result.value:null;
  if(!spot)throw result.reason||new Error("Spot Hunter cycle returned no result");
  const hasDataFailures=Number(spot.failed_count||0)>0,hasQualityRejections=Number(spot.rejected_count||0)>0,hasIncompleteCycle=!!spot.universe_refreshed||!!spot.universe_stale||Number(spot.scanned_count||0)===0;
  const status=hasDataFailures||hasQualityRejections||hasIncompleteCycle?"partial":"success";
  const payload={status,engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,cron:event?.cron||"* * * * *",scheduledTime:event?.scheduledTime||null,startedAt:stamp,finishedAt:new Date(finished).toISOString(),updated_at:new Date(finished).toISOString(),markets:{spot:{queue_position:spot.queue_position||0,scanned:spot.scanned_count||0,preliminary:spot.preliminary_signals?.length||0,failed:spot.failed_count||0,rejected:spot.rejected_count||0,cooldown_count:spot.cooldown_count||0,universe_refreshed:spot.universe_refreshed===true,universe:spot.universe_count||0,signals:spot.signals?.length||0,last_errors:spot.last_errors||[],last_rejections:spot.last_rejections||[]}},errors:{}};
  await save(payload);
 }catch(error){
  const finished=Date.now(),message=String(error?.message||error).slice(0,240);
  const payload={status:"error",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,cron:event?.cron||"* * * * *",scheduledTime:event?.scheduledTime||null,startedAt:stamp,finishedAt:new Date(finished).toISOString(),updated_at:new Date(finished).toISOString(),markets:{spot:{status:"error",error:message}},errors:{spot:message}};
  try{await save(payload);}catch(saveError){console.error("Spot Hunter error heartbeat write failed:",saveError?.message||saveError);}
  throw error;
 }
}
export default {
 fetch:handle,
 async scheduled(event,env,ctx){
  // Keep independent health/maintenance tasks alive even when a Hunter scan fails.
  // Cloudflare waitUntil owns every background task until it settles.
  const cleanup=cleanupMarketFallbackCache(env).catch(error=>console.error("Market fallback cleanup failed:",error?.message||error));
  const scheduledAt=Number(event?.scheduledTime)||Date.now(),minute=new Date(scheduledAt).getUTCMinutes();
  const universeRefresh=minute%15===0?refreshDigitalHunterUniverses(env).catch(error=>console.error("Hunter universe refresh failed:",error?.message||error)):Promise.resolve();
  const hunterCycle=runDigitalHunterCron(event,env,ctx).catch(error=>console.error("Digital Hunter scheduled cycle failed:",error?.message||error));
  // Call the isolated Tether Worker through a service binding. Its external
  // provider requests use a separate invocation/subrequest budget.
  const tetherMonitor=env.TETHER_MONITOR?.fetch
   ?env.TETHER_MONITOR.fetch(new Request("https://tether-monitor.internal/run",{method:"POST",headers:{"Content-Type":"application/json"}})).then(async response=>{if(!response.ok)throw new Error("Tether monitor HTTP "+response.status);const result=await response.json();console.log("Tether monitor isolated run",JSON.stringify({status:result.status,source_count:result.source_count,checked_at:result.checked_at}));}).catch(error=>console.error("Isolated Tether monitor failed:",error?.message||error))
   :Promise.resolve();
  const background=Promise.allSettled([cleanup,universeRefresh,hunterCycle,tetherMonitor]);
  if(ctx?.waitUntil)ctx.waitUntil(background);else await background;
 }
};