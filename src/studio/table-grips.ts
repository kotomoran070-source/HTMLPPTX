import { getAt, setAt } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import type { Block, Deck } from '../types';

/**
 * Ширина столбцов таблицы — прямо на слайде: у выделенной таблицы на границах столбцов
 * появляются ручки, их тянут мышью. Результат — доли ширины (widths) в данных таблицы.
 */
export function tableGrips(h: { deck: Deck; editor: Editor; stage(): HTMLElement }): { sync(): void } {
  const layer = document.createElement('div');
  layer.className = 'st-grips';
  layer.dataset.edKeep = '';
  document.body.appendChild(layer);

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
  /** Ячейки одной строки — по ним видны границы столбцов */
  const cells = (table: HTMLTableElement) => [...(table.rows[0]?.cells ?? [])] as HTMLElement[];

  const place = () => {
    raf = 0;
    const cur = current();
    if (!cur) {
      layer.hidden = true;
      return;
    }
    const list = cells(cur.table);
    const tr = cur.table.getBoundingClientRect();
    const need = Math.max(0, list.length - 1);
    while (layer.children.length < need) {
      const g = document.createElement('i');
      g.className = 'st-grip';
      g.title = 'Потяните, чтобы изменить ширину столбцов';
      layer.appendChild(g);
    }
    while (layer.children.length > need) layer.lastElementChild!.remove();
    list.slice(0, -1).forEach((c, i) => {
      const g = layer.children[i] as HTMLElement;
      g.dataset.i = String(i);
      Object.assign(g.style, { left: `${c.getBoundingClientRect().right}px`, top: `${tr.top}px`, height: `${tr.height}px` });
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
    const list = cells(cur.table);
    const px = list.map((c) => c.getBoundingClientRect().width);
    const total = px.reduce((a, b) => a + b, 0);
    const min = Math.max(24, total * 0.1);
    // Во время перетаскивания меняются только колонки в разметке; в данные — по отпусканию
    let group = cur.table.querySelector('colgroup');
    if (!group) {
      group = document.createElement('colgroup');
      group.innerHTML = list.map(() => '<col>').join('');
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

  return {
    sync() {
      if (!raf && !dragging) place();
    },
  };
}
