const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
// Canonical exchange symbols for selected assets (CoinGecko ID -> ticker).
const ASSET_SYMBOL_OVERRIDES = { layerzero: "ZRO" };
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{...CORS,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
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
 return {price:last.c,change_pct:(last.c/closes[closes.length-2]-1)*100,rsi:rsi(closes),ema20:e20,ema50:e50,ema200:e200,ema_trend:e20&&e50&&e200?(last.c>e20&&e20>e50&&e50>e200?"bullish":last.c<e20&&e20<e50&&e50<e200?"bearish":"mixed"):"insufficient",macd,macd_signal:macd==null||signal==null?"insufficient":macd>signal?"bullish crossover bias":macd<signal?"bearish crossover bias":"neutral",atr,atr_percent:atr?atr/last.c*100:null,support,resistance,volume_ratio:mean(vols.slice(-5))/(mean(vols.slice(-25))||1),taker_buy_volume_ratio:totalBase?takerBuyBase/totalBase:null,candle_time:new Date(last.t).toISOString()};
}
async function candles(symbol,interval,env,marketType="spot"){
 const headers={"Accept":"application/json"};
 const spotUrls=[
  "https://api.binance.com/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",
  "https://api.binance.us/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",
  "https://data-api.binance.vision/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250"
 ];
 if(marketType==="futures"){
  let primaryError=null;
  try{
   const r=await fetch("https://fapi.binance.com/fapi/v1/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",{headers});
   if(!r.ok)throw new Error("Binance Futures HTTP "+r.status);
   const rows=await r.json();
   if(!Array.isArray(rows)||rows.length<80)throw new Error("Binance Futures candle history is insufficient");
   const result=analyzeKlines(rows);result.data_provider="Binance Futures";return result;
  }catch(e){primaryError=e;}
  const bybitInterval={"15m":"15","1h":"60","4h":"240","1d":"D"}[interval];
  const url="https://api.bybit.com/v5/market/kline?category=linear&symbol="+encodeURIComponent(symbol)+"&interval="+bybitInterval+"&limit=250";
  const r=await fetch(url,{headers});
  if(!r.ok)throw new Error("Futures data unavailable: Binance and Bybit HTTP "+r.status);
  const payload=await r.json();
  const list=payload?.retCode===0?payload.result?.list:null;
  if(!Array.isArray(list)||list.length<80)throw new Error("Futures data unavailable for "+symbol+"; Binance: "+primaryError.message+"; Bybit: "+(payload?.retMsg||"insufficient candle history"));
  const rows=list.slice().reverse().map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]);
  const result=analyzeKlines(rows);result.data_provider="Bybit Linear Perpetual (fallback)";return result;
 }
 let lastError=null;
 for(const url of spotUrls){
  try{
   const r=await fetch(url,{headers});
   if(!r.ok){lastError=new Error("HTTP "+r.status);continue;}
   const rows=await r.json();
   if(!Array.isArray(rows)||rows.length<80){lastError=new Error("insufficient candle history");continue;}
   const result=analyzeKlines(rows);result.data_provider=url.includes("binance.us")?"Binance.US":url.includes("data-api")?"Binance Data API":"Binance Spot";return result;
  }catch(e){lastError=e;}
 }
 // Final spot fallback: Bybit public spot candles, useful for assets whose
 // Binance spot pair is unavailable or temporarily inaccessible.
 try{
  const bybitInterval={"15m":"15","1h":"60","4h":"240","1d":"D"}[interval];
  const url="https://api.bybit.com/v5/market/kline?category=spot&symbol="+encodeURIComponent(symbol)+"&interval="+bybitInterval+"&limit=250";
  const r=await fetch(url,{headers});
  if(!r.ok)throw new Error("Bybit Spot HTTP "+r.status);
  const payload=await r.json();
  const list=payload?.retCode===0?payload.result?.list:null;
  if(!Array.isArray(list)||list.length<80)throw new Error(payload?.retMsg||"insufficient Bybit spot candle history");
  const rows=list.slice().reverse().map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]);
  const result=analyzeKlines(rows);result.data_provider="Bybit Spot (fallback)";return result;
 }catch(bybitError){
  // Last-resort public spot fallback: OKX. This keeps analysis independent
  // from the chart widget and avoids failing when Binance/Bybit return 403.
  try{
   const okxBar={"15m":"15m","1h":"1H","4h":"4H","1d":"1Dutc"}[interval];
   const instId=symbol.replace(/USDT$/,"-USDT");
   const url="https://www.okx.com/api/v5/market/candles?instId="+encodeURIComponent(instId)+"&bar="+okxBar+"&limit=250";
   const r=await fetch(url,{headers});
   if(!r.ok)throw new Error("OKX Spot HTTP "+r.status);
   const payload=await r.json();
   const list=payload?.code==="0"?payload.data:null;
   if(!Array.isArray(list)||list.length<80)throw new Error(payload?.msg||"insufficient OKX spot candle history");
   const rows=list.slice().reverse().map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]);
   const result=analyzeKlines(rows);result.data_provider="OKX Spot (fallback)";return result;
  }catch(okxError){
   throw new Error("Spot data unavailable for "+symbol+" "+interval+"; Binance: "+(lastError?.message||"all providers failed")+"; Bybit: "+(bybitError?.message||"fallback failed")+"; OKX: "+(okxError?.message||"fallback failed"));
  }
 }
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

function validSymbol(s){return /^[A-Z0-9]{2,20}$/.test(s||"")&&!s.includes("USDTUSDT")}

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
 if(request.method==="OPTIONS")return new Response(null,{headers:CORS});
 if(request.method==="GET"&&new URL(request.url).pathname==="/health"){
  const probe=async(url)=>{try{const r=await fetch(url,{headers:{"Accept":"application/json"}});return {ok:r.ok,status:r.status};}catch(e){return {ok:false,error:e.message||"network error"};}};
  const [spot,futures,bybit]=await Promise.all([
   probe("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1"),
   probe("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=1"),
   probe("https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=60&limit=1")
  ]);
  return json({service:"MMP COIN AI",worker:"online",ai_binding:!!env.AI,providers:{spot_binance:spot,futures_binance:futures,futures_bybit_fallback:bybit},checked_at:new Date().toISOString()});
 }
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 if(!env.AI)return json({error:"AI binding is not configured in Cloudflare Worker."},503);
 let body;try{body=await request.json()}catch{return json({error:"Invalid JSON"},400)}
 const coinId=String(body.coin_id||"").toLowerCase();
 const symbol=String(ASSET_SYMBOL_OVERRIDES[coinId]||body.symbol||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
 if(!validSymbol(symbol))return json({error:"Invalid asset symbol"},400);
 const pair=symbol.endsWith("USDT")?symbol:symbol+"USDT";
 const mode=["spot","futures","both"].includes(body.market_mode)?body.market_mode:"both";
 let stage="دریافت کندل‌های بازار";
 try{
  const intervals=["15m","1h","4h","1d"];
  let spotMarket=null,futuresMarket=null,market={},candleMarket=mode==="futures"?"futures":"spot";
  if(mode==="both"){
   const settled=await Promise.allSettled([
    Promise.all(intervals.map(async tf=>[tf,await candles(pair,tf,env,"spot")])),
    Promise.all(intervals.map(async tf=>[tf,await candles(pair,tf,env,"futures")]))
   ]);
   if(settled[0].status!=="fulfilled")throw settled[0].reason;
   spotMarket=Object.fromEntries(settled[0].value);
   if(settled[1].status==="fulfilled")futuresMarket=Object.fromEntries(settled[1].value);
   market=spotMarket;
  }else{
   const results=await Promise.all(intervals.map(async tf=>[tf,await candles(pair,tf,env,candleMarket)]));
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
  const snapshot={asset:String(body.name||symbol).slice(0,60),symbol:pair,market_mode:mode,source:[...new Set(providers)].join(" + ")+"; derivatives metrics when available; Alternative.me Fear & Greed; CoinGecko global market",market_timestamp:latest.candle_time,timeframes:market,futures_timeframes:mode==="both"&&futuresMarket?futuresMarket:null,spot_timeframes:mode==="both"?spotMarket:null,futures_data_available:mode==="both"?!!futuresMarket:mode==="futures",derivatives:funding?{funding_rate:funding.lastFundingRate,mark_price:funding.markPrice??null,next_funding_time:funding.nextFundingTime??null,open_interest:openInterest?.openInterest||null}:null,sentiment:fng?.data?.[0]?{fear_greed_value:Number(fng.data[0].value),classification:fng.data[0].value_classification}:null,global_market:global?.data?{btc_dominance:global.data.market_cap_percentage?.btc,total_market_cap_usd:global.data.total_market_cap?.usd,total_volume_usd:global.data.total_volume?.usd}:null};
  const prompt="You are MMP COIN AI, a professional quantitative crypto analyst. Use ONLY the supplied market snapshot and its numeric values. Write every human-readable sentence in fluent, natural Persian. Do not mix Persian with Russian, Chinese, or English words. All explanatory text must be fluent Persian. Never write English words such as signal, leverage, market, entry, exit, volume, wait, monitor, breakout, breakdown, support, resistance, risk, or trade; translate them into Persian. Avoid mixed-language sentences entirely. Preserve only tickers and standard indicators: BTCUSDT, RSI, MACD, EMA, ATR, LONG, SHORT, BUY, SELL, WAIT, TP1, TP2, TP3. Never invent news, events, order-book data, on-chain metrics, funding, open interest, volume, prices, or indicators.\n\nAnalyze all four timeframes (15m, 1h, 4h, 1d), distinguish short-term noise from the main trend, compare EMA alignment, RSI, MACD, volume ratio, ATR, support and resistance. In both mode, compare spot timeframes against futures_timeframes and explicitly identify agreement or divergence; never claim futures data was checked when futures_data_available is false. Evaluate derivatives funding and open interest only when present; explain Fear & Greed only when present.\n\nReturn ONLY one valid JSON object with keys: action (BUY, SELL, WAIT), primary_timeframe, confidence (integer 0-100 representing strength/alignment of evidence, NOT probability of profit), risk_level, market {price_usd}, levels {entry_zone:{low,high},stop_loss,tp1,tp2,tp3}, risk_reward, holding_horizon, position_risk, summary, technical_analysis, indicators {rsi,macd_signal,ema_trend,atr_percent}, scenarios [{name,description}], recommendations [3-6 concise actionable Persian suggestions], reasons [3-6 evidence-based Persian strings], risk_management, invalidation, market_context, data_source, market_timestamp.\n\nScenarios must cover bullish, bearish, and sideways cases, each with the condition that would confirm it and the relevant supplied support/resistance or indicator evidence. Recommendations should include what to monitor next, what would confirm entry, what invalidates the setup, and whether to wait for candle close. Never promise a return or call confidence a win probability.\n\nChoose WAIT when timeframes conflict, evidence is weak, risk/reward is below 1.5, volume confirmation is missing, or data is insufficient. When action is WAIT, set all entry/stop/target values to null. For BUY, entry and targets must be logically consistent around current price; for SELL, reverse the direction. Derive levels only from supplied support, resistance, ATR and current price. In spot-only mode never recommend SHORT or SELL. For futures, warn that leverage creates liquidation risk and advise low or no leverage. Use concise but substantive analysis, not generic filler.\n\nSnapshot: "+JSON.stringify(snapshot);
  stage="اجرای هوش مصنوعی";
  const ai=await env.AI.run(MODEL,{messages:[{role:"system",content:"Return one valid JSON object only. Never give guaranteed financial advice."},{role:"user",content:prompt}],max_tokens:2400,temperature:0.12});
  stage="پردازش پاسخ هوش مصنوعی";
  let raw=ai.response||ai.result||ai.output_text||"";
  if(typeof raw!=="string")raw=JSON.stringify(raw);
  raw=raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
  const start=raw.indexOf("{"),end=raw.lastIndexOf("}");
  if(start<0||end<=start)throw new Error("AI returned an invalid structured response");
  const analysis=persianize(JSON.parse(raw.slice(start,end+1)));
  if(!["BUY","SELL","WAIT"].includes(String(analysis.action||"").toUpperCase()))analysis.action="WAIT";
  analysis.confidence=Math.max(0,Math.min(100,Math.round(Number(analysis.confidence)||0)));
  analysis.market=analysis.market||{};analysis.market.price_usd=latest.price;
  analysis.indicators={...(analysis.indicators||{}),rsi:latest.rsi==null?null:Number(latest.rsi.toFixed(2)),macd_signal:latest.macd_signal,ema_trend:latest.ema_trend,atr_percent:latest.atr_percent==null?null:Number(latest.atr_percent.toFixed(2))};
  analysis.market_timestamp=latest.candle_time;analysis.data_source=(candleMarket==="futures"?"Binance Futures":"Binance Spot")+" public market candles · Cloudflare Workers AI";
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
  return json({analysis,market:snapshot});
 }catch(e){return json({error:e.message||"Analysis failed",stage,symbol:pair,market_mode:mode},502)}
}
export default {fetch:handle};
