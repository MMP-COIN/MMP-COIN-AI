(function(){
"use strict";
const CENTERS={
 command:{title:"فرماندهی بازار",en:"MARKET COMMAND",desc:"نمای کلی بازار، دارایی‌های شاخص و نرخ تتر به تومان",icon:"◈",sections:["mmp-home-hero","market-snapshot"],jumps:[["نمای کلی بازار","#mmp-home-hero"],["قیمت‌های شاخص","#market-snapshot"],["بیت‌کوین","#mmp-btc-card"],["اتریوم","#mmp-eth-card"],["تتر به تومان","#mmp-usdt-card"],["اونس طلا","#mmp-gold-card"]]},
 hunter:{title:"شکار بازار",en:"QUANTUM HUNTER",desc:"رادار، شکارچی اسپات و فیوچرز و آزمایشگاه مومنتوم",icon:"⌖",sections:["opportunities","market-hunter","boom-hunter"],jumps:[["رادار","#opportunities"],["شکارچی","#market-hunter"],["مومنتوم","#boom-hunter"]]},
 charts:{title:"تحلیل تکنیکال",en:"ADVANCED CHARTING",desc:"نمودار زنده، کندل‌ها و تحلیل چندتایم‌فریمی",icon:"▥",sections:["chart-section"],jumps:[["نمودار","#chart-section"]]},
 flow:{title:"پول هوشمند و نقدینگی",en:"SMART MONEY & FLOW",desc:"مشتقات، دفتر سفارش، جریان معاملات و نقدینگی",icon:"◉",sections:["market-intelligence"],jumps:[["مشتقات","#derivatives-panel"],["Order Flow","#orderflow-panel"],["سناریوهای کندلی","#candle-intelligence"],["نهنگ‌ها","#whale-panel"]]},
 ai:{title:"هوش مصنوعی کوانتومی",en:"MMP QUANTUM INTELLIGENCE",desc:"تحلیل چندلایه، هسته هوشمند و سناریوهای بازار",icon:"✧",sections:["quantum-center-entry","ai-section"],jumps:[["هسته کوانتومی","#quantum-center-entry"],["تحلیلگر AI","#ai-section"]]},
 strategy:{title:"استراتژی و معاملات",en:"TRADE STRATEGY",desc:"مدیریت سرمایه، محاسبه ریسک و ابزارهای معاملاتی",icon:"⌗",sections:["trading-tools"],jumps:[["ابزارهای معامله","#trading-tools"]]},
 markets:{title:"صرافی‌ها و بازارها",en:"EXCHANGES & MARKETS",desc:"فهرست ارزها، نقشه حرارتی، اتصال صرافی‌ها و بازارها",icon:"▦",sections:["market-heatmap-entry","coins-section","exchange-connections","market-hours"],jumps:[["نقشه حرارتی","/market-heatmap.html"],["فهرست ارزها","#coins-section"],["اتصالات","#exchange-connections"],["ساعت بازارها","#market-hours"]]},
 lab:{title:"آزمایشگاه و عملکرد",en:"QUANTUM LAB & PERFORMANCE",desc:"مرکز فرماندهی موتورهای کوانتومی و ارزیابی عملکرد",icon:"⌬",url:"/quantum-lab.html",sections:[],jumps:[]},
 support:{title:"اشتراک و ارتباط",en:"APP & CONTACT",desc:"ارسال اپلیکیشن برای دوستان و ارتباط مستقیم با MMP",icon:"✉",sections:["app-download","contact-us"],jumps:[["ارسال اپ برای دوستان","#app-download"],["ارتباط با ما","#contact-us"]]}
};
const $=(s,r=document)=>r.querySelector(s);
function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function init(){
 const body=document.body,main=$("#hero"),appMode=new URLSearchParams(location.search).has("mmp_native_version");
 const APP_PAGE_IDS=Object.keys(CENTERS).filter(id=>id!=="support");
 if(!main||body.dataset.mmpTerminalReady==="1")return;
 body.dataset.mmpTerminalReady="1";body.classList.add("mmp-quantum-terminal");
 const allSections=[...main.querySelectorAll(":scope > section")];
 const assign={"mmp-home-hero":"command","market-snapshot":"command","quantum-center-entry":"ai","opportunities":"hunter","market-hunter":"hunter","ai-section":"ai","boom-hunter":"hunter","chart-section":"charts","market-intelligence":"flow","coins-section":"markets","trading-tools":"strategy","exchange-connections":"markets","market-hours":"markets","app-download":"footer","contact-us":"footer"};
 allSections.forEach(el=>{if(el.id&&assign[el.id])el.dataset.mmpCenter=assign[el.id];});
 const heat=main.querySelector(".market-heatmap-entry");if(heat)heat.dataset.mmpCenter="markets";
 const hub=document.createElement("section");hub.id="mmp-terminal-hub";hub.className="mmp-terminal-hub";
 hub.innerHTML='<div class="mmp-hub-heading"><div><h2>هشت مرکز تخصصی MMP</h2><p>هر مرکز یک محیط کاری مستقل با ابزارها و داده‌های تخصصی خودش</p></div><span class="mmp-hub-heading-en">QUANTUM TRADING ECOSYSTEM</span></div><div class="mmp-hub-grid">'+Object.entries(CENTERS).filter(([id])=>id!=="support").map(([id,c],i)=>'<button type="button" class="mmp-hub-card" data-center-style="'+id+'" data-mmp-open-center="'+id+'"><span class="mmp-hub-card-top"><span class="mmp-hub-icon">'+c.icon+'</span><span class="mmp-hub-number">0'+(i+1)+'</span></span><strong>'+esc(c.title)+'</strong><small>'+esc(c.desc)+'</small><span class="mmp-hub-enter">ورود به مرکز <b>←</b></span></button>').join("")+'</div>';
 const snapshot=$("#market-snapshot");if(snapshot)snapshot.after(hub);else main.prepend(hub);
 const toolbar=document.createElement("section");toolbar.id="mmp-center-toolbar";toolbar.hidden=true;
 toolbar.innerHTML='<div class="mmp-center-title"><img src="assets/mmp-coin-mark.svg" alt=""><div><strong id="mmp-center-title-text"></strong><small id="mmp-center-title-en"></small></div></div><div class="mmp-center-actions"><div class="mmp-center-currency" role="group" aria-label="واحد نمایش قیمت"><button type="button" class="mmp-currency-irt active" data-mmp-currency="IRT" aria-pressed="true" onclick="setCurrency(\'IRT\')">تومان</button><button type="button" class="mmp-currency-usdt" data-mmp-currency="USDT" aria-pressed="false" onclick="setCurrency(\'USDT\')">تتر / USDT</button></div><div id="mmp-center-jumps"></div><button type="button" class="mmp-center-back" data-mmp-home>بازگشت به صفحه اصلی</button></div>';
 hub.after(toolbar);
 let appDock=null;
 if(appMode){
  const shortLabels={command:"فرمان",hunter:"شکار",charts:"چارت",flow:"نقدینگی",ai:"هوش",strategy:"استراتژی",markets:"بازار",lab:"آزمایشگاه"};
  appDock=document.createElement("nav");appDock.id="mmp-app-page-dock";appDock.className="mmp-app-page-dock";appDock.setAttribute("aria-label","صفحه‌های اپلیکیشن MMP");
  appDock.innerHTML=APP_PAGE_IDS.map((id,i)=>'<button type="button" data-mmp-app-page="'+id+'" aria-label="'+esc(CENTERS[id].title)+'" aria-current="false"><i>'+CENTERS[id].icon+'</i><span>'+shortLabels[id]+'</span></button>').join("");
  document.body.append(appDock);
 }
 const jumpHost=$("#mmp-center-jumps",toolbar);
 function menuMarkup(){return (appMode?"":'<a href="/" data-mmp-home><i class="menu-icon">⌂</i><span>صفحه اصلی</span></a>')+'<div class="menu-section-label">هشت مرکز تخصصی MMP</div>'+Object.entries(CENTERS).filter(([id])=>id!=="support").map(([id,c],i)=>'<a href="'+(c.url||"#center-"+id)+'" data-mmp-open-center="'+id+'"><i class="menu-icon">'+c.icon+'</i><span>'+esc(c.title)+'</span></a>').join("")+(appMode?'<div class="menu-divider"></div><a href="#app-download" data-mmp-open-center="support"><i class="menu-icon">✉</i><span>اشتراک و ارتباط</span></a>':'')+'<div class="menu-divider"></div>';}
 const menu=$("#dropdownMenu");if(menu)menu.innerHTML=menuMarkup();
 function show(view,updateHistory){
  const config=CENTERS[view];if(!config)view="home";
  if(view==="lab"){const target=new URL(CENTERS.lab.url,location.origin),version=new URLSearchParams(location.search).get("mmp_native_version");if(version)target.searchParams.set("mmp_native_version",version);location.href=target.pathname+target.search;return;}
  body.dataset.mmpView=view;
  allSections.forEach(el=>{
   const group=el.dataset.mmpCenter||"";
   // The global MMP hero and market snapshot belong only to the homepage.
   // The Quantum Command / Smart Core card belongs only to the AI center.
   let visible=view==="home"?(group==="command"||group==="footer"):view==="support"?group==="footer":group===view;
   if(el.id==="mmp-home-hero"||el.id==="market-snapshot")visible=view==="home"||view==="command";
   if(el.id==="quantum-center-entry")visible=view==="home"||view==="command"||view==="ai";
   el.hidden=!visible;
  });
  hub.hidden=view!=="home";toolbar.hidden=view==="home";
  if(view!=="home"){
   $("#mmp-center-title-text").textContent=config.title;
   $("#mmp-center-title-en").textContent=config.en;
   jumpHost.innerHTML=(config.jumps||[]).map(([label,href])=>'<a class="mmp-center-jump" href="'+href+'">'+esc(label)+'</a>').join("");
  }
  if(updateHistory){const url=new URL(location.href);if(view==="home")url.searchParams.delete("center");else url.searchParams.set("center",view);history.pushState({mmpView:view},"",url.pathname+url.search+url.hash);}
  document.querySelectorAll("[data-mmp-open-center]").forEach(el=>el.setAttribute("aria-current",el.dataset.mmpOpenCenter===view?"page":"false"));
  if(appDock)appDock.querySelectorAll("[data-mmp-app-page]").forEach(el=>el.setAttribute("aria-current",el.dataset.mmpAppPage===view?"page":"false"));
  const menuBtn=$(".menu-btn");if(menuBtn)menuBtn.setAttribute("aria-expanded","false");if(menu)menu.classList.remove("show","open");
  window.scrollTo({top:0,behavior:"auto"});
  if(view==="command"){
   // Re-entering Market Command always refreshes the live market snapshot instead of leaving empty placeholders.
   try{if(typeof window.refreshSiteData==="function")window.refreshSiteData();else if(typeof window.refreshLiveQuotes==="function")window.refreshLiveQuotes();}catch(error){console.warn("Market Command refresh failed:",error);}
  }
  document.dispatchEvent(new CustomEvent("mmp:center-change",{detail:{view}}));
  if(view==="charts")requestAnimationFrame(()=>{if(typeof window.mmpLoadChart==="function")window.mmpLoadChart(true);});
 }
 document.addEventListener("click",e=>{
  const opener=e.target.closest("[data-mmp-open-center]");
  if(opener){e.preventDefault();e.stopPropagation();show(opener.dataset.mmpOpenCenter,true);return;}
  if(e.target.closest("[data-mmp-home]")){e.preventDefault();show(appMode?"command":"home",true);return;}
  const footerLink=e.target.closest('a[href="#app-download"],a[href="#contact-us"]');
  if(footerLink){e.preventDefault();const target=footerLink.getAttribute("href");show(appMode?"support":"home",true);requestAnimationFrame(()=>{const node=$(target);if(node)node.scrollIntoView({behavior:"smooth",block:"start"});});}
 });
 if(appDock)appDock.addEventListener("click",e=>{const button=e.target.closest("[data-mmp-app-page]");if(button)show(button.dataset.mmpAppPage,true);});
 if(appMode){
  let touchStart=null;
  document.addEventListener("touchstart",e=>{if(e.touches.length!==1)return;const target=e.target;if(target.closest("input,textarea,select,[contenteditable='true'],.mmp-app-page-dock,.mmp-symbol-menu,.mmp-coin-detail-backdrop"))return;const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY};},{passive:true});
  document.addEventListener("touchend",e=>{if(!touchStart||!e.changedTouches.length)return;const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)<65||Math.abs(dx)<Math.abs(dy)*1.25)return;e.preventDefault();const current=body.dataset.mmpView||"command";let index=APP_PAGE_IDS.indexOf(current);if(index<0)index=0;index=(index+(dx>0?1:APP_PAGE_IDS.length-1))%APP_PAGE_IDS.length;show(APP_PAGE_IDS[index],true);},{passive:false});
 }
 window.addEventListener("popstate",()=>show(new URL(location.href).searchParams.get("center")||(appMode?"command":"home"),false));
 const initial=new URL(location.href).searchParams.get("center")||(appMode?"command":"home");show(initial,false);
 const title=$("head title");if(title&&!title.textContent.includes("MMP QUANTUM"))title.textContent="MMP QUANTUM | ترمینال هوشمند بازار";
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();