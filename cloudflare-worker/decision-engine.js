const finite=value=>Number.isFinite(Number(value))?Number(value):null;
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):min));

/**
 * Single policy gate for final Hunter decisions.
 * Scoring remains in QIE; this layer decides whether evidence is sufficient
 * to publish a directional setup. Missing evidence always resolves to WAIT.
 */
export const QUANTUM_DECISION_VERSION="MMP-CENTRAL-DECISION-1.0.0";
export function decideQuantumSignal(input={}){
 const quantum=input.quantum&&typeof input.quantum==="object"?input.quantum:{};
 const trend=input.trend==="bull"||input.trend==="bear"?input.trend:null;
 const score=clamp(input.score??quantum.score);
 const confidence=finite(quantum.confidence);
 const age=finite(quantum.dataAgeMs??input.dataAgeMs);
 const stop=finite(input.stopDistancePct);
 const checks={
  direction:trend!==null,
  qualityGate:quantum.qualityGate===true,
  scoreThreshold:score>=68,
  confidence:confidence!==null&&confidence>=45,
  freshData:age!==null&&age<=180000,
  executedFlow:quantum.flowValidated===true&&input.flowConfirmed===true,
  multiExchange:quantum.multiExchangeConfirmed===true&&input.multiExchangeConfirmed===true,
  depth:quantum.depthConfirmed===true&&input.depthConfirmed===true,
  riskModel:stop!==null&&stop>0
 };
 const reasons=Object.entries(checks).filter(([,passed])=>!passed).map(([key])=>key);
 const approved=reasons.length===0;
 const direction=trend==="bull"?"LONG":trend==="bear"?"SHORT":null;
 return {
  version:QUANTUM_DECISION_VERSION,
  policy:"fail-closed evidence gate; no AI-generated numeric overrides",
  action:approved?direction:"WAIT",
  status:approved?"approved":"withheld",
  score,
  confidence:confidence===null?null:Math.round(clamp(confidence)),
  riskPercent:stop,
  reasons,
  checks,
  decidedAt:Number.isFinite(Number(input.now))?Number(input.now):Date.now()
 };
}
