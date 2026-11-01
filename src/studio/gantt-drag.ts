import { getAt } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import type { Deck } from '../types';

const HINT = 'Тяните: середина — сдвинуть, края — сроки. Двойной щелчок — «Готово, %»';
const HINT_KEY = 'htmlpptx-gantt-hint';

/** Срок словами по подписям шкалы: «Фев», «сер. Мар» */
function when(v: number, labels: string[], end: boolean): string {
  const half = Math.abs(v % 1 - 0.5) < 1e-6;
  // Начало — период, который начинается; конец — период, который кончается
  const i = end ? (half ? Math.ceil(v) : v) : Math.floor(v) + 1;
  const name = labels[i - 1] ?? String(i);
  return half ? `сер. ${name}` : name;
}

/**
 * Полосы диаграммы Ганта — мышью на слайде: у выделенной диаграммы полосу тянут за середину — сдвинуть
 * срок, за край — начало или конец; веху — по периодам. Шаг — полпериода, запись — одним шагом отмены.
 * Ручки на краях полос, подсказка при первых выделениях, во время перетаскивания — срок словами;
 * двойной щелчок по полосе — поле «Готово, %»
 */
export function ganttDrag(h: { deck: Deck; editor: Editor; stage(): HTMLElement }): { sync(): void } {
  const EDGE = 8;
  const tip = document.createElement('div');
  tip.className = 'st-gt-tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  /** Полоса выделенной диаграммы под элементом и путь диаграммы */
  const hit = (t: Element | null) => {
    const el = t?.closest?.<HTMLElement>('.gt-bar, .gt-ms');
    const box = el?.closest<HTMLElement>('[data-block]');
    const sel = h.editor.selection;
    if (!el || !box || !h.stage().contains(el) || h.editor.editingField) return null;
    if (!sel || sel.group.length > 1 || JSON.stringify(sel.block) !== box.dataset.block) return null;
    const k = Number(el.dataset.gk);
    return Number.isInteger(k) ? { el, path: sel.block, k } : null;
  };
  // Двойной щелчок по полосе — готовность задачи
  addEventListener('dblclick', (e) => {
    const t = hit(e.target as Element);
    if (!t || t.el.classList.contains('gt-ms')) return;
    e.preventDefault();
    e.stopPropagation();
    const item = getAt(h.deck, [...t.path, 'items', t.k]) as { done?: unknown } | undefined;
    const cur = item?.done === true ? 100 : Number(item?.done) || 0;
    void h.editor.prompt(t.el, {
      label: 'Готово, %', value: String(cur), placeholder: '0–100',
      validate: (v) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) && n >= 0 && n <= 100 ? null : 'Число от 0 до 100'; },
    }).then((v) => {
      if (v === null) return;
      const n = Math.round(Number(v.replace(',', '.')));
      h.editor.commit((d) => {
        const it = getAt(d, [...t.path, 'items', t.k]) as Record<string, unknown> | undefined;
        if (!it) return;
        if (n > 0) it.done = n;
        else delete it.done;
      }, { rebuild: true });
    });
  }, true);
  addEventListener('pointerdown', (e) => {
    // Только у выделенной диаграммы: первый щелчок выделяет её, как любой объект
    const t = e.button === 0 ? hit(e.target as Element) : null;
    if (!t) return;
    const { el, path, k } = t;
    const labels = [...el.closest('.gantt')!.querySelectorAll('.gt-scale span')].map((x) => x.textContent?.trim() ?? '');
    const track = el.parentElement!;
    const n = Number(getComputedStyle(el.closest('.gantt')!).getPropertyValue('--n')) || 1;
    const unit = track.getBoundingClientRect().width / n;
    if (!(unit > 0)) return;
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
      // Срок словами — над полосой
      tip.textContent = ms ? when(s - 0.5, labels, false) : `${when(s, labels, false)} — ${when(en, labels, true)}`;
      const b = el.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = `${b.left + b.width / 2}px`;
      tip.style.top = `${b.top - 8}px`;
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      document.body.classList.remove('st-gt-drag');
      tip.hidden = true;
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
  let shown = '';
  return {
    sync() {
      const sel = h.editor.selection;
      const box = sel && sel.group.length === 1 ? h.stage().querySelector<HTMLElement>(`.slide.on [data-block="${CSS.escape(JSON.stringify(sel.block))}"]`) : null;
      if (!box || !(box.matches('.gantt') || box.querySelector('.gantt'))) { shown = ''; return; }
      box.querySelectorAll<HTMLElement>('.gt-bar, .gt-ms').forEach((b) => { b.title = b.classList.contains('gt-ms') ? 'Тяните, чтобы перенести веху' : HINT; });
      // Подсказка — при первых трёх выделениях диаграммы (не на каждой перерисовке)
      const key = box.dataset.block ?? '';
      if (shown === key) return;
      shown = key;
      let n = 0;
      try { n = Number(localStorage.getItem(HINT_KEY)) || 0; } catch { /* без хранилища — каждый раз */ }
      if (n >= 3) return;
      try { localStorage.setItem(HINT_KEY, String(n + 1)); } catch { /* пусть */ }
      h.editor.toast(HINT, 4500);
    },
  };
}
