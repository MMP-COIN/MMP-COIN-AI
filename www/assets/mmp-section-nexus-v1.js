/* MMP NEXUS: section-level command menus + honest UI health audit */
(function(){
 "use strict";
 if(window.__mmpSectionNexusV1)return;
 window.__mmpSectionNexusV1=true;
 var modules=[
  {id:"mmp-home-hero",title:"MMP QUANTUM",caption:"شبکه هوشمندی بازار",icon:"✥"},
  {id:"market-snapshot",title:"نمای دارایی‌های شاخص",caption:"BTC · ETH · USDT · GOLD",icon:"◈"},
  {id:"quantum-center-entry",title:"مرکز فرماندهی کوانتومی",caption:"۱۲ ماژول تحلیل تخصصی",icon:"✧"},
  {id:"mmp-autonomous-health-center",title:"MMP NEXUS",caption:"پایش، ترمیم و تکامل",icon:"✚"},
  {id:"opportunities",title:"رادار فرصت‌ها",caption:"کشف موقعیت‌های بازار",icon:"⌖"},
  {id:"market-hunter",title:"Market Hunter",caption:"شکار هوشمند Spot و Futures",icon:"◎"},
  {id:"ai-section",title:"تحلیلگر هوشمند AI",caption:"تحلیل چندلایه و سناریو",icon:"✦"},
  {id:"boom-hunter",title:"Boom Hunter",caption:"مومنتوم و شتاب بازار",icon:"ϟ"},
  {id:"chart-section",title:"نمودار حرفه‌ای",caption:"تحلیل تکنیکال و تایم‌فریم",icon:"▥"},
  {id:"market-intelligence",title:"هوشمندی بازار",caption:"جریان سفارش و نقدینگی",icon:"⌁"},
  {id:"coins-section",title:"بازار رمزارزها",caption:"کاتالوگ و جست‌وجوی دارایی",icon:"₿"},
  {id:"trading-tools",title:"ابزارهای معامله‌گری",caption:"ریسک، سرمایه و حجم",icon:"⌗"},
  {id:"exchange-connections",title:"اتصال صرافی‌ها",caption:"منابع و وضعیت اتصال",icon:"⇄"},
  {id:"market-hours",title:"ساعات بازار",caption:"زمان‌بندی بازارهای جهانی",icon:"◷"},
  {id:"app-download",title:"اپلیکیشن MMP",caption:"دریافت و به‌روزرسانی",icon:"↓"},
  {id:"contact-us",title:"ارتباط با MMP",caption:"پشتیبانی و ارتباط",icon:"✉"},
  {id:"radar-signal-page",title:"آزمایشگاه سیگنال",caption:"ماژول داخلی سیگنال",icon:"⌁"}
 ];
 var byId={};modules.forEach(function(m){byId[m.id]=m;});
 function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
 function labelFor(node,index){
  var value=node.getAttribute("aria-label")||node.getAttribute("title")||node.getAttribute("data-label")||node.getAttribute("placeholder")||"";
  if(!value&&node.id){var lab=document.querySelector('label[for="'+node.id.replace(/"/g,'\\"')+'"]');if(lab)value=lab.textContent;}
  if(!value)value=(node.innerText||node.textContent||"").replace(/\s+/g," ").trim();
  if(!value&&node.tagName==="IMG")value=node.alt;
  return (value||("کنترل شماره "+(index+1))).slice(0,76);
 }
 function uniqueId(root,node,index){
  if(node.id)return node.id;
  var base="mmp-local-"+root.id+"-"+index, id=base, n=1;
  while(document.getElementById(id)){id=base+"-"+(++n);}
  node.id=id;node.setAttribute("data-mmp-generated-id","1");return id;
 }
 function makeActions(root){
  var old=root.querySelector(":scope > .mmp-priority-toolbar .mmp-section-actions,:scope > .mmp-section-floating-tools .mmp-section-actions,.mmp-hero-actions .mmp-section-actions");
  if(old)return old;
  var details=el("details","mmp-section-actions");
  var summary=el("summary","","امکانات");
  summary.setAttribute("aria-label","نمایش امکانات همین بخش");
  var nav=el("nav");nav.setAttribute("aria-label","امکانات "+root.id);
  var nodes=Array.from(root.querySelectorAll("button:not(.mmp-priority-toggle),input,select,textarea,details > summary,a[href^='#'],article.mmp-market-card"));
  nodes=nodes.filter(function(node){return !node.closest(".mmp-priority-toolbar,.mmp-section-floating-tools,.mmp-hero-actions .mmp-section-actions");});
  var seen=new Set(),items=[];
  nodes.forEach(function(node,index){
   var target=node.tagName==="SUMMARY"?node.parentElement:node;
   if(!target||seen.has(target))return;seen.add(target);
   var id=uniqueId(root,target,index+1);
   var a=el("a","",labelFor(node,index));a.href="#"+id;
   a.addEventListener("click",function(){details.open=false;});
   items.push(a);
  });
  if(items.length){items.slice(0,24).forEach(function(a){nav.appendChild(a);});}
  else nav.appendChild(el("div","mmp-actions-empty","در این بخش کنترل مستقلی شناسایی نشد."));
  details.append(summary,nav);
  return details;
 }
 function addHeadline(toolbar,config){
  if(toolbar.querySelector(".mmp-section-headline"))return;
  var head=el("div","mmp-section-headline");
  head.append(el("span","mmp-section-symbol",config.icon));
  var copy=el("span","");
  copy.append(el("span","mmp-section-name",config.title),el("span","mmp-section-caption",config.caption));
  head.append(copy);
  toolbar.insertBefore(head,toolbar.firstChild);
 }
 function setup(config){
  var root=document.getElementById(config.id);
  if(!root)return {id:config.id,state:"missing"};
  root.dataset.mmpSectionId=config.id;
  if(root.hidden||root.getAttribute("aria-hidden")==="true"){
   root.dataset.mmpUiHealth="internal";
   return {id:config.id,state:"internal"};
  }
  var actions=makeActions(root);
  if(config.id==="mmp-home-hero"){
   var host=root.querySelector(".mmp-hero-actions")||root;
   if(!actions.parentElement)host.appendChild(actions);
   actions.classList.add("mmp-section-actions");
   
  }else if(config.id==="market-snapshot"){
   var floating=root.querySelector(":scope > .mmp-section-floating-tools");
   if(!floating){floating=el("div","mmp-section-floating-tools");floating.append(el("span","mmp-section-label","MARKET SNAPSHOT"));root.insertBefore(floating,root.firstChild);}
   floating.append(actions);
   if(!floating.querySelector(".mmp-section-health"))floating.append(el("span","mmp-section-health","بررسی رابط"));
  }else{
   var toolbar=root.querySelector(":scope > .mmp-priority-toolbar");
   if(!toolbar){
    toolbar=el("div","mmp-priority-toolbar mmp-section-toolbar");
    root.insertBefore(toolbar,root.firstChild);
    var tools=el("div","mmp-priority-tools");
    var icon=el("span","mmp-priority-icon",config.icon);
    tools.append(icon);
    var collapse=el("button","mmp-priority-toggle","جمع‌کردن");
    collapse.type="button";collapse.setAttribute("aria-expanded","true");
    collapse.addEventListener("click",function(){
     var collapsed=root.classList.toggle("mmp-priority-collapsed");
     collapse.textContent=collapsed?"بازکردن":"جمع‌کردن";
     collapse.setAttribute("aria-expanded",String(!collapsed));
    });
    tools.append(actions,collapse);toolbar.append(tools);
   }else{
    var tools=toolbar.querySelector(".mmp-priority-tools")||toolbar;
    tools.append(actions);
   }
   addHeadline(toolbar,config);
   if(!toolbar.querySelector(".mmp-section-health"))toolbar.append(el("span","mmp-section-health","بررسی رابط"));
  }
  root.querySelectorAll(".mmp-section-actions").forEach(function(menu){
   menu.addEventListener("toggle",function(){
    if(menu.open)document.querySelectorAll(".mmp-section-actions[open]").forEach(function(other){if(other!==menu)other.open=false;});
   });
  });
  return {id:config.id,state:"ready",root:root};
 }
 function audit(){
  var report=[];
  modules.forEach(function(config){
   var root=document.getElementById(config.id);
   if(!root){report.push({id:config.id,status:"missing",controls:0,broken:0,duplicates:0});return;}
   if(root.hidden||root.getAttribute("aria-hidden")==="true"){report.push({id:config.id,status:"internal",controls:0,broken:0,duplicates:0});return;}
   var controls=root.querySelectorAll("button,input,select,textarea,details,a[href]").length;
   var broken=Array.from(root.querySelectorAll("a[href^='#']")).filter(function(a){
    var href=a.getAttribute("href");return href&&href!=="#"&&!document.getElementById(href.slice(1));
   }).length;
   var counts={};root.querySelectorAll("[id]").forEach(function(n){counts[n.id]=(counts[n.id]||0)+1;});
   var duplicates=Object.keys(counts).filter(function(id){return counts[id]>1;}).length;
   var textSize=(root.innerText||root.textContent||"").trim().length;
   var status=(broken||duplicates||textSize<8)?"warn":"ok";
   var badge=root.querySelector(".mmp-section-health");
   if(badge){
    badge.classList.toggle("is-warn",status==="warn");
    badge.classList.toggle("is-idle",status==="idle");
    badge.textContent=status==="ok"?"رابط سالم": "نیازمند بررسی";
    badge.title="کنترل رابط: "+controls+" · پیوند خراب: "+broken+" · شناسه تکراری: "+duplicates+" · این آزمون سلامت API یا صحت داده بازار را تضمین نمی‌کند.";
   }
   root.dataset.mmpUiHealth=status;
   report.push({id:config.id,status:status,controls:controls,broken:broken,duplicates:duplicates,contentChars:textSize});
  });
  window.mmpSectionHealthReport={checkedAt:new Date().toISOString(),scope:"DOM/UI only; backend APIs and market-data correctness are not inferred",sections:report};
  document.documentElement.dataset.mmpSectionHealthChecked="1";
  document.dispatchEvent(new CustomEvent("mmp:section-health",{detail:window.mmpSectionHealthReport}));
  return window.mmpSectionHealthReport;
 }
 function start(){
  modules.forEach(setup);
  audit();
  window.addEventListener("load",audit,{once:true});
  window.setTimeout(audit,2600);
  document.addEventListener("click",function(event){
   var link=event.target.closest(".mmp-section-actions a[href^='#']");if(!link)return;
   var target=document.getElementById(link.getAttribute("href").slice(1));
   if(target){event.preventDefault();link.closest(".mmp-section-actions").open=false;target.scrollIntoView({behavior:"smooth",block:"center"});}
  });
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
 window.mmpRunSectionHealthAudit=audit;
})();