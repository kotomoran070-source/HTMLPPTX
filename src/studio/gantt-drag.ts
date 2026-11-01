import { getAt } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import type { Deck } from '../types';

/**
 * Полосы диаграммы Ганта — мышью на слайде: у выделенной диаграммы полосу тянут за середину — сдвинуть
 * срок, за край — начало или конец; веху — по периодам. Шаг — полпериода, запись — одним шагом отмены
 */
export function ganttDrag(h: { deck: Deck; editor: Editor; stage(): HTMLElement }): void {
  const EDGE = 8;
  addEventListener('pointerdown', (e) => {
    const t = e.target as Element;
    const el = t.closest?.<HTMLElement | SVGElement>('.gt-bar, .gt-ms');
    const box = el?.closest<HTMLElement>('[data-block]');
    if (!el || !box || e.button !== 0 || !h.stage().contains(el) || h.editor.editingField) return;
    // Только у выделенной диаграммы: первый щелчок выделяет её, как любой объект
    const sel = h.editor.selection;
    if (!sel || sel.group.length > 1 || JSON.stringify(sel.block) !== box.dataset.block) return;
    const path = sel.block;
    const k = Number((el as HTMLElement).dataset.gk);
    const track = el.parentElement!;
    const n = Number(getComputedStyle(el.closest('.gantt')!).getPropertyValue('--n')) || 1;
    const unit = track.getBoundingClientRect().width / n;
    if (!(unit > 0) || !Number.isInteger(k)) return;
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    const ms = el.classList.contains('gt-ms');
    const mode = ms ? 'move' : e.clientX - r.left < EDGE ? 'start' : r.right - e.clientX < EDGE ? 'end' : 'move';
    const step = ms ? 1 : 0.5;
    const snap = (v: number) => Math.round(v / step) * step;
    // Начало и конец — по месту на экране, сразу на сетке полупериодов (ширина в пикселях дробная)
    const half = (v: number) => Math.round(v * 2) / 2;
    const left = (r.left + (ms ? r.width / 2 : 0) - track.getBoundingClientRect().left) / unit;
    const s0 = half(left);
    const e0 = ms ? s0 : half(left + r.width / unit);
    let s = s0;
    let en = e0;
    const x0 = e.clientX;
    (el as HTMLElement).style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
    document.body.classList.add('st-gt-drag');
    const pct = (v: number) => `${(v / n) * 100}%`;
    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) / unit;
      if (ms) {
        // Веха — посередине периода
        s = en = Math.max(0.5, Math.min(n - 0.5, Math.round(s0 + d - 0.5) + 0.5));
      } else if (mode === 'move') {
        const len = e0 - s0;
        s = Math.max(0, Math.min(n - len, snap(s0 + d)));
        en = s + len;
      } else if (mode === 'start') s = Math.max(0, Math.min(en - step, snap(s0 + d)));
      else en = Math.min(n, Math.max(s + step, snap(e0 + d)));
      el.style.left = pct(s);
      if (!ms) el.style.width = pct(en - s);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      document.body.classList.remove('st-gt-drag');
      (el as HTMLElement).style.cursor = '';
      if (Math.abs(s - s0) < 1e-6 && Math.abs(en - e0) < 1e-6) return;
      h.editor.commit((d) => {
        const item = (getAt(d, [...path, 'items', k]) ?? null) as Record<string, unknown> | null;
        if (!item) return;
        // Обратно в номера периодов: начало «с 2,5» — с середины второго, конец «по 2» — до конца второго
        if (ms) item.from = s + 0.5;
        else {
          item.from = s + 1;
          item.to = Number.isInteger(en) ? en : en + 1;
        }
      }, { rebuild: true });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }, true);
}
