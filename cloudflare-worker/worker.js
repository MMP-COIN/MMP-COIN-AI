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
  {role:"system",content:"Return one valid JSON object only. Never give guaranteed financial advice."},
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
 const pairInfo=splitQuotePair(symbol);
 if(pairInfo){
  try{
   const kucoinInterval={"15m":"15min","1h":"1hour","4h":"4hour","1d":"1day"}[interval];
   const url="https://api.kucoin.com/api/v1/market/candles?symbol="+encodeURIComponent(pairInfo.base+"-"+pairInfo.quote)+"&type="+kucoinInterval;
   const r=await fetch(url,{headers});
   if(!r.ok)throw new Error("KuCoin Spot HTTP "+r.status);
   const payload=await r.json(),rows=payload?.code==="200000"?payload.data:null;
   if(!validRows(rows))throw new Error(payload?.msg||"insufficient KuCoin spot candle history");
   const normalized=rows.map(x=>[Number(x[0])*1000,x[1],x[3],x[4],x[2],x[5]||"0","0","0","0","0"]).sort((a,b)=>a[0]-b[0]);
   const result=analyzeKlines(normalized);result.data_provider="KuCoin Spot (fallback)";return result;
  }catch(e){lastError=new Error((lastError?.message||"Binance unavailable")+"; "+e.message);}
  try{
   const gateInterval={"15m":"15m","1h":"1h","4h":"4h","1d":"1d"}[interval];
   const gatePair=pairInfo.base+"_"+pairInfo.quote;
   const url="https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair="+encodeURIComponent(gatePair)+"&interval="+gateInterval+"&limit=250";
   const r=await fetch(url,{headers});
   if(!r.ok)throw new Error("Gate.io Spot HTTP "+r.status);
   const rows=await r.json();
   if(!validRows(rows))throw new Error("insufficient Gate.io spot candle history");
   const normalized=rows.map(x=>[Number(x[0])<1e12?Number(x[0])*1000:Number(x[0]),x[5],x[3],x[4],x[2],x[6]||"0","0","0","0","0"]).sort((a,b)=>a[0]-b[0]);
   const result=analyzeKlines(normalized);result.data_provider="Gate.io Spot (fallback)";return result;
  }catch(e){lastError=new Error((lastError?.message||"Binance unavailable")+"; "+e.message);}
 }
 const whitebitPair=splitQuotePair(symbol);
 if(whitebitPair){
  let whitebitError=null;
  const market=whitebitPair.base+"_"+whitebitPair.quote;
  const whitebitInterval={"15m":"15m","1h":"1h","4h":"4h","1d":"1d"}[interval];
  for(const host of ["https://whitebit.com","https://whitebit.eu","https://whitebit.tr","https://whitebit.ge"]){
   try{
    const url=host+"/api/v1/public/kline?market="+encodeURIComponent(market)+"&interval="+whitebitInterval+"&limit=250";
    const r=await fetch(url,{headers});
    if(!r.ok)throw new Error("WhiteBIT HTTP "+r.status);
    const payload=await r.json(),rows=payload?.success===true?payload.result:null;
    if(!validRows(rows))throw new Error(payload?.message||"insufficient WhiteBIT candle history");
    const normalized=rows.map(x=>[Number(x[0])*1000,x[1],x[3],x[4],x[2],x[5]||"0","0","0","0","0"]).sort((a,b)=>a[0]-b[0]);
    const result=analyzeKlines(normalized);result.data_provider="WhiteBIT Spot";return result;
   }catch(e){whitebitError=e;}
  }
  lastError=new Error((lastError?.message||"Earlier spot sources unavailable")+"; "+(whitebitError?.message||"WhiteBIT unavailable"));
 }

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
  ["gate_spot",["https://api.gateio.ws/api/v4/spot/currency_pairs","https://api.gate.us/api/v4/spot/currency_pairs"]],
  ["kucoin_spot",["https://api.kucoin.com/api/v2/symbols","https://api.kucoin.tr/api/v2/symbols"]]
 ];
 const results=await Promise.all(urls.map(async ([key,endpoint])=>[key,Array.isArray(endpoint)?await readAnyPublicJson(endpoint):await readPublicJson(endpoint)]));
 const out=Object.fromEntries(results);
 const [okxSpot,okxSwap]=await Promise.all([readOkxCatalog("SPOT"),readOkxCatalog("SWAP")]);
 out.okx_spot=okxSpot;out.okx_futures=okxSwap;
 exchangeCatalogCache=out;exchangeCatalogCacheAt=Date.now();return out;
}
function exchangeSupport(symbol,catalogs){
 const base=String(symbol||"").toUpperCase();
 const quotes=["USDT","USDC","FDUSD","BUSD","USD","BTC","ETH"];
 const choose=items=>items.filter(Boolean).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const binanceSpotPair=(catalogs.binance_spot?.data?.symbols||[]).filter(x=>x.status==="TRADING"&&x.baseAsset===base&&quotes.includes(x.quoteAsset)).map(x=>({pair:x.symbol,quote:x.quoteAsset})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const bybitSpotPair=(catalogs.bybit_spot?.data?.result?.list||[]).filter(x=>x.status==="Trading"&&x.baseCoin===base&&quotes.includes(x.quoteCoin)).map(x=>({pair:x.symbol,quote:x.quoteCoin})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const okxSpotPair=(catalogs.okx_spot?.data?.data||[]).filter(x=>x.state==="live"&&x.baseCcy===base&&quotes.includes(x.quoteCcy)).map(x=>({pair:String(x.instId||"").replaceAll("-",""),quote:x.quoteCcy})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const bitgetSpotPair=(catalogs.bitget_spot?.data?.data||[]).filter(x=>x.status==="online"&&String(x.symbol||"").toUpperCase().startsWith(base)&&quotes.some(q=>String(x.symbol||"").toUpperCase()===base+q)).map(x=>{const q=quotes.find(q=>String(x.symbol||"").toUpperCase()===base+q);return q?{pair:String(x.symbol).toUpperCase(),quote:q}:null;}).filter(Boolean).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const whitebitSpotPair=(catalogs.whitebit_spot?.data?.success===true?(catalogs.whitebit_spot.data.result||[]):[]).filter(x=>String(x.stock||"").toUpperCase()===base&&quotes.includes(String(x.money||"").toUpperCase())).map(x=>({pair:String(x.name||"").toUpperCase().replace("_",""),quote:String(x.money).toUpperCase()})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const gateSpotPair=(Array.isArray(catalogs.gate_spot?.data)?catalogs.gate_spot.data:[]).filter(x=>String(x.base||"").toUpperCase()===base&&quotes.includes(String(x.quote||"").toUpperCase())&&["tradable","buyable","sellable"].includes(String(x.trade_status||"").toLowerCase())).map(x=>({pair:String(x.base).toUpperCase()+String(x.quote).toUpperCase(),quote:String(x.quote).toUpperCase()})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const kucoinSpotPair=(catalogs.kucoin_spot?.data?.code==="200000"&&Array.isArray(catalogs.kucoin_spot.data.data)?catalogs.kucoin_spot.data.data:[]).filter(x=>x.enableTrading===true&&String(x.baseCurrency||"").toUpperCase()===base&&quotes.includes(String(x.quoteCurrency||"").toUpperCase())).map(x=>({pair:String(x.baseCurrency).toUpperCase()+String(x.quoteCurrency).toUpperCase(),quote:String(x.quoteCurrency).toUpperCase()})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const binanceFuturesPair=(catalogs.binance_futures?.data?.symbols||[]).filter(x=>x.status==="TRADING"&&(!x.contractType||x.contractType==="PERPETUAL")&&x.baseAsset===base&&quotes.includes(x.quoteAsset)).map(x=>({pair:x.symbol,quote:x.quoteAsset})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const bybitFuturesPair=(catalogs.bybit_futures?.data?.result?.list||[]).filter(x=>x.status==="Trading"&&(!x.contractType||x.contractType==="LinearPerpetual")&&x.baseCoin===base&&quotes.includes(x.quoteCoin)).map(x=>({pair:x.symbol,quote:x.quoteCoin})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const okxFuturesPair=(catalogs.okx_futures?.data?.data||[]).filter(x=>x.state==="live"&&(!x.ctType||x.ctType==="linear")&&String(x.instId||"").endsWith("-SWAP")).map(x=>{const p=String(x.instId||"").split("-");return p[0]===base&&quotes.includes(p[1])?{pair:p[0]+p[1],quote:p[1]}:null;}).filter(Boolean).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const spotEntries=[["Binance",binanceSpotPair,catalogs.binance_spot],["Bybit",bybitSpotPair,catalogs.bybit_spot],["OKX",okxSpotPair,catalogs.okx_spot],["Bitget",bitgetSpotPair,catalogs.bitget_spot],["WhiteBIT",whitebitSpotPair,catalogs.whitebit_spot],["Gate.io",gateSpotPair,catalogs.gate_spot],["KuCoin",kucoinSpotPair,catalogs.kucoin_spot]];
 const futuresEntries=[["Binance",binanceFuturesPair,catalogs.binance_futures],["Bybit",bybitFuturesPair,catalogs.bybit_futures],["OKX",okxFuturesPair,catalogs.okx_futures]];
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

async function handle(request,env){
 if(request.method==="OPTIONS"){
  const origin=request.headers.get("Origin");
  if(origin&&!ALLOWED_ORIGINS.has(origin))return new Response(null,{status:403,headers:{"Vary":"Origin"}});
  return new Response(null,{status:204,headers:{...corsHeaders(request),"X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/hunter-universe"){
  const limitResult=await checkRateLimit(env.PUBLIC_API_LIMITER,request,"hunter-universe");
  const limited=rateLimitReply(limitResult,request);if(limited)return limited;
  const timedJson=async(url,timeout=12000,cacheTtl=30)=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
   try{
    const response=await fetch(url,{headers:{"Accept":"application/json","User-Agent":"MMP-COIN-AI/1.0","Accept-Language":"en-US,en;q=0.9"},signal:controller.signal,cf:{cacheTtl,cacheEverything:true}});
    if(!response.ok)throw new Error("HTTP "+response.status);
    return await response.json();
   }finally{clearTimeout(timer);}
  };
  const cmcUrl=start=>"https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/listings/latest?start="+start+"&limit=5000&convert=USD";
  const primary=await Promise.allSettled([
   timedJson("https://api.binance.com/api/v3/exchangeInfo?permissions=%5B%22SPOT%22%5D",12000,300),
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
  if(!cmcRows.length)return json({error:"فهرست CMC و مسیر جایگزین CoinLore در دسترس نیست.",cmc_error:primary[1].status==="rejected"?String(primary[1].reason?.message||primary[1].reason).slice(0,140):null},502,request);
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
  if(!eligible.length)return json({error:"نماد معتبر در فهرست بازار پیدا نشد."},502,request);
  const jobs=[
   ["Binance","https://api.binance.com/api/v3/ticker/24hr",d=>(Array.isArray(d)?d:[]).filter(x=>String(x.symbol).endsWith("USDT")).map(x=>({symbol:String(x.symbol).slice(0,-4),pair:String(x.symbol),quoteAsset:"USDT",volume:Number(x.quoteVolume)||0,price:Number(x.lastPrice)||0,change24h:Number(x.priceChangePercent)||0}))],
   ["Bybit","https://api.bybit.com/v5/market/tickers?category=spot",d=>(d.result?.list||[]).filter(x=>String(x.symbol).endsWith("USDT")).map(x=>({symbol:String(x.symbol).slice(0,-4),pair:String(x.symbol),quoteAsset:"USDT",volume:Number(x.turnover24h)||0,price:Number(x.lastPrice)||0,change24h:(Number(x.price24hPcnt)||0)*100}))],
   ["OKX","https://www.okx.com/api/v5/market/tickers?instType=SPOT",d=>(d.data||[]).filter(x=>String(x.instId).endsWith("-USDT")).map(x=>({symbol:String(x.instId).replace("-USDT",""),pair:String(x.instId),quoteAsset:"USDT",volume:Number(x.volCcy24h)||0,price:Number(x.last)||0,change24h:Number(x.open24h)>0?(Number(x.last)/Number(x.open24h)-1)*100:0}))],
   ["Bitget","https://api.bitget.com/api/v2/spot/market/tickers",d=>(d.data||[]).filter(x=>String(x.symbol).endsWith("USDT")).map(x=>({symbol:String(x.symbol).slice(0,-4),pair:String(x.symbol),quoteAsset:"USDT",volume:Number(x.usdtVolume||x.quoteVolume)||0,price:Number(x.lastPr)||0,change24h:(Number(x.change24h)||0)*100}))],
   ["Gate","https://api.gateio.ws/api/v4/spot/tickers",d=>(Array.isArray(d)?d:[]).filter(x=>String(x.currency_pair).endsWith("_USDT")).map(x=>({symbol:String(x.currency_pair).replace("_USDT",""),pair:String(x.currency_pair),quoteAsset:"USDT",volume:Number(x.quote_volume)||0,price:Number(x.last)||0,change24h:Number(x.change_percentage)||0}))],
   ["KuCoin","https://api.kucoin.com/api/v1/market/allTickers",d=>(d.data?.ticker||[]).filter(x=>String(x.symbol).endsWith("-USDT")).map(x=>({symbol:String(x.symbol).replace("-USDT",""),pair:String(x.symbol),quoteAsset:"USDT",volume:Number(x.volValue)||0,price:Number(x.last)||0,change24h:(Number(x.changeRate)||0)*100}))],
   ["WhiteBIT","https://whitebit.com/api/v4/public/ticker",d=>Object.entries(d||{}).filter(([pair,x])=>pair.endsWith("_USDT")&&!x.isFrozen).map(([pair,x])=>({symbol:pair.slice(0,-5),pair,quoteAsset:"USDT",volume:Number(x.quote_volume)||0,price:Number(x.last_price)||0,change24h:Number(x.change)||0}))],
   ["Nobitex","https://apiv2.nobitex.ir/market/stats?dstCurrency=rls",d=>{const stats=d?.stats||{},usdtRls=Number(stats["usdt-rls"]?.latest)||0;if(d?.status!=="ok"||usdtRls<=0)return [];return Object.entries(stats).filter(([pair,x])=>pair.endsWith("-rls")&&pair!=="usdt-rls"&&Number(x?.latest)>0).map(([pair,x])=>({symbol:pair.split("-")[0].toUpperCase(),pair:pair.toUpperCase(),quoteAsset:"IRT",volume:Number(x.volumeDst)>0?Number(x.volumeDst)/usdtRls:0,price:Number(x.latest)/usdtRls,change24h:Number(x.dayChange)||0}));}],
   ["Wallex","https://api.wallex.ir/v1/markets",d=>{const raw=d?.result?.symbols||d?.result?.markets||{},rows=Array.isArray(raw)?raw:Object.values(raw),usdtRial=Number((Array.isArray(raw)?rows.find(x=>String(x.symbol).toUpperCase()==="USDTIRT"):raw.USDTIRT)?.stats?.lastPrice)||0;return d?.success===true?rows.map(x=>{const base=String(x.baseAsset||"").toUpperCase(),quote=String(x.quoteAsset||"").toUpperCase(),last=Number(x.stats?.lastPrice??x.lastPrice)||0,local=["IRT","IRR","RLS","TMN"].includes(quote),rate=local?usdtRial:1,quoteVolume=Number(x.stats?.["24h_quoteVolume"]??x.stats?.quoteVolume)||0;return {symbol:base,pair:String(x.symbol||base+quote),quoteAsset:local?"IRT":quote,volume:rate>0?quoteVolume/rate:quoteVolume,price:rate>0?last/rate:last,change24h:Number(x.stats?.["24h_ch"]??x.stats?.change24h)||0};}).filter(x=>x.symbol&&x.price>0&&["USDT","IRT"].includes(x.quoteAsset)):[];}]
  ];
  const tickerResults=await Promise.allSettled(jobs.map(async([name,url,normalize])=>({name,rows:normalize(await timedJson(url,11000,10))})));
  const markets=new Map(),discoveryMarkets=new Map(),sources={BinanceExchangeInfo:{ok:primary[0].status==="fulfilled",status:primary[0].status==="fulfilled"?200:0,error:primary[0].status==="rejected"?String(primary[0].reason?.message||primary[0].reason).slice(0,140):null},MetadataCatalog:{ok:true,provider:metadataProvider},CoinMarketCap:{ok:primary[1].status==="fulfilled",status:primary[1].status==="fulfilled"?200:0,page2:primary[2].status==="fulfilled"}};
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
  if(!assets.length)return json({error:"داده زنده برای نمادهای مشترک صرافی‌ها دریافت نشد."},502,request);
  // Keep the complete verified cross-exchange discovery universe; the client scans it in rotating batches to respect exchange rate limits.
  const rankedAssets=assets.sort((a,b)=>b.total_volume-a.total_volume||Number(a.market_cap_rank||999999)-Number(b.market_cap_rank||999999));
  const discoveredAssets=[...discoveryMarkets.entries()].map(([symbol,market])=>{
   const quotes=market.quotes.slice().sort((a,b)=>b.volume-a.volume),best=quotes[0]||{};
   return {id:"market-discovery:"+symbol,symbol,name:symbol,image:"",current_price:Number(best.price)||0,total_volume:quotes.reduce((sum,x)=>sum+(Number(x.volume)||0),0),market_cap:null,market_cap_rank:null,hunterExchange:[...market.venues].join(", "),hunterPriceExchange:best.exchange||"Exchange discovery",hunterChange24h:Number(best.change24h)||0,hunterVenueVolume:Object.fromEntries(quotes.map(x=>[x.exchange,Number(x.volume)||0])),marketPairs:quotes.map(q=>({exchange:q.exchange,pair:q.pair,quote:q.quoteAsset,price:Number(q.price)||0,volume:Number(q.volume)||0})),hasUsdtMarket:true,hasDomesticMarket:false,isDiscovery:true};
  }).filter(asset=>asset.current_price>0&&discoveryMarkets.get(asset.symbol).venues.size>=2&&asset.total_volume>=50000);
  const hunterAssets=[...rankedAssets.filter(asset=>asset.hasUsdtMarket===true),...discoveredAssets].sort((a,b)=>Number(b.total_volume||0)-Number(a.total_volume||0));
  return json({checked_at:new Date().toISOString(),count:rankedAssets.length,hunter_count:hunterAssets.length,discovered_count:discoveredAssets.length,binance_spot_symbols:binanceSymbols.size,cmc_listings:cmcRows.length,universe_mode:"unified_catalog_plus_independent_exchange_discovery",metadata_provider:metadataProvider,assets:rankedAssets,hunter_assets:hunterAssets,sources},200,request,{"X-MMP-Data-Source":"Binance, Bybit, OKX, Bitget, Gate, KuCoin, WhiteBIT, Nobitex, Wallex + "+metadataProvider});
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
  const get=async(u,ms=7500)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(u,{signal:c.signal,headers:{"Accept":"application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);return await r.json();}finally{clearTimeout(t);}};
  const hosts=["https://fapi.binance.com","https://fapi1.binance.com"];
  const binance=await Promise.allSettled(hosts.map(async host=>{
   const results=await Promise.allSettled([get(host+"/fapi/v1/premiumIndex?symbol="+symbol),get(host+"/fapi/v1/openInterest?symbol="+symbol),get(host+"/futures/data/globalLongShortAccountRatio?symbol="+symbol+"&period=5m&limit=1")]);
   const p=results[0].status==="fulfilled"?results[0].value:null,o=results[1].status==="fulfilled"?results[1].value:null,l=results[2].status==="fulfilled"?results[2].value:null;
   if(!p&&!o&&!l)throw new Error("Binance Futures metrics unavailable");
   return {premium:p,oi:o,ratio:Array.isArray(l)?l[0]:null,source:"Binance USDⓈ-M Futures"};
  }));
  let data=binance.find(x=>x.status==="fulfilled")?.value||null;
  if(!data){
   for(const host of ["https://api.bybit.eu","https://api.bytick.eu","https://api.bybit.com","https://api.bytick.com"]){
    try{
     const results=await Promise.allSettled([get(host+"/v5/market/tickers?category=linear&symbol="+symbol),get(host+"/v5/market/account-ratio?category=linear&symbol="+symbol+"&period=5min&limit=1")]);
     const t=results[0].status==="fulfilled"?results[0].value:null,r=results[1].status==="fulfilled"?results[1].value:null;
     const ticker=t?.retCode===0?t.result?.list?.[0]:null,ratio=r?.retCode===0?r.result?.list?.[0]:null;
     if(ticker||ratio){data={premium:ticker?{lastFundingRate:ticker.fundingRate,markPrice:ticker.markPrice}:null,oi:ticker?{openInterest:ticker.openInterest}:null,ratio:ratio?{longShortRatio:Number(ratio.buyRatio)/Math.max(Number(ratio.sellRatio),1e-9)}:null,source:"Bybit Linear"};break;}
    }catch{}
   }
  }
  if(!data){
   try{
    const results=await Promise.allSettled([get("https://www.okx.com/api/v5/public/funding-rate?instId="+instId),get("https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId="+instId)]);
    const p=results[0].status==="fulfilled"?results[0].value:null,o=results[1].status==="fulfilled"?results[1].value:null;
    const premium=p?.code==="0"?p.data?.[0]:null,oi=o?.code==="0"?o.data?.[0]:null;
    if(premium||oi)data={premium:premium?{lastFundingRate:premium.fundingRate,markPrice:null}:null,oi:oi?{openInterest:oi.oiCcy||oi.oi}:null,ratio:null,source:"OKX Swap"};
   }catch{}
  }
  if(!data)return json({error:"داده مشتقات برای این نماد از منابع بررسی‌شده دریافت نشد."},502,request);
  const p=data.premium||{},o=data.oi||{},r=data.ratio||{};
  return json({symbol:base,source:data.source,funding_rate:p.lastFundingRate==null?null:Number(p.lastFundingRate),open_interest:o.openInterest==null?null:Number(o.openInterest),long_short_ratio:r.longShortRatio==null?null:Number(r.longShortRatio),mark_price:p.markPrice==null?null:Number(p.markPrice),checked_at:new Date().toISOString()},200,request);
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/market-orderflow"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"market-orderflow"),request);if(limited)return limited;
  const url=new URL(request.url),raw=String(url.searchParams.get("symbol")||"BTC").toUpperCase();
  if(!/^[A-Z0-9]{2,15}$/.test(raw))return json({error:"نماد نامعتبر است."},400,request);
  const symbol=raw.endsWith("USDT")?raw:raw+"USDT",base=symbol.replace(/USDT$/,"");
  const get=async(u,ms=8500)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(u,{signal:c.signal,headers:{"Accept":"application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);return await r.json();}finally{clearTimeout(t);}};
  const depthUrls=[
   "https://api.binance.com/api/v3/depth?symbol="+symbol+"&limit=100",
   "https://api.binance.us/api/v3/depth?symbol="+symbol+"&limit=100",
   "https://api1.binance.com/api/v3/depth?symbol="+symbol+"&limit=100",
   "https://data-api.binance.vision/api/v3/depth?symbol="+symbol+"&limit=100"
  ];
  let depth=null,depthSource=null,depthError=null;
  const depthAttempts=await Promise.allSettled(depthUrls.map(u=>get(u)));
  for(const attempt of depthAttempts){if(attempt.status==="fulfilled"&&Array.isArray(attempt.value.bids)&&Array.isArray(attempt.value.asks)){depth=attempt.value;depthSource="Binance Spot";break;}if(attempt.status==="rejected")depthError=String(attempt.reason?.message||attempt.reason);}
  if(!depth){try{const d=await get("https://www.okx.com/api/v5/market/books?instId="+base+"-USDT&sz=100");const b=d?.data?.[0];if(b?.bids&&b?.asks){depth={bids:b.bids,asks:b.asks};depthSource="OKX Spot";}}catch(e){depthError=String(e?.message||e);}}
  let bid=0,ask=0,mid=0;
  if(depth){const bp=Number(depth.bids?.[0]?.[0]||0),ap=Number(depth.asks?.[0]?.[0]||0);mid=(bp+ap)/2;
   for(const [p,q] of depth.bids||[])if(mid&&Number(p)>=mid*.99)bid+=Number(p)*Number(q);
   for(const [p,q] of depth.asks||[])if(mid&&Number(p)<=mid*1.01)ask+=Number(p)*Number(q);
  }
  let klines=null,candleSource=null,candleError=null;
  const klineUrls=[
   "https://api.binance.com/api/v3/klines?symbol="+symbol+"&interval=1m&limit=60",
   "https://api.binance.us/api/v3/klines?symbol="+symbol+"&interval=1m&limit=60",
   "https://api1.binance.com/api/v3/klines?symbol="+symbol+"&interval=1m&limit=60",
   "https://data-api.binance.vision/api/v3/klines?symbol="+symbol+"&interval=1m&limit=60"
  ];
  const candleAttempts=await Promise.allSettled(klineUrls.map(u=>get(u)));
  for(const attempt of candleAttempts){if(attempt.status==="fulfilled"&&Array.isArray(attempt.value)&&attempt.value.length>=10){klines=attempt.value;candleSource="Binance Spot";break;}if(attempt.status==="rejected")candleError=String(attempt.reason?.message||attempt.reason);}
  let buy=null,sell=null,cvd=null;
  if(klines){buy=0;sell=0;for(const k of klines){const quote=Number(k[7])||0,takerBuy=Number(k[10])||0;buy+=takerBuy;sell+=Math.max(0,quote-takerBuy);}cvd=buy-sell;}
  const imbalance=bid+ask?(bid-ask)/(bid+ask)*100:null;
  return json({symbol,depth:{available:!!depth,source:depthSource,bid_usdt:depth?bid:null,ask_usdt:depth?ask:null,imbalance_pct:imbalance},flow:{available:!!klines,source:candleSource,buy_usdt:buy,sell_usdt:sell,cvd_usdt:cvd,minutes:klines?klines.length:0},errors:{depth:depth?null:depthError,candles:klines?null:candleError},checked_at:new Date().toISOString()},200,request);
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/whale-watch"){
  const limited=rateLimitReply(await checkRateLimit(env.PUBLIC_API_LIMITER,request,"whale-watch"),request);if(limited)return limited;
  try{
   const c=new AbortController(),timer=setTimeout(()=>c.abort(),9000);
   let rows;try{const r=await fetch("https://mempool.space/api/mempool/recent",{signal:c.signal,headers:{"Accept":"application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);rows=await r.json();}finally{clearTimeout(timer);}
   const txs=(Array.isArray(rows)?rows:[]).map(x=>({txid:String(x.txid||""),value_btc:Number(x.value)/1e8,fee:Number(x.fee)||0,fee_rate:Number(x.feeRate)||0})).filter(x=>x.txid&&x.value_btc>=10).sort((a,b)=>b.value_btc-a.value_btc).slice(0,20);
   return json({asset:"BTC",scope:"unconfirmed_mempool",provider:"mempool.space",threshold_btc:10,count:txs.length,transfers:txs,checked_at:new Date().toISOString(),limitation:"این داده فقط تراکنش‌های بزرگِ در انتظار تأیید شبکه بیت‌کوین را نشان می‌دهد؛ آدرس‌های صرافی برچسب‌گذاری نشده‌اند و جریان ورودی/خروجی صرافی از آن استنباط نمی‌شود."},200,request);
  }catch(e){return json({error:"داده عمومی تراکنش‌های بزرگ بیت‌کوین در دسترس نیست.",detail:String(e?.message||e).slice(0,180)},502,request);}
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/market-candles"){
  const limitResult=await checkRateLimit(env.PUBLIC_API_LIMITER,request,"market-candles");
  const limited=rateLimitReply(limitResult,request);if(limited)return limited;
  const url=new URL(request.url),rawSymbol=String(url.searchParams.get("symbol")||"").toUpperCase();
  const interval=String(url.searchParams.get("interval")||"15m");
  if(!/^[A-Z0-9]{2,15}$/.test(rawSymbol)||!["15m","1h","4h","1d"].includes(interval))return json({error:"نماد یا بازه زمانی نامعتبر است."},400,request);
  const symbol=rawSymbol.endsWith("USDT")?rawSymbol:rawSymbol+"USDT";
  try{
   const result=await candles(symbol,interval,env,"spot");
   return json({symbol,interval,provider:result.data_provider,price:result.price,change_pct:result.change_pct,candles:result.candles.map(c=>({time:Math.floor(c.t/1000),open:c.o,high:c.h,low:c.l,close:c.c,volume:c.v}))},200,request);
  }catch(error){return json({error:"داده کندلی این ارز فعلاً در دسترس نیست.",detail:String(error?.message||"upstream error").slice(0,220),symbol,interval},502,request);}
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/market-proxy"){
  const limitResult=await checkRateLimit(env.PUBLIC_API_LIMITER,request,"market-proxy");
  const limited=rateLimitReply(limitResult,request);if(limited)return limited;
  const url=new URL(request.url),source=url.searchParams.get("source")||"";
  const requestedTopPage=Number(url.searchParams.get("page")||1);
  const requestedOffset=Number(url.searchParams.get("offset")||0);
  if(source==="coingecko-top"&&(!Number.isInteger(requestedTopPage)||requestedTopPage<1||requestedTopPage>5))return json({error:"Invalid CoinGecko page"},400,request);
  if(source==="coinlore-top"&&(!Number.isInteger(requestedOffset)||requestedOffset<0||requestedOffset>5000||requestedOffset%100!==0))return json({error:"Invalid CoinLore offset"},400,request);
  const urls={
   "binance-tickers":["https://api.binance.com/api/v3/ticker/24hr","https://api.binance.us/api/v3/ticker/24hr","https://api1.binance.com/api/v3/ticker/24hr","https://api2.binance.com/api/v3/ticker/24hr","https://api3.binance.com/api/v3/ticker/24hr","https://data-api.binance.vision/api/v3/ticker/24hr"],
   "coingecko-top":["https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page="+requestedTopPage+"&sparkline=false&price_change_percentage=1h%2C24h%2C7d"],
   "coinlore-top":["https://api.coinlore.net/api/tickers/?start="+requestedOffset+"&limit=100"],
   "nobitex-tether":["https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls","https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls"],
   "wallex-markets":["https://api.wallex.ir/v1/markets","https://api.wallex.ir/hector/web/v1/markets","https://api.wallex.ir/v1/otc/markets"]
  };
  let candidates=urls[source]||null;
  if(source==="coingecko-extra"){
   const ids=url.searchParams.get("ids")||"";
   if(!/^[a-z0-9,-]{1,1800}$/i.test(ids)||ids.split(",").length>60)return json({error:"Invalid asset id list"},400,request);
   candidates=["https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids="+encodeURIComponent(ids)+"&order=market_cap_desc&sparkline=false&price_change_percentage=1h%2C24h%2C7d"];
  }
  if(!candidates)return json({error:"Unsupported market data source"},400,request);
  let lastError=null;
  for(const endpoint of candidates){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
   try{
    const upstreamHeaders={"Accept":"application/json, text/plain, */*","User-Agent":"MMP-COIN-AI/1.0","Accept-Language":"en-US,en;q=0.9"};
   if(source==="wallex-markets"){upstreamHeaders.Origin="https://wallex.ir";upstreamHeaders.Referer="https://wallex.ir/";}
   const upstream=await fetch(endpoint,{headers:upstreamHeaders,signal:controller.signal,cf:{cacheTtl:source.startsWith("coingecko")?60:source.includes("tether")||source.includes("wallex")?10:5,cacheEverything:true}});
    if(!upstream.ok){lastError="Upstream HTTP "+upstream.status;continue;}
    const data=await upstream.json();
    if(data===null||typeof data!=="object")throw new Error("Invalid upstream JSON");
    return json(data,200,request,{"X-MMP-Data-Source":source});
   }catch(error){lastError=String(error?.message||"network error");}
   finally{clearTimeout(timer);}
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
   const results=await Promise.all(urls.map(url=>timeoutFetch(url,valid,timeout,extraHeaders)));
   const good=results.filter(x=>x.status!=="down").sort((a,b)=>a.ping-b.ping);
   return good[0]||results[results.length-1]||{status:"down",ping:null,error:"no Wallex endpoint responded"};
  };
  const [binance,bybit,okx,nobitex,wallex,bitget,gate,kucoin]=await Promise.all([
   probeAny(["https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://api.binance.us/api/v3/ticker/price?symbol=BTCUSDT","https://api1.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://api2.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://api3.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT"],d=>Number(d?.price)>0),
   probeAny(["https://api.bybit.eu/v5/market/tickers?category=spot&symbol=BTCUSDT","https://api.bytick.eu/v5/market/tickers?category=spot&symbol=BTCUSDT","https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT","https://api.bytick.com/v5/market/tickers?category=spot&symbol=BTCUSDT"],d=>d?.retCode===0&&Number(d?.result?.list?.[0]?.lastPrice)>0),
   probeAny(["https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT","https://us.okx.com/api/v5/market/ticker?instId=BTC-USDT","https://openapi.okx.com/api/v5/market/ticker?instId=BTC-USDT"],d=>d?.code==="0"&&Number(d?.data?.[0]?.last)>0),
   timeoutFetch("https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls",d=>d?.status==="ok"&&Number(d?.stats?.["usdt-rls"]?.latest)>0,5500),
   probeAny(["https://api.wallex.ir/v1/markets","https://api.wallex.ir/hector/web/v1/markets","https://api.wallex.ir/v1/otc/markets"],d=>{if(d?.success!==true)return false;const raw=d?.result?.symbols??d?.result?.markets;if(Array.isArray(raw))return raw.length>0;if(raw&&typeof raw==="object")return Object.keys(raw).length>0;return false;},12000,{"Origin":"https://wallex.ir","Referer":"https://wallex.ir/"}),
   timeoutFetch("https://api.bitget.com/api/v3/market/tickers?category=SPOT&symbol=BTCUSDT",d=>d?.code==="00000"&&Number(d?.data?.[0]?.lastPrice)>0,7000),
   timeoutFetch("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT",d=>Array.isArray(d)&&Number(d?.[0]?.last)>0,7000),
   timeoutFetch("https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT",d=>d?.code==="200000"&&Number(d?.data?.price)>0,7000)
  ]);
  const checks=[
   {name:"Binance Spot",purpose:"قیمت، حجم و کندل اسپات",...binance},
   {name:"Bybit Spot",purpose:"قیمت، حجم و کندل اسپات",...bybit},
   {name:"OKX Spot",purpose:"قیمت، حجم و کندل اسپات",...okx},
   {name:"Bitget Spot",purpose:"قیمت، حجم و کندل اسپات",...bitget},
   {name:"Gate.io Spot",purpose:"قیمت، حجم و کندل اسپات",...gate},
   {name:"KuCoin Spot",purpose:"قیمت، حجم و کندل اسپات",...kucoin},
   {name:"Nobitex",purpose:"نرخ تتر به تومان",...nobitex},
   {name:"Wallex",purpose:"نرخ تتر به تومان",...wallex}
  ];
  return json({checked_at:new Date().toISOString(),checks},200,request);
 }
if(request.method==="GET"&&new URL(request.url).pathname==="/health"){
  const limitResult=await checkRateLimit(env.PUBLIC_API_LIMITER,request,"health");
  const limited=rateLimitReply(limitResult,request);if(limited)return limited;
  const probe=async(url)=>{try{const r=await fetch(url,{headers:{"Accept":"application/json, text/plain, */*","User-Agent":"MMP-COIN-AI/1.0","Accept-Language":"en-US,en;q=0.9"}});return {ok:r.ok,status:r.status};}catch(e){return {ok:false,error:e.message||"network error"};}};
  const [spot,futures,bybit]=await Promise.all([
   probe("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1"),
   probe("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=1"),
   probe("https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=60&limit=1")
  ]);
  return json({service:"MMP COIN AI",worker:"online",ai_binding:!!env.AI,providers:{spot_binance:spot,futures_binance:futures,futures_bybit_fallback:bybit},checked_at:new Date().toISOString()},200,request);
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
  const compactTimeframes=source=>Object.fromEntries(Object.entries(source||{}).map(([tf,x])=>[tf,{price:x.price,change_pct:x.change_pct,rsi:x.rsi,ema_trend:x.ema_trend,macd_signal:x.macd_signal,atr_percent:x.atr_percent,support:x.support,resistance:x.resistance,volume_ratio:x.volume_ratio,candle_time:x.candle_time,data_provider:x.data_provider}]));
  const snapshot={asset:String(body.name||symbol).slice(0,60),symbol:pair,market_mode:mode,source:[...new Set(providers)].join(" + ")+"; derivatives metrics when available; Alternative.me Fear & Greed; CoinGecko global market",market_timestamp:latest.candle_time,timeframes:compactTimeframes(market),futures_timeframes:mode==="both"&&futuresMarket?compactTimeframes(futuresMarket):null,futures_data_available:mode==="both"?!!futuresMarket:mode==="futures",derivatives:funding?{funding_rate:funding.lastFundingRate,mark_price:funding.markPrice??null,next_funding_time:funding.nextFundingTime??null,open_interest:openInterest?.openInterest||null}:null,sentiment:fng?.data?.[0]?{fear_greed_value:Number(fng.data[0].value),classification:fng.data[0].value_classification}:null,global_market:global?.data?{btc_dominance:global.data.market_cap_percentage?.btc,total_market_cap_usd:global.data.total_market_cap?.usd,total_volume_usd:global.data.total_volume?.usd}:null}
  const prompt="You are MMP COIN AI, a professional quantitative crypto analyst. Use ONLY the supplied market snapshot and its numeric values. Write every human-readable sentence in fluent, natural Persian. Do not mix Persian with Russian, Chinese, or English words. All explanatory text must be fluent Persian. Never write English words such as signal, leverage, market, entry, exit, volume, wait, monitor, breakout, breakdown, support, resistance, risk, or trade; translate them into Persian. Avoid mixed-language sentences entirely. Preserve only tickers and standard indicators: BTCUSDT, RSI, MACD, EMA, ATR, LONG, SHORT, BUY, SELL, WAIT, TP1, TP2, TP3. Never invent news, events, order-book data, on-chain metrics, funding, open interest, volume, prices, or indicators.\n\nAnalyze all four timeframes (15m, 1h, 4h, 1d), distinguish short-term noise from the main trend, compare EMA alignment, RSI, MACD, volume ratio, ATR, support and resistance. In both mode, compare spot timeframes against futures_timeframes and explicitly identify agreement or divergence; never claim futures data was checked when futures_data_available is false. Evaluate derivatives funding and open interest only when present; explain Fear & Greed only when present.\n\nReturn ONLY one valid JSON object with keys: action (BUY, SELL, WAIT), primary_timeframe, confidence (integer 0-100 representing strength/alignment of evidence, NOT probability of profit), risk_level, market {price_usd}, levels {entry_zone:{low,high},stop_loss,tp1,tp2,tp3}, risk_reward, holding_horizon, position_risk, summary, technical_analysis, indicators {rsi,macd_signal,ema_trend,atr_percent}, scenarios [{name,description}], recommendations [3-6 concise actionable Persian suggestions], reasons [3-6 evidence-based Persian strings], risk_management, invalidation, market_context, data_source, market_timestamp.\n\nScenarios must cover bullish, bearish, and sideways cases, each with the condition that would confirm it and the relevant supplied support/resistance or indicator evidence. Recommendations should include what to monitor next, what would confirm entry, what invalidates the setup, and whether to wait for candle close. Never promise a return or call confidence a win probability.\n\nChoose WAIT when timeframes conflict, evidence is weak, risk/reward is below 1.5, volume confirmation is missing, or data is insufficient. When action is WAIT, set all entry/stop/target values to null. For BUY, entry and targets must be logically consistent around current price; for SELL, reverse the direction. Derive levels only from supplied support, resistance, ATR and current price. In spot-only mode never recommend SHORT or SELL. For futures, warn that leverage creates liquidation risk and advise low or no leverage. Use concise but substantive analysis, not generic filler.\n\nSnapshot: "+JSON.stringify(snapshot);
  stage="اجرای هوش مصنوعی";
  const aiResult=await runAIWithFallback(env,prompt);
  const aiProvider=aiResult.provider;
  stage="پردازش پاسخ هوش مصنوعی";
  let raw=aiResult.raw;
  if(typeof raw!=="string")raw=JSON.stringify(raw);
  raw=raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
  const start=raw.indexOf("{"),end=raw.lastIndexOf("}");
  if(start<0||end<=start)throw new Error("AI returned an invalid structured response");
  const analysis=persianize(JSON.parse(raw.slice(start,end+1)));
  if(!["BUY","SELL","WAIT"].includes(String(analysis.action||"").toUpperCase()))analysis.action="WAIT";
  analysis.confidence=Math.max(0,Math.min(100,Math.round(Number(analysis.confidence)||0)));
  analysis.market=analysis.market||{};analysis.market.price_usd=latest.price;
  analysis.indicators={...(analysis.indicators||{}),rsi:latest.rsi==null?null:Number(latest.rsi.toFixed(2)),macd_signal:latest.macd_signal,ema_trend:latest.ema_trend,atr_percent:latest.atr_percent==null?null:Number(latest.atr_percent.toFixed(2))};
  analysis.market_timestamp=latest.candle_time;analysis.data_source=[...new Set(providers)].join(" + ")+ " · "+aiProvider;
  analysis.recommendations=Array.isArray(analysis.recommendations)?analysis.recommendations.slice(0,6):[];
  analysis.scenarios=Array.isArray(analysis.scenarios)?analysis.scenarios.slice(0,3):[];
  analysis.reasons=Array.isArray(analysis.reasons)?analysis.reasons.slice(0,6):[];
  stage="محاسبه وضعیت سیگنال";
  const alignmentMarket=mode==="futures"?(futuresMarket||market):market;
  let longAligned=alignmentMarket["4h"].ema_trend==="bullish"&&alignmentMarket["1d"].ema_trend!=="bearish";
  let shortAligned=alignmentMarket["4h"].ema_trend==="bearish"&&alignmentMarket["1d"].ema_trend!=="bullish";
  if(mode==="both"&&futuresMarket){longAligned=longAligned&&futuresMarket["4h"].ema_trend==="bullish"&&futuresMarket["1d"].ema_trend!=="bearish";shortAligned=shortAligned&&futuresMarket["4h"].ema_trend==="bearish"&&futuresMarket["1d"].ema_trend!=="bullish";}
  if((analysis.action==="BUY"&&!longAligned)||(analysis.action==="SELL"&&!shortAligned)||(mode==="spot"&&analysis.action==="SELL")){
   analysis.action="WAIT";analysis.confidence=Math.min(analysis.confidence,55);
   analysis.reasons.unshift("هم‌جهتی کافی میان روند ۴ ساعته و روزانه وجود ندارد؛ ورود فوری تأیید نمی‌شود.");
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
export default {fetch:handle};
