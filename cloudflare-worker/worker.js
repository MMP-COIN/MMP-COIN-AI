// Trigger one-by-one 100-asset audit
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
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
async function runAIWithFallback(env,prompt){
 const messages=[
  {role:"system",content:"Return one valid JSON object only. Never give guaranteed financial advice. Never describe any token as safe, scam-free, verified investment, or guaranteed. Exchange listing and market-cap rank do not prove contract safety. If smart-contract audit, ownership controls, liquidity-lock, holder concentration, and exploit-risk data are not supplied, explicitly state that contract-level safety is unverified; distinguish market liquidity checks from security checks. Do not invent security audits or claim scam detection."},
  {role:"user",content:prompt}
 ];
 const failures=[];
 const accept=(provider,content)=>({provider,raw:extractAIJson(content)});
 const groqModels=[
  {id:"qwen/qwen3.8-27b",body:{temperature:0.1,max_completion_tokens:800,reasoning_effort:"none"}},
  {id:"openai/gpt-oss-20b",body:{max_completion_tokens:1200,reasoning_effort:"low"}}
 ];
 if(env.GROQ_API_KEY){
  for(const entry of groqModels){
   const model=entry.id;
   try{
    const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{
     method:"POST",
     headers:{"Authorization":"Bearer "+env.GROQ_API_KEY,"Content-Type":"application/json"},
     body:JSON.stringify({model,messages,...entry.body,response_format:{type:"json_object"}})
    });
    if(!response.ok){
     const body=await response.text();
     let detail=body;
     try{const parsed=JSON.parse(body);detail=parsed?.error?.message||parsed?.message||body;}catch{}
     const retryAfter=response.headers.get("retry-after");
     throw new Error("HTTP "+response.status+" "+String(detail).slice(0,520)+(retryAfter?"; retry-after="+retryAfter+"s":""));
    }
    const data=await response.json();
    const content=data?.choices?.[0]?.message?.content;
    if(!content)throw new Error("Empty model response");
    return accept("Groq / "+model,content);
   }catch(error){
    failures.push("Groq "+model+": "+String(error?.message||error).slice(0,560));
   }
  }
 }else failures.push("Groq not configured (GROQ_API_KEY missing)");
 // Cloudflare AI remains a fallback, with a smaller output budget.
 if(env.AI){
  try{
   const result=await env.AI.run(MODEL,{messages,max_tokens:900,temperature:0.12});
   if(result?.error)throw new Error(typeof result.error==="string"?result.error:JSON.stringify(result.error));
   return accept("Cloudflare Workers AI",result?.response??result?.result??result?.output_text??result);
  }catch(error){failures.push("Cloudflare: "+String(error?.message||error).slice(0,260));}
 }else failures.push("Cloudflare AI binding missing");
 if(env.HF_TOKEN&&env.HF_MODEL){
  try{
   const response=await fetch("https://router.huggingface.co/v1/chat/completions",{
    method:"POST",headers:{"Authorization":"Bearer "+env.HF_TOKEN,"Content-Type":"application/json"},
    body:JSON.stringify({model:env.HF_MODEL,messages,temperature:0.12,max_completion_tokens:900,response_format:{type:"json_object"}})
   });
   if(!response.ok)throw new Error("HTTP "+response.status+" "+(await response.text()).slice(0,320));
   const data=await response.json(),content=data?.choices?.[0]?.message?.content;
   if(!content)throw new Error("Empty model response");
   return accept("Hugging Face / "+env.HF_MODEL,content);
  }catch(error){failures.push("Hugging Face: "+String(error?.message||error).slice(0,320));}
 }else failures.push("Hugging Face not configured (HF_TOKEN and HF_MODEL required)");
 if(env.OLLAMA_BASE_URL&&env.OLLAMA_MODEL){
  try{
   const base=String(env.OLLAMA_BASE_URL).replace(/\/+$/,"");
   const headers={"Content-Type":"application/json"};
   if(env.OLLAMA_API_KEY)headers.Authorization="Bearer "+env.OLLAMA_API_KEY;
   const response=await fetch(base+"/api/chat",{method:"POST",headers,body:JSON.stringify({model:env.OLLAMA_MODEL,messages,stream:false,format:"json",options:{temperature:0.12,num_predict:900}})});
   if(!response.ok)throw new Error("HTTP "+response.status+" "+(await response.text()).slice(0,320));
   const data=await response.json(),content=data?.message?.content;
   if(!content)throw new Error("Empty model response");
   return accept("Ollama / "+env.OLLAMA_MODEL,content);
  }catch(error){failures.push("Ollama: "+String(error?.message||error).slice(0,320));}
 }else failures.push("Ollama not configured (OLLAMA_BASE_URL and OLLAMA_MODEL required)");
 throw new Error("تمام سرویس‌های هوش مصنوعی در دسترس نیستند. "+failures.join(" | "));
}

// Canonical exchange symbols for selected assets (CoinGecko ID -> ticker).
const ASSET_SYMBOL_OVERRIDES = { layerzero: "ZRO" };
const ALLOWED_ORIGINS = new Set([
 "https://mmp1988.github.io",
 "https://mmp-coin.github.io",
 "https://localhost",
 "capacitor://localhost",
 "http://localhost"
]);
function corsHeaders(request){
 const origin=request?.headers.get("Origin");
 const headers={"Vary":"Origin"};
 if(origin&&ALLOWED_ORIGINS.has(origin)){
  headers["Access-Control-Allow-Origin"]=origin;
  headers["Access-Control-Allow-Methods"]="GET, POST, OPTIONS";
  headers["Access-Control-Allow-Headers"]="Content-Type";
  headers["Access-Control-Max-Age"]="86400";
 }
 return headers;
}
const json=(obj,status=200,request=null,extraHeaders={})=>new Response(JSON.stringify(obj),{status,headers:{...corsHeaders(request),...extraHeaders,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
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
function rsi(values,p=14){if(values.length<=p)return null;let up=0,dn=0;for(let i=values.length-p;i<values.length;i++){let d=values[i]-values[i-1];if(d>0)up+=d;else dn-=d;}if(dn===0)return 100;let rs=(up/p)/(dn/p);return 100-100/(1+rs)}
function analyzeKlines(rows){
 const candles=rows.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));
 const closes=candles.map(x=>x.c), highs=candles.map(x=>x.h), lows=candles.map(x=>x.l), vols=candles.map(x=>x.v);
 const last=candles[candles.length-1],e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200);
 const fast=ema(closes,12),slow=ema(closes,26);
 const macdSeries=closes.map((_,i)=>{const a=ema(closes.slice(0,i+1),12),b=ema(closes.slice(0,i+1),26);return a==null||b==null?null:a-b;}).filter(x=>x!=null);
 const macd=fast!=null&&slow!=null?fast-slow:null,signal=macdSeries.length?ema(macdSeries,9):null;
 const tr=candles.slice(1).map((x,i)=>Math.max(x.h-x.l,Math.abs(x.h-candles[i].c),Math.abs(x.l-candles[i].c)));
 const atr=tr.length>=14?mean(tr.slice(-14)):null;
 const support=Math.min(...lows.slice(-30)),resistance=Math.max(...highs.slice(-30));
 const takerBuyBase=rows.slice(-24).reduce((s,x)=>s+Number(x[9]||0),0);
 const totalBase=rows.slice(-24).reduce((s,x)=>s+Number(x[5]||0),0);
 return {candles,price:last.c,change_pct:(last.c/closes[closes.length-2]-1)*100,rsi:rsi(closes),ema20:e20,ema50:e50,ema200:e200,ema_trend:e20&&e50&&e200?(last.c>e20&&e20>e50&&e50>e200?"bullish":last.c<e20&&e20<e50&&e50<e200?"bearish":"mixed"):"insufficient",macd,macd_signal:macd==null||signal==null?"insufficient":macd>signal?"bullish crossover bias":macd<signal?"bearish crossover bias":"neutral",atr,atr_percent:atr?atr/last.c*100:null,support,resistance,volume_ratio:mean(vols.slice(-5))/(mean(vols.slice(-25))||1),taker_buy_volume_ratio:totalBase?takerBuyBase/totalBase:null,candle_time:new Date(last.t).toISOString()};
}
function splitQuotePair(symbol){
 const match=String(symbol||"").toUpperCase().match(/^([A-Z0-9_]+?)(USDT|USDC|FDUSD|BUSD|USD|BTC|ETH)$/);
 return match?{base:match[1],quote:match[2]}:null;
}
async function candles(symbol,interval,env,marketType="spot"){
 const headers={"Accept":"application/json, text/plain, */*","User-Agent":"MMP-COIN-AI/1.0","Accept-Language":"en-US,en;q=0.9"};
 const minimumCandles=interval==="1d"?20:30;
 const okxBar={"15m":"15m","1h":"1H","4h":"4H","1d":"1Dutc"}[interval];
 const bybitInterval={"15m":"15","1h":"60","4h":"240","1d":"D"}[interval];
 const toBybitRows=list=>list.slice().reverse().map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]);
 const toOkxRows=list=>list.slice().reverse().map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]);
 const validRows=rows=>Array.isArray(rows)&&rows.length>=minimumCandles;
 if(marketType==="futures"){
  let binanceError=null,bybitError=null,okxError=null;
  try{
   const url="https://fapi.binance.com/fapi/v1/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250";
   const r=await fetch(url,{headers});
   if(!r.ok)throw new Error("Binance Futures HTTP "+r.status);
   const rows=await r.json();
   if(!validRows(rows))throw new Error("Binance Futures candle history is insufficient");
   const result=analyzeKlines(rows);result.data_provider="Binance Futures";return result;
  }catch(e){binanceError=e;}
  for(const host of ["https://api.bybit.eu","https://api.bytick.eu","https://api.bybit.com","https://api.bytick.com"]){
   try{
    const url=host+"/v5/market/kline?category=linear&symbol="+encodeURIComponent(symbol)+"&interval="+bybitInterval+"&limit=250";
    const r=await fetch(url,{headers});
    if(!r.ok)throw new Error("Bybit Linear HTTP "+r.status);
    const payload=await r.json(),list=payload?.retCode===0?payload.result?.list:null;
    if(!validRows(list))throw new Error(payload?.retMsg||"insufficient Bybit linear candle history");
    const result=analyzeKlines(toBybitRows(list));result.data_provider="Bybit Linear Perpetual (fallback)";return result;
   }catch(e){bybitError=e;}
  }
  const pair=splitQuotePair(symbol);
  if(pair){
   const instId=pair.base+"-"+pair.quote+"-SWAP";
   for(const host of ["https://www.okx.com","https://us.okx.com","https://openapi.okx.com"]){
    try{
     const r=await fetch(host+"/api/v5/market/candles?instId="+encodeURIComponent(instId)+"&bar="+okxBar+"&limit=250",{headers});
     if(!r.ok)throw new Error("OKX Swap HTTP "+r.status);
     const payload=await r.json(),list=payload?.code==="0"?payload.data:null;
     if(!validRows(list))throw new Error(payload?.msg||"insufficient OKX swap candle history");
     const result=analyzeKlines(toOkxRows(list));result.data_provider="OKX Linear Swap (fallback)";return result;
    }catch(e){okxError=e;}
   }
  }else okxError=new Error("Unsupported quote currency for OKX swap");
  throw new Error("Futures data unavailable for "+symbol+"; Binance: "+(binanceError?.message||"failed")+"; Bybit: "+(bybitError?.message||"failed")+"; OKX: "+(okxError?.message||"failed"));
 }
 let lastError=null,bitgetError=null,bybitError=null,okxError=null;
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
   const r=await fetch(url,{headers});
   if(!r.ok)throw new Error("Binance Spot HTTP "+r.status);
   const rows=await r.json();
   if(!validRows(rows))throw new Error("insufficient Binance spot candle history");
   const result=analyzeKlines(rows);
   result.data_provider=url.includes("binance.us")?"Binance.US":url.includes("data-api")?"Binance Data API":url.includes("api1.")||url.includes("api2.")||url.includes("api3.")?"Binance mirror":"Binance Spot";
   return result;
  }catch(e){lastError=e;}
 }
 try{
  const bitgetInterval={"15m":"15m","1h":"1H","4h":"4H","1d":"1D"}[interval];
  const url="https://api.bitget.com/api/v3/market/candles?category=SPOT&symbol="+encodeURIComponent(symbol)+"&interval="+bitgetInterval+"&limit=250";
  const r=await fetch(url,{headers});
  if(!r.ok)throw new Error("Bitget Spot HTTP "+r.status);
  const payload=await r.json(),rows=payload?.code==="00000"||payload?.code==="0"?payload.data:null;
  if(!validRows(rows))throw new Error(payload?.msg||"insufficient Bitget spot candle history");
  const normalized=rows.map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]).sort((a,b)=>a[0]-b[0]);
  const result=analyzeKlines(normalized);result.data_provider="Bitget Spot";return result;
 }catch(e){bitgetError=e;}
 for(const host of ["https://api.bybit.eu","https://api.bytick.eu","https://api.bybit.com","https://api.bytick.com"]){
  try{
   const url=host+"/v5/market/kline?category=spot&symbol="+encodeURIComponent(symbol)+"&interval="+bybitInterval+"&limit=250";
   const r=await fetch(url,{headers});
   if(!r.ok)throw new Error("Bybit Spot HTTP "+r.status);
   const payload=await r.json(),list=payload?.retCode===0?payload.result?.list:null;
   if(!validRows(list))throw new Error(payload?.retMsg||"insufficient Bybit spot candle history");
   const result=analyzeKlines(toBybitRows(list));result.data_provider="Bybit Spot (fallback)";return result;
  }catch(e){bybitError=e;}
 }
 const pair=splitQuotePair(symbol);
 if(pair){
  const instId=pair.base+"-"+pair.quote;
  for(const host of ["https://www.okx.com","https://us.okx.com","https://openapi.okx.com"]){
   try{
    const r=await fetch(host+"/api/v5/market/candles?instId="+encodeURIComponent(instId)+"&bar="+okxBar+"&limit=250",{headers});
    if(!r.ok)throw new Error("OKX Spot HTTP "+r.status);
    const payload=await r.json(),list=payload?.code==="0"?payload.data:null;
    if(!validRows(list))throw new Error(payload?.msg||"insufficient OKX spot candle history");
    const result=analyzeKlines(toOkxRows(list));result.data_provider="OKX Spot (fallback)";return result;
   }catch(e){okxError=e;}
  }
 }else okxError=new Error("Unsupported quote currency for OKX spot");
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

let exchangeCatalogCache=null,exchangeCatalogCacheAt=0;
async function readPublicJson(url){
 try{
  const r=await fetch(url,{headers:{"Accept":"application/json, text/plain, */*","User-Agent":"MMP-COIN-AI/1.0","Accept-Language":"en-US,en;q=0.9"}});
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
 for(const host of ["https://www.okx.com","https://us.okx.com","https://openapi.okx.com"]){
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
  ["bitget_spot","https://api.bitget.com/api/v3/market/instruments?category=SPOT"],
  ["whitebit_spot",["https://whitebit.com/api/v1/public/markets","https://whitebit.eu/api/v1/public/markets","https://whitebit.tr/api/v1/public/markets","https://whitebit.ge/api/v1/public/markets"]],
  ["gate_spot",["https://api.gateio.ws/api/v4/spot/currency_pairs","https://api.gate.us/api/v4/spot/curr --- TRUNCATED --- 53,646 chars