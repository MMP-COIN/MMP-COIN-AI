import { runDigitalHunterMarketCycle } from "./worker.js";
import { QUANTUM_ENGINE_NAME, QUANTUM_ENGINE_VERSION } from "./quantum-core.js";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/health"&&request.method==="GET")return json({status:"online",engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION,market:"futures",d1:!!env.ADMIN_DB});
  if(url.pathname==="/run"&&request.method==="POST"){
   if(!env.ADMIN_DB)return json({error:"ADMIN_DB binding missing"},503);
   try{return json(await runDigitalHunterMarketCycle(env,"futures"));}
   catch(error){return json({error:String(error?.message||error).slice(0,240),engine:QUANTUM_ENGINE_NAME,engine_version:QUANTUM_ENGINE_VERSION},502);}
  }
  return json({error:"Not found"},404);
 }
};