/* MMP compact priority navigation; preserves all module content and IDs. */
(function(){
 'use strict';
 var order=['mmp-home-hero','market-snapshot','chart-section','quantum-center-entry','mmp-autonomous-health-center','opportunities','market-hunter','ai-section','market-intelligence','boom-hunter','coins-section','trading-tools','exchange-connections','market-hours','app-download','contact-us','radar-signal-page'];
 var flattenIds=['chart-section','mmp-autonomous-health-center','opportunities','market-hunter','ai-section','market-intelligence','boom-hunter','trading-tools'];
 var modules={
  'chart-section':{icon:'▥',links:[['مرکز فرماندهی','quantum-center-entry'],['رادار','opportunities'],['تحلیلگر','ai-section']]},
  'mmp-autonomous-health-center':{icon:'✚',links:[['وضعیت بازار','market-snapshot'],['مرکز فرماندهی','quantum-center-entry'],['اتصالات','exchange-connections']]},
  'opportunities':{icon:'◉',links:[['نمودار','chart-section'],['شکارچی','market-hunter'],['تحلیلگر','ai-section']]},
  'market-hunter':{icon:'⌖',links:[['رادار','opportunities'],['تحلیلگر','ai-section'],['مومنتوم','boom-hunter']]},
  'ai-section':{icon:'✧',links:[['نمودار','chart-section'],['هوشمندی بازار','market-intelligence'],['ابزار معامله','trading-tools']]},
  'market-intelligence':{icon:'⌁',links:[['نمودار','chart-section'],['دارایی‌ها','coins-section'],['اتصالات','exchange-connections']]},
  'boom-hunter':{icon:'↗',links:[['شکارچی','market-hunter'],['رادار','opportunities'],['تحلیلگر','ai-section']]},
  'trading-tools':{icon:'⚙',links:[['نمودار','chart-section'],['تحلیلگر','ai-section'],['بازار','market-snapshot']]},
  'quantum-center-entry':{icon:'✥',links:[['پایش و ترمیم','mmp-autonomous-health-center'],['رادار','opportunities'],['شکارچی','market-hunter']]},
  'coins-section':{icon:'◈',links:[['نمودار','chart-section'],['هوشمندی بازار','market-intelligence'],['ابزار معامله','trading-tools']]},
  'exchange-connections':{icon:'⇄',links:[['پایش سیستم','mmp-autonomous-health-center'],['دارایی‌ها','coins-section'],['بازار','market-snapshot']]},
  'market-hours':{icon:'◷',links:[['بازار','market-snapshot'],['نمودار','chart-section'],['اتصالات','exchange-connections']]},
  'app-download':{icon:'↓',links:[['ارتباط','contact-us'],['مرکز فرماندهی','quantum-center-entry']]},
  'contact-us':{icon:'✉',links:[['دانلود اپ','app-download'],['مرکز فرماندهی','quantum-center-entry']]}
 };
 function build(){
  var main=document.getElementById('hero');
  if(!main||main.dataset.mmpPriorityReady==='1')return;
  main.dataset.mmpPriorityReady='1';
  order.forEach(function(id){var el=document.getElementById(id);if(el&&el.parentElement===main)main.appendChild(el);});
  Object.keys(modules).forEach(function(id){
   var section=document.getElementById(id),cfg=modules[id];
   if(!section||section.dataset.mmpCompactReady==='1')return;
   section.dataset.mmpCompactReady='1';section.classList.add('mmp-priority-module');if(flattenIds.indexOf(id)!==-1){section.classList.add('mmp-priority-card-flattened');section.classList.remove('card');}
   var first=section.firstElementChild;
   var logo=section.querySelector('.mmp-module-logo');
   var toolbar=document.createElement('div');toolbar.className='mmp-priority-toolbar';
   var icon=document.createElement('span');icon.className='mmp-priority-icon';
   if(logo){var img=document.createElement('img');img.className='mmp-priority-logo';img.src=logo.src;img.alt=logo.alt||'';icon.replaceWith(img);icon=img;}else icon.textContent=cfg.icon;
   var tools=document.createElement('div');tools.className='mmp-priority-tools';tools.appendChild(icon);
   var menu=document.createElement('details');menu.className='mmp-priority-menu';
   var summary=document.createElement('summary');summary.textContent='منو';menu.appendChild(summary);
   var links=document.createElement('nav');links.className='mmp-priority-menu-links';links.setAttribute('aria-label','میانبرهای '+id);
   cfg.links.forEach(function(item){var a=document.createElement('a');a.href='#'+item[1];a.textContent=item[0];a.addEventListener('click',function(){menu.open=false;});links.appendChild(a);});
   menu.appendChild(links);tools.appendChild(menu);
   var toggle=document.createElement('button');toggle.type='button';toggle.className='mmp-priority-toggle';toggle.textContent='جمع‌کردن';toggle.setAttribute('aria-expanded','true');
   toggle.addEventListener('click',function(){
    var collapsed=section.classList.toggle('mmp-priority-collapsed');
    toggle.textContent=collapsed?'بازکردن':'جمع‌کردن';
    toggle.setAttribute('aria-expanded',String(!collapsed));
   });
   tools.appendChild(toggle);toolbar.appendChild(tools);
   if(first)section.insertBefore(toolbar,first);else section.appendChild(toolbar);
   section.querySelectorAll('button').forEach(function(btn){if(!btn.getAttribute('aria-label')&&!btn.textContent.trim())btn.setAttribute('aria-label','عملیات بخش');});
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build,{once:true});else build();
})();
