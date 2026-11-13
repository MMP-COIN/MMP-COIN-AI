import { runDigitalHunterMarketCycle, loadFuturesMarketFlow } from "./worker.js";
import { QUANTUM_ENGINE_NAME, QUANTUM_ENGINE_VERSION } from "./quantum-core.js";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/health"&&request.method==="GET")return json({status:"online",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,market:"futures",d1:!!env.ADMIN_DB});
  if(url.pathname==="/market-flow"&&request.method==="GET"){
   if(!env.FUTURES_ENGINE_TOKEN||request.headers.get("X-MMP-Futures-Token")!==env.FUTURES_ENGINE_TOKEN)return json({error:"Unauthorized"},401);
   const symbol=String(url.searchParams.get("symbol")||"").toUpperCase(),windowMinutes=url.searchParams.get("window")||1;
   if(!/^[A-Z0-9]{2,24}(USDT)?$/.test(symbol))return json({error:"Invalid Futures symbol"},400);
   try{return json(await loadFuturesMarketFlow(symbol,windowMinutes),200);}
   catch(error){return json({error:String(error?.message||error).slice(0,260)},502);}
  }
  if(url.pathname==="/run"&&request.method==="POST"){
   if(!env.FUTURES_ENGINE_TOKEN||request.headers.get("X-MMP-FUTURES-TOKEN")!==env.FUTURES_ENGINE_TOKEN)return json({error:"Unauthorized"},401);
   if(!env.ADMIN_DB)return json({error:"ADMIN_DB binding missing"},503);
   try{return json(await runDigitalHunterMarketCycle(env,"futures"));}
   catch(error){return json({error:String(error?.message||error).slice(0,240),engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION},502);}
  }
  return json({error:"Not found"},404);
 },
 async scheduled(event,env,ctx){
  if(!env.ADMIN_DB)throw new Error("ADMIN_DB binding missing");
  const tetherMonitor=(async()=>{
   const row=await env.ADMIN_DB.prepare("SELECT payload FROM hunter_engine_state WHERE id = ?").bind("local-tether-watch").first();
   let saved=null;try{saved=row?.payload?JSON.parse(row.payload):null;}catch{}
   const updated=Date.parse(saved?.monitor_updated_at||saved?.checked_at||"");
   if(!Number.isFinite(updated)||Date.now()-updated>120000){
    if(!env.TETHER_MONITOR?.fetch)throw new Error("Tether service binding unavailable while monitor snapshot is stale");
    const response=await env.TETHER_MONITOR.fetch(new Request("https://tether-monitor.internal/run",{method:"POST",headers:{"Content-Type":"application/json"}}));
    if(!response.ok)throw new Error("Tether monitor HTTP "+response.status);
    const result=await response.json();
    console.log("Futures Cron Tether fallback run",JSON.stringify({status:result.status,source_count:result.source_count,checked_at:result.checked_at}));
   }
  })().catch(error=>console.error("Futures Cron Tether monitor fallback failed:",error?.message||error));
  if(ctx?.waitUntil)ctx.waitUntil(tetherMonitor);else await tetherMonitor;
  const id="digital-hunter-futures-cron-heartbeat",started=Date.now(),stamp=new Date(started).toISOString();
  const save=payload=>env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind(id,JSON.stringify(payload),payload.updated_at||new Date().toISOString()).run();
  await save({status:"started",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,market:"futures",cron:event?.cron||"* * * * *",scheduledTime:event?.scheduledTime||null,updated_at:stamp});
  let timer;
  try{
   const result=await Promise.race([
    runDigitalHunterMarketCycle(env,"futures"),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Futures cycle timeout after 48000ms")),48000);})
   ]);
   const finished=Date.now(),hasDataFailures=Number(result.failed_count||0)>0,hasQualityRejections=Number(result.rejected_count||0)>0,hasIncompleteCycle=!!result.universe_refreshed||!!result.universe_stale||Number(result.scanned_count||0)===0;
   const payload={status:hasDataFailures||hasQualityRejections||hasIncompleteCycle?"partial":"success",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,market:"futures",cron:event?.cron||"* * * * *",scheduledTime:event?.scheduledTime||null,startedAt:stamp,finishedAt:new Date(finished).toISOString(),updated_at:new Date(finished).toISOString(),market_data:{queue_position:result.queue_position||0,scanned:result.scanned_count||0,preliminary:result.preliminary_signals?.length||0,failed:result.failed_count||0,rejected:result.rejected_count||0,cooldown_count:result.cooldown_count||0,universe_refreshed:result.universe_refreshed===true,universe:result.universe_count||0,signals:result.signals?.length||0,last_errors:result.last_errors||[],last_rejections:result.last_rejections||[]}};
   await save(payload);
  }catch(error){
   const finished=Date.now(),payload={status:"error",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,market:"futures",cron:event?.cron||"* * * * *",scheduledTime:event?.scheduledTime||null,startedAt:stamp,finishedAt:new Date(finished).toISOString(),updated_at:new Date(finished).toISOString(),error:String(error?.message||error).slice(0,240)};
   await save(payload);
   throw error;
  }finally{clearTimeout(timer);}
 }
};