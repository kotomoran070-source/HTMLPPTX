/**
 * Мышь — во встроенные документы (живые вставки, результат песочницы). Они изолированы
 * (iframe без доступа к странице), поэтому события в них не пробросить напрямую: страница
 * присылает положение сообщением, а маленький скрипт внутри документа сам создаёт события
 * мыши в этой точке. Так курсор докладчика у зрителей расталкивает частицы и жмёт кнопки вставки.
 */

/** Скрипт внутри документа: принимает сообщения только от страницы, в которую встроен */
const SCRIPT = `<script>(function(){addEventListener('message',function(e){var d=e.data;if(e.source!==parent||!d||typeof d.slideriaPtr!=='string')return;var t=d.slideriaPtr,x=+d.x||0,y=+d.y||0,b=+d.b||0;`
  + `function f(el,type,P,o){try{el.dispatchEvent(new (P&&window.PointerEvent?PointerEvent:MouseEvent)(type,Object.assign({clientX:x,clientY:y,buttons:b,pointerId:1,pointerType:'mouse',isPrimary:true,view:window},o)))}catch(_){}}`
  + `if(t==='leave'){f(window,'pointerleave',1,{});f(document.documentElement,'pointerleave',1,{});f(document.documentElement,'mouseleave',0,{});f(document.documentElement,'mouseout',0,{bubbles:true});return}`
  + `var el=document.elementFromPoint(x,y)||document.body||document.documentElement,o={bubbles:true,cancelable:true,composed:true};`
  + `if(t==='move'){f(el,'pointermove',1,o);f(el,'mousemove',0,o)}`
  + `else if(t==='down'){f(el,'pointerdown',1,Object.assign({button:0,buttons:1},o));f(el,'mousedown',0,Object.assign({button:0,buttons:1},o))}`
  + `else if(t==='up'){f(el,'pointerup',1,Object.assign({button:0,buttons:0},o));f(el,'mouseup',0,Object.assign({button:0,buttons:0},o));f(el,'click',0,Object.assign({button:0,buttons:0},o))}`
  + `});`
  // Пульс: документ рисуется (кадры идут) — страница видит, что вставка не застыла
  + `var n=0;function k(){if(++n%20===0)try{parent.postMessage({slideriaAlive:1},'*')}catch(_){}requestAnimationFrame(k)}requestAnimationFrame(k)})()</script>`;

/** Сообщение-пульс из рамки (см. SCRIPT) */
export const isAlive = (e: MessageEvent, frame: HTMLIFrameElement | null): boolean => !!frame && e.source === frame.contentWindow && e.data?.slideriaAlive === 1;

/** Документ со скриптом-приёмником: после <head> (как цвета темы), иначе — в начало, но после <!doctype> */
export function withPointerBridge(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + SCRIPT);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + SCRIPT);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? doctype[0] + SCRIPT + html.slice(doctype[0].length) : SCRIPT + html;
}

export type FramePointer = 'move' | 'down' | 'up' | 'leave';

/** Событие мыши в точке экрана (cx, cy) — документу в рамке, в его координатах */
export function postPointer(frame: HTMLIFrameElement, type: FramePointer, cx = 0, cy = 0, buttons = 0): void {
  const r = frame.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // Рамка может быть уменьшена вместе со сценой: координаты — в пикселях самого документа
  const x = ((cx - r.left) / r.width) * frame.clientWidth;
  const y = ((cy - r.top) / r.height) * frame.clientHeight;
  frame.contentWindow?.postMessage({ slideriaPtr: type, x, y, b: buttons }, '*');
}

/** Рамка под точкой экрана: интерактивная вставка или результат песочницы (верхняя из видимых) */
export function frameAt(root: ParentNode, cx: number, cy: number): HTMLIFrameElement | null {
  const list = [...root.querySelectorAll<HTMLIFrameElement>('.slide.on .embed.interactive > iframe.embed-frame.on, .slide.on iframe.sbx-frame.on')];
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i].getBoundingClientRect();
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return list[i];
  }
  return null;
}

/**
 * Мышь своего зрителя — во вставку, закрытую другими объектами: фон-анимация под заголовком
 * и плашкой («космос» вставкой) реагирует на курсор и над ними. Над открытой частью вставки
 * события и так идут в неё напрямую. Щелчок по ссылке, кнопке, полю или объекту-кнопке
 * во вставку не уходит. skip() — не пробрасывать (режим правки).
 */
export function forwardCovered(stage: HTMLElement, skip: () => boolean): () => void {
  let cur: HTMLIFrameElement | null = null;
  const leave = () => {
    if (cur?.isConnected) postPointer(cur, 'leave');
    cur = null;
  };
  const move = (e: PointerEvent) => {
    if (skip() || !e.isTrusted) return leave();
    const f = frameAt(stage, e.clientX, e.clientY);
    if (f !== cur) leave();
    cur = f;
    if (f) postPointer(f, 'move', e.clientX, e.clientY, e.buttons);
  };
  const click = (e: MouseEvent) => {
    if (skip() || !e.isTrusted) return;
    const t = e.target as Element;
    if (t.closest('a, button, input, select, textarea, label, summary, video, model-viewer, [contenteditable="true"], .free[data-action], .sbx')) return;
    const f = frameAt(stage, e.clientX, e.clientY);
    if (!f) return;
    postPointer(f, 'down', e.clientX, e.clientY, 1);
    postPointer(f, 'up', e.clientX, e.clientY);
  };
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerleave', leave);
  stage.addEventListener('click', click);
  return () => {
    leave();
    stage.removeEventListener('pointermove', move);
    stage.removeEventListener('pointerleave', leave);
    stage.removeEventListener('click', click);
  };
}
