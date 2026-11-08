export const QUANTUM_ENGINE_NAME = "MMP QUANTUM INTELLIGENCE ENGINE";
export const QUANTUM_ENGINE_VERSION = "QIE-1.1.0";
export const QUANTUM_SCORE_WEIGHTS = Object.freeze({momentum:0.20,flow:0.20,structure:0.15,liquidity:0.15,multiTimeframe:0.15,regime:0.10,dataQuality:0.05});
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):min));
const finite=value=>Number.isFinite(Number(value))?Number(value):0;
export function scoreQuantumOpportunity(input={}){
 const trend=input.trend==="bear"?-1:1;
 const changes=[finite(input.change1m??input.m1),finite(input.change3m??input.m3),finite(input.change5m??input.m5),finite(input.change15m??input.m15)];
 const momentum=clamp(28+Math.abs(changes[0])*11+Math.abs(changes[1])*7+Math.abs(changes[2])*4+Math.abs(changes[3])*1.2);
 const flowImbalance=finite(input.flowImbalance);
 const flow=input.flowConfirmed===true?clamp(50+flowImbalance*trend*250):50;
 const structure=input.breakout===true?100:input.structureAligned===true||input.structure===true?68:38;
 const liquidity=clamp(finite(input.volumeRatio)*45);
 const aligned=changes.filter(value=>Math.abs(value)<0.025||Math.sign(value)===trend).length;
 const multiTimeframe=aligned/changes.length*100;
 let regime=input.trend15===true||input.trend15m===true?84:56;
 if(input.overextended===true)regime=Math.max(25,regime-28);
 const age=Math.max(0,finite(input.dataAgeMs));
 const dataQuality=age<=90000?100:age<=150000?80:age<=210000?60:0;
 const parts={momentum,flow,structure,liquidity,multiTimeframe,regime,dataQuality};
 const score=Math.round(Object.entries(QUANTUM_SCORE_WEIGHTS).reduce((sum,[key,weight])=>sum+parts[key]*weight,0));
 const confidence=Math.round(clamp(dataQuality*.35+multiTimeframe*.25+liquidity*.20+(input.flowConfirmed===true?20:8)));
 const liquidityConfirmed=input.totalVolume24h==null||finite(input.totalVolume24h)>=150000;
 const candidateGate=dataQuality>=80&&multiTimeframe>=50&&liquidity>=25&&liquidityConfirmed&&input.overextended!==true;
 const flowAligned=input.flowConfirmed===true&&flowImbalance*trend>=0.045;
 const volumeConfirmed=finite(input.volumeRatio)>=1.1;
 const multiExchangeConfirmed=input.multiExchangeConfirmed===true;
 const depthConfirmed=input.requireDepthConfirmation!==true||input.depthConfirmed===true;
 return {engine:QUANTUM_ENGINE_NAME,version:QUANTUM_ENGINE_VERSION,score:clamp(score,0,99),confidence,components:Object.fromEntries(Object.entries(parts).map(([key,value])=>[key,Math.round(value)])),weights:QUANTUM_SCORE_WEIGHTS,dataAgeMs:age,flowValidated:input.flowConfirmed===true,flowAligned,volumeConfirmed,multiExchangeConfirmed,depthConfirmed,candidateGate,qualityGate:candidateGate&&flowAligned&&volumeConfirmed&&multiExchangeConfirmed&&depthConfirmed};
}
export function normalizeQuantumUniverse(items,marketType="spot"){
 if(!Array.isArray(items))return [];
 const unique=new Map();
 for(const item of items){
  const symbol=String(item?.symbol||"").toUpperCase(),price=finite(item?.current_price??item?.price),volume=finite(item?.total_volume??item?.volume);
  if(!/^[A-Z0-9]{2,20}$/.test(symbol)||!(price>0)||volume<50000)continue;
  if(marketType==="spot"){
   const pairs=Array.isArray(item.marketPairs)?item.marketPairs:[];
   if(item.hasUsdtMarket!==true&&!pairs.some(pair=>String(pair?.quote||"").toUpperCase()==="USDT"))continue;
  }
  const previous=unique.get(symbol);
  if(!previous||volume>finite(previous.total_volume))unique.set(symbol,{...item,symbol,current_price:price,total_volume:volume,marketPairs:Array.isArray(item.marketPairs)?item.marketPairs.slice(0,4):[]});
 }
 return [...unique.values()].sort((a,b)=>finite(b.total_volume)-finite(a.total_volume));
}
