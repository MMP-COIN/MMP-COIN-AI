import { refreshDigitalHunterUniverses } from "./worker.js";
import { QUANTUM_ENGINE_NAME, QUANTUM_ENGINE_VERSION } from "./quantum-core.js";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/health"&&request.method==="GET")return json({status:"online",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,role:"hourly-universe-refresh",d1:!!env.ADMIN_DB});
  if(url.pathname==="/status"&&request.method==="GET"){
   if(!env.ADMIN_DB)return json({status:"unavailable",error:"ADMIN_DB binding missing"},503);
   const row=await env.ADMIN_DB.prepare("SELECT payload,updated_at FROM hunter_engine_state WHERE id = ?").bind("digital-hunter-universe-refresh").first();
   let payload={};try{payload=JSON.parse(row?.payload||"{}");}catch{}
   return json({status:payload.status||"pending",updated_at:row?.updated_at||null,markets:payload.markets||{},errors:payload.errors||{}});
  }
  return json({error:"Not found"},404);
 },
 async scheduled(event,env){
  if(!env.ADMIN_DB)throw new Error("ADMIN_DB binding missing");
  const id="digital-hunter-universe-refresh-heartbeat",started=Date.now(),cron=event?.cron||"*/15 * * * *";
  const save=payload=>env.ADMIN_DB.prepare("INSERT INTO hunter_engine_state (id,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind(id,JSON.stringify(payload),payload.updated_at||new Date().toISOString()).run();
  await save({status:"started",cron,scheduledTime:event?.scheduledTime||null,startedAt:new Date(started).toISOString(),updated_at:new Date(started).toISOString()});
  try{
   const result=await refreshDigitalHunterUniverses(env),finished=Date.now();
   await save({status:result.status,cron,scheduledTime:event?.scheduledTime||null,startedAt:new Date(started).toISOString(),finishedAt:new Date(finished).toISOString(),updated_at:new Date(finished).toISOString(),markets:result.markets,errors:result.errors});
   console.log("Hunter universe refresh",JSON.stringify({status:result.status,updated_at:result.updated_at,markets:result.markets,errors:result.errors,cron}));
   if(result.status==="error")throw new Error("Hunter universe refresh failed: "+JSON.stringify(result.errors));
  }catch(error){
   const finished=Date.now(),message=String(error?.message||error).slice(0,240);
   await save({status:"error",cron,scheduledTime:event?.scheduledTime||null,startedAt:new Date(started).toISOString(),finishedAt:new Date(finished).toISOString(),updated_at:new Date(finished).toISOString(),error:message});
   throw error;
  }
 }
};