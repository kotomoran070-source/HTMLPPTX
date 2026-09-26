/**
 * «Живые» слайды: исходный HTML-файл показывается как есть, со всеми его скриптами,
 * в изолированной рамке — по одному слайду. Здесь общее для импорта (Node) и показа (браузер):
 * как найти слайды в чужом файле и скрипт, который оставляет в рамке только нужный слайд.
 * Без зависимостей: модуль подключается и в браузере, и в плагинах.
 */

/**
 * Где искать слайды, по порядку: наш формат и артефакты, Claude Design, reveal.js и похожие.
 * Берётся первый вариант, который находит хотя бы два слайда (или один — для явных слайдов).
 */
export const SLIDE_SELECTORS = [
  'section.slide', '.deck-slide', '.reveal .slides > section', '.slides > section',
  '[data-slide]', '.slide', 'body > section', 'section',
];

/** Первый подходящий селектор и число слайдов; null — слайдов не видно (вся страница — один слайд). */
export function pickSelector(count: (sel: string) => number): { selector: string | null; count: number } {
  for (const sel of SLIDE_SELECTORS) {
    const n = count(sel);
    if (n >= 2 || (n === 1 && (sel === 'section.slide' || sel === '.deck-slide'))) return { selector: sel, count: n };
  }
  return { selector: null, count: 1 };
}

export interface LiveOptions {
  /** Номер слайда (с 0) */
  index: number;
  /** Селектор слайдов (null — вся страница) */
  selector: string | null;
  /** Метка сообщений этой рамки */
  token: string;
  /** Тема показа: у файла, который её поддерживает (data-theme), включается та же */
  theme: 'light' | 'dark';
  /** Цвета темы проекта: для файлов, написанных через var(--ac) и др. */
  tokens: Record<string, string>;
}

/**
 * Скрипт в начало исходного файла. Он:
 * - подменяет localStorage/sessionStorage (в изолированной рамке они недоступны, скрипты падали бы);
 * - находит нужный слайд, делает его «показанным» (классы on/active/present/current),
 *   прячет всё вокруг (кнопки, счётчики, другие слайды) и вписывает слайд в рамку;
 * - держит это состояние, даже если собственный движок файла пытается листать;
 * - передаёт клавиши листания движку проекта, а не движку файла.
 */
export function liveScript(o: LiveOptions): string {
  const cfg = JSON.stringify({ n: o.index, sel: o.selector, tok: o.token, theme: o.theme, tokens: o.tokens });
  return `<script>(function(){var C=${cfg.replace(/</g, '\\u003c')};
function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}
['localStorage','sessionStorage'].forEach(function(k){try{window[k].getItem('x')}catch(e){try{Object.defineProperty(window,k,{value:mem(),configurable:true})}catch(e2){}}});
var root=document.documentElement;
function applyTheme(t,tk){root.setAttribute('data-theme',t);root.style.colorScheme=t;var s=document.getElementById('htmlpptx-live-theme');if(!s){s=document.createElement('style');s.id='htmlpptx-live-theme';(document.head||root).appendChild(s)}
var v=[];for(var k in tk)if(tk[k])v.push(k+':'+tk[k]);s.textContent=':root:root{'+v.join(';')+'}'}
applyTheme(C.theme,C.tokens);
var STATE=['on','active','present','current'];
function slides(){return C.sel?[].slice.call(document.querySelectorAll(C.sel)):[]}
var busy=false,mo=null;
function watch(on){if(!mo)return;if(!on){mo.disconnect();return}slides().forEach(function(x){mo.observe(x,{attributes:true,attributeFilter:['class','style']})})}
function focus(){if(busy||!document.body)return;busy=true;watch(false);try{
var list=slides(),s=C.sel?list[C.n]:null;
document.body.style.transform='';
if(s){list.forEach(function(x,i){STATE.forEach(function(c){if(i===C.n){if(!x.classList.contains(c)&&(c==='on'||c==='active'||c==='present'))x.classList.add(c)}else x.classList.remove(c)});if(i!==C.n)x.style.setProperty('visibility','hidden','important')});
s.style.removeProperty('visibility');if(getComputedStyle(s).display==='none')s.style.setProperty('display','block','important');
for(var node=s;node&&node!==document.body&&node.parentElement;node=node.parentElement){node.style.removeProperty('visibility');[].forEach.call(node.parentElement.children,function(sib){if(sib!==node&&sib.tagName!=='SCRIPT'&&sib.tagName!=='STYLE'&&!sib.contains(s))sib.style.setProperty('visibility','hidden','important')})}
var r=s.getBoundingClientRect();
// Слайд уже на весь экран (движки с position:fixed) — страницу не трогаем: сдвиг body ломал бы их раскладку
var full=r.width>=innerWidth*.9&&r.height>=innerHeight*.9&&r.left>-8&&r.top>-8&&r.right<=innerWidth+8&&r.bottom<=innerHeight+8;
if(r.width>0&&r.height>0&&!full){var k=Math.min(innerWidth/r.width,innerHeight/r.height),x=(innerWidth-r.width*k)/2-r.left*k,y=(innerHeight-r.height*k)/2-r.top*k;
document.body.style.transformOrigin='0 0';document.body.style.transform='translate('+x+'px,'+y+'px) scale('+k+')'}}
root.style.overflow='hidden';
}catch(e){}watch(true);busy=false}
var raf=0;mo=new MutationObserver(function(){if(!raf)raf=requestAnimationFrame(function(){raf=0;focus()})});
function start(){focus();[50,200,500,1000,2000,3500].forEach(function(t){setTimeout(focus,t)})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
addEventListener('load',focus);addEventListener('resize',focus);
var NAV={ArrowRight:1,ArrowLeft:1,ArrowUp:1,ArrowDown:1,PageUp:1,PageDown:1,Home:1,End:1,' ':1,Enter:1,Backspace:1,Escape:1};
addEventListener('keydown',function(e){var t=e.target,typing=t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));if(typing)return;
if(NAV[e.key]||(e.key.length===1&&!e.ctrlKey&&!e.metaKey)){e.stopImmediatePropagation();e.preventDefault();
parent.postMessage({htmlpptxLive:C.tok,key:e.key,code:e.code,shiftKey:e.shiftKey,altKey:e.altKey,ctrlKey:e.ctrlKey,metaKey:e.metaKey},'*')}},true);
var tx=0;addEventListener('touchstart',function(e){tx=e.touches[0].clientX},{capture:true,passive:true});
addEventListener('touchend',function(e){var d=e.changedTouches[0].clientX-tx;if(Math.abs(d)>70){e.stopImmediatePropagation();parent.postMessage({htmlpptxLive:C.tok,key:d<0?'ArrowRight':'ArrowLeft'},'*')}},true);
addEventListener('message',function(e){if(e.source!==parent||!e.data||e.data.htmlpptxLive!==C.tok)return;if(e.data.theme)applyTheme(e.data.theme,e.data.tokens||{})});
})()<\/script>`;
}

/** Исходный файл со скриптом живого слайда: скрипт — первым в <head>, до скриптов файла. */
export function liveDocument(html: string, o: LiveOptions): string {
  const s = liveScript(o);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + s);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${s}</head>`);
  return s + html;
}
