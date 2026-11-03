const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
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
 const base=marketType==="futures"?"https://fapi.binance.com/fapi/v1/klines":"https://api.binance.com/api/v3/klines";
 const url=base+"?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250";
 const r=await fetch(url,{headers:{"Accept":"application/json"}});
 if(!r.ok)throw new Error("Market data unavailable for "+symbol+" "+interval);
 const rows=await r.json();if(!Array.isArray(rows)||rows.length<80)throw new Error("Not enough candle history for "+interval);
 return analyzeKlines(rows);
}
function validSymbol(s){return /^[A-Z0-9]{2,20}$/.test(s||"")&&!s.includes("USDTUSDT")}
async function handle(request,env){
 if(request.method==="OPTIONS")return new Response(null,{headers:CORS});
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 if(!env.AI)return json({error:"AI binding is not configured in Cloudflare Worker."},503);
 let body;try{body=await request.json()}catch{return json({error:"Invalid JSON"},400)}
 const symbol=String(body.symbol||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
 if(!validSymbol(symbol))return json({error:"Invalid asset symbol"},400);
 const pair=symbol.endsWith("USDT")?symbol:symbol+"USDT";
 const mode=["spot","futures","both"].includes(body.market_mode)?body.market_mode:"both";
 try{
  const intervals=["15m","1h","4h","1d"];
  const candleMarket=mode==="futures"?"futures":"spot";
  const results=await Promise.all(intervals.map(async tf=>[tf,await candles(pair,tf,env,candleMarket)]));
  const market=Object.fromEntries(results);
  const latest=market["4h"];
  const optionalJson=async url=>{try{const r=await fetch(url);if(!r.ok)return null;return await r.json();}catch{return null;}};
  const [funding,openInterest,fng,global]=await Promise.all([
   mode==="spot"?Promise.resolve(null):optionalJson("https://fapi.binance.com/fapi/v1/premiumIndex?symbol="+pair),
   mode==="spot"?Promise.resolve(null):optionalJson("https://fapi.binance.com/fapi/v1/openInterest?symbol="+pair),
   optionalJson("https://api.alternative.me/fng/?limit=1"),
   optionalJson("https://api.coingecko.com/api/v3/global")
  ]);
  const snapshot={asset:String(body.name||symbol).slice(0,60),symbol:pair,market_mode:mode,source:"Binance public candles; Binance Futures metrics when available; Alternative.me Fear & Greed; CoinGecko global market",market_timestamp:latest.candle_time,timeframes:market,derivatives:funding?{funding_rate:funding.lastFundingRate,mark_price:funding.markPrice,next_funding_time:funding.nextFundingTime,open_interest:openInterest?.openInterest||null}:null,sentiment:fng?.data?.[0]?{fear_greed_value:Number(fng.data[0].value),classification:fng.data[0].value_classification}:null,global_market:global?.data?{btc_dominance:global.data.market_cap_percentage?.btc,total_market_cap_usd:global.data.total_market_cap?.usd,total_volume_usd:global.data.total_volume?.usd}:null};
  const prompt="You are MMP COIN AI, a cautious professional crypto market analyst. Analyze ONLY the supplied numeric market snapshot. Do not invent prices, indicators, news, order-book data, funding, open interest, on-chain data, or probabilities. Respond in Persian. Return ONLY valid JSON with keys: action (BUY, SELL, WAIT), primary_timeframe, confidence (0-100 as evidence-strength not win probability), risk_level, market {price_usd}, levels {entry_zone:{low,high},stop_loss,tp1,tp2,tp3}, risk_reward, holding_horizon, position_risk, summary, technical_analysis, indicators {rsi,macd_signal,ema_trend,atr_percent}, scenarios [{name,description}], reasons [strings], risk_management, invalidation, market_context, data_source, market_timestamp. All price levels must be numeric USD values derived from snapshot. If signals conflict, trend is mixed, risk/reward is poor, or data is insufficient, choose WAIT and set entry/stop/targets to null. For SELL only describe short/futures conditions; for spot-only mode never recommend short selling. For futures mention leverage increases liquidation risk and recommend low/no leverage. Use support/resistance/ATR and multiple timeframes; do not promise returns. Snapshot: "+JSON.stringify(snapshot);
  const ai=await env.AI.run(MODEL,{messages:[{role:"system",content:"Return one valid JSON object only. Never give guaranteed financial advice."},{role:"user",content:prompt}],max_tokens:1500,temperature:0.15});
  let raw=ai.response||ai.result||ai.output_text||"";
  if(typeof raw!=="string")raw=JSON.stringify(raw);
  raw=raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
  const start=raw.indexOf("{"),end=raw.lastIndexOf("}");
  if(start<0||end<=start)throw new Error("AI returned an invalid structured response");
  const analysis=JSON.parse(raw.slice(start,end+1));
  if(!["BUY","SELL","WAIT"].includes(String(analysis.action||"").toUpperCase()))analysis.action="WAIT";
  analysis.market=analysis.market||{};analysis.market.price_usd=latest.price;
  analysis.market_timestamp=latest.candle_time;analysis.data_source=(candleMarket==="futures"?"Binance Futures":"Binance Spot")+" public market candles · Cloudflare Workers AI";
  if(mode==="spot"&&analysis.action==="SELL"){analysis.action="WAIT";analysis.levels={entry_zone:null,stop_loss:null,tp1:null,tp2:null,tp3:null};}
  return json({analysis,market:snapshot});
 }catch(e){return json({error:e.message||"Analysis failed"},502)}
}
export default {fetch:handle};
