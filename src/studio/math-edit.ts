/**
 * Правка формулы на слайде: двойной щелчок по формуле — под ней поле с исходником, слайд
 * перерисовывается на лету. Кнопки вставляют заготовки (дробь, степень, корень, сумма…)
 * простой записью или LaTeX — смотря как написана формула. Esc, Ctrl+Enter или щелчок мимо — готово.
 */
import { getAt, setAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import type { Deck } from '../types';

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

/** Имена ползунков слайда — для кнопки «живое число» */
function slideVars(deck: Deck, path: Path): string[] {
  const s = deck.slides[Number(path[1])];
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const b = v as Record<string, unknown>;
    if (b.type === 'control' && typeof b.name === 'string' && b.name) out.push(b.name);
    for (const k of ['body', 'free', 'items']) if (k in b) walk(b[k]);
  };
  walk(s?.body);
  walk(s?.free);
  return out;
}

export function editMath(ed: Editor, deck: () => Deck, stage: () => HTMLElement, path: Path, selectAll = false): void {
  closeMathEditor();
  const key = JSON.stringify(path);
  const blockEl = () => [...stage().querySelectorAll<HTMLElement>('.slide.on [data-type="math"][data-block]')].find((e) => e.dataset.block === key) ?? null;
  const at = blockEl();
  if (!at) return;
  const start = String(getAt(deck(), [...path, 'tex']) ?? '');
  const vars = slideVars(deck(), path);

  const el = document.createElement('div');
  el.className = 'st-mathed';
  el.dataset.edKeep = '';
  el.innerHTML = `<textarea class="st-mathed-src" rows="2" spellcheck="false" aria-label="Формула" placeholder="x^2 + 1/2 · sqrt(x) · alpha · есть «\\» — LaTeX"></textarea>`
    + `<div class="st-mathed-err" hidden></div>`
    + `<div class="st-mathed-keys">${SNIPS.map(([l, , , t, c], k) => `<button type="button" data-k="${k}"${c ? ` class="${c}"` : ''}${t ? ` aria-label="${t}"` : ''}>${esc(l)}</button>`).join('')}`
    + (vars.length ? `<button type="button" class="live" data-live aria-label="Живое число: значение ползунка «${esc(vars[0])}»">{{${esc(vars[0])}}}</button>` : '')
    + `</div>`;
  document.body.appendChild(el);
  const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
  const err = el.querySelector<HTMLElement>('.st-mathed-err')!;
  ta.value = start;

  const fitRows = () => { ta.rows = Math.min(8, Math.max(2, ta.value.split('\n').length)); };
  const place = () => {
    const b = blockEl() ?? at;
    const r = b.getBoundingClientRect();
    const w = Math.min(innerWidth - 16, Math.max(580, Math.min(720, r.width)));
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
  fitRows();
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
    timer = window.setTimeout(() => { save(); place(); }, 160);
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
    const sn = SNIPS[Number(b.dataset.k)];
    if (sn) insert(ta.value.includes('\\') ? sn[2] : sn[1]);
  });

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
