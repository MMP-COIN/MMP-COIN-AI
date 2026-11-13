/* MMP premium navigation v2 — header-only menu, compact grouped sections */
(function(){
 "use strict";
 if(window.__mmpCompactNavigationV2)return;
 window.__mmpCompactNavigationV2=true;
 const groups=[
  {title:"نمای کلی",icon:"⌂",items:[
   ["صفحه اصلی","hero","⌂"],["چهار دارایی شاخص","market-snapshot","◈"],["مرکز فرماندهی کوانتومی","quantum-center-entry","✧"]
  ]},
  {title:"رادار و تحلیل هوشمند",icon:"✧",items:[
   ["رادار فرصت‌ها","opportunities","⌖"],["شکارچی بازار","market-hunter","◎"],["تحلیلگر هوشمند","ai-section","✧"],["آزمایشگاه مومنتوم","boom-hunter","ϟ"],["نمودار حرفه‌ای","chart-section","▥"],["هوشمندی بازار","market-intelligence","◉"]
  ]},
  {title:"گزارش‌ها و سلامت سامانه",icon:"⛨",items:[
   ["سلامت NEXUS","mmp-autonomous-health-center","⛨"],["سرویس‌ها و جریان داده","mmp-ah-services-accordion","⌁"],["پیشنهادهای هوشمند","mmp-ah-advice-accordion","✦"],["گزارش آخرین چرخه","mmp-ah-report","▤"],["دفتر اقدامات","mmp-ah-action-log","✓"],["پایش سروری","mmp-ah-server","◷"],["پیش‌بینی بازار","forecast-summary","⌁"],["نتایج آزمون گذشته‌نگر","backtest-results","▤"]
  ]},
  {title:"بازار و جریان داده",icon:"▦",items:[
   ["نقشه حرارتی","/market-heatmap.html","▦"],["نبض فیوچرز","derivatives-panel","↗"],["جریان سفارش و نقدینگی","orderflow-panel","⇄"],["سناریوهای کندلی","candle-intelligence","▥"],["پایش نهنگ‌ها","whale-panel","◉"],["فهرست رمزارزها","coins-section","₿"],["اتصال صرافی‌ها","exchange-connections","⌁"],["ساعت بازارها","market-hours","◷"]
  ]},
  {title:"ابزارهای معامله‌گری",icon:"⌗",items:[
   ["محاسبه ریسک و حجم","trading-tools","⌗"]
  ]},
  {title:"اپلیکیشن و ارتباط",icon:"↗",items:[
   ["دانلود اپلیکیشن","app-download","⬇"],["ارتباط با ما","contact-us","✉"]
  ]}
 ];
 function makeGroups(){
  const wrap=document.createElement("div");wrap.className="mmp-nav-groups";
  groups.forEach(group=>{
   const details=document.createElement("details");details.className="mmp-nav-group";
   const summary=document.createElement("summary");
   summary.innerHTML='<span class="mmp-nav-icon" aria-hidden="true">'+group.icon+'</span><span class="mmp-nav-label"></span><span class="mmp-nav-count">'+String(group.items.length).padStart(2,"0")+'</span><span class="mmp-nav-chevron" aria-hidden="true">⌄</span>';
   summary.querySelector(".mmp-nav-label").textContent=group.title;
   const items=document.createElement("div");items.className="mmp-nav-items";
   group.items.forEach(item=>{
    const a=document.createElement("a");a.className="mmp-nav-link";
    a.href=item[1].startsWith("/")?item[1]:"#"+item[1];
    a.innerHTML='<span class="mmp-nav-link-icon" aria-hidden="true"></span><span></span>';
    a.querySelector(".mmp-nav-link-icon").textContent=item[2];
    a.lastElementChild.textContent=item[0];
    items.appendChild(a);
   });
   details.append(summary,items);wrap.appendChild(details);
  });
  wrap.addEventListener("toggle",event=>{
   if(event.target.matches("details.mmp-nav-group")&&event.target.open){
    wrap.querySelectorAll("details.mmp-nav-group").forEach(other=>{if(other!==event.target)other.open=false;});
   }
  },true);
  return wrap;
 }
 const sidebar=document.getElementById("mmp-sidebar");
 if(sidebar){
  const brand=sidebar.querySelector(".side-brand"),footer=sidebar.querySelector(".side-footer");
  Array.from(sidebar.children).forEach(child=>{if(child!==brand&&child!==footer)child.remove();});
  const nav=makeGroups();
  if(brand)brand.after(nav);else sidebar.prepend(nav);
  if(footer)sidebar.appendChild(footer);
 }
 const menu=document.getElementById("dropdownMenu");
 const button=document.querySelector(".menu-btn");
 if(menu){
  menu.replaceChildren();
  const label=document.createElement("div");label.className="mmp-menu-heading";label.textContent="فهرست بخش‌ها";
  menu.append(label,makeGroups());
 }
 function toggle(open){
  if(!menu||!button)return;
  const next=typeof open==="boolean"?open:!menu.classList.contains("show");
  menu.classList.toggle("show",next);
  button.setAttribute("aria-expanded",String(next));
  button.setAttribute("aria-label",next?"بستن منوی اصلی":"باز کردن منوی اصلی");
 }
 // The homepage owns the single menu-button toggle handler; do not register a second one here.
 if(menu)menu.addEventListener("click",event=>{
  const link=event.target.closest("a.mmp-nav-link");if(!link)return;
  toggle(false);
  if(link.getAttribute("href").startsWith("#")){
   const target=document.getElementById(link.getAttribute("href").slice(1));
   if(target){event.preventDefault();target.scrollIntoView({behavior:"smooth",block:"start"});}
  }
 });
 document.addEventListener("click",event=>{if(menu&&!menu.contains(event.target)&&!event.target.closest(".menu-btn"))toggle(false);});
 document.addEventListener("keydown",event=>{if(event.key==="Escape")toggle(false);});
 const links=[...document.querySelectorAll(".mmp-nav-link[href^='#']")];
 const targets=links.map(link=>({link,target:document.getElementById(link.getAttribute("href").slice(1))})).filter(x=>x.target);
 function setActive(target){
  document.querySelectorAll(".mmp-nav-link.active").forEach(link=>link.classList.remove("active"));
  const match=targets.find(x=>x.target===target);
  if(match){document.querySelectorAll('.mmp-nav-link[href="'+match.link.getAttribute("href")+'"]').forEach(link=>link.classList.add("active"));}
 }
 if("IntersectionObserver"in window&&targets.length){
  const observer=new IntersectionObserver(entries=>{
   const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
   if(visible)setActive(visible.target);
  },{rootMargin:"-18% 0px -68% 0px",threshold:[0,.15,.35]});
  targets.forEach(item=>observer.observe(item.target));
 }
 // Remove any legacy bottom navigation left by an older cached script.
 document.querySelectorAll(".mmp-redesign-mobile-nav,.mmp-mobile-menu-overlay,.mmp-mobile-dock").forEach(node=>node.remove());
})();