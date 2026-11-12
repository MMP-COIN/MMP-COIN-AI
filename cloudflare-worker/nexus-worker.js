const DEFAULT_ANALYZER = "https://mmp-coin-ai-analyzer.mehrdadmohammadi1988.workers.dev";
const DEFAULT_RADAR = "https://mmp-coin-ai-radar.mehrdadmohammadi1988.workers.dev";
const ORIGINS = new Set(["https://mmp-coin.github.io","https://localhost","capacitor://localhost","ionic://localhost","http://localhost"]);
const safe = value => String(value ?? "").replace(/[\u0000-\u001f]/g," ").slice(0,240);
const json = (value,status=200,request=null) => {
  const origin=request?.headers.get("Origin")||"";
  const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Vary":"Origin"};
  if(ORIGINS.has(origin)){headers["Access-Control-Allow-Origin"]=origin;headers["Access-Control-Allow-Methods"]="GET, OPTIONS";headers["Access-Control-Allow-Headers"]="Content-Type";headers["Access-Control-Max-Age"]="86400";}
  return new Response(JSON.stringify(value),{status,headers});
};
async function probe(url,timeoutMs=12000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{headers:{"Accept":"application/json","Cache-Control":"no-cache"},signal:controller.signal});
    const raw=await response.text();
    if(!response.ok)throw new Error("HTTP "+response.status+" "+raw.slice(0,140));
    let data;try{data=JSON.parse(raw);}catch{throw new Error("Invalid JSON response");}
    return {ok:true,data};
  }catch(error){return {ok:false,error:safe(error?.message||error)};}
  finally{clearTimeout(timer);}
}
async function readState(db,key){
  const row=await db.prepare("SELECT value FROM nexus_state WHERE key=?").bind(key).first();
  return row?.value??null;
}
async function writeState(db,key,value){
  await db.prepare("INSERT INTO nexus_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .bind(key,String(value),new Date().toISOString()).run();
}
function ageSeconds(timestamp){
  const time=Date.parse(timestamp||"");
  return Number.isFinite(time)?Math.max(0,Math.round((Date.now()-time)/1000)):null;
}
function flowHealthy(result){
  const flow=result?.flow||{};
  return flow.available===true&&flow.complete===true&&Number(flow.trade_count??flow.tradeCount)>0;
}
async function runCycle(env){
  const analyzer=env.ANALYZER_URL||DEFAULT_ANALYZER,radar=env.RADAR_URL||DEFAULT_RADAR;
  const urls=[
    analyzer+"/health",
    analyzer+"/connections-health",
    analyzer+"/hunter-snapshot",
    analyzer+"/futures-engine-health",
    analyzer+"/hunter-futures-snapshot",
    radar+"/health",
    radar+"/fast-radar-snapshot",
    radar+"/last-error",
    analyzer+"/market-orderflow?symbol=BTCUSDT&market=spot",
    analyzer+"/market-orderflow?symbol=BTCUSDT&market=futures"
  ];
  const results=await Promise.all(urls.map((url,i)=>probe(url,i===1?20000:12000)));
  const data=results.map(x=>x.ok?x.data:null);
  const [health,connections,spot,futuresHealth,futures,radarHealth,radarSnapshot,radarError,spotFlow,futuresFlow]=data;
  const connectionChecks=Array.isArray(connections?.checks)?connections.checks:[];
  const connectionOk=connectionChecks.filter(x=>x.status==="ok"||x.status==="slow").length;
  const connectionStatus=!connectionChecks.length?"unknown":connectionOk===connectionChecks.length?"ok":connectionOk>0?"slow":"down";
  const qieNames=["momentum","flow","structure","liquidity","multiTimeframe","regime","volatility","sentiment","smartMoney","scenario","risk","dataQuality"];
  const spotActivity=spot?.engine_activity||{},futuresActivity=futures?.engine_activity||{};
  const qieEvidence=qieNames.map(name=>({name,processed:(Number(spotActivity[name]?.processed)||0)+(Number(futuresActivity[name]?.processed)||0),evidence:(Number(spotActivity[name]?.evidence)||0)+(Number(futuresActivity[name]?.evidence)||0)}));
  const qieActive=qieEvidence.filter(x=>x.processed>0&&x.evidence>0).length;
  const radarAge=ageSeconds(radarSnapshot?.scanned_at);
  const radarFresh=radarHealth?.worker==="online"&&radarSnapshot?.status==="online"&&radarAge!==null&&radarAge<=180;
  const spotHealthy=["online","success"].includes(spot?.status);
  const futuresHealthy=futuresHealth?.status==="online"&&futuresHealth?.service_binding==="connected"&&["online","success"].includes(futures?.status);
  const spotFlowOk=flowHealthy(spotFlow),futuresFlowOk=flowHealthy(futuresFlow);
  const services=[
    {name:"Analyzer Worker",status:health?.worker==="online"&&health?.ai_binding===true?"ok":"down",detail:"AI binding="+String(health?.ai_binding===true)+" · "+safe(health?.engine_version||"no version")},
    {name:"Exchange connections",status:connectionStatus,detail:connectionOk+"/"+connectionChecks.length+" healthy checks"},
    {name:"Spot Hunter",status:spotHealthy?"ok":"down",detail:"status="+safe(spot?.status||results[2].error||"no snapshot")},
    {name:"Futures Hunter",status:futuresHealthy?"ok":"down",detail:"engine="+safe(futuresHealth?.status||results[3].error||"no health")+" · snapshot="+safe(futures?.status||results[4].error||"no snapshot")},
    {name:"Radar Worker",status:radarHealth?.worker==="online"?"ok":"down",detail:safe(radarHealth?.engine_version||results[5].error||"no health")},
    {name:"Radar Snapshot",status:radarFresh?"ok":radarSnapshot?.status==="online"?"slow":"down",detail:radarAge===null?"timestamp missing":radarAge+"s old"},
    {name:"Spot executed-trade flow",status:spotFlowOk?"ok":"down",detail:safe(spotFlow?.flow?.source||results[8].error||"no provider")+" · trades="+Number(spotFlow?.flow?.trade_count||0)+" · complete="+String(spotFlow?.flow?.complete===true)},
    {name:"Futures executed-trade flow",status:futuresFlowOk?"ok":"down",detail:safe(futuresFlow?.flow?.source||results[9].error||"no provider")+" · trades="+Number(futuresFlow?.flow?.trade_count||0)+" · complete="+String(futuresFlow?.flow?.complete===true)},
    {name:"QIE evidence coverage",status:qieActive===qieNames.length?"ok":qieActive>0?"slow":"down",detail:qieActive+"/"+qieNames.length+" specialists with processed evidence"}
  ];
  const issues=[];
  const issue=(component,severity,evidence,recommendation)=>issues.push({component,severity,evidence:safe(evidence),recommendation:safe(recommendation)});
  if(!health||health.worker!=="online")issue("Analyzer Worker","critical",results[0].error||"health endpoint did not report online","Check Worker deployment, runtime errors and service bindings");
  if(!health?.ai_binding)issue("AI binding","critical","Analyzer health reports AI binding unavailable","Restore the Workers AI binding and verify a real model invocation");
  if(!spotHealthy)issue("Spot Hunter","critical",results[2].error||"Spot snapshot status is not online","Inspect Spot scan logs and supported exchange fallbacks; retry only the existing scan cycle");
  if(!futuresHealthy)issue("Futures Hunter","critical",results[3].error||results[4].error||"Futures engine or snapshot is not healthy","Check Futures service binding and D1 health; retry only the existing scan cycle");
  if(!radarFresh)issue("Radar","warning",radarAge===null?(results[6].error||"Radar snapshot timestamp missing"):"snapshot age "+radarAge+" seconds; last error="+safe(radarError?.message||radarError?.error||"none"),"Check Radar Worker, Cron execution, scanned_at freshness and last-error endpoint");
  if(!spotFlowOk)issue("Spot executed-trade flow","warning",results[8].error||("available="+String(spotFlow?.flow?.available)+" complete="+String(spotFlow?.flow?.complete)+" trades="+Number(spotFlow?.flow?.trade_count||0)),"Inspect provider pagination and fallback evidence; never label partial trades as complete");
  if(!futuresFlowOk)issue("Futures executed-trade flow","warning",results[9].error||("available="+String(futuresFlow?.flow?.available)+" complete="+String(futuresFlow?.flow?.complete)+" trades="+Number(futuresFlow?.flow?.trade_count||0)),"Inspect Futures provider pagination, exchange access and trade-window completeness");
  if(qieActive<qieNames.length)issue("QIE specialist evidence","warning",qieEvidence.filter(x=>!(x.processed>0&&x.evidence>0)).map(x=>x.name).join(", ")+" lack processed evidence","Inspect the missing specialist input feeds and activate only after verified evidence exists");
  if(connectionStatus==="down")issue("Exchange connections","critical","No exchange check is currently healthy","Check provider connectivity and supported alternate endpoints");
  const blocked=connectionChecks.filter(x=>/403|451/.test(JSON.stringify(x)));
  if(blocked.length)issue("Exchange access","warning",blocked.slice(0,5).map(x=>safe(x.name||x.exchange)+" "+safe(x.status||x.error)).join(" · "),"Use only officially supported alternate providers; do not bypass geographic or legal restrictions");
  const snapshot={checked_at:new Date().toISOString(),services,issues,radar:{age_seconds:radarAge,last_error:safe(radarError?.message||radarError?.error||radarError?.status||"none")},spot_flow:{complete:spotFlowOk,trade_count:Number(spotFlow?.flow?.trade_count||0)},futures_flow:{complete:futuresFlowOk,trade_count:Number(futuresFlow?.flow?.trade_count||0)}};
  const actions=[];
  const lastRepair=Number(await readState(env.NEXUS_DB,"last_repair_at")||0);
  if(Date.now()-lastRepair>=600000){
    const repairTargets=[];
    if(!spotHealthy)repairTargets.push({name:"Spot Hunter",url:analyzer+"/hunter-run"});
    if(!futuresHealthy)repairTargets.push({name:"Futures Hunter",url:analyzer+"/hunter-futures-run"});
    if(repairTargets.length){
      await writeState(env.NEXUS_DB,"last_repair_at",Date.now());
      for(const target of repairTargets){
        const result=await probe(target.url,45000);
        actions.push({action:"safe_retry",target:target.name,status:result.ok?"accepted":"failed",detail:result.ok?"existing scan cycle re-run requested":result.error});
      }
    }
  }
  let severity=issues.some(x=>x.severity==="critical")?"critical":issues.length?"warning":"healthy";
  let summary=issues.length?issues.length+" issue(s) detected from live telemetry":"All monitored services passed the current health checks";
  let nextChecks=issues.map(x=>x.component+": "+x.recommendation).slice(0,6),provider="deterministic health rules";
  const lastAI=Number(await readState(env.NEXUS_DB,"last_ai_at")||0);
  const utcDay=new Date().toISOString().slice(0,10);
  const aiCalls=Number(await readState(env.NEXUS_DB,"ai_calls:"+utcDay)||0);
  let aiIssues=[],upgradeRecommendations=[];
  if(issues.length&&env.AI&&Date.now()-lastAI>=900000&&aiCalls<20){
    try{
      await writeState(env.NEXUS_DB,"last_ai_at",Date.now());
      await writeState(env.NEXUS_DB,"ai_calls:"+utcDay,aiCalls+1);
      const prompt="You are MMP NEXUS, an independent reliability diagnostician. Use only these observed facts. Separate facts from hypotheses. Never bypass 403/451 restrictions. Only recommend bounded reversible actions already exposed; never claim source code or secrets were changed. Return JSON with severity, summary, issues, upgrade_recommendations, next_checks. Telemetry: "+JSON.stringify(snapshot)+" Actions: "+JSON.stringify(actions);
      const response=await env.AI.run("@cf/openai/gpt-oss-120b",{messages:[{role:"system",content:"Return one valid JSON object only. No markdown."},{role:"user",content:prompt}],max_tokens:1200,temperature:0.2});
      const raw=response?.choices?.[0]?.message?.content||response?.response||response?.output_text||"";
      const match=String(raw).match(/\{[\s\S]*\}/);
      if(match){
        const parsed=JSON.parse(match[0]);
        if(["healthy","warning","critical"].includes(parsed.severity))severity=parsed.severity;
        if(parsed.summary)summary=safe(parsed.summary);
        if(Array.isArray(parsed.next_checks))nextChecks=parsed.next_checks.slice(0,6).map(safe);
        if(Array.isArray(parsed.issues))aiIssues=parsed.issues.slice(0,6).map(x=>({component:safe(x.component),severity:["info","warning","critical"].includes(x.severity)?x.severity:"warning",evidence:safe(x.evidence),recommendation:safe(x.recommendation)}));
        if(Array.isArray(parsed.upgrade_recommendations))upgradeRecommendations=parsed.upgrade_recommendations.slice(0,6).map(x=>({module:safe(x.module),reason:safe(x.reason),priority:["low","medium","high"].includes(x.priority)?x.priority:"medium"}));
        provider="Cloudflare Workers AI";
      }
    }catch(error){actions.push({action:"ai_diagnosis",status:"fallback",detail:safe(error?.message||error)});}
  }
  snapshot.ai_issues=aiIssues;
  snapshot.upgrade_recommendations=upgradeRecommendations;
  const report={status:"ok",checked_at:snapshot.checked_at,severity,summary,ai_provider:provider,services,issues,ai_issues:aiIssues,upgrade_recommendations:upgradeRecommendations,actions,next_checks:nextChecks,radar:snapshot.radar,spot_flow:snapshot.spot_flow,futures_flow:snapshot.futures_flow,monitor:"server-cron-5m",code_changes_executed:false};
  await env.NEXUS_DB.prepare("INSERT INTO nexus_runs(checked_at,severity,summary,snapshot_json,issues_json,actions_json,ai_provider) VALUES(?,?,?,?,?,?,?)")
    .bind(report.checked_at,severity,summary,JSON.stringify(snapshot),JSON.stringify(issues),JSON.stringify(actions),provider).run();
  await env.NEXUS_DB.prepare("DELETE FROM nexus_runs WHERE id NOT IN (SELECT id FROM nexus_runs ORDER BY id DESC LIMIT 200)").run();
  return report;
}
async function latestReport(env){
  const row=await env.NEXUS_DB.prepare("SELECT * FROM nexus_runs ORDER BY id DESC LIMIT 1").first();
  if(!row)return {status:"warming_up",monitor:"server-cron-5m",message:"Waiting for first scheduled NEXUS cycle"};
  const snapshot=JSON.parse(row.snapshot_json||"{}");
  return {status:"ok",checked_at:row.checked_at,severity:row.severity,summary:row.summary,ai_provider:row.ai_provider,services:snapshot.services||[],issues:JSON.parse(row.issues_json||"[]"),ai_issues:snapshot.ai_issues||[],upgrade_recommendations:snapshot.upgrade_recommendations||[],actions:JSON.parse(row.actions_json||"[]"),next_checks:snapshot.next_checks||[],snapshot,monitor:"server-cron-5m",code_changes_executed:false};
}
export default {
  async fetch(request,env){
    if(request.method==="OPTIONS")return json({status:"ok"},204,request);
    const path=new URL(request.url).pathname;
    if(request.method!=="GET")return json({error:"Method not allowed"},405,request);
    try{
      if(path==="/health"){
        let database="unknown";try{await env.NEXUS_DB.prepare("SELECT 1 AS ok").first();database="ok";}catch{database="error";}
        return json({status:"ok",worker:"online",monitor:"server-cron-5m",database,ai_binding:!!env.AI,checked_at:new Date().toISOString()},200,request);
      }
      if(path==="/status")return json(await latestReport(env),200,request);
      if(path==="/history"){
        const result=await env.NEXUS_DB.prepare("SELECT id,checked_at,severity,summary,ai_provider,issues_json,actions_json FROM nexus_runs ORDER BY id DESC LIMIT 25").all();
        return json({status:"ok",items:(result.results||[]).map(x=>({...x,issues:JSON.parse(x.issues_json||"[]"),actions:JSON.parse(x.actions_json||"[]")}))},200,request);
      }
      return json({error:"Not found"},404,request);
    }catch(error){return json({status:"error",error:safe(error?.message||error)},500,request);}
  },
  async scheduled(event,env,ctx){
    const task=runCycle(env).catch(error=>console.error("MMP NEXUS scheduled cycle failed",safe(error?.message||error)));
    if(ctx?.waitUntil)ctx.waitUntil(task);else await task;
  }
};