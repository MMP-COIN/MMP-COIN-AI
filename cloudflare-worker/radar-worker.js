import { QUANTUM_ENGINE_NAME, QUANTUM_ENGINE_VERSION, normalizeQuantumUniverse, scoreQuantumOpportunity, calculateQuantumIndicators } from "./quantum-core.js";
const MAIN_UNIVERSE = "https://mmp-coin-ai-analyzer.mehrdadmohammadi1988.workers.dev/hunter-universe";
const MAIN_FLOW = "https://mmp-coin-ai-analyzer.mehrdadmohammadi1988.workers.dev/market-flow";
const RETENTION_SCORE = 64;
const BATCH_SIZE = 18;
const CONCURRENCY = 4;
const SUPPORTED = new Set(["Binance","Bybit","OKX","Bitget","Gate","KuCoin","WhiteBIT","MEXC"]);
const JSON_HEADERS = { "Accept":"application/json", "User-Agent":"MMP-COIN-AI-RADAR/1.0" };
async function getJson(url, timeoutMs = 6500) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url,{headers:JSON_HEADERS,signal:controller.signal});
      if (!response.ok) {
        const error = new Error("HTTP "+response.status);
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Math.min(900,Math.max(250,Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:350));
          await new Promise(resolve => setTimeout(resolve,delay));
          lastError = error;
          continue;
        }
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === 0 && /fetch failed|network|timeout|aborted/i.test(String(error?.message||error))) {
        await new Promise(resolve => setTimeout(resolve,250));
        continue;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  throw lastError || new Error("Market data request failed");
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
      try{const rows=normalizeRows(await getJson(host+"/api/v3/klines?symbol="+pair+"&interval=1m&limit=80"));if(rows.length>=25)return {rows,provider:"Binance Spot"};throw new Error("کمبود کندل");}
      catch(error){lastError=error;}
    }
    throw lastError||new Error("Binance unavailable");
  }
  if(exchange==="Bybit"){
    const d=await getJson("https://api.bybit.com/v5/market/kline?category=spot&symbol="+pair+"&interval=1&limit=80");
    if(String(d.retCode)!=="0")throw new Error(d.retMsg||"Bybit unavailable");
    const rows=normalizeRows(d.result?.list);if(rows.length<55)throw new Error("Bybit candle history insufficient");return {rows,provider:"Bybit Spot"};
  }
  if(exchange==="OKX"){
    const d=await getJson("https://www.okx.com/api/v5/market/candles?instId="+symbol+"-USDT&bar=1m&limit=80");
    if(String(d.code)!=="0")throw new Error(d.msg||"OKX unavailable");
    const rows=normalizeRows(d.data);if(rows.length<55)throw new Error("OKX candle history insufficient");return {rows,provider:"OKX Spot"};
  }
  if(exchange==="Bitget"){
    const d=await getJson("https://api.bitget.com/api/v3/market/candles?category=SPOT&symbol="+pair+"&interval=1m&limit=80");
    if(!["00000","0"].includes(String(d.code)))throw new Error(d.msg||"Bitget unavailable");
    const rows=normalizeRows(d.data);if(rows.length<55)throw new Error("Bitget candle history insufficient");return {rows,provider:"Bitget Spot"};
  }
  if(exchange==="Gate"){
    const d=await getJson("https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair="+symbol+"_USDT&interval=1m&limit=80");
    const raw=Array.isArray(d)?d:[];
    // Gate Spot rows are [timestamp, volume, close, high, low, open].
    const rows=raw.map(x=>[Number(x[0])*1000,Number(x[5]),Number(x[3]),Number(x[4]),Number(x[2]),Number(x[1])])
      .filter(x=>x.every(Number.isFinite)&&x[1]>0&&x[2]>=x[3]&&x[3]>0&&x[4]>0&&x[5]>=0)
      .sort((a,b)=>a[0]-b[0]);
    if(rows.length<55)throw new Error("Gate candle history insufficient");return {rows,provider:"Gate Spot"};
  }
  if(exchange==="MEXC"){
    const d=await getJson("https://api.mexc.com/api/v3/klines?symbol="+pair+"&interval=1m&limit=80");
    const rows=normalizeRows(d);if(rows.length<55)throw new Error("MEXC Spot candle history insufficient");return {rows,provider:"MEXC Spot"};
  }
  if(exchange==="KuCoin"){
    const d=await getJson("https://api.kucoin.com/api/v1/market/candles?type=1min&symbol="+symbol+"-USDT");
    if(String(d.code)!=="200000")throw new Error("KuCoin unavailable");
    const rows=normalizeRows(Array.isArray(d.data)?d.data.map(x=>[Number(x[0])*1000,x[1],x[3],x[4],x[2],x[6]||x[5]]):[]);
    if(rows.length<55)throw new Error("KuCoin candle history insufficient");return {rows,provider:"KuCoin Spot"};
  }
  if(exchange==="WhiteBIT"){
    const d=await getJson("https://whitebit.com/api/v1/public/kline?market="+symbol+"_USDT&interval=1m&limit=80");
    if(d?.success!==true)throw new Error(d?.message||"WhiteBIT unavailable");
    const rows=normalizeRows(Array.isArray(d.result)?d.result.map(x=>[Number(x[0])*1000,x[1],x[3],x[4],x[2],x[5]]):[]);
    if(rows.length<55)throw new Error("WhiteBIT candle history insufficient");return {rows,provider:"WhiteBIT Spot"};
  }
  throw new Error("Unsupported venue");
}
async function scanCoin(coin){
  const symbol=String(coin?.symbol||"").toUpperCase();
  if(!/^[A-Z0-9]{2,20}$/.test(symbol))return null;
  const listed=Array.isArray(coin.marketPairs)
    ?coin.marketPairs.filter(x=>String(x.quote||"").toUpperCase()==="USDT"&&SUPPORTED.has(String(x.exchange)))
    :Object.entries(coin.hunterVenueVolume||{}).filter(([name])=>SUPPORTED.has(name)).map(([exchange,volume])=>({exchange,volume,quote:"USDT"}));
  if(!listed.length)return null;
  const order=[...new Map(listed.sort((a,b)=>Number(b.volume)-Number(a.volume)).map(x=>[x.exchange,x])).values()].map(x=>x.exchange);
  const fallback=["OKX","Gate","MEXC","KuCoin","WhiteBIT","Binance","Bitget","Bybit"].filter(name=>!order.includes(name));
  const verificationOrder=[...new Set([...order,...fallback])].slice(0,6);
  let market=null,corroboration=null,errors=[];
  for(const venue of verificationOrder){if(corroboration)break;try{const candidate=await loadProvider(symbol,venue);if(!market)market=candidate;else corroboration=candidate;}catch(error){errors.push(venue+": "+String(error?.message||error).slice(0,80));}}
  if(!market)throw new Error(errors.join(" | ")||"No candle provider responded");
  if(!corroboration)throw new Error("تأیید دو صرافی برای "+symbol+"USDT در دسترس نیست: "+errors.join(" | "));
  const rows=market.rows,now=Date.now(),primaryClosed=rows.slice(0,-1),secondaryClosed=corroboration.rows.slice(0,-1);
  const secondaryByTime=new Map(secondaryClosed.map(candle=>[candle[0],candle]));
  let index=-1,primary=null,other=null;
  for(let i=primaryClosed.length-1;i>=0;i--){const match=secondaryByTime.get(primaryClosed[i][0]);if(match){index=i;primary=primaryClosed[i];other=match;break;}}
  if(!primary||!other)throw new Error("کندل بسته‌شده مشترک برای تأیید چندصرافی پیدا نشد");
  const exchangeTimeDiffMs=Math.abs(primary[0]-other[0]),exchangePriceDeviationPct=primary[4]>0?Math.abs(other[4]/primary[4]-1)*100:Infinity;
  const multiExchangeConfirmed=exchangeTimeDiffMs===0&&exchangePriceDeviationPct<=0.4;
  // A real price disagreement is a quality rejection, not an upstream transport failure.
  if(!multiExchangeConfirmed)return null;
  if(index<54)return null;
  const last=rows[index],candleAge=now-last[0],close=last[4],open=last[1],volume=last[5];
  if(candleAge<60000||candleAge>180000||close<=0||open<=0||volume<=0)return null;
   const indicators=calculateQuantumIndicators(rows.slice(0,index+1));
   if(!indicators.available)return null;
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
  const technicalAligned=trend==="bull"?(indicators.trendUp&&indicators.rsi14>=50&&indicators.rsi14<=78):(indicators.trendDown&&indicators.rsi14>=22&&indicators.rsi14<=50);
   const quantum=scoreQuantumOpportunity({trend,change1m,change3m,change5m,change15m,volumeRatio,breakout,structureAligned:coreAligned&&technicalAligned,trend15:Math.sign(change15m)===direction,rsi14:indicators.rsi14,ema9:indicators.ema9,ema21:indicators.ema21,ema50:indicators.ema50,macdHistogram:indicators.macdHistogram,atrPct:indicators.atrPct,overextended:Math.abs(change5m)>=1.5||Math.abs(change1m)>=0.8||Math.abs(dailyChange24h)>=18,dataAgeMs:now-last[0],flowConfirmed:false,multiExchangeConfirmed,totalVolume24h:coin.total_volume});
  score=Math.round(score*0.55+quantum.score*0.45);
  if(!coreAligned)score=Math.min(score,63);
  if(volumeRatio<0.75)score=Math.min(score,60);
  const lowLiquidity=Number(coin.total_volume||0)<150000;
  if(lowLiquidity)score-=5;
  score=Math.max(0,Math.min(99,score));
  const overextended=Math.abs(change5m)>=1.5||Math.abs(change1m)>=0.8||Math.abs(dailyChange24h)>=18;
  return {
    id:String(coin.id),symbol,trend,score,quantum,scoringVersion:5,coreAligned,technicalAligned,indicators:{rsi14:indicators.rsi14,ema9:indicators.ema9,ema21:indicators.ema21,ema50:indicators.ema50,macdHistogram:indicators.macdHistogram,atrPct:indicators.atrPct},multiExchangeConfirmed,multiExchangeEvidence:{primary:market.provider,secondary:corroboration.provider,timeDiffMs:exchangeTimeDiffMs,priceDeviationPct:Number(exchangePriceDeviationPct.toFixed(4)),primaryPrice:primary[4],secondaryPrice:other[4],candleTime:primary[0]},
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
      const venues=Array.isArray(coin.marketPairs)?coin.marketPairs.some(x=>String(x.quote||"").toUpperCase()==="USDT"&&SUPPORTED.has(String(x.exchange))):
        Object.keys(coin.hunterVenueVolume||{}).some(name=>SUPPORTED.has(name));
      return venues&&/^[A-Z0-9]{2,20}$/.test(String(coin.symbol||""));
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
  const expiredSignals=previousSignals.filter(x=>retentionNow-Number(x?.updatedAt||0)>5*60*1000);
  const signals=new Map(previousSignals.filter(x=>Number(x?.score)>=RETENTION_SCORE&&retentionNow-Number(x?.updatedAt||0)<=5*60*1000).map(x=>[String(x.id),x]));
  const start=Math.max(0,Number(state?.cursor)||0)%universe.length;
  const byId=new Map(universe.map(coin=>[String(coin.id),coin]));
  const bySymbol=new Map(universe.map(coin=>[String(coin.symbol).toUpperCase(),coin]));
  const prioritySignals=[...signals.values()]
    .filter(x=>Number(x?.scoringVersion)===5&&Number(x?.score)>=RETENTION_SCORE)
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
  for(const signal of expiredSignals){const id=String(signal.id||"");if(id)removedSignals[id]={symbol:signal.symbol||signal.coin?.symbol||"",score:Number(signal.score)||0,scannedAt:Number(signal.updatedAt)||null,removedAt:retentionNow,reason:"signal_expired_stale"};}
  const tombstoneCutoff=Date.now()-24*60*60*1000;
  for(const [id,item] of Object.entries(removedSignals)){if(Number(item?.removedAt||0)<tombstoneCutoff)delete removedSignals[id];}
  await mapLimit(batch,CONCURRENCY,async coin=>{
    try{const signal=await scanCoin(coin);if(signal){valid++;scannedSignals.push(signal);}}
    catch(error){failed++;if(failedSamples.length<8)failedSamples.push({symbol:String(coin.symbol||""),error:String(error?.message||error).slice(0,220)});}
    finally{completed++;}
  });
  // Validate the strongest fresh candidates with real executed trades, not candle volume alone.
  // Check early, multi-exchange candidates for executed flow before full 15m alignment.
  // These remain watch-only until the unchanged final quality gate passes.
  const flowEligible=x=>x.multiExchangeConfirmed&&Math.abs(Number(x.change5m)||0)<2.5&&Math.abs(Number(x.change1m)||0)<1.2&&Number(x.coin?.total_volume||0)>=75000&&Number(x.volumeRatio)>=0.9&&Number(x.score)>=42;
  const flowCandidates=[...scannedSignals.filter(x=>x.trend==="bull"&&flowEligible(x)).sort((a,b)=>b.score-a.score).slice(0,2),...scannedSignals.filter(x=>x.trend==="bear"&&flowEligible(x)).sort((a,b)=>b.score-a.score).slice(0,2)];
  const flowCheckedSymbols=new Set(flowCandidates.map(signal=>String(signal.symbol).toUpperCase()));
  for(const signal of scannedSignals)signal.flowStatus=flowCheckedSymbols.has(String(signal.symbol).toUpperCase())?"checking_flow":"queued_for_flow_review";
  await mapLimit(flowCandidates,2,async signal=>{
    signal.flowStatus="checking_flow";
    try{
      let flow=await getJson(MAIN_FLOW+"?symbol="+encodeURIComponent(signal.symbol)+"&window=5",8500);
      if(flow.complete!==true){const shorter=await getJson(MAIN_FLOW+"?symbol="+encodeURIComponent(signal.symbol)+"&window=1",8500);if(shorter.complete===true&&Number(shorter.trade_count)>=10)flow=shorter;}
      signal.flow={buy5m:Number(flow.buy5m)||0,sell5m:Number(flow.sell5m)||0,net5m:Number(flow.net5m)||0,
        windowMinutes:Number(flow.window_minutes)||5,tradeCount:Number(flow.trade_count)||0,provider:flow.provider||"",complete:flow.complete===true,rows:Array.isArray(flow.rows)?flow.rows:[]};
      signal.flowSignal=signal.flow.net5m>0?"inflow":signal.flow.net5m<0?"outflow":"";
      const total=signal.flow.buy5m+signal.flow.sell5m;
      if(signal.flow.complete&&signal.flow.tradeCount>=10&&total>0){
        const buyPressure=signal.flow.buy5m/total;
        const aligned=signal.trend==="bull"?buyPressure>=0.56:buyPressure<=0.44;
        const opposed=signal.trend==="bull"?buyPressure<=0.44:buyPressure>=0.56;
        signal.flowAdjustment=aligned?8:opposed?-10:0;
        signal.flowPressure=Number((buyPressure*100).toFixed(1));
      }
      signal.flowStatus=signal.flow.complete&&signal.flow.tradeCount>=10?"flow_received":"flow_incomplete";
    }catch(error){signal.flowStatus="flow_error";signal.flowError=String(error?.message||error).slice(0,120);}
  });
  // Re-score each candidate with the shared Quantum Intelligence core.
  for(const signal of scannedSignals){
    const flow=signal.flow||{},gross=Number(flow.buy5m||0)+Number(flow.sell5m||0),imbalance=gross>0?(Number(flow.buy5m||0)-Number(flow.sell5m||0))/gross:0;
    signal.flowConfirmed=flow.complete===true&&Number(flow.tradeCount)>=10&&(signal.trend==="bull"?imbalance>=0.045:imbalance<=-0.045);
    if(signal.flowConfirmed)signal.flowStatus="flow_confirmed";else if(signal.flowStatus==="flow_received")signal.flowStatus="flow_not_aligned";
    const qBars=Array.isArray(signal.rows)?signal.rows.slice(-70):[],qRanges=qBars.slice(1).map((bar,i)=>Math.max(Number(bar[2])-Number(bar[3]),Math.abs(Number(bar[2])-Number(qBars[i][4])),Math.abs(Number(bar[3])-Number(qBars[i][4])))).filter(v=>Number.isFinite(v)&&v>0),qAtr=qRanges.length?qRanges.slice(-14).reduce((a,b)=>a+b,0)/Math.min(14,qRanges.length):0,qEntry=Number(signal.price),qAtrPct=qEntry>0?qAtr/qEntry*100:null,qStopPct=qEntry>0?Math.max(qAtr*1.25,qEntry*.002)/qEntry*100:null,qSmartMoneyScore=Math.max(0,Math.min(100,50+Math.sign(imbalance)*(signal.trend==="bull"?1:-1)*Math.min(25,Math.abs(imbalance)*100)+Math.min(15,Math.log2(Math.max(1,Number(flow.tradeCount)||1))*3))),qExplosionScore=Math.max(0,Math.min(100,Math.max(0,Number(signal.volumeRatio)-1)*28+Math.abs(imbalance)*45+Math.min(25,Math.log2(Math.max(1,Number(flow.tradeCount)||1))*5)));
    signal.quantum=scoreQuantumOpportunity({...signal,flowImbalance:imbalance,flowConfirmed:signal.flowConfirmed,multiExchangeConfirmed:signal.multiExchangeConfirmed,volumeRatio:signal.volumeRatio,structureAligned:signal.coreAligned===true&&signal.technicalAligned===true,trend15:Math.sign(Number(signal.change15m)||0)===(signal.trend==="bull"?1:-1),rsi14:signal.indicators?.rsi14,ema9:signal.indicators?.ema9,ema21:signal.indicators?.ema21,ema50:signal.indicators?.ema50,macdHistogram:signal.indicators?.macdHistogram,totalVolume24h:Number(signal.coin?.total_volume)||0,atrPct:qAtrPct,explosionScore:qExplosionScore,smartMoneyScore:qSmartMoneyScore,smartMoneyConfirmed:signal.flowConfirmed,riskRewardRatio:2.2,stopDistancePct:qStopPct,dataAgeMs:Date.now()-Number(signal.candleTime||Date.now())});
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
  const sameUniverse=Number(state?.universe_count)===universe.length;
  const previousCycleScanned=sameUniverse?Math.max(0,Number(state?.cycle_scanned_count??start)||0):start;
  const cycleAdvance=previousCycleScanned+inspected;
  const completedCycles=Math.floor(cycleAdvance/universe.length);
  const cycleScannedCount=cycleAdvance%universe.length;
  const cycleNumber=(sameUniverse?Math.max(1,Number(state?.cycle_number)||1):1)+completedCycles;
  const cyclePercent=Math.min(100,Math.floor(cycleScannedCount/universe.length*100));
  const candidateDetails=scannedSignals.map(signal=>({id:String(signal.id),symbol:signal.symbol,trend:signal.trend,score:Number(signal.score)||0,price:Number(signal.price)||0,change1m:Number(signal.change1m)||0,change3m:Number(signal.change3m)||0,change5m:Number(signal.change5m)||0,volumeRatio:Number(signal.volumeRatio)||0,provider:signal.provider||"",multiExchangeConfirmed:signal.multiExchangeConfirmed===true,flowStatus:signal.flowStatus||"queued_for_flow_review",flowTradeCount:Number(signal.flow?.tradeCount)||0,flowComplete:signal.flow?.complete===true,flowConfirmed:signal.flowConfirmed===true,flowPressure:Number.isFinite(Number(signal.flowPressure))?Number(signal.flowPressure):null,flowProvider:signal.flow?.provider||"",flowError:signal.flowError||"",flowBuyUSDT:Number(signal.flow?.buy5m)||0,flowSellUSDT:Number(signal.flow?.sell5m)||0,coreAligned:signal.coreAligned===true,missingEvidence:signal.quantum?.missingEvidence||[],volumeConfirmed:signal.volumeConfirmed===true,depthConfirmed:signal.depth?.confirmed===true,qualityGate:signal.quantum?.qualityGate===true,updatedAt:Number(signal.updatedAt)||Date.now(),coin:signal.coin||null}));
  const flowConfirmedCount=scannedSignals.filter(signal=>signal.flowConfirmed===true).length;
  const qualityPassCount=scannedSignals.filter(signal=>signal.flowConfirmed===true&&signal.volumeConfirmed===true&&signal.quantum?.qualityGate===true&&Number(signal.score)>=RETENTION_SCORE).length;
  const snapshot={
    status:"online",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,source:"Cloudflare scheduled radar",scoring_version:5,retention_score:RETENTION_SCORE,
    universe_source:universeSource,universe_cache_age_ms:universeSource==="cached"?cacheAge:0,
    scanned_at:new Date().toISOString(),scheduled_at:new Date(Number(scheduledTime)||Date.now()).toISOString(),
    universe_count:universe.length,cycle_scanned_count:cycleScannedCount,cycle_total:universe.length,cycle_percent:cyclePercent,cycle_number:cycleNumber,scanned_count:completed,valid_count:valid,flow_checked_count:flowCandidates.length,flow_confirmed_count:flowConfirmedCount,quality_pass_count:qualityPassCount,candidate_details:candidateDetails,failed_count:failed,failed_samples:failedSamples,
    removed_count:removed,removed_signals:removedSignals,batch_size:BATCH_SIZE,priority_scanned_count:priorityCoins.length,next_cursor:nextCursor,
    signals:(()=>{
      const canonicalIds=new Map(universe.map(coin=>[String(coin.symbol).toUpperCase(),String(coin.id)]));
      const unique=new Map();
      for(const signal of [...signals.values()].filter(x=>Number(x?.score)>=RETENTION_SCORE&&Number(x?.scoringVersion)===5&&Date.now()-Number(x?.updatedAt||0)<=5*60*1000&&x.multiExchangeConfirmed===true&&x.flowConfirmed===true&&x.volumeConfirmed===true&&x.quantum?.qualityGate===true).sort((a,b)=>b.score-a.score)){
        const symbol=String(signal.symbol||signal.coin?.symbol||"").toUpperCase();
        if(!symbol||canonicalIds.get(symbol)!==String(signal.id)||unique.has(symbol))continue;
        unique.set(symbol,signal);
      }
      return [...unique.values()];
    })(),
    legacy_signals:[...signals.values()].filter(x=>Number(x?.scoringVersion)!==5)
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
    cursor:nextCursor,cycle_scanned_count:cycleScannedCount,cycle_number:cycleNumber,updated_at:snapshot.scanned_at,universe_count:universe.length,removed_signals:removedSignals,
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