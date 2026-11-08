import { QUANTUM_ENGINE_NAME, QUANTUM_ENGINE_VERSION, normalizeQuantumUniverse, scoreQuantumOpportunity } from "./quantum-core.js";
const MAIN_UNIVERSE = "https://mmp-coin-ai-analyzer.mehrdadmohammadi1988.workers.dev/hunter-universe";
const MAIN_FLOW = "https://mmp-coin-ai-analyzer.mehrdadmohammadi1988.workers.dev/market-flow";
const RETENTION_SCORE = 64;
const BATCH_SIZE = 16;
const CONCURRENCY = 4;
const SUPPORTED = new Set(["Binance","Bybit","OKX","Bitget","Gate","KuCoin","WhiteBIT"]);
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
    for(const host of ["https://api.binance.com"]){
      try{const rows=normalizeRows(await getJson(host+"/api/v3/klines?symbol="+pair+"&interval=1m&limit=40"));if(rows.length>=25)return {rows,provider:"Binance Spot"};throw new Error("کمبود کندل");}
      catch(error){lastError=error;}
    }
    throw lastError||new Error("Binance unavailable");
  }
  if(exchange==="Bybit"){
    const d=await getJson("https://api.bybit.com/v5/market/kline?category=spot&symbol="+pair+"&interval=1&limit=40");
    if(String(d.retCode)!=="0")throw new Error(d.retMsg||"Bybit unavailable");
    const rows=normalizeRows(d.result?.list);if(rows.length<25)throw new Error("Bybit candle history insufficient");return {rows,provider:"Bybit Spot"};
  }
  if(exchange==="OKX"){
    const d=await getJson("https://www.okx.com/api/v5/market/candles?instId="+symbol+"-USDT&bar=1m&limit=40");
    if(String(d.code)!=="0")throw new Error(d.msg||"OKX unavailable");
    const rows=normalizeRows(d.data);if(rows.length<25)throw new Error("OKX candle history insufficient");return {rows,provider:"OKX Spot"};
  }
  if(exchange==="Bitget"){
    const d=await getJson("https://api.bitget.com/api/v3/market/candles?category=SPOT&symbol="+pair+"&interval=1m&limit=40");
    if(!["00000","0"].includes(String(d.code)))throw new Error(d.msg||"Bitget unavailable");
    const rows=normalizeRows(d.data);if(rows.length<25)throw new Error("Bitget candle history insufficient");return {rows,provider:"Bitget Spot"};
  }
  if(exchange==="Gate"){
    const d=await getJson("https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair="+symbol+"_USDT&interval=1m&limit=40");
    const raw=Array.isArray(d)?d:[];
    const points=raw.map(x=>({t:Number(x[0])*1000,c:Number(x[2]),h:Number(x[3]),l:Number(x[4]),v:Number(x[5])}))
      .filter(x=>[x.t,x.c,x.h,x.l,x.v].every(Number.isFinite)&&x.c>0&&x.h>=x.l&&x.l>0&&x.v>=0)
      .sort((a,b)=>a.t-b.t);
    // Gate candles do not provide an open field; derive each candle open from the previous close.
    const rows=points.slice(1).map((x,i)=>[x.t,points[i].c,x.h,x.l,x.c,x.v]);
    if(rows.length<25)throw new Error("Gate candle history insufficient");return {rows,provider:"Gate Spot"};
  }
  if(exchange==="KuCoin"){
    const d=await getJson("https://api.kucoin.com/api/v1/market/candles?type=1min&symbol="+symbol+"-USDT");
    if(String(d.code)!=="200000")throw new Error("KuCoin unavailable");
    const rows=normalizeRows(Array.isArray(d.data)?d.data.map(x=>[Number(x[0])*1000,x[1],x[3],x[4],x[2],x[6]||x[5]]):[]);
    if(rows.length<25)throw new Error("KuCoin candle history insufficient");return {rows,provider:"KuCoin Spot"};
  }
  if(exchange==="WhiteBIT"){
    const d=await getJson("https://whitebit.com/api/v1/public/kline?market="+symbol+"_USDT&interval=1m&limit=40");
    if(d?.success!==true)throw new Error(d?.message||"WhiteBIT unavailable");
    const rows=normalizeRows(Array.isArray(d.result)?d.result.map(x=>[Number(x[0])*1000,x[1],x[3],x[4],x[2],x[5]]):[]);
    if(rows.length<25)throw new Error("WhiteBIT candle history insufficient");return {rows,provider:"WhiteBIT Spot"};
  }
  throw new Error("Unsupported venue");
}
async function scanCoin(coin){
  const symbol=String(coin?.symbol||"").toUpperCase();
  if(!/^[A-Z0-9]{2,20}$/.test(symbol))return null;
  const listed=Array.isArray(coin.marketPairs)
    ?coin.marketPairs.filter(x=>String(x.quote||"").toUpperCase()==="USDT"&&Number(x.volume)>=5000&&SUPPORTED.has(String(x.exchange)))
    :Object.entries(coin.hunterVenueVolume||{}).filter(([name,volume])=>SUPPORTED.has(name)&&Number(volume)>=5000).map(([exchange,volume])=>({exchange,volume,quote:"USDT"}));
  if(Number(coin.total_volume||0)<50000||!listed.length)return null;
  const order=[...new Map(listed.sort((a,b)=>Number(b.volume)-Number(a.volume)).map(x=>[x.exchange,x])).values()].map(x=>x.exchange);
  const fallback=["Binance","OKX","Gate","KuCoin","WhiteBIT","Bitget","Bybit"].filter(name=>!order.includes(name));
  const verificationOrder=[...order,...fallback].slice(0,2);
  let market=null,corroboration=null,errors=[];
  for(const venue of verificationOrder){try{const candidate=await loadProvider(symbol,venue);if(!market)market=candidate;else corroboration=candidate;}catch(error){errors.push(venue+": "+String(error?.message||error).slice(0,80));}}
  if(!market)throw new Error(errors.join(" | ")||"No candle provider responded");
  if(!corroboration)throw new Error("تأیید دو صرافی برای "+symbol+"USDT در دسترس نیست: "+errors.join(" | "));
  const rows=market.rows,now=Date.now(),index=rows.length-2,other=corroboration.rows.slice(0,-1).at(-1),primary=rows.slice(0,-1).at(-1);
  if(!primary||!other)throw new Error("کندل بسته‌شده برای تأیید چندصرافی کافی نیست");
  const exchangeTimeDiffMs=Math.abs(primary[0]-other[0]),exchangePriceDeviationPct=primary[4]>0?Math.abs(other[4]/primary[4]-1)*100:Infinity;
  const multiExchangeConfirmed=exchangeTimeDiffMs<=90000&&exchangePriceDeviationPct<=0.4;
  if(!multiExchangeConfirmed)throw new Error("اختلاف چندصرافی خارج از حد مجاز: "+exchangeTimeDiffMs+"ms / "+exchangePriceDeviationPct.toFixed(3)+"٪");
  if(index<30)return null;
  const last=rows[index],candleAge=now-last[0],close=last[4],open=last[1],volume=last[5];
  if(candleAge<60000||candleAge>180000||close<=0||open<=0||volume<=0)return null;
  const baseline=rows.slice(index-20,index).map(x=>x[5]).filter(x=>x>0);
  if(baseline.length<16)return null;
  const avgVolume=baseline.reduce((a,b)=>a+b,0)/baseline.length;
  const volumeRatio=avgVolume>0?volume/avgVolume:0;
  const pct=(from,to)=>from>0?(to/from-1)*100:0;
  const change1m=pct(open,close);
  const change3m=pct(rows[index-2][1],close);
  const change5m=pct(rows[index-4][1],close);
  const change15m=pct(rows[index-14][1],close);
  const change30m=pct(rows[index-29][1],close);
  const dailyChange24h=Number(coin.hunterChange24h)||0;
  const directionWeight=change5m+change15m*0.8+change30m*0.35;
  const trend=directionWeight>=0?"bull":"bear",direction=trend==="bull"?1:-1;
  const changes=[change1m,change3m,change5m,change15m,change30m];
  const signs=changes.map(x=>Math.abs(x)<0.025?0:Math.sign(x));
  const alignedVotes=signs.filter(x=>x===direction).length;
  const coreAligned=Math.sign(change5m)===Math.sign(change15m)&&Math.abs(change5m)>=0.05&&Math.abs(change15m)>=0.08;
  const prior=rows.slice(index-15,index);
  const priorHigh=Math.max(...prior.map(x=>x[2])),priorLow=Math.min(...prior.map(x=>x[3]));
  const breakoutUp=close>priorHigh,breakoutDown=close<priorLow;
  const breakout=(trend==="bull"&&breakoutUp)||(trend==="bear"&&breakoutDown);
  const alignmentScore=alignedVotes/5*30;
  const momentumScore=Math.min(25,Math.abs(change5m)*7+Math.abs(change15m)*2+Math.abs(change30m)*0.5);
  const volumeScore=Math.min(15,Math.max(0,volumeRatio-1)*8);
  const breakoutScore=breakout?10:0;
  const dailyScore=dailyChange24h!==0&&Math.sign(dailyChange24h)===direction?5:0;
  const impulseScore=signs[0]===direction&&Math.abs(change1m)>=0.08?5:0;
  let score=Math.round(10+alignmentScore+momentumScore+volumeScore+breakoutScore+dailyScore+impulseScore);
  const quantum=scoreQuantumOpportunity({trend,change1m,change3m,change5m,change15m,volumeRatio,breakout,structureAligned:coreAligned,trend15:Math.sign(change15m)===direction,overextended:Math.abs(change5m)>=1.5||Math.abs(change1m)>=0.8||Math.abs(dailyChange24h)>=18,dataAgeMs:now-last[0],flowConfirmed:false,multiExchangeConfirmed,totalVolume24h:coin.total_volume});
  score=Math.round(score*0.55+quantum.score*0.45);
  if(!coreAligned)score=Math.min(score,63);
  if(volumeRatio<0.75)score=Math.min(score,60);
  const lowLiquidity=Number(coin.total_volume||0)<150000;
  if(lowLiquidity)score-=5;
  score=Math.max(0,Math.min(99,score));
  const overextended=Math.abs(change5m)>=1.5||Math.abs(change1m)>=0.8||Math.abs(dailyChange24h)>=18;
  return {
    id:String(coin.id),symbol,trend,score,quantum,scoringVersion:3,coreAligned,multiExchangeConfirmed,multiExchangeEvidence:{primary:market.provider,secondary:corroboration.provider,timeDiffMs:exchangeTimeDiffMs,priceDeviationPct:Number(exchangePriceDeviationPct.toFixed(4)),primaryPrice:primary[4],secondaryPrice:other[4],candleTime:primary[0]},
    change1m,change3m,change5m,change15m,change30m,dailyChange24h,
    dailyMover:Math.abs(dailyChange24h)>=8,lowLiquidity,volumeRatio,
    breakout,breakoutDirection:breakout?(trend==="bull"?"up":"down"):"",overextended,
    price:close,provider:market.provider,flow:null,flowSignal:"",flowAdjustment:0,
    updatedAt:now,candleTime:last[0],rows:rows.map(x=>x.slice(0,6)),serverScanned:true,
    coin:{id:String(coin.id),symbol,name:coin.name||symbol,image:coin.image||"",
      current_price:close,total_volume:Number(coin.total_volume)||0,market_cap:coin.market_cap||null,
      market_cap_rank:coin.market_cap_rank||null,hunterExchange:coin.hunterExchange||"",
      hunterPriceExchange:coin.hunterPriceExchange||"",hunterChange24h:dailyChange24h,
      hunterVenueVolume:coin.hunterVenueVolume||{},marketPairs:Array.isArray(coin.marketPairs)?coin.marketPairs:[]}
  };
}
async function mapLimit(items,limit,fn){
  let cursor=0;const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const i=cursor++;await fn(items[i],i);}});
  await Promise.all(workers);
}
async function runRadar(env,scheduledTime=Date.now()){
  if(!env.RADAR_KV)throw new Error("RADAR_KV binding is missing");
  const [state,oldSnapshot]=await Promise.all([env.RADAR_KV.get("radar:state",{type:"json"}),env.RADAR_KV.get("radar:snapshot",{type:"json"})]);
  const cacheTimestamp=Date.parse(state?.universe_cache_updated_at||state?.updated_at||"")||Number(state?.universe_cache_updated_at||state?.updated_at||0)||0;
  const cacheAge=Math.max(0,Date.now()-cacheTimestamp);
  const cachedUniverse=Array.isArray(state?.universe_cache)&&state.universe_cache.length&&cacheAge<=30*60*1000?state.universe_cache:null;
  let source=null,universeSource="live";
  try{
    const response=await getJson(MAIN_UNIVERSE,12000);
    source=Array.isArray(response.hunter_assets)&&response.hunter_assets.length?response.hunter_assets:Array.isArray(response.radar_assets)&&response.radar_assets.length?response.radar_assets:response.assets;
    if(!Array.isArray(source)||!source.length)throw new Error("Exchange universe returned no assets");
  }catch(error){
    if(!cachedUniverse)throw new Error("Live universe unavailable and no fresh cache exists: "+String(error?.message||error).slice(0,160));
    source=cachedUniverse;universeSource="cached";
  }
  const buildUniverse=items=>{
    const eligible=normalizeQuantumUniverse(items,"spot").filter(coin=>{
      const venues=Array.isArray(coin.marketPairs)?coin.marketPairs.some(x=>String(x.quote||"").toUpperCase()==="USDT"&&Number(x.volume)>=15000&&SUPPORTED.has(String(x.exchange))):
        Object.entries(coin.hunterVenueVolume||{}).some(([name,volume])=>SUPPORTED.has(name)&&Number(volume)>=15000);
      return venues&&Number(coin.total_volume||0)>=50000&&/^[A-Z0-9]{2,20}$/.test(String(coin.symbol||""));
    }).sort((a,b)=>Number(b.total_volume||0)-Number(a.total_volume||0));
    const seen=new Set();
    return eligible.filter(coin=>{
      const symbol=String(coin.symbol||"").toUpperCase();
      if(seen.has(symbol))return false;
      seen.add(symbol);return true;
    });
  };
  let universe=buildUniverse(source);
  if(!universe.length&&universeSource==="live"&&cachedUniverse){universe=buildUniverse(cachedUniverse);universeSource="cached";}
  if(!universe.length)throw new Error("No eligible USDT spot symbols; previous snapshot retained");
  const previousSignals=[...(Array.isArray(oldSnapshot?.signals)?oldSnapshot.signals:[]),...(Array.isArray(oldSnapshot?.legacy_signals)?oldSnapshot.legacy_signals:[])];
  const retentionNow=Date.now();
  const signals=new Map(previousSignals.filter(x=>Number(x?.score)>=RETENTION_SCORE&&retentionNow-Number(x?.updatedAt||0)<=5*60*1000).map(x=>[String(x.id),x]));
  const start=Math.max(0,Number(state?.cursor)||0)%universe.length;
  const byId=new Map(universe.map(coin=>[String(coin.id),coin]));
  const bySymbol=new Map(universe.map(coin=>[String(coin.symbol).toUpperCase(),coin]));
  const prioritySignals=[...signals.values()]
    .filter(x=>Number(x?.scoringVersion)===3&&Number(x?.score)>=RETENTION_SCORE)
    .sort((a,b)=>Number(b.score)-Number(a.score)||Number(a.updatedAt||0)-Number(b.updatedAt||0));
  const priorityCoins=[],prioritySymbols=new Set();
  for(const signal of prioritySignals){
    const symbol=String(signal.symbol||signal.coin?.symbol||"").toUpperCase();
    const coin=byId.get(String(signal.id))||bySymbol.get(symbol);
    if(!coin||!symbol||prioritySymbols.has(symbol))continue;
    priorityCoins.push(coin);prioritySymbols.add(symbol);
    if(priorityCoins.length>=4)break;
  }
  // Recheck the strongest live candidates every minute, while the rotating tail discovers new movers.
  const rotationTarget=Math.max(0,Math.min(BATCH_SIZE,universe.length)-priorityCoins.length);
  const rotatingCoins=[],rotatingSymbols=new Set(prioritySymbols);
  let cursor=start,inspected=0;
  while(rotatingCoins.length<rotationTarget&&inspected<universe.length){
    const coin=universe[cursor],symbol=String(coin.symbol||"").toUpperCase();
    cursor=(cursor+1)%universe.length;inspected++;
    if(!symbol||rotatingSymbols.has(symbol))continue;
    rotatingCoins.push(coin);rotatingSymbols.add(symbol);
  }
  const batch=[...priorityCoins,...rotatingCoins];
  let completed=0,failed=0,valid=0,removed=0,failedSamples=[],scannedSignals=[],removedSignals={...(state?.removed_signals||{})};
  const tombstoneCutoff=Date.now()-24*60*60*1000;
  for(const [id,item] of Object.entries(removedSignals)){if(Number(item?.removedAt||0)<tombstoneCutoff)delete removedSignals[id];}
  await mapLimit(batch,CONCURRENCY,async coin=>{
    try{const signal=await scanCoin(coin);if(signal){valid++;scannedSignals.push(signal);}}
    catch(error){failed++;if(failedSamples.length<8)failedSamples.push({symbol:String(coin.symbol||""),error:String(error?.message||error).slice(0,220)});}
    finally{completed++;}
  });
  // Validate the strongest fresh candidates with real executed trades, not candle volume alone.
  const flowCandidates=[...scannedSignals.filter(x=>x.trend==="bull"&&x.coreAligned&&!x.lowLiquidity&&x.multiExchangeConfirmed&&Number(x.score)>=48).sort((a,b)=>b.score-a.score).slice(0,2),...scannedSignals.filter(x=>x.trend==="bear"&&x.coreAligned&&!x.lowLiquidity&&x.multiExchangeConfirmed&&Number(x.score)>=48).sort((a,b)=>b.score-a.score).slice(0,2)];
  await mapLimit(flowCandidates,2,async signal=>{
    try{
      const flow=await getJson(MAIN_FLOW+"?symbol="+encodeURIComponent(signal.symbol)+"&window=5",8500);
      signal.flow={buy5m:Number(flow.buy5m)||0,sell5m:Number(flow.sell5m)||0,net5m:Number(flow.net5m)||0,
        tradeCount:Number(flow.trade_count)||0,provider:flow.provider||"",complete:flow.complete===true,rows:Array.isArray(flow.rows)?flow.rows:[]};
      signal.flowSignal=signal.flow.net5m>0?"inflow":signal.flow.net5m<0?"outflow":"";
      const total=signal.flow.buy5m+signal.flow.sell5m;
      if(signal.flow.complete&&signal.flow.tradeCount>=10&&total>0){
        const buyPressure=signal.flow.buy5m/total;
        const aligned=signal.trend==="bull"?buyPressure>=0.56:buyPressure<=0.44;
        const opposed=signal.trend==="bull"?buyPressure<=0.44:buyPressure>=0.56;
        signal.flowAdjustment=aligned?8:opposed?-10:0;
        signal.flowPressure=Number((buyPressure*100).toFixed(1));
      }
    }catch(error){signal.flowError=String(error?.message||error).slice(0,120);}
  });
  // Re-score each candidate with the shared Quantum Intelligence core.
  for(const signal of scannedSignals){
    const flow=signal.flow||{},gross=Number(flow.buy5m||0)+Number(flow.sell5m||0),imbalance=gross>0?(Number(flow.buy5m||0)-Number(flow.sell5m||0))/gross:0;
    signal.flowConfirmed=flow.complete===true&&Number(flow.tradeCount)>=10&&(signal.trend==="bull"?imbalance>=0.045:imbalance<=-0.045);
    signal.quantum=scoreQuantumOpportunity({...signal,flowImbalance:imbalance,flowConfirmed:signal.flowConfirmed,multiExchangeConfirmed:signal.multiExchangeConfirmed,volumeRatio:signal.volumeRatio,dataAgeMs:Date.now()-Number(signal.candleTime||Date.now())});
    signal.score=Math.round(Number(signal.score||0)*0.55+signal.quantum.score*0.45);
  }
  // Only fresh Quantum scores are published. Legacy signals remain stored until their own valid rescan.
  for(const signal of scannedSignals){
    signal.score=Math.max(0,Math.min(99,Number(signal.score)+Number(signal.flowAdjustment||0)));
    if(!signal.coreAligned)signal.score=Math.min(signal.score,63);
    // A below-average candle volume is accepted only when executed trades independently confirm direction.
    const flow=signal.flow||{};
    signal.volumeConfirmed=Number(signal.volumeRatio)>=1.1;
    if(!signal.volumeConfirmed)signal.score=Math.min(signal.score,RETENTION_SCORE-1);
    if(!signal.flowConfirmed||!signal.multiExchangeConfirmed||!signal.quantum?.qualityGate||Number(signal.flowAdjustment)<0)signal.score=Math.min(signal.score,RETENTION_SCORE-1);
    if(signal.score>=RETENTION_SCORE){
      signals.set(signal.id,signal);
      delete removedSignals[signal.id];
    }else if(signals.delete(signal.id)){
      removed++;
      removedSignals[signal.id]={symbol:signal.symbol,score:signal.score,scannedAt:signal.updatedAt,removedAt:Date.now(),reason:"below_retention_threshold"};
    }
  }
  const nextCursor=cursor;
  const snapshot={
    status:"online",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,source:"Cloudflare scheduled radar",scoring_version:3,retention_score:RETENTION_SCORE,
    universe_source:universeSource,universe_cache_age_ms:universeSource==="cached"?cacheAge:0,
    scanned_at:new Date().toISOString(),scheduled_at:new Date(Number(scheduledTime)||Date.now()).toISOString(),
    universe_count:universe.length,scanned_count:completed,valid_count:valid,failed_count:failed,failed_samples:failedSamples,
    removed_count:removed,removed_signals:removedSignals,batch_size:BATCH_SIZE,priority_scanned_count:priorityCoins.length,next_cursor:nextCursor,
    signals:(()=>{
      const canonicalIds=new Map(universe.map(coin=>[String(coin.symbol).toUpperCase(),String(coin.id)]));
      const unique=new Map();
      for(const signal of [...signals.values()].filter(x=>Number(x?.score)>=RETENTION_SCORE&&Number(x?.scoringVersion)===3&&Date.now()-Number(x?.updatedAt||0)<=5*60*1000&&x.multiExchangeConfirmed===true&&x.flowConfirmed===true&&x.volumeConfirmed===true&&x.quantum?.qualityGate===true).sort((a,b)=>b.score-a.score)){
        const symbol=String(signal.symbol||signal.coin?.symbol||"").toUpperCase();
        if(!symbol||canonicalIds.get(symbol)!==String(signal.id)||unique.has(symbol))continue;
        unique.set(symbol,signal);
      }
      return [...unique.values()];
    })(),
    legacy_signals:[...signals.values()].filter(x=>Number(x?.scoringVersion)!==3)
       .sort((a,b)=>b.score-a.score)
  };
  // Persist the public snapshot first; advance the cursor only after it is safely stored.
  await env.RADAR_KV.put("radar:snapshot",JSON.stringify(snapshot));
  const universeCache=universe.map(coin=>({id:coin.id,symbol:coin.symbol,name:coin.name||"",image:coin.image||"",
    total_volume:Number(coin.total_volume)||0,market_cap:coin.market_cap||null,market_cap_rank:coin.market_cap_rank||null,
    hunterExchange:coin.hunterExchange||"",hunterPriceExchange:coin.hunterPriceExchange||"",
    hunterChange24h:Number(coin.hunterChange24h)||0,hunterVenueVolume:coin.hunterVenueVolume||{},
    marketPairs:Array.isArray(coin.marketPairs)?coin.marketPairs:[]}));
  await env.RADAR_KV.put("radar:state",JSON.stringify({
    cursor:nextCursor,updated_at:snapshot.scanned_at,universe_count:universe.length,removed_signals:removedSignals,
    universe_cache:universeCache,
    universe_cache_updated_at:universeSource==="live"?snapshot.scanned_at:Number(state?.universe_cache_updated_at||state?.updated_at||snapshot.scanned_at)
  }));
  return snapshot;
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==="OPTIONS")return json({},204);
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    if(url.pathname==="/health")return json({worker:"online",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,scheduled_scan:"every minute",kv:!!env.RADAR_KV,checked_at:new Date().toISOString()});
    if(url.pathname==="/fast-radar-snapshot"||url.pathname==="/snapshot"){
      if(!env.RADAR_KV)return json({status:"not_configured",signals:[]},503);
      const snapshot=await env.RADAR_KV.get("radar:snapshot",{type:"json"});
      return json(snapshot||{status:"warming_up",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,signals:[],message:"اولین اسکن زمان‌بندی‌شده هنوز کامل نشده است."});
    }
    return json({error:"Not found"},404);
  },
  async scheduled(controller,env){await runRadar(env,controller.scheduledTime);}
};