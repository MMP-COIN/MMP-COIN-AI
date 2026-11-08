const MAIN_UNIVERSE = "https://mmp-coin-ai-analyzer.mehrdadmohammadi1988.workers.dev/hunter-universe";
const MAIN_FLOW = "https://mmp-coin-ai-analyzer.mehrdadmohammadi1988.workers.dev/market-flow";
const RETENTION_SCORE = 64;
const BATCH_SIZE = 36;
const CONCURRENCY = 9;
const SUPPORTED = new Set(["Binance","Bybit","OKX","Bitget","Gate","KuCoin"]);
const JSON_HEADERS = { "Accept":"application/json", "User-Agent":"MMP-COIN-AI-RADAR/1.0" };
async function getJson(url, timeoutMs = 6500) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetch(url,{headers:JSON_HEADERS,signal:controller.signal}); if(!response.ok) throw new Error("HTTP "+response.status); return await response.json(); }
  finally { clearTimeout(timer); }
}
function normalizeRows(rows) {
  if(!Array.isArray(rows)) return [];
  return rows.map(row=>{let t=Number(row[0]);if(t>0&&t<1000000000000)t*=1000;return [t,Number(row[1]),Number(row[2]),Number(row[3]),Number(row[4]),Number(row[5])];})
    .filter(row=>row.every(Number.isFinite)&&row[1]>0&&row[2]>=row[3]&&row[3]>0&&row[4]>0&&row[5]>=0).sort((a,b)=>a[0]-b[0]);
}
async function loadProvider(symbol,exchange) {
  const pair=symbol+"USDT";
  if(exchange==="Binance"){
    let lastError;
    for(const host of ["https://api.binance.com","https://data-api.binance.vision","https://api1.binance.com"]){
      try{const rows=normalizeRows(await getJson(host+"/api/v3/klines?symbol="+pair+"&interval=1m&limit=30"));if(rows.length>=25)return {rows,provider:"Binance Spot"};throw new Error("کمبود کندل");}
      catch(error){lastError=error;}
    }
    throw lastError||new Error("Binance unavailable");
  }
  if(exchange==="Bybit"){
    const d=await getJson("https://api.bybit.com/v5/market/kline?category=spot&symbol="+pair+"&interval=1&limit=30");
    if(String(d.retCode)!=="0")throw new Error(d.retMsg||"Bybit unavailable");
    const rows=normalizeRows(d.result?.list);if(rows.length<25)throw new Error("Bybit candle history insufficient");return {rows,provider:"Bybit Spot"};
  }
  if(exchange==="OKX"){
    const d=await getJson("https://www.okx.com/api/v5/market/candles?instId="+symbol+"-USDT&bar=1m&limit=30");
    if(String(d.code)!=="0")throw new Error(d.msg||"OKX unavailable");
    const rows=normalizeRows(d.data);if(rows.length<25)throw new Error("OKX candle history insufficient");return {rows,provider:"OKX Spot"};
  }
  if(exchange==="Bitget"){
    const d=await getJson("https://api.bitget.com/api/v3/market/candles?category=SPOT&symbol="+pair+"&interval=1m&limit=30");
    if(!["00000","0"].includes(String(d.code)))throw new Error(d.msg||"Bitget unavailable");
    const rows=normalizeRows(d.data);if(rows.length<25)throw new Error("Bitget candle history insufficient");return {rows,provider:"Bitget Spot"};
  }
  if(exchange==="Gate"){
    const d=await getJson("https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair="+symbol+"_USDT&interval=1m&limit=30");
    const rows=normalizeRows(Array.isArray(d)?d.map(x=>[Number(x[0])*1000,x[5],x[3],x[4],x[2],x[1]]):[]);
    if(rows.length<25)throw new Error("Gate candle history insufficient");return {rows,provider:"Gate Spot"};
  }
  if(exchange==="KuCoin"){
    const d=await getJson("https://api.kucoin.com/api/v1/market/candles?type=1min&symbol="+symbol+"-USDT");
    if(String(d.code)!=="200000")throw new Error("KuCoin unavailable");
    const rows=normalizeRows(Array.isArray(d.data)?d.data.map(x=>[Number(x[0])*1000,x[1],x[3],x[4],x[2],x[6]||x[5]]):[]);
    if(rows.length<25)throw new Error("KuCoin candle history insufficient");return {rows,provider:"KuCoin Spot"};
  }
  throw new Error("Unsupported venue");
}
async function scanCoin(coin){
  const symbol=String(coin?.symbol||"").toUpperCase();if(!/^[A-Z0-9]{2,20}$/.test(symbol))return null;
  const listed=Array.isArray(coin.marketPairs)?coin.marketPairs.filter(x=>String(x.quote||"").toUpperCase()==="USDT"&&Number(x.volume)>=15000&&SUPPORTED.has(String(x.exchange))):
    Object.entries(coin.hunterVenueVolume||{}).filter(([name,volume])=>SUPPORTED.has(name)&&Number(volume)>=15000).map(([exchange,volume])=>({exchange,volume,quote:"USDT"}));
  if(Number(coin.total_volume||0)<50000||!listed.length)return null;
  const order=[...new Map(listed.sort((a,b)=>Number(b.volume)-Number(a.volume)).map(x=>[x.exchange,x])).values()].map(x=>x.exchange);
  let market=null,errors=[];
  for(const venue of order){try{market=await loadProvider(symbol,venue);break;}catch(error){errors.push(venue+": "+String(error?.message||error).slice(0,80));}}
  if(!market)throw new Error(errors.join(" | ")||"No candle provider responded");
  const rows=market.rows,now=Date.now(),index=rows.length-2;if(index<21)return null;
  const last=rows[index],candleAge=now-last[0],close=last[4],open=last[1],volume=last[5];
  if(candleAge<60000||candleAge>180000||close<=0||open<=0||volume<=0)return null;
  const baseline=rows.slice(index-20,index).map(x=>x[5]).filter(x=>x>0);if(baseline.length<16)return null;
  const avgVolume=baseline.reduce((a,b)=>a+b,0)/baseline.length,volumeRatio=avgVolume>0?volume/avgVolume:0;
  const change1m=(close/open-1)*100,start5=rows[index-4][1];if(!(start5>0))return null;
  const change5m=(close/start5-1)*100,dailyChange24h=Number(coin.hunterChange24h)||0,recent=rows.slice(index-7,index);
  const priorHigh=Math.max(...recent.map(x=>x[2])),priorLow=Math.min(...recent.map(x=>x[3]));
  const breakoutUp=close>priorHigh,breakoutDown=close<priorLow;
  const overextended=Math.abs(change5m)>=1.5||Math.abs(change1m)>=0.8||Math.abs(dailyChange24h)>=18;
  const bullDaily=dailyChange24h>=8&&change5m>=-0.15&&volumeRatio>=0.9,bearDaily=dailyChange24h<=-8&&change5m<=0.15&&volumeRatio>=0.9;
  const score=Math.min(99,Math.max((bullDaily||bearDaily)?72:0,Math.round(55+Math.min(16,Math.abs(change1m)*30)+Math.min(14,Math.abs(change5m)*8)+Math.min(16,Math.max(0,volumeRatio-1)*8)+((breakoutUp||breakoutDown)?8:0))));
  return {id:String(coin.id),symbol,trend:change5m>=0?"bull":"bear",score,change1m,change5m,dailyChange24h,dailyMover:Math.abs(dailyChange24h)>=8,lowLiquidity:Number(coin.total_volume||0)<150000,volumeRatio,breakout:breakoutUp||breakoutDown,overextended,price:close,provider:market.provider,flow:null,flowSignal:"",updatedAt:now,candleTime:last[0],rows:rows.map(x=>x.slice(0,6)),serverScanned:true,coin:{id:String(coin.id),symbol,name:coin.name||symbol,image:coin.image||"",current_price:close,total_volume:Number(coin.total_volume)||0,market_cap:coin.market_cap||null,market_cap_rank:coin.market_cap_rank||null,hunterExchange:coin.hunterExchange||"",hunterPriceExchange:coin.hunterPriceExchange||"",hunterChange24h:dailyChange24h,hunterVenueVolume:coin.hunterVenueVolume||{},marketPairs:Array.isArray(coin.marketPairs)?coin.marketPairs:[]}};
}
async function mapLimit(items,limit,fn){
  let cursor=0;const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const i=cursor++;await fn(items[i],i);}});
  await Promise.all(workers);
}
async function runRadar(env,scheduledTime=Date.now()){
  if(!env.RADAR_KV)throw new Error("RADAR_KV binding is missing");
  const response=await getJson(MAIN_UNIVERSE,55000);
  const source=Array.isArray(response.hunter_assets)&&response.hunter_assets.length?response.hunter_assets:Array.isArray(response.radar_assets)&&response.radar_assets.length?response.radar_assets:response.assets;
  if(!Array.isArray(source)||!source.length)throw new Error("Exchange universe returned no assets; previous snapshot retained");
  const universe=source.filter(coin=>{
    const venues=Array.isArray(coin.marketPairs)?coin.marketPairs.some(x=>String(x.quote||"").toUpperCase()==="USDT"&&Number(x.volume)>=15000&&SUPPORTED.has(String(x.exchange))):
      Object.entries(coin.hunterVenueVolume||{}).some(([name,volume])=>SUPPORTED.has(name)&&Number(volume)>=15000);
    return venues&&Number(coin.total_volume||0)>=50000&&/^[A-Z0-9]{2,20}$/.test(String(coin.symbol||""));
  }).sort((a,b)=>Number(b.total_volume||0)-Number(a.total_volume||0));
  if(!universe.length)throw new Error("No eligible USDT spot symbols; previous snapshot retained");
  const [state,oldSnapshot]=await Promise.all([env.RADAR_KV.get("radar:state",{type:"json"}),env.RADAR_KV.get("radar:snapshot",{type:"json"})]);
  const signals=new Map((Array.isArray(oldSnapshot?.signals)?oldSnapshot.signals:[]).filter(x=>Number(x?.score)>=RETENTION_SCORE).map(x=>[String(x.id),x]));
  const start=Math.max(0,Number(state?.cursor)||0)%universe.length,batch=Array.from({length:Math.min(BATCH_SIZE,universe.length)},(_,i)=>universe[(start+i)%universe.length]);
  let completed=0,failed=0,valid=0,removed=0,failedSamples=[],scannedSignals=[],removedSignals={...(state?.removed_signals||{})};
  // Keep removal tombstones for 24 hours so clients that miss one snapshot still receive removals.
  const tombstoneCutoff=Date.now()-24*60*60*1000;
  for(const [id,item] of Object.entries(removedSignals)){if(Number(item?.removedAt||0)<tombstoneCutoff)delete removedSignals[id];}
  await mapLimit(batch,CONCURRENCY,async coin=>{
    try{const signal=await scanCoin(coin);if(signal){valid++;scannedSignals.push(signal);if(signal.score>=RETENTION_SCORE){signals.set(signal.id,signal);delete removedSignals[signal.id];}else if(signals.delete(signal.id)){removed++;removedSignals[signal.id]={symbol:signal.symbol,score:signal.score,scannedAt:signal.updatedAt,removedAt:Date.now(),reason:"below_retention_threshold"};}}}
    catch(error){failed++;if(failedSamples.length<8)failedSamples.push({symbol:String(coin.symbol||""),error:String(error?.message||error).slice(0,220)});}finally{completed++;}
  });
  // Shared real-trade flow enriches a small set of strongest fresh candidates; it never changes radar scores or retention decisions.
  await mapLimit(scannedSignals.filter(x=>Number(x.score)>=RETENTION_SCORE).sort((a,b)=>b.score-a.score).slice(0,8),2,async signal=>{
    try{
      const flow=await getJson(MAIN_FLOW+"?symbol="+encodeURIComponent(signal.symbol)+"&window=5",8500);
      signal.flow={buy5m:Number(flow.buy5m)||0,sell5m:Number(flow.sell5m)||0,net5m:Number(flow.net5m)||0,tradeCount:Number(flow.trade_count)||0,provider:flow.provider||"",complete:flow.complete!==false,rows:Array.isArray(flow.rows)?flow.rows:[]};
      signal.flowSignal=signal.flow.net5m>0?"inflow":signal.flow.net5m<0?"outflow":"";
    }catch(error){signal.flowError=String(error?.message||error).slice(0,120);}
    const current=signals.get(signal.id);if(current&&Number(current.updatedAt)<=Number(signal.updatedAt))signals.set(signal.id,signal);
  });
  const nextCursor=(start+batch.length)%universe.length,snapshot={status:"online",source:"Cloudflare scheduled radar",retention_score:RETENTION_SCORE,scanned_at:new Date().toISOString(),scheduled_at:new Date(Number(scheduledTime)||Date.now()).toISOString(),universe_count:universe.length,scanned_count:completed,valid_count:valid,failed_count:failed,failed_samples:failedSamples,removed_count:removed,removed_signals:removedSignals,batch_size:BATCH_SIZE,next_cursor:nextCursor,signals:[...signals.values()].filter(x=>Number(x?.score)>=RETENTION_SCORE).sort((a,b)=>b.score-a.score).slice(0,300)};
  await Promise.all([env.RADAR_KV.put("radar:snapshot",JSON.stringify(snapshot)),env.RADAR_KV.put("radar:state",JSON.stringify({cursor:nextCursor,updated_at:snapshot.scanned_at,universe_count:universe.length,removed_signals:removedSignals}))]);
  return snapshot;
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==="OPTIONS")return json({},204);
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    if(url.pathname==="/health")return json({worker:"online",scheduled_scan:"every minute",kv:!!env.RADAR_KV,checked_at:new Date().toISOString()});
    if(url.pathname==="/fast-radar-snapshot"||url.pathname==="/snapshot"){
      if(!env.RADAR_KV)return json({status:"not_configured",signals:[]},503);
      const snapshot=await env.RADAR_KV.get("radar:snapshot",{type:"json"});
      return json(snapshot||{status:"warming_up",signals:[],message:"اولین اسکن زمان‌بندی‌شده هنوز کامل نشده است."});
    }
    return json({error:"Not found"},404);
  },
  async scheduled(controller,env){await runRadar(env,controller.scheduledTime);}
};