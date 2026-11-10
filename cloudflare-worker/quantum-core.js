export const QUANTUM_ENGINE_NAME = "MMP QUANTUM INTELLIGENCE ENGINE";
export const QUANTUM_ENGINE_VERSION = "QIE-4.0.0";

/* Legacy weights retain their relative influence. New specialist engines join
   only when their underlying evidence is actually supplied and validated. */
export const QUANTUM_SCORE_WEIGHTS = Object.freeze({
 momentum:0.18, flow:0.18, structure:0.135, liquidity:0.135,
 multiTimeframe:0.135, regime:0.09, dataQuality:0.045,
 volatility:0.035, sentiment:0.01, smartMoney:0.02, scenario:0.015, risk:0.02
});
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):min));
const finite=value=>Number.isFinite(Number(value))?Number(value):0;
export function calculateMarketScanPriority(item={}){
 const move=Math.min(35,Math.abs(finite(item.hunterChange24h??item.price_change_percentage_24h??item.change24h)));
 const volume=Math.max(50000,finite(item.total_volume??item.totalVolume24h));
 const liquidity=Math.min(18,Math.max(0,Math.log10(volume/50000))*3.6);
 return Number((move*.78+liquidity).toFixed(6));
}
const has=(input,key)=>input[key]!==undefined&&input[key]!==null&&Number.isFinite(Number(input[key]));

export function calculateQuantumIndicators(rows=[]){
 const bars=(Array.isArray(rows)?rows:[]).map(x=>({t:Number(x?.[0]),o:Number(x?.[1]),h:Number(x?.[2]),l:Number(x?.[3]),c:Number(x?.[4]),v:Number(x?.[5])}))
  .filter(x=>Number.isFinite(x.c)&&x.c>0&&Number.isFinite(x.h)&&Number.isFinite(x.l)&&x.h>=x.l&&x.l>0&&Number.isFinite(x.v)&&x.v>=0);
 if(bars.length<55)return {available:false,reason:"insufficient_closed_candles"};
 const closes=bars.map(x=>x.c);
 const emaSeries=(values,period)=>{const k=2/(period+1),out=[];let prev=values.slice(0,period).reduce((a,b)=>a+b,0)/period;for(let i=0;i<values.length;i++){if(i<period-1){out.push(null);continue;}if(i===period-1){out.push(prev);continue;}prev=values[i]*k+prev*(1-k);out.push(prev);}return out;};
 const e9=emaSeries(closes,9),e12=emaSeries(closes,12),e21=emaSeries(closes,21),e26=emaSeries(closes,26),e50=emaSeries(closes,50);
 const gains=[],losses=[],trs=[];
 for(let i=1;i<bars.length;i++){const d=closes[i]-closes[i-1];gains.push(Math.max(0,d));losses.push(Math.max(0,-d));trs.push(Math.max(bars[i].h-bars[i].l,Math.abs(bars[i].h-closes[i-1]),Math.abs(bars[i].l-closes[i-1])));}
 let avgGain=gains.slice(0,14).reduce((a,b)=>a+b,0)/14,avgLoss=losses.slice(0,14).reduce((a,b)=>a+b,0)/14;
 for(let i=14;i<gains.length;i++){avgGain=(avgGain*13+gains[i])/14;avgLoss=(avgLoss*13+losses[i])/14;}
 const rsi14=avgLoss===0?100:100-(100/(1+avgGain/avgLoss));
 const macdValues=closes.map((_,i)=>e12[i]!==null&&e26[i]!==null?e12[i]-e26[i]:null).filter(Number.isFinite);
 const macdSignal=emaSeries(macdValues,9),macd=macdValues.at(-1),signal=macdSignal.at(-1),macdHistogram=macd-signal;
 const atr14=trs.slice(-14).reduce((a,b)=>a+b,0)/Math.min(14,trs.length),last=bars.at(-1),atrPct=last.c>0?atr14/last.c*100:null;
 const recent=bars.slice(-30),vwapVolume=recent.reduce((a,b)=>a+b.v,0),vwap=vwapVolume>0?recent.reduce((a,b)=>a+((b.h+b.l+b.c)/3)*b.v,0)/vwapVolume:null;
 const vwapDeviationPct=vwap>0?(last.c/vwap-1)*100:null;
 const prior=bars.slice(-21,-1),priorHigh=Math.max(...prior.map(x=>x.h)),priorLow=Math.min(...prior.map(x=>x.l));
 const obv=[];let running=0;for(let i=1;i<bars.length;i++){running+=bars[i].c>bars[i-1].c?bars[i].v:bars[i].c<bars[i-1].c?-bars[i].v:0;obv.push(running);}
 const obvChange=obv.length>=20?obv.at(-1)-obv.at(-20):0;
 const ema9=e9.at(-1),ema21=e21.at(-1),ema50=e50.at(-1);
 return {available:[ema9,ema21,ema50,rsi14,macdHistogram,atrPct,vwap,vwapDeviationPct].every(Number.isFinite),ema9,ema21,ema50,rsi14,macdHistogram,atr14,atrPct,vwap,vwapDeviationPct,obvChange,obvTrend:Math.sign(obvChange),breakoutUp:last.c>priorHigh,breakoutDown:last.c<priorLow,trendUp:ema9>ema21&&ema21>ema50&&macdHistogram>=0,trendDown:ema9<ema21&&ema21<ema50&&macdHistogram<=0};
}

export function scoreQuantumOpportunity(input={}){
 const direction=input.trend==="bull"?1:input.trend==="bear"?-1:0;
 const changes=[input.change1m??input.m1,input.change3m??input.m3,input.change5m??input.m5,input.change15m??input.m15];
 const changesAvailable=changes.every(value=>value!==undefined&&value!==null&&Number.isFinite(Number(value)));
 const price=finite(input.currentPrice??input.price);
 const priceAvailable=price>0;
 const ageAvailable=has(input,"dataAgeMs");
 const age=ageAvailable?Math.max(0,finite(input.dataAgeMs)):Infinity;
 const fresh=ageAvailable&&age<=180000;
 const momentumAvailable=changesAvailable;
 const momentum=momentumAvailable?clamp(28+Math.abs(Number(changes[0]))*11+Math.abs(Number(changes[1]))*7+Math.abs(Number(changes[2]))*4+Math.abs(Number(changes[3]))*1.2):0;
 const flowAvailable=input.flowConfirmed===true&&has(input,"flowImbalance");
 const flowImbalance=flowAvailable?finite(input.flowImbalance):0;
 const flow=flowAvailable&&direction?clamp(50+flowImbalance*direction*250):0;
 const technicalAvailable=has(input,"rsi14")&&has(input,"ema9")&&has(input,"ema21")&&has(input,"ema50")&&has(input,"macdHistogram");
 const technicalAligned=technicalAvailable&&direction!==0&&(direction>0?Number(input.ema9)>Number(input.ema21)&&Number(input.ema21)>Number(input.ema50)&&Number(input.macdHistogram)>=0&&Number(input.rsi14)>=50&&Number(input.rsi14)<=78:Number(input.ema9)<Number(input.ema21)&&Number(input.ema21)<Number(input.ema50)&&Number(input.macdHistogram)<=0&&Number(input.rsi14)>=22&&Number(input.rsi14)<=50);
 const structureAvailable=(input.breakout!==undefined||input.structureAligned!==undefined||input.structure!==undefined)&&technicalAvailable;
 const structure=structureAvailable?(input.breakout===true&&technicalAligned?100:input.structureAligned===true&&technicalAligned?82:technicalAligned?68:28):0;
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
 const dataQuality=dataQualityAvailable?(age<=180000?100:age<=240000?80:0):0;

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
 // QIE-4 adaptive weighting: weights shift only when the corresponding market evidence exists.
 const adaptiveProfile=regimeAvailable?(regime>=68?"risk_on":regime<=38?"defensive":volatilityAvailable&&volatility>=82?"high_volatility":"balanced"):(volatilityAvailable&&volatility>=82?"high_volatility":"balanced");
 const effectiveWeights={...QUANTUM_SCORE_WEIGHTS};
 if(adaptiveProfile==="risk_on"){
  effectiveWeights.momentum*=1.12;effectiveWeights.flow*=1.16;effectiveWeights.structure*=1.12;
  effectiveWeights.multiTimeframe*=1.10;effectiveWeights.risk*=1.08;
 }else if(adaptiveProfile==="defensive"){
  effectiveWeights.risk*=1.65;effectiveWeights.dataQuality*=1.35;effectiveWeights.liquidity*=1.22;
  effectiveWeights.momentum*=0.78;effectiveWeights.volatility*=1.20;effectiveWeights.sentiment*=0.70;
 }else if(adaptiveProfile==="high_volatility"){
  effectiveWeights.volatility*=1.45;effectiveWeights.risk*=1.38;effectiveWeights.liquidity*=1.18;
  effectiveWeights.momentum*=0.86;effectiveWeights.sentiment*=0.75;
 }
 if(!flowAvailable)effectiveWeights.flow=0;
 if(!smartMoneyAvailable)effectiveWeights.smartMoney=0;
 if(!sentimentAvailable)effectiveWeights.sentiment=0;
 if(!scenarioAvailable)effectiveWeights.scenario=0;
 const activeWeight=Object.entries(effectiveWeights).reduce((sum,[key,weight])=>sum+(availability[key]?weight:0),0);
 const weightedScore=activeWeight>0?Object.entries(effectiveWeights).reduce((sum,[key,weight])=>sum+(availability[key]?parts[key]*weight:0),0)/activeWeight:0;
 const evidenceCoverage=Object.values(availability).filter(Boolean).length/Object.keys(availability).length;
 const rawScore=weightedScore;
 const overextensionPenalty=input.overextended===true?8:0;
 const stalePenalty=ageAvailable&&age>120000?Math.min(12,(age-120000)/15000):0;
 const score=Math.round(clamp(rawScore-overextensionPenalty-stalePenalty,0,99));
 const confidence=Math.round(clamp((dataQualityAvailable?dataQuality*.32:0)+(multiTimeframeAvailable?multiTimeframe*.23:0)+(liquidityAvailable?liquidity*.18:0)+(flowAvailable?12:0)+(volatilityAvailable?5:0)+(smartMoneyAvailable?5:0)+(sentimentAvailable?3:0)+(evidenceCoverage*12)));
 const totalVolumeAvailable=has(input,"totalVolume24h");
 const liquidityConfirmed=totalVolumeAvailable&&finite(input.totalVolume24h)>=150000;
 const candidateGate=priceAvailable&&fresh&&changesAvailable&&direction!==0&&structureAvailable&&technicalAligned&&volumeAvailable&&dataQuality>=80&&multiTimeframe>=50&&liquidity>=25&&liquidityConfirmed&&volumeRatio>=1.1&&input.overextended!==true;
 const flowAligned=flowAvailable&&direction!==0&&flowImbalance*direction>=0.045;
 const volumeConfirmed=volumeAvailable&&volumeRatio>=1.1;
 const multiExchangeConfirmed=input.multiExchangeConfirmed===true;
 const depthConfirmed=input.requireDepthConfirmation===true?input.depthConfirmed===true:null;
 const depthGate=input.requireDepthConfirmation!==true||depthConfirmed===true;
 const qualityGate=candidateGate&&flowAligned&&volumeConfirmed&&multiExchangeConfirmed&&depthGate;
 const missingEvidence=Object.entries({price:priceAvailable,dataAge:ageAvailable&&fresh,multiTimeframe:changesAvailable,trend:direction!==0,structure:structureAvailable,technicalAlignment:technicalAligned,volume:volumeAvailable,marketLiquidity:liquidityConfirmed,multiExchange:multiExchangeConfirmed,executedFlow:flowAvailable}).filter(([,ok])=>!ok).map(([key])=>key);
 return {
  engine:QUANTUM_ENGINE_NAME,version:QUANTUM_ENGINE_VERSION,score:clamp(score,0,99),confidence,
  adaptiveProfile,evidenceCoverage:Number(evidenceCoverage.toFixed(3)),rawScore:Number(rawScore.toFixed(2)),
  qualityTier:confidence>=82&&evidenceCoverage>=0.72?"A":confidence>=65&&evidenceCoverage>=0.55?"B":confidence>=45?"C":"INSUFFICIENT",
  components:Object.fromEntries(Object.entries(parts).map(([key,value])=>[key,Math.round(value)])),
  componentAvailability:availability,weights:QUANTUM_SCORE_WEIGHTS,effectiveWeights,activeWeight:Number(activeWeight.toFixed(3)),
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
