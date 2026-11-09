(function(){
"use strict";
let snapshot=null,subscribers=new Set();
function read(){try{snapshot=JSON.parse(localStorage.getItem("mmp_quantum_snapshot_v1")||"null")}catch(e){snapshot=null}return snapshot}
function publish(next){if(!next||!Array.isArray(next.opportunities))return;snapshot=next;window.dispatchEvent(new CustomEvent("mmp-quantum-snapshot",{detail:next}));subscribers.forEach(fn=>{try{fn(next)}catch(e){}});render(next)}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
function render(data){
 const host=document.getElementById("mmp-quantum-live-opportunities");if(!host)return;
 const valid=!!(data&&Array.isArray(data.opportunities)&&Number.isFinite(Number(data.generatedAt)));
 if(!valid){host.innerHTML='<div class="mql-live-top"><div class="mql-live-title"><i class="mql-orbit"></i><div><b>مرکز کوانتومی MMP</b><small>QUANTUM INTELLIGENCE · خروجی اسکن</small></div></div><span class="mql-state waiting">در انتظار داده</span></div><div class="mql-empty">هنوز خروجی معتبری از چرخهٔ آزمایشگاه ثبت نشده است.</div>';return}
 const qualified=data.opportunities.filter(x=>x&&Number(x.score)>=55);const rows=qualified.slice(0,6);
 const scanned=Math.max(0,Number(data.scanned)||0),stamp=new Date(Number(data.generatedAt));
 const time=Number.isNaN(stamp.getTime())?"زمان نامشخص":stamp.toLocaleString("fa-IR");
 const state=scanned>0?"ثبت‌شده":"بدون چرخه";
 const cards=rows.map(x=>{const score=Math.max(0,Math.min(100,Number(x.score)||0));const dir=x.direction==="bull"?"up":x.direction==="bear"?"down":"wait";const label=dir==="up"?"صعودی":dir==="down"?"نزولی":"خنثی";return '<a class="mql-opportunity '+dir+'" href="/quantum-lab.html"><span class="mql-coin">'+esc(x.symbol)+'</span><span class="mql-direction">'+label+'</span><span class="mql-score"><b>'+score.toLocaleString("fa-IR")+'</b><i><em style="width:'+score+'%"></em></i></span></a>'}).join("");
 host.innerHTML='<div class="mql-live-top"><div class="mql-live-title"><i class="mql-orbit"></i><div><b>مرکز کوانتومی MMP</b><small>QUANTUM INTELLIGENCE · آخرین خروجی ثبت‌شده · مرکز کوانتومی</small></div></div><span class="mql-state '+(scanned>0?"ready":"waiting")+'"><i></i>'+state+'</span></div><div class="mql-live-metrics"><div><small>ارز بررسی‌شده</small><b>'+scanned.toLocaleString("fa-IR")+'</b></div><div><small>فرصت‌های ۵۵+</small><b>'+qualified.length.toLocaleString("fa-IR")+'</b></div><div><small>حداقل امتیاز</small><b>۵۵</b></div></div>'+(rows.length?'<div class="mql-opportunities">'+cards+'</div>':(scanned>0?'<div class="mql-empty">در این چرخه فرصت تأییدشده با امتیاز ۵۵ یا بالاتر ثبت نشده است.</div>':'<div class="mql-empty">این خروجی هنوز چرخهٔ اسکن معتبری ندارد؛ عدد صفر به معنی نبود فرصت در بازار نیست.</div>'))+'<div class="mql-live-foot"><span>آخرین ثبت: '+esc(time)+'</span><a href="/quantum-lab.html">ورود به مرکز کوانتومی ←</a></div>';
}
function mount(){
 const hero=document.querySelector(".quantum-command-hero")||document.querySelector(".hero");
 if(hero&&!document.getElementById("mmp-quantum-live-opportunities")){
  const style=document.createElement("style");style.id="mmp-quantum-lab-launcher-style";
  style.textContent="#mmp-quantum-lab-launcher{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:12px 0 18px;padding:16px 18px;border:1px solid #80683f;border-radius:16px;background:radial-gradient(ellipse at 8% 0%,#d9b66d20,transparent 45%),linear-gradient(120deg,#171b24,#101722 65%,#211b12);box-shadow:0 12px 35px #0006}\\n#mmp-quantum-lab-launcher .mql-copy{min-width:0;flex:1}\\n#mmp-quantum-lab-launcher b{display:block;color:#f5dda2;font-size:15px}\\n#mmp-quantum-lab-launcher small{display:block;color:#aab4c3;font-size:11px;line-height:1.9;margin-top:5px}\\n#mmp-quantum-lab-launcher a{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:9px 15px;border-radius:10px;background:linear-gradient(120deg,#a77c35,#e8cd8c);color:#17130a;text-decoration:none;font-weight:900;font-size:12px;white-space:nowrap}\\n#mmp-quantum-lab-launcher .mql-mark{color:#d9b66d;font-size:22px;margin-left:8px}\\n#mmp-quantum-live-opportunities{position:relative;isolation:isolate;overflow:hidden;margin:0 0 18px;padding:13px 15px;border:1px solid #8c713c66;border-radius:15px;background:radial-gradient(ellipse at 95% 0%,#d9b66d18,transparent 42%),linear-gradient(135deg,#101722 0%,#0a1018 65%,#17130e 100%);box-shadow:0 10px 30px #0005,inset 0 1px #ffffff08}\\n#mmp-quantum-live-opportunities:before{content:\\\"\\\";position:absolute;z-index:-1;inset:0 auto 0 0;width:2px;background:linear-gradient(transparent,#d9b66d,transparent);opacity:.8}\\n.mql-live-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}\\n.mql-live-title{display:flex;align-items:center;gap:10px}\\n.mql-live-title b{display:block;color:#f3d99c;font-size:13px;letter-spacing:.02em}\\n.mql-live-title small{display:block;color:#8190a3;font-size:9px;letter-spacing:.08em;margin-top:3px}\\n.mql-orbit{position:relative;display:block;flex:0 0 30px;width:30px;height:30px;border:1px solid #d9b66d99;border-radius:50%;background:radial-gradient(circle,#e6c77b 0 2px,#d9b66d20 3px,transparent 65%);box-shadow:0 0 15px #d9b66d25}\\n.mql-orbit:before,.mql-orbit:after{content:\\\"\\\";position:absolute;inset:5px;border:1px solid #d9b66d88;border-radius:50%;transform:rotate(45deg) scaleX(.55)}\\n.mql-orbit:after{transform:rotate(-45deg) scaleX(.55)}\\n.mql-state{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid #ffffff18;border-radius:999px;color:#b9c2cf;font-size:9px;white-space:nowrap}\\n.mql-state i{width:6px;height:6px;border-radius:50%;background:#e2b95f;box-shadow:0 0 8px currentColor}\\n.mql-state.ready{color:#7cdbad;border-color:#4aa77b55}.mql-state.ready i{background:#51d59a}\\n.mql-live-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:12px 0 9px}\\n.mql-live-metrics>div{min-width:0;padding:8px 10px;border:1px solid #ffffff10;border-radius:9px;background:linear-gradient(145deg,#ffffff08,#ffffff02)}\\n.mql-live-metrics small{display:block;color:#8995a6;font-size:9px}\\n.mql-live-metrics b{display:block;margin-top:3px;color:#f0d18a;font-size:18px;font-variant-numeric:tabular-nums}\\n.mql-opportunities{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}\\n.mql-opportunity{display:grid;grid-template-columns:auto auto 1fr;align-items:center;gap:7px;min-width:0;padding:8px;border:1px solid #ffffff12;border-radius:9px;background:#ffffff05;text-decoration:none}\\n.mql-coin{overflow:hidden;color:#f2eee5;font-size:11px;font-weight:900;text-overflow:ellipsis}\\n.mql-direction{font-size:9px;color:#b6c0cd}.mql-opportunity.up .mql-direction{color:#55d5a0}.mql-opportunity.down .mql-direction{color:#ff7883}\\n.mql-score{display:flex;align-items:center;justify-content:flex-end;gap:5px;min-width:0}\\n.mql-score b{color:#e9cc8a;font-size:11px;font-variant-numeric:tabular-nums}\\n.mql-score i{display:block;overflow:hidden;width:28px;height:3px;border-radius:5px;background:#ffffff18}\\n.mql-score em{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#8f6b32,#efd18c)}\\n.mql-empty{margin-top:10px;padding:10px 12px;border:1px dashed #d9b66d35;border-radius:9px;color:#aab4c2;font-size:10px;line-height:1.8;background:#0002}\\n.mql-live-foot{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:8px;border-top:1px solid #ffffff10;color:#788699;font-size:9px}\\n.mql-live-foot a{color:#e0c17c;text-decoration:none}\\n@media(max-width:600px){#mmp-quantum-live-opportunities{padding:11px}.mql-opportunities{grid-template-columns:repeat(2,minmax(0,1fr))}.mql-live-metrics>div{padding:7px}.mql-live-metrics b{font-size:16px}.mql-opportunity{gap:5px;padding:7px}.mql-score i{width:20px}}\\n@media(prefers-reduced-motion:no-preference){.mql-orbit{animation:mqlOrbit 7s linear infinite}@keyframes mqlOrbit{to{transform:rotate(360deg)}}}";

  style.textContent += `
  #mmp-quantum-live-opportunities{padding:20px 21px 15px;border:1px solid rgba(221,184,103,.42);border-radius:21px;background:radial-gradient(ellipse at 86% 12%,rgba(219,174,83,.19),transparent 33%),radial-gradient(ellipse at 5% 100%,rgba(34,111,132,.12),transparent 38%),linear-gradient(135deg,#111a27 0%,#090f18 55%,#17150f 100%);box-shadow:0 20px 55px rgba(0,0,0,.38),inset 0 1px rgba(255,255,255,.09);min-height:190px}
  #mmp-quantum-live-opportunities:before{width:3px;opacity:1;background:linear-gradient(180deg,transparent,#f2d28a 24%,#9d762e 70%,transparent)}
  #mmp-quantum-live-opportunities:after{content:"";position:absolute;z-index:-1;right:22px;top:16px;width:142px;height:142px;border:1px solid rgba(220,181,101,.17);border-radius:50%;box-shadow:0 0 0 12px rgba(220,181,101,.025),0 0 0 26px rgba(220,181,101,.018),inset 0 0 30px rgba(220,181,101,.07);pointer-events:none}
  .mql-live-top{position:relative;z-index:1;align-items:center;min-height:48px}
  .mql-live-title{gap:13px}
  .mql-live-title b{font-size:15px;letter-spacing:.01em;color:#f6dfaa;text-shadow:0 1px 15px rgba(228,188,105,.18)}
  .mql-live-title small{font-size:9px;letter-spacing:.14em;color:#9ba9bb}
  .mql-orbit{flex-basis:43px;width:43px;height:43px;border:1px solid #e6c477;background:radial-gradient(circle at 36% 30%,#fff1c0 0 3%,#e8c36e 12%,#9c6e29 38%,#382b19 64%,#111923 72%);box-shadow:inset 0 2px 5px #fff8, inset 0 -7px 12px #000b,0 0 0 4px #d6ae5b15,0 0 24px #d9b66d45}
  .mql-orbit:before,.mql-orbit:after{inset:-5px;border:1px solid #e4c477a0;transform:rotate(38deg) scaleX(.52)}
  .mql-orbit:after{inset:-5px;transform:rotate(-38deg) scaleX(.52);border-color:#82c6d477}
  .mql-state{padding:7px 11px;background:rgba(255,255,255,.035);font-size:10px;backdrop-filter:blur(8px)}
  .mql-live-metrics{position:relative;z-index:1;gap:10px;margin:17px 0 12px}
  .mql-live-metrics>div{position:relative;overflow:hidden;padding:12px 13px 10px;border:1px solid rgba(255,255,255,.095);border-radius:13px;background:linear-gradient(145deg,rgba(255,255,255,.075),rgba(255,255,255,.018));box-shadow:inset 0 1px rgba(255,255,255,.055),0 8px 20px #0002}
  .mql-live-metrics>div:after{content:"";position:absolute;right:0;top:0;width:34px;height:2px;background:linear-gradient(90deg,transparent,#d9b66d)}
  .mql-live-metrics small{font-size:10px;color:#a7b2c2}
  .mql-live-metrics b{font-size:25px;line-height:1.25;margin-top:5px;color:#f2d38e;text-shadow:0 0 18px #d9b66d25}
  .mql-opportunities{position:relative;z-index:1;gap:8px}
  .mql-opportunity{padding:10px 11px;border-radius:12px;border-color:#ffffff18;background:linear-gradient(120deg,#ffffff0b,#ffffff03);transition:transform .2s ease,border-color .2s ease,background .2s ease}
  .mql-opportunity:hover{transform:translateY(-2px);border-color:#d9b66d88;background:#d9b66d0d}
  .mql-coin{font-size:12px}
  .mql-direction{font-size:10px}
  .mql-score b{font-size:12px}
  .mql-score i{width:35px;height:4px}
  .mql-empty{position:relative;z-index:1;margin-top:13px;padding:13px 15px;border:1px solid #d9b66d38;border-radius:12px;background:linear-gradient(110deg,#d9b66d0b,#ffffff03);color:#c1cbd7;font-size:11px}
  .mql-live-foot{position:relative;z-index:1;margin-top:14px;padding-top:11px;border-top:1px solid rgba(255,255,255,.1);font-size:10px}
  .mql-live-foot a{font-weight:800;letter-spacing:.01em}
  @media(max-width:600px){#mmp-quantum-live-opportunities{padding:15px 13px 12px;border-radius:17px;min-height:0}#mmp-quantum-live-opportunities:after{right:7px;top:8px;width:108px;height:108px}.mql-live-title b{font-size:13px}.mql-live-title small{font-size:8px;letter-spacing:.08em}.mql-orbit{flex-basis:37px;width:37px;height:37px}.mql-live-metrics{gap:6px;margin:13px 0 10px}.mql-live-metrics>div{padding:9px 8px;border-radius:10px}.mql-live-metrics small{font-size:9px}.mql-live-metrics b{font-size:20px}.mql-opportunities{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.mql-opportunity{padding:8px 7px}.mql-coin{font-size:10px}.mql-direction{font-size:9px}.mql-score i{width:22px}}
  @media(prefers-reduced-motion:no-preference){#mmp-quantum-live-opportunities:after{animation:mqlHalo 16s linear infinite}@keyframes mqlHalo{to{transform:rotate(360deg)}}}
  `;
  document.head.appendChild(style);
  const live=document.createElement("section");live.id="mmp-quantum-live-opportunities";
  hero.insertAdjacentElement("afterend",live);
  document.querySelectorAll(".native-app-menu,.dropdown-menu").forEach(menu=>{
   if(menu.querySelector('a[href="/quantum-lab.html"]'))return;
   const link=document.createElement("a");link.href="/quantum-lab.html";link.textContent="◈ ورود به مرکز کوانتومی MMP";menu.appendChild(link);
  });
 }
 render(read());
}
window.MMPQuantumCore={
 getSnapshot:()=>snapshot||read(),
 getOpportunities:()=>((snapshot||read())?.opportunities||[]),
 subscribe:fn=>{if(typeof fn!=="function")return()=>{};subscribers.add(fn);return()=>subscribers.delete(fn)}
};
window.addEventListener("storage",e=>{if(e.key==="mmp_quantum_snapshot_v1")publish(read())});
try{if("BroadcastChannel"in window){const ch=new BroadcastChannel("mmp-quantum-core");ch.onmessage=e=>publish(e.data)}}catch(e){}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();
})();