const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
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
 return {price:last.c,change_pct:(last.c/closes[closes.length-2]-1)*100,rsi:rsi(closes),ema20:e20,ema50:e50,ema200:e200,ema_trend:e20&&e50&&e200?(last.c>e20&&e20>e50&&e50>e200?"bullish":last.c<e20&&e20<e50&&e50<e200?"bearish":"mixed"):"insufficient",macd,macd_signal:macd==null||signal==null?"insufficient":macd>signal?"bullish crossover bias":macd<signal?"bearish crossover bias":"neutral",atr,atr_percent:atr?atr/last.c*100:null,support,resistance,volume_ratio:mean(vols.slice(-5))/(mean(vols.slice(-25))||1),taker_buy_volume_ratio:totalBase?takerBuyBase/totalBase:null,candle_time:new Date(last.t).toISOString()};
}
function splitQuotePair(symbol){
 const match=String(symbol||"").toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|FDUSD|BUSD|USD|BTC|ETH)$/);
 return match?{base:match[1],quote:match[2]}:null;
}
async function candles(symbol,interval,env,marketType="spot"){
 const headers={"Accept":"application/json, text/plain, */*","User-Agent":"MMP-COIN-AI/1.0","Accept-Language":"en-US,en;q=0.9"};
 const spotUrls=[
  "https://api.binance.com/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",
  "https://api.binance.us/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",
  "https://api.binance.us/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",
  "https://data-api.binance.vision/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250"
 ];
 const okxBar={"15m":"15m","1h":"1H","4h":"4H","1d":"1Dutc"}[interval];
 if(marketType==="futures"){
  let binanceError=null;
  try{
   const r=await fetch("https://fapi.binance.com/fapi/v1/klines?symbol="+encodeURIComponent(symbol)+"&interval="+interval+"&limit=250",{headers});
   if(!r.ok)throw new Error("Binance Futures HTTP "+r.status);
   const rows=await r.json();
   if(!Array.isArray(rows)||rows.length<80)throw new Error("Binance Futures candle history is insufficient");
   const result=analyzeKlines(rows);result.data_provider="Binance Futures";return result;
  }catch(e){binanceError=e;}
  let bybitError=null;
  try{
   const bybitInterval={"15m":"15","1h":"60","4h":"240","1d":"D"}[interval];
   const url="https://api.bybit.com/v5/market/kline?category=linear&symbol="+encodeURIComponent(symbol)+"&interval="+bybitInterval+"&limit=250";
   const r=await fetch(url,{headers});
   if(!r.ok)throw new Error("Bybit Linear HTTP "+r.status);
   const payload=await r.json(),list=payload?.retCode===0?payload.result?.list:null;
   if(!Array.isArray(list)||list.length<80)throw new Error(payload?.retMsg||"insufficient Bybit linear candle history");
   const rows=list.slice().reverse().map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]);
   const result=analyzeKlines(rows);result.data_provider="Bybit Linear Perpetual (fallback)";return result;
  }catch(e){bybitError=e;}
  try{
   const pair=splitQuotePair(symbol);if(!pair)throw new Error("Unsupported quote currency for OKX swap");
   const instId=pair.base+"-"+pair.quote+"-SWAP";
   let lastError=null;
   for(const host of ["https://www.okx.com","https://us.okx.com","https://openapi.okx.com"]){
    try{
     const r=await fetch(host+"/api/v5/market/candles?instId="+encodeURIComponent(instId)+"&bar="+okxBar+"&limit=250",{headers});
     if(!r.ok){lastError=new Error("OKX Swap HTTP "+r.status);continue;}
     const payload=await r.json(),list=payload?.code==="0"?payload.data:null;
     if(!Array.isArray(list)||list.length<80){lastError=new Error(payload?.msg||"insufficient OKX swap candle history");continue;}
     const rows=list.slice().reverse().map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]);
     const result=analyzeKlines(rows);result.data_provider="OKX Linear Swap (fallback)";return result;
    }catch(e){lastError=e;}
   }
   throw lastError||new Error("OKX swap candle history unavailable");
  }catch(okxError){
   throw new Error("Futures data unavailable for "+symbol+"; Binance: "+(binanceError?.message||"failed")+"; Bybit: "+(bybitError?.message||"failed")+"; OKX: "+(okxError?.message||"failed"));
  }
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
 let bitgetError=null;
 try{
  const bitgetInterval={"15m":"15m","1h":"1H","4h":"4H","1d":"1D"}[interval];
  const url="https://api.bitget.com/api/v3/market/history-candles?category=SPOT&symbol="+encodeURIComponent(symbol)+"&interval="+bitgetInterval+"&limit=100";
  const r=await fetch(url,{headers});
  if(!r.ok)throw new Error("Bitget Spot HTTP "+r.status);
  const payload=await r.json(),rows=payload?.code==="00000"?payload.data:null;
  if(!Array.isArray(rows)||rows.length<80)throw new Error(payload?.msg||"insufficient Bitget spot candle history");
  const result=analyzeKlines(rows.map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]));
  result.data_provider="Bitget Spot";return result;
 }catch(e){bitgetError=e;}
 let bybitError=null;
 try{
  const bybitInterval={"15m":"15","1h":"60","4h":"240","1d":"D"}[interval];
  const url="https://api.bybit.com/v5/market/kline?category=spot&symbol="+encodeURIComponent(symbol)+"&interval="+bybitInterval+"&limit=250";
  const r=await fetch(url,{headers});
  if(!r.ok)throw new Error("Bybit Spot HTTP "+r.status);
  const payload=await r.json(),list=payload?.retCode===0?payload.result?.list:null;
  if(!Array.isArray(list)||list.length<80)throw new Error(payload?.retMsg||"insufficient Bybit spot candle history");
  const rows=list.slice().reverse().map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]);
  const result=analyzeKlines(rows);result.data_provider="Bybit Spot (fallback)";return result;
 }catch(e){bybitError=e;}
 try{
  const pair=splitQuotePair(symbol);if(!pair)throw new Error("Unsupported quote currency for OKX spot");
  const instId=pair.base+"-"+pair.quote;
  let lastError=null;
  for(const host of ["https://www.okx.com","https://us.okx.com","https://openapi.okx.com"]){
   try{
    const r=await fetch(host+"/api/v5/market/candles?instId="+encodeURIComponent(instId)+"&bar="+okxBar+"&limit=250",{headers});
    if(!r.ok){lastError=new Error("OKX Spot HTTP "+r.status);continue;}
    const payload=await r.json(),list=payload?.code==="0"?payload.data:null;
    if(!Array.isArray(list)||list.length<80){lastError=new Error(payload?.msg||"insufficient OKX spot candle history");continue;}
    const rows=list.slice().reverse().map(x=>[Number(x[0]),x[1],x[2],x[3],x[4],x[5],x[6]||"0","0","0","0"]);
    const result=analyzeKlines(rows);result.data_provider="OKX Spot (fallback)";return result;
   }catch(e){lastError=e;}
  }
  throw lastError||new Error("OKX spot candle history unavailable");
 }catch(okxError){
  throw new Error("Spot data unavailable for "+symbol+" "+interval+"; Binance: "+(lastError?.message||"failed")+"; Bybit: "+(bybitError?.message||"failed")+"; Bitget: "+(bitgetError?.message||"failed")+"; OKX: "+(okxError?.message||"failed"));
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
  ["bitget_spot","https://api.bitget.com/api/v3/market/instruments?category=SPOT"]
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
 const binanceFuturesPair=(catalogs.binance_futures?.data?.symbols||[]).filter(x=>x.status==="TRADING"&&(!x.contractType||x.contractType==="PERPETUAL")&&x.baseAsset===base&&quotes.includes(x.quoteAsset)).map(x=>({pair:x.symbol,quote:x.quoteAsset})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const bybitFuturesPair=(catalogs.bybit_futures?.data?.result?.list||[]).filter(x=>x.status==="Trading"&&(!x.contractType||x.contractType==="LinearPerpetual")&&x.baseCoin===base&&quotes.includes(x.quoteCoin)).map(x=>({pair:x.symbol,quote:x.quoteCoin})).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const okxFuturesPair=(catalogs.okx_futures?.data?.data||[]).filter(x=>x.state==="live"&&(!x.ctType||x.ctType==="linear")&&String(x.instId||"").endsWith("-SWAP")).map(x=>{const p=String(x.instId||"").split("-");return p[0]===base&&quotes.includes(p[1])?{pair:p[0]+p[1],quote:p[1]}:null;}).filter(Boolean).sort((a,b)=>quotes.indexOf(a.quote)-quotes.indexOf(b.quote))[0]||null;
 const spotEntries=[["Binance",binanceSpotPair,catalogs.binance_spot],["Bybit",bybitSpotPair,catalogs.bybit_spot],["OKX",okxSpotPair,catalogs.okx_spot],["Bitget",bitgetSpotPair,catalogs.bitget_spot]];
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
 if(request.method==="GET"&&new URL(request.url).pathname==="/support-check"){
  const limitResult=await checkRateLimit(env.PUBLIC_API_LIMITER,request,"support-check");
  const limited=rateLimitReply(limitResult,request);if(limited)return limited;
  const url=new URL(request.url);
  const symbols=[...new Set((url.searchParams.get("symbols")||"").split(",").map(x=>x.toUpperCase().replace(/[^A-Z0-9]/g,"")).filter(validSymbol))].slice(0,150);
  if(!symbols.length)return json({error:"Provide comma-separated symbols"},400,request);
  const catalogs=await getExchangeCatalogs();
  const assets=symbols.map(symbol=>exchangeSupport(symbol,catalogs));
  const sources=Object.fromEntries(Object.entries(catalogs).map(([k,v])=>[k,{ok:!!v?.ok,status:v?.status||0,error:v?.error||null,source:v?.source||null}]));
  return json({checked_at:new Date().toISOString(),assets,sources},200,request);
 }
 if(request.method==="GET"&&new URL(request.url).pathname==="/market-proxy"){
  const limitResult=await checkRateLimit(env.PUBLIC_API_LIMITER,request,"market-proxy");
  const limited=rateLimitReply(limitResult,request);if(limited)return limited;
  const url=new URL(request.url),source=url.searchParams.get("source")||"";
  const urls={
   "binance-tickers":["https://api.binance.com/api/v3/ticker/24hr","https://api.binance.us/api/v3/ticker/24hr","https://api1.binance.com/api/v3/ticker/24hr","https://api2.binance.com/api/v3/ticker/24hr","https://api3.binance.com/api/v3/ticker/24hr","https://data-api.binance.vision/api/v3/ticker/24hr"],
   "bitget-tickers":["https://api.bitget.com/api/v3/market/tickers?category=SPOT"],
   "bitpin-tickers":["https://api.bitpin.ir/api/v1/mkt/tickers/"],
   "coingecko-top":["https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=1h%2C24h%2C7d"],
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
  const [binance,bybit,okx,nobitex,wallex,bitget,bitpin]=await Promise.all([
   probeAny(["https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://api.binance.us/api/v3/ticker/price?symbol=BTCUSDT","https://api1.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://api2.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://api3.binance.com/api/v3/ticker/price?symbol=BTCUSDT","https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT"],d=>Number(d?.price)>0),
   probeAny([
    "https://api.bybit.eu/v5/market/tickers?category=spot&symbol=BTCUSDT",
    "https://api.bytick.eu/v5/market/tickers?category=spot&symbol=BTCUSDT",
    "https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT",
    "https://api.bytick.com/v5/market/tickers?category=spot&symbol=BTCUSDT"
   ],d=>d?.retCode===0&&Number(d?.result?.list?.[0]?.lastPrice)>0),
   probeAny(["https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT","https://us.okx.com/api/v5/market/ticker?instId=BTC-USDT","https://openapi.okx.com/api/v5/market/ticker?instId=BTC-USDT"],d=>d?.code==="0"&&Number(d?.data?.[0]?.last)>0),
   timeoutFetch("https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls",d=>d?.status==="ok"&&Number(d?.stats?.["usdt-rls"]?.latest)>0,5500),
   probeAny(["https://api.wallex.ir/v1/markets","https://api.wallex.ir/hector/web/v1/markets","https://api.wallex.ir/v1/otc/markets"],d=>{
    if(d?.success!==true)return false;
    const raw=d?.result?.symbols??d?.result?.markets;
    if(Array.isArray(raw))return raw.length>0;
    if(raw&&typeof raw==="object")return Object.keys(raw).length>0;
    return false;
   },12000,{"Origin":"https://wallex.ir","Referer":"https://wallex.ir/"}),
   timeoutFetch("https://api.bitget.com/api/v3/market/tickers?category=SPOT&symbol=BTCUSDT",d=>d?.code==="00000"&&Number(d?.data?.[0]?.lastPrice)>0,7000),
   timeoutFetch("https://api.bitpin.ir/api/v1/mkt/tickers/",d=>Array.isArray(d)&&d.some(t=>String(t?.symbol||"").toUpperCase()==="USDT_IRT"&&Number(t?.price)>0),9000)
  ]);
  const checks=[
   {name:"Binance Spot",purpose:"قیمت و معاملات اسپات",...binance},
   {name:"Bybit Spot",purpose:"قیمت و معاملات اسپات",...bybit},
   {name:"OKX Spot",purpose:"قیمت و معاملات اسپات",...okx},
   {name:"Nobitex",purpose:"نرخ تتر به تومان",...nobitex},
   {name:"Wallex",purpose:"نرخ تتر به تومان",...wallex},
   {name:"Bitget Spot",purpose:"قیمت و معاملات اسپات",...bitget},
   {name:"Bitpin",purpose:"نرخ تتر به تومان",...bitpin}
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
 if(!env.AI)return json({error:"AI binding is not configured in Cloudflare Worker."},503,request);
 const contentType=request.headers.get("Content-Type")||"";
 if(!contentType.toLowerCase().includes("application/json"))return json({error:"Content-Type must be application/json"},415,request);
 const declaredLength=Number(request.headers.get("Content-Length")||0);
 if(declaredLength>16384)return json({error:"Request body is too large"},413,request);
 let body;try{const rawBody=await request.text();if(new TextEncoder().encode(rawBody).length>16384)return json({error:"Request body is too large"},413,request);body=JSON.parse(rawBody);}catch{return json({error:"Invalid JSON"},400,request);}
 if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"Invalid request body"},400,request);
 const coinId=String(body.coin_id||"").toLowerCase();
 const symbol=String(ASSET_SYMBOL_OVERRIDES[coinId]||body.symbol||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
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
   const settled=await Promise.allSettled([
    Promise.all(intervals.map(async tf=>[tf,await candles(spotPair,tf,env,"spot")])),
    Promise.all(intervals.map(async tf=>[tf,await candles(futuresPair,tf,env,"futures")]))
   ]);
   if(settled[0].status==="fulfilled")spotMarket=Object.fromEntries(settled[0].value);
   if(settled[1].status==="fulfilled")futuresMarket=Object.fromEntries(settled[1].value);
   // In "both" mode, either valid market is enough to continue. Prefer spot,
   // but fall back to futures when spot candles are unavailable.
   if(spotMarket){market=spotMarket;candleMarket="spot";}
   else if(futuresMarket){market=futuresMarket;candleMarket="futures";pair=futuresPair;}
   else{
    const spotError=String(settled[0].reason?.message||"داده اسپات در دسترس نیست");
    const futuresError=String(settled[1].reason?.message||"داده فیوچرز در دسترس نیست");
    const assetNote=symbol==="JAAA"?" این نماد به صندوق/دارایی توکنیزه‌شده Janus Henderson AAA CLO مرتبط است؛ بدون جفت معتبر یا شناسه دقیق توکن، نباید آن را به قرارداد دیگری نگاشت کرد.":"";
    throw new Error("برای "+symbol+" در بازار اسپات و فیوچرز داده کندلی کافی پیدا نشد. جفت معاملاتی "+pair+" ممکن است در صرافی‌های پشتیبانی‌شده فعال نباشد."+assetNote+" جزئیات: اسپات: "+spotError+"؛ فیوچرز: "+futuresError);
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
  analysis.market_timestamp=latest.candle_time;analysis.data_source=[...new Set(providers)].join(" + ")+" · Cloudflare Workers AI";
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
