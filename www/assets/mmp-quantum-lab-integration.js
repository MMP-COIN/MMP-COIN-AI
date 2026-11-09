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
 document.querySelectorAll(".native-app-menu,.dropdown-menu").forEach(menu=>{
  if(menu.querySelector('a[href="/quantum-lab.html"]'))return;
  const link=document.createElement("a");link.href="/quantum-lab.html";link.textContent="◈ ورود به مرکز کوانتومی MMP";menu.appendChild(link);
 });
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