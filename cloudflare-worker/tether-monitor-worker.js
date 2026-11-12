const HEADERS={"Accept":"application/json, text/plain, */*","User-Agent":"MMP-COIN-AI-Tether-Monitor/1.0","Accept-Language":"en-US,en;q=0.9"};
const WALLEX_HEADERS={...HEADERS,"Origin":"https://wallex.ir","Referer":"https://wallex.ir/","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fetchJson(url,headers=HEADERS){
 let lastError=null;
 for(let attempt=0;attempt<2;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
  try{
   const response=await fetch(url,{headers,signal:controller.signal});
   if(!response.ok){
    const error=new Error("HTTP "+response.status);error.status=response.status;
    const retryAfter=Number(response.headers.get("Retry-After"))||0;
    if(attempt===0&&(response.status===429||response.status>=500)){await pause(Math.min(1500,Math.max(300,retryAfter*1000||500)));lastError=error;continue;}
    throw error;
   }
   return await response.json();
  }catch(error){
   lastError=error;
   if(attempt===0&&(error.name==="AbortError"||!error.status)){await pause(350);continue;}
   throw error;
  }finally{clearTimeout(timer);}
 }
 throw lastError||new Error("provider request failed");
}
async function readSource(urls,exchange,normalize,headers=HEADERS){
 let value=null,lastError=null;
 for(const url of urls){
  try{
   const data=await fetchJson(url,headers),candidate=Number(normalize(data));
   if(candidate>0&&Number.isFinite(candidate)){value=candidate;break;}
   lastError=new Error(exchange+" returned no valid USDT/IRR price");
  }catch(error){lastError=error;}
 }
 return value>0
  ?{exchange,price_irr:value,price_toman:value/10,fresh:true}
  :{exchange,price_irr:null,price_toman:null,fresh:false,error:String(lastError?.message||"no valid price response").slice(0,100)};
}
async function fetchLocalTetherSnapshot(){
 const sources=await Promise.all([
  readSource([
   "https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls",
   "https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls",
   "https://apiv2.nobitex.ir/v3/orderbook/USDTIRT",
   "https://api.nobitex.ir/v3/orderbook/USDTIRT"
  ],"Nobitex",d=>{
   const rialRate=Number(d?.stats?.["usdt-rls"]?.latest);
   if(d?.status==="ok"&&rialRate>0)return rialRate;
   const tomanRate=Number(d?.stats?.["usdt-irt"]?.latest);
   if(d?.status==="ok"&&tomanRate>0)return tomanRate*10;
   const bid=Number(d?.bids?.[0]?.[0]),ask=Number(d?.asks?.[0]?.[0]),last=Number(d?.lastTradePrice);
   const tomanPrice=last>0?last:bid>0&&ask>0?(bid+ask)/2:null;
   return tomanPrice>0?tomanPrice*10:null;
  }),
  readSource([
   "https://api.wallex.ir/hector/web/v1/markets",
   "https://api.wallex.ir/v1/markets"
  ],"Wallex",d=>{
   const raw=d?.result?.symbols||d?.result?.markets||{},markets=Array.isArray(raw)?raw:Object.values(raw);
   const toman=markets.find(m=>String(m?.symbol||"").toUpperCase()==="USDTTMN");
   const rial=markets.find(m=>String(m?.symbol||"").toUpperCase()==="USDTIRT");
   const tmn=Number(toman?.stats?.lastPrice??toman?.lastPrice),irr=Number(rial?.stats?.lastPrice??rial?.lastPrice);
   if(tmn>0)return tmn*10;if(irr>0)return irr*10;
   const book=d?.result?.USDTTMN||d?.result?.["USDTTMN"]||(Array.isArray(d?.result?.bid)&&Array.isArray(d?.result?.ask)?d.result:{});
   const bid=Number(book?.bid?.[0]?.price??book?.bid?.[0]?.[0]),ask=Number(book?.ask?.[0]?.price??book?.ask?.[0]?.[0]);
   return bid>0&&ask>0?(bid+ask)*5:null;
  },WALLEX_HEADERS),
  readSource([
   "https://api.bitpin.org/api/v1/mkt/tickers/",
   "https://api.bitpin.ir/api/v1/mkt/tickers/"
  ],"Bitpin",d=>{
   const rows=Array.isArray(d?.results)?d.results:Array.isArray(d?.data)?d.data:Array.isArray(d)?d:[];
   const pair=rows.find(m=>{
    const code=String(m?.code||m?.symbol||"").replace(/[/-]/g,"_").toUpperCase();
    const flat=code.replace(/_/g,"");
    const base=String(m?.currency1?.code||m?.base_currency||m?.baseAsset||"").toUpperCase();
    const quote=String(m?.currency2?.code||m?.quote_currency||m?.quoteAsset||"").toUpperCase();
    return code==="USDT_IRT"||flat==="USDTIRT"||(base==="USDT"&&quote==="IRT");
   });
   const price=Number(pair?.price_info?.price??pair?.internal_price_info?.price??pair?.price??pair?.last_price??pair?.last);
   return price>0?price*10:null;
  }),
  readSource("https://api.exir.io/v2/tickers","Exir",d=>{
   const source=d?.result||d?.data||d||{},entries=Array.isArray(source)?source.map(x=>[x?.symbol||x?.pair||"",x]):Object.entries(source);
   const pair=entries.find(([key,value])=>{
    const symbol=String(value?.symbol||value?.pair||key).toLowerCase().replace(/[_/]/g,"-");
    return /^(usdt-(irt|tmn|toman|irr|rls)|(irt|tmn|toman|irr|rls)-usdt)$/.test(symbol);
   });
   const symbol=String(pair?.[1]?.symbol||pair?.[0]||"").toLowerCase().replace(/[_/]/g,"-");
   const parts=symbol.split("-"),reverse=parts[0]!=="usdt",unit=reverse?parts[0]:parts[1];
   const raw=Number(pair?.[1]?.last??pair?.[1]?.close??pair?.[1]?.price),price=reverse&&raw>0?1/raw:raw;
   return price>0?(["irt","tmn","toman"].includes(unit)?price*10:price):null;
  }),
  readSource("https://publicapi.ramzinex.com/exchange/api/v1.0/exchange/pairs","Ramzinex",d=>{
   const raw=d?.result?.data??d?.data??d?.result?.pairs??d?.pairs??[],rows=Array.isArray(raw)?raw:Object.values(raw);
   const code=v=>Array.isArray(v)?String(v[0]?.symbol??v[0]?.code??v[0]??""):String(v?.symbol??v?.code??v?.name??v??"");
   const pair=rows.find(x=>{
    const base=code(x?.base_currency_symbol??x?.base_currency??x?.baseCurrency).toUpperCase();
    const quote=code(x?.quote_currency_symbol??x?.quote_currency??x?.quoteCurrency).toUpperCase();
    const name=String(x?.url_name??x?.symbol??x?.pair??"").toLowerCase().replace(/[_/]/g,"-");
    return (base==="USDT"&&["IRR","IRT","RLS","TMN","TOMAN"].includes(quote))||/^(usdt-(irr|irt|rls|tmn|toman))$/.test(name);
   });
   const buy=Number(pair?.buy??pair?.best_buy??pair?.bid),sell=Number(pair?.sell??pair?.best_sell??pair?.ask);
   const last=Number(pair?.last??pair?.last_price??pair?.price??pair?.rate);
   const rawPrice=buy>0&&sell>0?(buy+sell)/2:last;
   const quote=code(pair?.quote_currency_symbol??pair?.quote_currency??pair?.quoteCurrency).toUpperCase();
   return rawPrice>0?(["IRT","TMN","TOMAN"].includes(quote)?rawPrice*10:rawPrice):null;
  })
 ]);
 const valid=sources.filter(x=>x.fresh&&Number.isFinite(x.price_toman)),values=valid.map(x=>x.price_toman).sort((a,b)=>a-b);
 const median=values.length?(values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2):null;
 const deviation=median?Math.max(...values.map(x=>Math.abs(x-median)/median*100)):null;
 return {market:"USDT/IRR",unit:"Toman",sources,source_count:valid.length,median_toman:median,source_deviation_pct:deviation,status:valid.length>=2?"multi_source":valid.length===1?"single_source":"offline",warning:valid.length===1?"فقط یک منبع معتبر پاسخ داده؛ مقایسه چندصرافی در دسترس نیست.":valid.length===0?"هیچ منبع زنده معتبر پاسخ نداده است.":null,checked_at:new Date().toISOString(),cache:"bypassed"};
}
async function readLocalTetherState(env){
 try{const row=await env.ADMIN_DB.prepare("SELECT payload FROM hunter_engine_state WHERE id = ?").bind("local-tether-watch").first();return row?.payload?JSON.parse(row.payload):null;}catch{return null;}
}
async function monitorLocalTether(env){
 const previous=await readLocalTetherState(env),previousAt=Date.parse(previous?.monitor_updated_at||"");
 if(previous&&Number.isFinite(previousAt)&&Date.now()-previousAt<45000)return {...previous,monitor_reused:true};
 const sample=await fetchLocalTetherSnapshot(),current=Number(sample.median_toman),now=new Date().toISOString();
 const lastKnown=Number(previous?.last_known_toman??previous?.median_toman)||null;
 const lastKnownAt=previous?.last_known_checked_at||previous?.checked_at||null;
 const lastKnownAge=lastKnownAt?Math.max(0,Date.now()-Date.parse(lastKnownAt)):null;
 if(!(current>0)){
  const payload={...sample,previous_toman:Number(previous?.median_toman)||null,last_known_toman:lastKnown,last_known_checked_at:lastKnownAt,last_known_age_ms:Number.isFinite(lastKnownAge)?lastKnownAge:null,change_pct:null,alert:false,alert_exchange:null,alert_at:previous?.alert_at||null,last_prices:{...(previous?.last_prices||{})},monitor:"dedicated-tether-cron-1m",monitor_updated_at:now};
  await env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind("local-tether-watch",JSON.stringify(payload),now).run();
  return payload;
 }
 const priorPrices={...(previous?.last_prices||{})},changes=[];
 for(const source of sample.sources.filter(x=>x.fresh&&Number(x.price_toman)>0)){
  const prior=Number(priorPrices[source.exchange]);if(prior>0)changes.push({exchange:source.exchange,previous:prior,current:Number(source.price_toman),pct:(Number(source.price_toman)/prior-1)*100});
  priorPrices[source.exchange]=Number(source.price_toman);
 }
 const shock=changes.find(x=>Math.abs(x.pct)>=2.5),change=shock?.pct??(changes[0]?.pct??null);
 const payload={...sample,previous_toman:Number(previous?.median_toman)||null,last_known_toman:current,last_known_checked_at:sample.checked_at,last_known_age_ms:0,change_pct:change,alert:!!shock,alert_exchange:shock?.exchange||null,alert_at:shock?now:(previous?.alert_at||null),last_prices:priorPrices,monitor:"dedicated-tether-cron-1m",monitor_updated_at:now};
 await env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind("local-tether-watch",JSON.stringify(payload),now).run();
 return payload;
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/run"&&request.method==="POST"){
   if(!env.ADMIN_DB)return new Response(JSON.stringify({error:"ADMIN_DB binding missing"}),{status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
   const payload=await monitorLocalTether(env);
   return new Response(JSON.stringify({ok:true,...payload}),{status:200,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  }
  if(url.pathname==="/health"&&request.method==="GET")return new Response(JSON.stringify({status:"online",role:"internal-tether-monitor",admin_db:!!env.ADMIN_DB}),{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  return new Response("Not found",{status:404,headers:{"Cache-Control":"no-store"}});
 },
 async scheduled(event,env,ctx){
  const task=monitorLocalTether(env).catch(error=>console.error("Dedicated Tether monitor failed:",error?.message||error));
  if(ctx?.waitUntil)ctx.waitUntil(task);else await task;
 }
};
