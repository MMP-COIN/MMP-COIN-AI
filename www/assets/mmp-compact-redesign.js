/* MMP compact function-first navigation */
(function(){
 "use strict";
 if(window.__mmpCompactNavigationReady)return;
 window.__mmpCompactNavigationReady=true;
 const sidebar=document.getElementById("mmp-sidebar");
 if(!sidebar)return;
 const groups=[
  {title:"نمای کلی",icon:"⌂",items:[
   ["نمای اصلی","hero","⌂"],["چهار دارایی شاخص","market-snapshot","◈"],["مرکز فرماندهی کوانتومی","quantum-center-entry","✧"]
  ]},
  {title:"رادار و تحلیل هوشمند",icon:"✧",items:[
   ["رادار فرصت‌های بازار","opportunities","⌖"],["شکارچی بازار","market-hunter","◎"],["تحلیلگر هوشمند AI","ai-section","✧"],["آزمایشگاه Boom Hunter","boom-hunter","ϟ"],["نمودار حرفه‌ای","chart-section","▥"],["مرکز هوشمندی بازار","market-intelligence","◉"],
   ["گزارش سناریو و پیش‌بینی","forecast-summary","▤","report"],["گزارش آزمون گذشته‌نگر","backtest-results","▤","report"]
  ]},
  {title:"گزارش‌ها و سلامت سامانه",icon:"⛨",items:[
   ["داشبورد سلامت NEXUS","mmp-autonomous-health-center","⛨"],["سلامت سرویس‌ها و جریان داده","mmp-ah-services-accordion","⌁","report"],["تشخیص و پیشنهادهای هوشمند","mmp-ah-advice-accordion","✦","report"],["گزارش آخرین چرخه","mmp-ah-report","▤","report"],["دفتر اقدامات و بازآزمایی","mmp-ah-action-log","✓","report"],["گزارش پایش سروری","mmp-ah-server","◷","report"]
  ]},
  {title:"بازار و جریان داده",icon:"▦",items:[
   ["نقشه حرارتی بازار","/market-heatmap.html","▦"],["فهرست رمزارزها","coins-section","₿"],["نبض بازار فیوچرز","derivatives-panel","↗"],["جریان سفارش و نقدینگی","orderflow-panel","⇄"],["سناریوهای کندلی","candle-intelligence","▥"],["پایش نهنگ‌ها","whale-panel","◉"],["اتصال صرافی‌ها","exchange-connections","⌁"],["ساعت بازارهای جهان","market-hours","◷"]
  ]},
  {title:"ابزارهای معامله‌گری",icon:"⌗",items:[
   ["محاسبه‌گر ریسک و حجم","trading-tools","⌗"]
  ]},
  {title:"اپلیکیشن و ارتباط",icon:"↗",items:[
   ["دانلود اپلیکیشن","app-download","⬇"],["ارتباط با ما","contact-us","✉"]
  ]}
 ];
 function makeGroups(){
  const wrap=document.createElement("div");wrap.className="mmp-nav-groups";
  groups.forEach((group,index)=>{
   const details=document.createElement("details");details.className="mmp-nav-group";if(index===0)details.open=true;
   const summary=document.createElement("summary");
   summary.innerHTML='<span class="mmp-nav-icon" aria-hidden="true">'+group.icon+'</span><span class="mmp-nav-label">'+group.title+'</span><span class="mmp-nav-count">'+String(group.items.length).padStart(2,"0")+'</span><span class="mmp-nav-chevron" aria-hidden="true">⌄</span>';
   const items=document.createElement("div");items.className="mmp-nav-items";
   group.items.forEach(item=>{
    const a=document.createElement("a");a.className="mmp-nav-link"+(item[3]==="report"?" mmp-report-link":"");
    a.href=item[1].startsWith("/")?item[1]:"#"+item[1];
    a.innerHTML='<span class="mmp-nav-link-icon" aria-hidden="true">'+item[2]+'</span><span></span>';
    a.lastElementChild.textContent=item[0];
    if(item[3]==="report")a.setAttribute("aria-label","گزارش: "+item[0]);
    items.appendChild(a);
   });
   details.append(summary,items);wrap.appendChild(details);
  });
  return wrap;
 }
 const brand=sidebar.querySelector(".side-brand"),footer=sidebar.querySelector(".side-footer");
 const nav=makeGroups();
 Array.from(sidebar.children).forEach(child=>{if(child!==brand&&child!==footer)child.remove()});
 if(brand)brand.after(nav);else sidebar.prepend(nav);
 if(footer)sidebar.appendChild(footer);
 function setActive(link){
  document.querySelectorAll(".mmp-nav-link.active").forEach(el=>el.classList.remove("active"));
  if(link){link.classList.add("active");const group=link.closest(".mmp-nav-group");if(group)group.open=true;}
 }
 document.addEventListener("click",event=>{
  const link=event.target.closest(".mmp-nav-link");
  if(!link)return;
  if(link.getAttribute("href").startsWith("#"))setActive(link);
 });
 const mobile=document.createElement("nav");mobile.className="mmp-redesign-mobile-nav";mobile.setAttribute("aria-label","میانبرهای اصلی");
 const shortcuts=[["خانه","#hero","⌂"],["رادار","#opportunities","⌖"],["شکار","#market-hunter","◎"],["تحلیل AI","#ai-section","✧"]];
 shortcuts.forEach((item,index)=>{
  const a=document.createElement("a");a.href=item[1];a.innerHTML='<span class="mmp-mobile-icon" aria-hidden="true">'+item[2]+'</span><span>'+item[0]+'</span>';
  if(index===3)a.className="mmp-mobile-primary";
  mobile.appendChild(a);
 });
 const more=document.createElement("button");more.type="button";more.innerHTML='<span class="mmp-mobile-icon" aria-hidden="true">☰</span><span>همه بخش‌ها</span>';more.setAttribute("aria-haspopup","dialog");more.setAttribute("aria-expanded","false");mobile.appendChild(more);
 document.body.appendChild(mobile);
 const overlay=document.createElement("div");overlay.className="mmp-mobile-menu-overlay";overlay.hidden=true;overlay.innerHTML='<div class="mmp-mobile-menu-panel" role="dialog" aria-modal="true" aria-label="منوی همه بخش‌ها"><div class="mmp-mobile-menu-head"><span>منوی هوشمند MMP</span><button type="button" class="mmp-mobile-menu-close" aria-label="بستن منو">×</button></div></div>';
 const panel=overlay.querySelector(".mmp-mobile-menu-panel");panel.appendChild(makeGroups());document.body.appendChild(overlay);
 const close=()=>{overlay.hidden=true;more.setAttribute("aria-expanded","false");document.body.classList.remove("mmp-menu-open");};
 more.addEventListener("click",()=>{overlay.hidden=false;more.setAttribute("aria-expanded","true");document.body.classList.add("mmp-menu-open");});
 overlay.querySelector(".mmp-mobile-menu-close").addEventListener("click",close);
 overlay.addEventListener("click",event=>{if(event.target===overlay)close();});
 overlay.querySelectorAll("a.mmp-nav-link").forEach(link=>link.addEventListener("click",()=>{close();if(link.getAttribute("href").startsWith("#")){const target=document.querySelector(link.getAttribute("href"));if(target)setTimeout(()=>target.scrollIntoView({behavior:"smooth",block:"start"}),0);}}));
 document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!overlay.hidden)close();});
 const targets=[...document.querySelectorAll(".mmp-nav-link[href^='#']")].map(link=>({link,target:document.getElementById(link.getAttribute("href").slice(1))})).filter(x=>x.target);
 if("IntersectionObserver"in window){
  const observer=new IntersectionObserver(entries=>{const visible=entries.filter(x=>x.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(!visible)return;const match=targets.find(x=>x.target===visible.target);if(match)setActive(match.link);},{rootMargin:"-18% 0px -68% 0px",threshold:[0,.15,.35]});
  targets.forEach(x=>observer.observe(x.target));
 }
})();
