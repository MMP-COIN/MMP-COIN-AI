(function(){
"use strict";
let snapshot=null,subscribers=new Set();
function read(){try{snapshot=JSON.parse(localStorage.getItem("mmp_quantum_snapshot_v1")||"null")}catch(e){snapshot=null}return snapshot}
function publish(next){if(!next||!Array.isArray(next.opportunities))return;snapshot=next;window.dispatchEvent(new CustomEvent("mmp-quantum-snapshot",{detail:next}));subscribers.forEach(fn=>{try{fn(next)}catch(e){}});render(next)}
function render(data){
 const host=document.getElementById("mmp-quantum-live-opportunities");if(!host)return;
 const rows=(data.opportunities||[]).filter(x=>x&&x.score>=55).slice(0,6);
 host.innerHTML='<div class="mql-live-head"><b>خروجی زنده هسته کوانتومی</b><small>'+new Date(data.generatedAt).toLocaleString("fa-IR")+' · '+Number(data.scanned||0).toLocaleString("fa-IR")+' ارز بررسی‌شده</small></div>'+
 (rows.length?'<div class="mql-live-grid">'+rows.map(x=>'<a href="/quantum-lab.html"><b>'+String(x.symbol).replace(/[&<>"]/g,"")+'</b><span class="'+(x.direction==="bull"?"up":x.direction==="bear"?"down":"wait")+'">'+(x.direction==="bull"?"صعودی":x.direction==="bear"?"نزولی":"خنثی")+'</span><strong>'+Number(x.score)+'</strong></a>').join("")+'</div>':'<small>در آخرین چرخه فرصت با امتیاز حداقل ۵۵ ثبت نشده است.</small>');
}
function mount(){
 const hero=document.querySelector(".hero");
 if(hero&&!document.getElementById("mmp-quantum-lab-launcher")){
  const style=document.createElement("style");style.id="mmp-quantum-lab-launcher-style";
  style.textContent="#mmp-quantum-lab-launcher{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:12px 0 18px;padding:16px 18px;border:1px solid #80683f;border-radius:16px;background:radial-gradient(ellipse at 8% 0%,#d9b66d20,transparent 45%),linear-gradient(120deg,#171b24,#101722 65%,#211b12);box-shadow:0 12px 35px #0006}#mmp-quantum-lab-launcher .mql-copy{min-width:0;flex:1}#mmp-quantum-lab-launcher b{display:block;color:#f5dda2;font-size:15px}#mmp-quantum-lab-launcher small{display:block;color:#aab4c3;font-size:11px;line-height:1.9;margin-top:5px}#mmp-quantum-lab-launcher a{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:9px 15px;border-radius:10px;background:linear-gradient(120deg,#a77c35,#e8cd8c);color:#17130a;text-decoration:none;font-weight:900;font-size:12px;white-space:nowrap}#mmp-quantum-lab-launcher .mql-mark{color:#d9b66d;font-size:22px;margin-left:8px}#mmp-quantum-live-opportunities{margin:0 0 18px;padding:14px;border:1px solid #354253;border-radius:14px;background:linear-gradient(145deg,#121a26,#0b111a)}.mql-live-head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px}.mql-live-head b{color:#f5dda2;font-size:13px}.mql-live-head small{color:#9aa5b5;font-size:10px}.mql-live-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.mql-live-grid a{display:flex;align-items:center;justify-content:space-between;gap:7px;padding:9px;border:1px solid #30394a;border-radius:10px;background:#0d141e;color:#f4f1e9;text-decoration:none;font-size:11px}.mql-live-grid strong{color:#f5dda2}.mql-live-grid .up{color:#25d695}.mql-live-grid .down{color:#ff6576}.mql-live-grid .wait{color:#f4c45e}@media(max-width:600px){.mql-live-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}";
  document.head.appendChild(style);
  const card=document.createElement("section");card.id="mmp-quantum-lab-launcher";card.innerHTML='<div class="mql-copy"><b><span class="mql-mark">◈</span> آزمایشگاه کوانتومی MMP</b><small>۱۲ موتور تخصصی برای درک بازار، کشف فرصت زودهنگام، تحلیل جریان سفارش و ارزیابی سناریوها · اسکن پویا و بدون سقف ثابت جفت‌های واجد شرایط USDT Spot</small></div><a href="/quantum-lab.html">ورود به آزمایشگاه ←</a>';
  hero.insertAdjacentElement("afterend",card);
  const live=document.createElement("section");live.id="mmp-quantum-live-opportunities";card.insertAdjacentElement("afterend",live);
  document.querySelectorAll(".native-app-menu,.dropdown-menu").forEach(menu=>{if(menu.querySelector('a[href="/quantum-lab.html"]'))return;const a=document.createElement("a");a.href="/quantum-lab.html";a.textContent="◈ آزمایشگاه کوانتومی";menu.appendChild(a);});
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