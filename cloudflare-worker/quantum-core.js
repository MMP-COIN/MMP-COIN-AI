export const QUANTUM_ENGINE_NAME = "MMP QUANTUM INTELLIGENCE ENGINE";
export const QUANTUM_ENGINE_VERSION = "QIE-2.0.0";

/* Legacy weights retain their relative influence. New specialist engines join
   only when their underlying evidence is actually supplied and validated. */
export const QUANTUM_SCORE_WEIGHTS = Object.freeze({
 momentum:0.18, flow:0.18, structure:0.135, liquidity:0.135,
 multiTimeframe:0.135, regime:0.09, dataQuality:0.045,
 volatility:0.035, sentiment:0.01, smartMoney:0.02, scenario:0.015, risk:0.02
});
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):min));
const finite=value=>Number.isFinite(Number(value))?Number(value):0;
const has=(input,key)=>input[key]!==undefined&&input[key]!==null&&Number.isFinite(Number(input[key]));

export function scoreQuantumOpportunity(input={}){
 const direction=input.trend==="bull"?1:input.trend==="bear"?-1:0;
 const changes=[input.change1m??input.m1,input.change3m??input.m3,input.change5m??input.m5,input.change15m??input.m15];
 const changesAvailable=changes.every(value=>value!==undefined&&value!==null&&Number.isFinite(Number(value)));
 const price=finite(input.currentPrice??input.price);
 const priceAvailable=price>0;
 const ageAvailable=has(input,"dataAgeMs");
 const age=ageAvailable?Math.max(0,finite(input.dataAgeMs)):Infinity;
 const fresh=ageAvailable&&age<=90000;
 const momentumAvailable=changesAvailable;
 const momentum=momentumAvailable?clamp(28+Math.abs(Number(changes[0]))*11+Math.abs(Number(changes[1]))*7+Math.abs(Number(changes[2]))*4+Math.abs(Number(changes[3]))*1.2):0;
 const flowAvailable=input.flowConfirmed===true&&has(input,"flowImbalance");
 const flowImbalance=flowAvailable?finite(input.flowImbalance):0;
 const flow=flowAvailable&&direction?clamp(50+flowImbalance*direction*250):0;
 const structureAvailable=input.breakout!==undefined||input.structureAligned!==undefined||input.structure!==undefined;
 const structure=structureAvailable?(input.breakout===true?100:input.structureAligned===true||input.structure===true?68:38):0;
 const volumeAvailable=has(input,"volumeRatio");
 const volumeRatio=volumeAvailable?Math.max(0,finite(input.volumeRatio)):0;
 const depthAvailable=input.depthConfirmed===true&&has(input,"depthImbalance");
 const depthScore=depthAvailable&&direction?clamp(50+finite(input.depthImbalance)*180*direction):0;
 const liquidityAvailable=volumeAvailable||depthAvailable;
 const liquidity=liquidityAvailable?clamp((volumeAvailable?clamp(volumeRatio*45)*0.7:0)+(depthAvailable?depthScore*0.3:0)):0;
 const multiTimeframeAvailable=changesAvailable&&direction!==0;
 const aligned=multiTimeframeAvailable?changes.filter(value=>Math.abs(Number(value))<0.025||Math.sign(Number(value))===direction).length:0;
 const multiTimeframe=multiTimeframeAvailable?aligned/changes.length*100:0;
 const regimeAvailable=has(input,"marketRegimeScore")||input.trend15===true||input.trend15m===true;
 let regime=has(input,"marketRegimeScore")?clamp(input.marketRegimeScore):(regimeAvailable?((input.trend15===true||input.trend15m===true)?84:56):0);
 if(input.overextended===true&&regimeAvailable)regime=Math.max(25,regime-28);
 const dataQualityAvailable=ageAvailable&&priceAvailable;
 const dataQuality=dataQualityAvailable?(age<=90000?100:age<=150000?80:age<=210000?60:0):0;

 const volatilityAvailable=has(input,"explosionScore")||has(input,"compressionScore")||has(input,"atrPct")||has(input,"atrPercent")||has(input,"volatilityRatio");
 let volatility=0;
 if(has(input,"explosionScore"))volatility=clamp(input.explosionScore);
 else if(has(input,"compressionScore"))volatility=clamp(55+finite(input.compressionScore)*35);
 else if(has(input,"volatilityRatio")){const ratio=Math.max(0,finite(input.volatilityRatio));volatility=clamp(78-Math.abs(ratio-1.15)*38);}
 else if(has(input,"atrPct")){const atr=Math.max(0,finite(input.atrPct));volatility=clamp(88-Math.max(0,atr-0.45)*24-Math.max(0,0.18-atr)*65);}
 else if(has(input,"atrPercent")){const atr=Math.max(0,finite(input.atrPercent));volatility=clamp(88-Math.max(0,atr-0.45)*24-Math.max(0,0.18-atr)*65);}

 const sentimentAvailable=has(input,"sentimentScore")&&(input.sentimentConfirmed===true||!!input.sentimentSource);
 const sentiment=sentimentAvailable?clamp(input.sentimentScore):0;
 const smartMoneyAvailable=has(input,"smartMoneyScore")||input.smartMoneyConfirmed===true;
 const smartMoney=has(input,"smartMoneyScore")?clamp(input.smartMoneyScore):(input.smartMoneyConfirmed===true&&flowAvailable&&direction?clamp(50+flowImbalance*direction*180):0);
 const scenarioAvailable=has(input,"scenarioScore")||has(input,"riskRewardRatio");
 const riskReward=Math.max(0,finite(input.riskRewardRatio));
 const scenario=has(input,"scenarioScore")?clamp(input.scenarioScore):(scenarioAvailable?clamp(48+(riskReward-1)*24):0);
 const riskAvailable=has(input,"riskScore")||has(input,"stopDistancePct")||has(input,"riskPercent");
 const stopDistance=Math.max(0,finite(input.stopDistancePct??input.riskPercent));
 const risk=has(input,"riskScore")?clamp(input.riskScore):(riskAvailable?clamp(100-Math.max(0,stopDistance-1.25)*24-Math.max(0,0.25-stopDistance)*70):0);

 const parts={momentum,flow,structure,liquidity,multiTimeframe,regime,volatility,sentiment,smartMoney,scenario,risk,dataQuality};
 const availability={momentum:momentumAvailable,flow:flowAvailable,structure:structureAvailable,liquidity:liquidityAvailable,
  multiTimeframe:multiTimeframeAvailable,regime:regimeAvailable,volatility:volatilityAvailable,sentiment:sentimentAvailable,
  smartMoney:smartMoneyAvailable,scenario:scenarioAvailable,risk:riskAvailable,dataQuality:dataQualityAvailable};
 const activeWeight=Object.entries(QUANTUM_SCORE_WEIGHTS).reduce((sum,[key,weight])=>sum+(availability[key]?weight:0),0);
 const score=activeWeight>0?Math.round(Object.entries(QUANTUM_SCORE_WEIGHTS).reduce((sum,[key,weight])=>sum+(availability[key]?parts[key]*weight:0),0)/activeWeight):0;
 const confidence=Math.round(clamp((dataQualityAvailable?dataQuality*.35:0)+(multiTimeframeAvailable?multiTimeframe*.25:0)+(liquidityAvailable?liquidity*.20:0)+(flowAvailable?20:0)+(volatilityAvailable?5:0)+(smartMoneyAvailable?5:0)));
 const totalVolumeAvailable=has(input,"totalVolume24h");
 const liquidityConfirmed=totalVolumeAvailable&&finite(input.totalVolume24h)>=150000;
 const candidateGate=priceAvailable&&fresh&&changesAvailable&&direction!==0&&structureAvailable&&volumeAvailable&&dataQuality>=80&&multiTimeframe>=50&&liquidity>=25&&liquidityConfirmed&&volumeRatio>=1.1&&input.overextended!==true;
 const flowAligned=flowAvailable&&direction!==0&&flowImbalance*direction>=0.045;
 const volumeConfirmed=volumeAvailable&&volumeRatio>=1.1;
 const multiExchangeConfirmed=input.multiExchangeConfirmed===true;
 const depthConfirmed=input.requireDepthConfirmation===true?input.depthConfirmed===true:null;
 const depthGate=input.requireDepthConfirmation!==true||depthConfirmed===true;
 const qualityGate=candidateGate&&flowAligned&&volumeConfirmed&&multiExchangeConfirmed&&depthGate;
 const missingEvidence=Object.entries({price:priceAvailable,dataAge:ageAvailable&&fresh,multiTimeframe:changesAvailable,trend:direction!==0,structure:structureAvailable,volume:volumeAvailable,marketLiquidity:liquidityConfirmed,multiExchange:multiExchangeConfirmed,executedFlow:flowAvailable}).filter(([,ok])=>!ok).map(([key])=>key);
 return {
  engine:QUANTUM_ENGINE_NAME,version:QUANTUM_ENGINE_VERSION,score:clamp(score,0,99),confidence,
  components:Object.fromEntries(Object.entries(parts).map(([key,value])=>[key,Math.round(value)])),
  componentAvailability:availability,weights:QUANTUM_SCORE_WEIGHTS,activeWeight:Number(activeWeight.toFixed(3)),
  dataAgeMs:Number.isFinite(age)?age:null,flowValidated:flowAvailable,flowAligned,volumeConfirmed,
  multiExchangeConfirmed,depthConfirmed,candidateGate,qualityGate,missingEvidence
 };
}

export function analyzeQuantumMarketRegime(input={}){
 const breadth=clamp(input.breadthScore??50),btc=clamp(input.btcTrendScore??50),volume=clamp(input.marketVolumeScore??50),volatility=clamp(input.marketVolatilityScore??50);
 const score=Math.round(breadth*.4+btc*.3+volume*.2+volatility*.1);
 const state=score>=68?"bull":score<=38?"bear":"neutral";
 const riskMode=volatility>=82||score<30?"defensive":score>=68&&breadth>=60?"risk_on":"balanced";
 return {engine:QUANTUM_ENGINE_NAME,version:QUANTUM_ENGINE_VERSION,score,state,riskMode,components:{breadth,btc,volume,volatility},evaluatedAt:new Date().toISOString()};
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
