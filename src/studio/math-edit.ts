/**
 * Правка формулы на слайде: двойной щелчок по формуле — под ней поле с исходником, слайд
 * перерисовывается на лету. Кнопки вставляют заготовки (дробь, степень, корень, сумма…)
 * простой записью или LaTeX — смотря как написана формула. Esc, Ctrl+Enter или щелчок мимо — готово.
 */
import { icon } from '../components/icons';
import { sample, yRange, type PlotProps } from '../components/charts/plot';
import { getAt, setAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { controlRange, deriveVars, type ControlProps, type Vars } from '../engine/formula';
import { esc } from '../engine/html';
import { plotExpr } from '../engine/math-input';
import type { Block, Deck } from '../types';

/** Заготовка: «|» — где окажется курсор (выделенное попадает туда же) */
type Snip = [label: string, simple: string, latex: string, title?: string, cls?: string];
const SNIPS: Snip[] = [
  ['a/b', '(|)/()', '\\frac{|}{}', 'Дробь'],
  ['x²', '^(|)', '^{|}', 'Степень'],
  ['x₁', '_(|)', '_{|}', 'Индекс'],
  ['√', 'sqrt(|)', '\\sqrt{|}', 'Корень'],
  ['∑', 'sum_(i=1)^n |', '\\sum_{i=1}^{n} |', 'Сумма'],
  ['∫', 'int_a^b | dx', '\\int_{a}^{b} | \\,dx', 'Интеграл'],
  ['lim', 'lim_(x->0) |', '\\lim_{x \\to 0} |', 'Предел'],
  ['π', 'pi', '\\pi '],
  ['α', 'alpha', '\\alpha '],
  ['≤', ' <= ', ' \\le '],
  ['±', ' +- ', ' \\pm '],
  ['→', ' -> ', ' \\to '],
  ['·', ' * ', ' \\cdot '],
  // Выделить цветом и зачеркнуть («сокращается») — выделенный кусок записи или пустое место под курсором
  ['a', '[[|]]', '\\hl{|}', 'Выделить цветом', 'mk-hl'],
  ['x', '~~|~~', '\\cancel{|}', 'Зачеркнуть', 'mk-cancel'],
];

let open: { close: () => void } | null = null;

export function closeMathEditor(): void {
  open?.close();
}

/** Ползунки слайда: имя, текущее значение и крайние положения */
function sliders(deck: Deck, path: Path): { name: string; vals: number[] }[] {
  const s = deck.slides[Number(path[1])];
  const out: { name: string; vals: number[] }[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const b = v as Record<string, unknown>;
    if (b.type === 'control' && typeof b.name === 'string' && b.name) {
      const r = controlRange(b as unknown as ControlProps);
      out.push({ name: b.name, vals: [r.value, r.varOf(r.min), r.varOf(r.max)] });
    }
    for (const k of ['body', 'free', 'items']) if (k in b) walk(b[k]);
  };
  walk(s?.body);
  walk(s?.free);
  return out;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * График по формуле: функция из записи, отрезок по x (тригонометрия — от −2π до 2π, корень и
 * логарифм — от 0) и, если в формуле ползунки, диапазон по y с запасом на их крайние положения —
 * кривая не уходит за край, когда ползунок двигают при показе. null — это не функция y = f(x).
 */
export function plotFor(deck: Deck, path: Path, src: string): PlotProps | null {
  const sl = sliders(deck, path);
  const pe = plotExpr(src, sl.map((x) => x.name));
  if (!pe) return null;
  const defs = deck.slides[Number(path[1])]?.vars;
  const at = (pick: number[]): Vars => deriveVars(defs, Object.fromEntries(sl.map((x, k) => [x.name, pick[k]])));
  const now = at(sl.map((x) => x.vals[0]));
  const trig = /\b(sin|cos|tan|tg|cot|ctg)\(/.test(pe.expr);
  const half = /\b(sqrt|ln|lg|log|log10)\(/.test(pe.expr);
  const x = trig ? [-2 * Math.PI, 2 * Math.PI] : half ? [0, 10] : [-5, 5];
  const pts = sample(pe.expr, pe.v, now, x, 160);
  if (pts.filter((q) => q.y !== null).length < pts.length * 0.3) return null;
  const out: PlotProps = { type: 'plot', fn: pe.expr, ...(pe.v !== 'x' ? { var: pe.v } : {}), x: x.map(round) };
  if (sl.length) {
    // Все сочетания: сейчас, минимум, максимум каждого ползунка (до четырёх ползунков)
    const use = sl.slice(0, 4);
    const ys: number[] = [];
    for (let c = 0; c < 3 ** use.length; c++) {
      const pick = sl.map((s0, k) => (k < use.length ? s0.vals[Math.floor(c / 3 ** k) % 3] : s0.vals[0]));
      for (const q of sample(pe.expr, pe.v, at(pick), x, 160)) if (q.y !== null) ys.push(q.y);
    }
    const yr = yRange(ys);
    if (yr) out.y = yr.map(round);
  }
  return out;
}

export function editMath(ed: Editor, deck: () => Deck, stage: () => HTMLElement, path: Path, selectAll = false): void {
  closeMathEditor();
  const key = JSON.stringify(path);
  const blockEl = () => [...stage().querySelectorAll<HTMLElement>('.slide.on [data-type="math"][data-block]')].find((e) => e.dataset.block === key) ?? null;
  const at = blockEl();
  if (!at) return;
  const start = String(getAt(deck(), [...path, 'tex']) ?? '');
  const vars = sliders(deck(), path).map((x) => x.name);

  const el = document.createElement('div');
  el.className = 'st-mathed';
  el.dataset.edKeep = '';
  el.innerHTML = `<textarea class="st-mathed-src" rows="2" spellcheck="false" aria-label="Формула" placeholder="x^2 + 1/2 · sqrt(x) · alpha · есть «\\» — LaTeX"></textarea>`
    + `<div class="st-mathed-err" hidden></div>`
    + `<div class="st-mathed-keys">${SNIPS.map(([l, , , t, c], k) => `<button type="button" data-k="${k}"${c ? ` class="${c}"` : ''}${t ? ` aria-label="${t}"` : ''}>${esc(l)}</button>`).join('')}`
    + (vars.length ? `<button type="button" class="live" data-live aria-label="Живое число: значение ползунка «${esc(vars[0])}»">{{${esc(vars[0])}}}</button>` : '')
    // Только у формулы-функции y = f(x): график рядом, живой от тех же ползунков
    + `<button type="button" class="plot-btn" data-plot hidden>${icon('chart')}<span>График</span></button>`
    + `</div>`;
  document.body.appendChild(el);
  const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
  const err = el.querySelector<HTMLElement>('.st-mathed-err')!;
  ta.value = start;

  const fitRows = () => { ta.rows = Math.min(8, Math.max(2, ta.value.split('\n').length)); };
  const place = () => {
    const b = blockEl() ?? at;
    const r = b.getBoundingClientRect();
    const w = Math.min(innerWidth - 16, Math.max(640, Math.min(760, r.width)));
    el.style.width = `${w}px`;
    const h = el.offsetHeight;
    const below = r.bottom + 10;
    el.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    el.style.top = `${below + h < innerHeight - 8 ? below : Math.max(8, r.top - h - 10)}px`;
  };
  /** Ошибка разбора — под полем (её же видно на слайде красным) */
  const showErr = () => {
    const bad = blockEl()?.querySelector<HTMLElement>('.math-err');
    err.hidden = !bad;
    err.textContent = bad?.title ?? '';
  };
  const plotBtn = el.querySelector<HTMLButtonElement>('[data-plot]')!;
  const canPlot = () => { plotBtn.hidden = !plotFor(deck(), path, ta.value); };
  fitRows();
  canPlot();
  place();
  showErr();

  let timer = 0;
  const save = () => {
    clearTimeout(timer);
    const v = ta.value;
    if (v === String(getAt(deck(), [...path, 'tex']) ?? '')) return;
    ed.commit((d) => setAt(d, [...path, 'tex'], v), { rebuild: true, merge: `math:${key}` });
    showErr();
  };
  ta.addEventListener('input', () => {
    fitRows();
    clearTimeout(timer);
    timer = window.setTimeout(() => { save(); canPlot(); place(); }, 160);
  });

  const insert = (snip: string) => {
    const [a, b = ''] = snip.split('|');
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    ta.setRangeText(a + sel + b, s, e, 'end');
    // Курсор — на место «|» (после выделенного, если было)
    const pos = s + a.length + sel.length;
    ta.setSelectionRange(pos, pos);
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  };
  el.querySelector('.st-mathed-keys')!.addEventListener('mousedown', (e) => e.preventDefault());
  el.querySelector('.st-mathed-keys')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset.live !== undefined) return insert(`{{${vars[0]}}}|`);
    if (b.dataset.plot !== undefined) return addPlot();
    const sn = SNIPS[Number(b.dataset.k)];
    if (sn) insert(ta.value.includes('\\') ? sn[2] : sn[1]);
  });

  /** График рядом с формулой: справа, если влезает, иначе под ней */
  const addPlot = () => {
    save();
    const p = plotFor(deck(), path, ta.value);
    if (!p) return;
    const i = Number(path[1]);
    // Место формулы: свободный объект (или тот, в котором она лежит)
    const top = path[2] === 'free' ? path.slice(0, 4) : null;
    const pl = (top ? getAt(deck(), [...top, 'place']) : null) as { x?: number; y?: number; w?: number } | null;
    const r = blockEl()?.closest<HTMLElement>('.free, [data-block]')?.getBoundingClientRect();
    const k = r ? (stage().querySelector<HTMLElement>('.slide.on')?.getBoundingClientRect().width ?? 1280) / 1280 : 1;
    const fx = Number(pl?.x ?? 80);
    const fy = Number(pl?.y ?? 80);
    const fw = Number(pl?.w ?? 560);
    const fh = r ? r.height / k : 120;
    let w = 520;
    let x: number;
    let y: number;
    if (fx + fw + 24 + 320 <= 1256) {
      w = Math.min(520, 1256 - (fx + fw + 24));
      x = fx + fw + 24;
      y = Math.max(24, Math.min(720 - 24 - (w * 400) / 640, fy + fh / 2 - (w * 400) / 640 / 2));
    } else {
      x = Math.max(24, Math.min(1256 - w, fx + fw / 2 - w / 2));
      y = Math.min(720 - 24 - (w * 400) / 640, fy + fh + 16);
    }
    let at = -1;
    if (!ed.commit((d) => {
      const s = d.slides[i];
      s.free = Array.isArray(s.free) ? s.free : [];
      s.free.push({ ...p, place: { x: Math.round(x), y: Math.round(y), w: Math.round(w) } } as Block);
      at = s.free.length - 1;
    }, { rebuild: true })) return;
    close();
    ed.selectFree(i, at);
  };

  const close = () => {
    save();
    el.remove();
    removeEventListener('pointerdown', outside, true);
    removeEventListener('resize', place);
    open = null;
  };
  const outside = (e: PointerEvent) => {
    const t = e.target as Element;
    if (el.contains(t) || blockEl()?.contains(t)) return;
    close();
  };
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      close();
    }
  });
  addEventListener('pointerdown', outside, true);
  addEventListener('resize', place);
  open = { close };
  ta.focus();
  if (selectAll) ta.select();
  else ta.setSelectionRange(ta.value.length, ta.value.length);
}
