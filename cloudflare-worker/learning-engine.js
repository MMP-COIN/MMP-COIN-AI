const HORIZONS=[5,15,60];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):min));
const finite=value=>Number.isFinite(Number(value))?Number(value):0;
function readTime(value,fallback){if(typeof value==="number"&&Number.isFinite(value))return value;const parsed=Date.parse(value||"");return Number.isFinite(parsed)?parsed:fallback;}
export function directionalReturnPct(entryPrice,currentPrice,direction){
 const entry=Number(entryPrice),current=Number(currentPrice);if(!(entry>0)||!(current>0))return null;
 return (current/entry-1)*100*(direction==="bear"?-1:1);
}
export function evaluateLearningMark(record,currentPrice,now=Date.now()){
 const signed=directionalReturnPct(record.entry_price,currentPrice,record.direction);if(signed===null)return record;
 const elapsed=Math.max(0,now-Number(record.signal_at||now));
 let next=null;
 for(const minutes of HORIZONS){
  const key="outcome_"+minutes+"m";
  if((record[key]===null||record[key]===undefined)&&elapsed>=minutes*60000){
   if(!next)next={...record};
   next[key]=Number(signed.toFixed(6));next[key+"_observed_at"]=now;next[key+"_lag_ms"]=elapsed-minutes*60000;
  }
 }
 if(!next)return record;
 if(next.outcome_60m!==null&&next.outcome_60m!==undefined)next.status="completed";
 return next;
}
function metric(records,key){const values=records.map(x=>x[key]).filter(x=>x!==null&&x!==undefined&&Number.isFinite(Number(x))).map(Number);return {samples:values.length,winRate:values.length?values.filter(x=>x>0).length/values.length:null,avgReturn:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};}
export function summarizeLearningLedger(records=[],market="spot"){
 const selected=(Array.isArray(records)?records:[]).filter(x=>x.market===market),m5=metric(selected,"outcome_5m"),m15=metric(selected,"outcome_15m"),m60=metric(selected,"outcome_60m");
 const adjustment=m5.samples>=30?clamp((m5.winRate-0.5)*10,-5,5):0;
 return {version:"MMP-SELF-LEARNING-1.0",market,totalSignals:selected.length,openSignals:selected.filter(x=>x.status==="open").length,
  matured5m:m5.samples,matured15m:m15.samples,matured60m:m60.samples,
  winRate5m:m5.winRate===null?null:Number((m5.winRate*100).toFixed(2)),avgReturn5m:m5.avgReturn===null?null:Number(m5.avgReturn.toFixed(4)),
  winRate15m:m15.winRate===null?null:Number((m15.winRate*100).toFixed(2)),avgReturn15m:m15.avgReturn===null?null:Number(m15.avgReturn.toFixed(4)),
  winRate60m:m60.winRate===null?null:Number((m60.winRate*100).toFixed(2)),avgReturn60m:m60.avgReturn===null?null:Number(m60.avgReturn.toFixed(4)),
  calibrationStatus:m5.samples>=30?"calibrated":"collecting",calibrationAdjustment:Number(adjustment.toFixed(2))};
}
export function updateLearningLedger(previous={},options={}){
 const now=Number(options.now)||Date.now(),market=String(options.market||"spot"),engine=String(options.engine||"hunter");
 let records=Array.isArray(previous.records)?previous.records.slice():[],changed=false;
 const observations=Array.isArray(options.observations)?options.observations:[];
 for(const observation of observations){
  const symbol=String(observation?.symbol||observation?.coin?.symbol||"").toUpperCase(),price=Number(observation?.price??observation?.currentPrice??observation?.coin?.current_price);
  if(!/^[A-Z0-9]{2,24}$/.test(symbol)||!(price>0))continue;
  records=records.map(record=>{if(record.market!==market||record.symbol!==symbol||record.status!=="open")return record;const updated=evaluateLearningMark(record,price,now);if(updated!==record)changed=true;return updated;});
 }
 const qualified=Array.isArray(options.signals)?options.signals:[];
 for(const signal of qualified){
  const symbol=String(signal?.symbol||signal?.coin?.symbol||"").toUpperCase(),price=Number(signal?.price??signal?.currentPrice),direction=signal?.trend==="bull"||signal?.trend==="bear"?signal.trend:null;
  if(!/^[A-Z0-9]{2,24}$/.test(symbol)||!(price>0)||!direction)continue;
  if(signal?.quantum?.qualityGate!==true||signal?.flowConfirmed!==true||signal?.multiExchangeConfirmed!==true||signal?.depth?.confirmed!==true)continue;
  const candleTime=readTime(signal.candleTime??signal.candle_time,Math.floor(now/300000)*300000),id=[engine,market,symbol,candleTime].join(":");
  if(records.some(record=>record.id===id))continue;
  records.push({id,engine,market,symbol,direction,entry_price:price,signal_at:candleTime,score:finite(signal.score),confidence:finite(signal.quantum?.confidence),
   engine_version:String(signal.quantum?.version||signal.quantum?.engine||"QIE"),
   evidence:{volumeRatio:finite(signal.volumeRatio),flowTrades:finite(signal.flow?.tradeCount),flowProvider:String(signal.flow?.provider||""),depthSource:String(signal.depth?.source||signal.depth?.provider||"")},
   outcome_5m:null,outcome_15m:null,outcome_60m:null,status:"open"});
  changed=true;
 }
 records.sort((a,b)=>Number(a.signal_at)-Number(b.signal_at));records=records.slice(-1000);
 const summary=summarizeLearningLedger(records,market);summary.processed=observations.length;
 return {version:"MMP-SELF-LEARNING-1.0",updatedAt:now,records,summary,changed};
}
export function applyLearningCalibration(signal,summary={}){
 if(!signal||typeof signal!=="object"||!signal.quantum)return signal;
 const adjustment=summary.calibrationStatus==="calibrated"?clamp(summary.calibrationAdjustment,-5,5):0;
 const confidence=clamp(finite(signal.quantum.confidence)+adjustment,0,100);
 return {...signal,quantum:{...signal.quantum,rawConfidence:finite(signal.quantum.confidence),confidence:Math.round(confidence),calibratedConfidence:Math.round(confidence),learningCalibration:{status:summary.calibrationStatus||"collecting",samples:Number(summary.matured5m)||0,adjustment:Number(adjustment.toFixed(2)),basis:"5m gross price return before fees/slippage; minimum 30 matured samples"}}};
}
