import { getAt, setAt } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import type { Block, Deck } from '../types';

/**
 * Ширина столбцов и высота строк таблицы — прямо на слайде: у выделенной таблицы на границах
 * столбцов и под строками появляются ручки, их тянут мышью. Результат — доли ширины (widths)
 * и высоты строк (heights, headHeight: ниже текста строка не становится)
 */
export function tableGrips(h: { deck: Deck; editor: Editor; stage(): HTMLElement }): { sync(): void } {
  const layer = document.createElement('div');
  layer.className = 'st-grips';
  layer.dataset.edKeep = '';
  document.body.appendChild(layer);
  const rows = document.createElement('div');
  rows.className = 'st-grips';
  rows.dataset.edKeep = '';
  document.body.appendChild(rows);

  let raf = 0;
  let dragging = false;

  /** Выделенная таблица: путь и элемент на слайде */
  const current = () => {
    const sel = h.editor.selection;
    if (!sel || sel.group.length > 1) return null;
    if ((getAt(h.deck, sel.block) as Block | undefined)?.type !== 'table') return null;
    const el = h.stage().querySelector<HTMLElement>(`.slide.on [data-block="${CSS.escape(JSON.stringify(sel.block))}"]`);
    const table = el?.querySelector('table');
    return table ? { path: sel.block, table } : null;
  };
  /**
   * Столбцы таблицы с учётом объединённых ячеек: левый край первого, правые края всех столбцов
   * и куски границ, где граница видна (внутри объединённой ячейки ручки нет)
   */
  const grid = (table: HTMLTableElement) => {
    const busy: number[][] = [];
    const right: number[] = [];
    let left = Infinity;
    const runs: { i: number; top: number; bottom: number }[] = [];
    [...table.rows].forEach((tr, r) => {
      let c = 0;
      for (const cell of [...tr.cells]) {
        while (busy[r]?.[c]) c++;
        const cs = Math.max(1, cell.colSpan);
        const rs = Math.max(1, cell.rowSpan);
        for (let a = 0; a < rs; a++) for (let b = 0; b < cs; b++) (busy[r + a] ??= [])[c + b] = 1;
        const box = cell.getBoundingClientRect();
        if (c === 0) left = Math.min(left, box.left);
        const end = c + cs - 1;
        right[end] ??= box.right;
        // Граница справа видна на высоте этой ячейки: продолжаем кусок или начинаем новый
        const last = [...runs].reverse().find((x) => x.i === end);
        if (last && Math.abs(last.bottom - box.top) < 2) last.bottom = Math.max(last.bottom, box.bottom);
        else runs.push({ i: end, top: box.top, bottom: box.bottom });
        c += cs;
      }
    });
    const n = right.length;
    for (let k = 0; k < n; k++) right[k] ??= (right[k - 1] ?? left) + 1;
    const widths = right.map((x, k) => x - (k ? right[k - 1] : left));
    return { n, right, widths, runs: runs.filter((x) => x.i < n - 1) };
  };

  const place = () => {
    raf = 0;
    const cur = current();
    if (!cur) {
      layer.hidden = true;
      rows.hidden = true;
      return;
    }
    // Под каждой строкой, кроме последней, — ручка высоты (нижний край таблицы — у рамки, как у столбцов)
    const trs = [...cur.table.rows].slice(0, -1);
    const tb = cur.table.getBoundingClientRect();
    while (rows.children.length < trs.length) {
      const g = document.createElement('i');
      g.className = 'st-rgrip';
      g.title = 'Потяните, чтобы изменить высоту строки';
      rows.appendChild(g);
    }
    while (rows.children.length > trs.length) rows.lastElementChild!.remove();
    trs.forEach((tr, k) => {
      const g = rows.children[k] as HTMLElement;
      g.dataset.k = String(k);
      Object.assign(g.style, { top: `${tr.getBoundingClientRect().bottom}px`, left: `${tb.left}px`, width: `${tb.width}px` });
    });
    rows.hidden = false;
    const g0 = grid(cur.table);
    const need = g0.runs.length;
    while (layer.children.length < need) {
      const g = document.createElement('i');
      g.className = 'st-grip';
      g.title = 'Потяните, чтобы изменить ширину столбцов';
      layer.appendChild(g);
    }
    while (layer.children.length > need) layer.lastElementChild!.remove();
    g0.runs.forEach((run, k) => {
      const g = layer.children[k] as HTMLElement;
      g.dataset.i = String(run.i);
      Object.assign(g.style, { left: `${g0.right[run.i]}px`, top: `${run.top}px`, height: `${run.bottom - run.top}px` });
    });
    layer.hidden = false;
    raf = requestAnimationFrame(place);
  };

  layer.addEventListener('pointerdown', (e) => {
    const g = (e.target as Element).closest<HTMLElement>('.st-grip');
    const cur = current();
    if (!g || !cur) return;
    e.preventDefault();
    e.stopPropagation();
    const i = Number(g.dataset.i);
    const px = grid(cur.table).widths;
    const total = px.reduce((a, b) => a + b, 0);
    const min = Math.max(24, total * 0.1);
    // Во время перетаскивания меняются только колонки в разметке; в данные — по отпусканию
    let group = cur.table.querySelector('colgroup');
    if (!group) {
      group = document.createElement('colgroup');
      group.innerHTML = px.map(() => '<col>').join('');
      cur.table.prepend(group);
    }
    const colEls = [...group.children] as HTMLElement[];
    const x0 = e.clientX;
    const next = [...px];
    const show = () => colEls.forEach((c, k) => { c.style.width = `${(next[k] / total) * 100}%`; });
    show();
    dragging = true;
    g.classList.add('on');
    g.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const pair = px[i] + px[i + 1];
      const a = Math.max(min, Math.min(pair - min, px[i] + ev.clientX - x0));
      next[i] = a;
      next[i + 1] = pair - a;
      show();
    };
    const up = () => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      g.removeEventListener('pointercancel', up);
      g.classList.remove('on');
      dragging = false;
      if (Math.abs(next[i] - px[i]) < 1) return;
      const widths = next.map((w) => Math.round((w / total) * 1000) / 10);
      h.editor.commit((d) => setAt(d, [...cur.path, 'widths'], widths), { rebuild: true });
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
  });

  rows.addEventListener('pointerdown', (e) => {
    const g = (e.target as Element).closest<HTMLElement>('.st-rgrip');
    const cur = current();
    if (!g || !cur) return;
    e.preventDefault();
    e.stopPropagation();
    const k = Number(g.dataset.k);
    const tr = cur.table.rows[k];
    if (!tr) return;
    const head = !!cur.table.tHead && k === 0;
    const r = cur.table.tHead ? k - 1 : k;
    // Масштаб слайда: сдвиг мыши → пиксели слайда
    const scale = tr.getBoundingClientRect().height / (tr.offsetHeight || 1);
    const h0 = tr.offsetHeight;
    const y0 = e.clientY;
    dragging = true;
    g.classList.add('on');
    g.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      tr.style.height = `${Math.max(8, Math.round(h0 + (ev.clientY - y0) / scale))}px`;
      g.style.top = `${tr.getBoundingClientRect().bottom}px`;
    };
    const up = () => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      g.removeEventListener('pointercancel', up);
      g.classList.remove('on');
      dragging = false;
      // Записывается настоящая высота: ниже текста строка не бывает
      const hh = tr.offsetHeight;
      if (Math.abs(hh - h0) < 1) return;
      h.editor.commit((d) => {
        const t = getAt(d, cur.path) as { heights?: (number | null)[]; rows?: unknown[] };
        if (head) setAt(d, [...cur.path, 'headHeight'], hh);
        else {
          const list = Array.isArray(t.heights) ? [...t.heights] : [];
          while (list.length <= r) list.push(null);
          list[r] = hh;
          setAt(d, [...cur.path, 'heights'], list);
        }
      }, { rebuild: true });
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
  });

  return {
    sync() {
      if (!raf && !dragging) place();
    },
  };
}
