/**
 * Появления, которым мало CSS: «По словам» и «По буквам» (текст делится на части .fx-w с номером --i)
 * «Прорисовка» (контуры SVG получают pathLength=1, у фигуры — обводка-подсказка поверх) и «Из ряби»
 * (на время появления — SVG-фильтр, рябь утихает). Как и эффекты
 * текста, это делается только при показе и в «Просмотре»; остановка возвращает разметку как была.
 * Подготовленный объект получает класс fx-ready: дальше двигают только его части (base.css)
 */
const HOLDER = ':is(p[data-type="text"], .shape-t)';
/** Эффекты текста, которые сами делят текст по буквам — с ними текст по частям не делится */
const OWN_SPLIT = new Set(['wave', 'type', 'scramble']);
const GEOMETRY = 'path, line, polyline, polygon, circle, ellipse, rect';
const SVG = 'http://www.w3.org/2000/svg';

/** Подготовить появления на слайде; возвращает остановку */
export function enterFx(slide: HTMLElement | undefined): () => void {
  if (!slide) return () => {};
  const body = document.body.classList;
  if ((body.contains('editing') && !body.contains('st-previewing')) || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const undo: (() => void)[] = [];
  slide.querySelectorAll<HTMLElement>(':scope > .free:is(.fx-words, .fx-letters)').forEach((obj) => {
    if (obj.hasAttribute('data-count') || OWN_SPLIT.has(obj.dataset.tfx ?? '')) return;
    const holders = [...obj.querySelectorAll<HTMLElement>(HOLDER)];
    if (!holders.length) return;
    const html = holders.map((h) => h.innerHTML);
    let i = 0;
    for (const h of holders) i = split(h, obj.classList.contains('fx-letters'), i);
    obj.classList.add('fx-ready');
    undo.push(() => {
      obj.classList.remove('fx-ready');
      holders.forEach((h, k) => { if (h.isConnected) h.innerHTML = html[k]; });
    });
  });
  // По пунктам без щелчка: пункты появляются один за другим (номер --i), сам объект стоит
  slide.querySelectorAll<HTMLElement>(':scope > .free.by-item').forEach((obj) => {
    if (/\bin:/.test(obj.dataset.acts ?? '')) return;
    const items = [...obj.querySelectorAll<HTMLElement>('li, .md-li')];
    items.forEach((it, i) => it.style.setProperty('--i', String(i)));
    obj.classList.add('fx-items');
    undo.push(() => { obj.classList.remove('fx-items'); items.forEach((it) => it.style.removeProperty('--i')); });
  });
  slide.querySelectorAll<HTMLElement>(':scope > .free.fx-draw').forEach((obj) => {
    const off = draw(obj);
    if (!off) return;
    obj.classList.add('fx-ready');
    undo.push(() => { obj.classList.remove('fx-ready'); off(); });
  });
  slide.querySelectorAll<HTMLElement>(':scope > .free.fx-ripple').forEach((obj) => undo.push(ripple(obj)));
  return () => undo.forEach((f) => f());
}

let rippleN = 0;
/**
 * Из ряби: объект проступает (fx-ripple, base.css), а пока идёт появление — свой фильтр: рябь шума
 * (feTurbulence) сдвигает его (feDisplacementMap), смещение утихает до нуля за время появления.
 * Начало ловится по animationstart — так и с задержкой, и по щелчку; по концу фильтр снимается
 */
function ripple(obj: HTMLElement): () => void {
  const id = `sl-ripple-${++rippleN}`;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  svg.innerHTML = `<filter id="${id}" y="-10%" height="120%" color-interpolation-filters="sRGB">`
    + '<feTurbulence type="fractalNoise" baseFrequency="0.003 0.05" numOctaves="1" seed="4">'
    + '<animate attributeName="baseFrequency" values="0.003 0.05;0.002 0.02" dur="1s" begin="indefinite" fill="freeze"/></feTurbulence>'
    // Волны идут поперёк: смещение только по горизонтали (зелёный — середина)
    + '<feColorMatrix values="1 0 0 0 0  0 0 0 0 .5  0 0 0 0 0  0 0 0 0 1" result="n"/>'
    + '<feDisplacementMap in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G">'
    + '<animate attributeName="scale" values="90;0" dur="1s" begin="indefinite" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".35 .2 .45 1"/>'
    + '</feDisplacementMap></filter>';
  document.body.append(svg);
  const filter = svg.querySelector('filter')!;
  const anims = [...svg.querySelectorAll('animate')];
  const was = obj.style.filter;
  const off = () => { obj.style.filter = was; };
  const start = (e: AnimationEvent) => {
    if (e.target !== obj || e.animationName !== 'fx-ripple') return;
    off();
    const cs = getComputedStyle(obj);
    const dur = cs.animationDuration.split(',')[0].trim();
    const base = cs.filter;
    // Сила ряби — по ширине объекта (не больше 90 px), поле фильтра — с запасом на сдвиг: края не срезаются
    const w = Math.max(1, obj.offsetWidth);
    const amp = Math.round(Math.min(90, Math.max(24, w * 0.22)));
    filter.setAttribute('x', `${(-(amp / 2 + 6) / w) * 100}%`);
    filter.setAttribute('width', `${(1 + (amp + 12) / w) * 100}%`);
    anims[1].setAttribute('values', `${amp};0`);
    obj.style.filter = `url(#${id})${base && base !== 'none' ? ` ${base}` : ''}`;
    for (const a of anims) {
      a.setAttribute('dur', dur);
      a.beginElement();
    }
  };
  const end = (e: AnimationEvent) => { if (e.target === obj && e.animationName === 'fx-ripple') off(); };
  obj.addEventListener('animationstart', start);
  obj.addEventListener('animationend', end);
  obj.addEventListener('animationcancel', end);
  return () => {
    obj.removeEventListener('animationstart', start);
    obj.removeEventListener('animationend', end);
    obj.removeEventListener('animationcancel', end);
    off();
    svg.remove();
  };
}

/** Текст элемента — по словам или по буквам в span.fx-w; пробелы остаются текстом. Возвращает следующий номер */
function split(el: HTMLElement, letters: boolean, from: number): number {
  let i = from;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) nodes.push(n);
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    for (const part of node.data.split(letters ? /(\s)/ : /(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { frag.append(part); continue; }
      // Буквы слова держатся вместе: перенос строки — только между словами
      const word = letters ? document.createElement('span') : frag;
      if (letters) (word as HTMLElement).style.whiteSpace = 'nowrap';
      for (const ch of letters ? [...part] : [part]) {
        const s = document.createElement('span');
        s.className = 'fx-w';
        s.textContent = ch;
        s.style.setProperty('--i', String(i++));
        word.append(s);
      }
      if (letters) frag.append(word);
    }
    node.replaceWith(frag);
  }
  return i;
}

/**
 * Прорисовка: линия и стрелка — средствами CSS; контуры SVG внутри объекта — штрихом (pathLength=1);
 * фигура-прямоугольник, овал, капсула — обводкой поверх, затем проявляется сама. Нечего рисовать — null
 */
function draw(obj: HTMLElement): (() => void) | null {
  if (obj.querySelector('.shape-line')) return () => {};
  const geo = [...obj.querySelectorAll<SVGGeometryElement>(GEOMETRY)].filter((g) => !g.closest('.fx-ol'));
  if (geo.length) {
    const marked: SVGGeometryElement[] = [];
    for (const g of geo) {
      const cs = getComputedStyle(g);
      // Свой пунктир остаётся пунктиром: такой контур только проявляется
      const stroked = cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0 && cs.strokeDasharray === 'none' && !g.hasAttribute('pathLength');
      if (stroked) g.setAttribute('pathLength', '1');
      g.classList.add('fx-dr');
      marked.push(g);
    }
    return () => marked.forEach((g) => { g.classList.remove('fx-dr'); g.removeAttribute('pathLength'); });
  }
  const shape = obj.querySelector<HTMLElement>('.shape');
  if (!shape) return null;
  const cs = getComputedStyle(shape);
  const w = shape.offsetWidth;
  const h = shape.offsetHeight;
  if (!w || !h) return null;
  const bw = parseFloat(cs.borderTopWidth) || 0;
  const sw = Math.max(2, bw);
  const svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('fx-ol');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { left: `${shape.offsetLeft}px`, top: `${shape.offsetTop}px`, width: `${w}px`, height: `${h}px`, inset: 'auto' });
  const ellipse = shape.classList.contains('shape-ellipse');
  const line = document.createElementNS(SVG, ellipse ? 'ellipse' : 'rect');
  const at = (k: string, v: number | string) => line.setAttribute(k, String(v));
  if (ellipse) { at('cx', w / 2); at('cy', h / 2); at('rx', w / 2 - sw / 2); at('ry', h / 2 - sw / 2); } else {
    const r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
    at('x', sw / 2); at('y', sw / 2); at('width', w - sw); at('height', h - sw); at('rx', Math.max(0, r - sw / 2));
  }
  at('pathLength', 1);
  // Цвет — как у рамки фигуры, без рамки — цвет акцента
  line.setAttribute('style', `fill:none;stroke:${bw > 0 ? cs.borderTopColor : 'var(--ac)'};stroke-width:${sw};stroke-dasharray:1 1`);
  svg.append(line);
  obj.append(svg);
  shape.classList.add('fx-olf');
  return () => { svg.remove(); shape.classList.remove('fx-olf'); };
}
