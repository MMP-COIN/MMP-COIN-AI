export function normalizeMarketCandles(rows=[],options={}){
 const now=Number(options.now)||Date.now(),maxFutureSkewMs=Math.max(0,Number(options.maxFutureSkewMs??60000));
 const unique=new Map();
 for(const row of Array.isArray(rows)?rows:[]){
  if(!Array.isArray(row)||row.length<6)continue;
  let time=Number(row[0]);
  if(time>0&&time<1e12)time*=1000;
  const open=Number(row[1]),high=Number(row[2]),low=Number(row[3]),close=Number(row[4]),volume=Number(row[5]);
  if(!Number.isFinite(time)||time<=0||time>now+maxFutureSkewMs||![open,high,low,close,volume].every(Number.isFinite))continue;
  if(open<=0||close<=0||low<=0||high<Math.max(open,close,low)||low>Math.min(open,close,high)||volume<0)continue;
  unique.set(time,[time,open,high,low,close,volume]);
 }
 return [...unique.values()].sort((a,b)=>a[0]-b[0]);
}
export function alignMarketCandles(primaryRows=[],secondaryRows=[],options={}){
 const now=Number(options.now)||Date.now(),maxAgeMs=Math.max(0,Number(options.maxAgeMs??210000)),maxDeviationPct=Math.max(0,Number(options.maxDeviationPct??0.4));
 const primary=normalizeMarketCandles(primaryRows,{now}),secondary=normalizeMarketCandles(secondaryRows,{now});
 if(!primary.length||!secondary.length)return null;
 const byTime=new Map(secondary.map(row=>[row[0],row]));
 for(let index=primary.length-1;index>=0;index--){
  const a=primary[index],b=byTime.get(a[0]);if(!b)continue;
  const rawAgeMs=now-a[0];if(rawAgeMs< -Math.max(0,Number(options.maxFutureSkewMs??60000)))continue;
  const ageMs=Math.max(0,rawAgeMs),deviationPct=a[4]>0?Math.abs(b[4]/a[4]-1)*100:Infinity;
  if(ageMs>maxAgeMs||deviationPct>maxDeviationPct)continue;
  return {index,primary:a,secondary:b,timeDiffMs:Math.abs(a[0]-b[0]),ageMs,deviationPct};
 }
 return null;
}
export function assessMarketDataFreshness(timestamp,now=Date.now(),maxAgeMs=180000){
 const value=Number(timestamp);
 if(!Number.isFinite(value)||value<=0)return {available:false,fresh:false,ageMs:null,reason:"missing_timestamp"};
 const rawAgeMs=now-value;
 if(rawAgeMs< -60000)return {available:true,fresh:false,ageMs:rawAgeMs,reason:"future_timestamp"};
 const ageMs=Math.max(0,rawAgeMs);
 return {available:true,fresh:ageMs<=maxAgeMs,ageMs,reason:ageMs<=maxAgeMs?null:"stale_market_data"};
}
