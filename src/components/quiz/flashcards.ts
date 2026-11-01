/**
 * Карточки-перевёртыши для терминов: лицо — термин, оборот — определение.
 * Сеткой — щелчок переворачивает карточку; стопкой (mode: deck) — по одной: «Знаю» откладывает,
 * «Ещё раз» — в конец стопки, в конце «Выучено N из N». Листает докладчик: в окне показа или докладчика —
 * в обоих. Прогресс стопки при показе запоминается; перевёрнутые карточки сетки — только на время показа.
 * В правке карточку поворачивает кнопка ↻ (править оборот на слайде); в PDF — обе стороны
 */
import { defineBlock } from '../../engine/component';
import { esc, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import { icon } from '../icons';
import type { Block } from '../../types';
import { quizStore } from './state';
import './flashcards.css';

export interface FlashItem { front?: string; back?: string }
export interface FlashProps extends Block {
  items?: FlashItem[];
  /** deck — стопкой по одной; без него — сеткой */
  mode?: string;
  /** Столбцов в сетке (по умолчанию — по числу карточек, до 4) */
  cols?: number;
  /** Подпись на лице карточки: «Термин» */
  label?: string;
}

/** Стопка: порядок оставшихся, выученные, открыт ли оборот текущей */
interface DeckState { queue: number[]; known: number[]; open?: boolean }

const live = () => !document.body.classList.contains('editing') || document.body.classList.contains('st-previewing');
const itemsOf = (p: FlashProps): FlashItem[] => (Array.isArray(p.items) ? p.items.filter((x) => x && typeof x === 'object') : []);
const hash = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

/** Стопка по данным: убранные карточки — прочь, новые — в конец */
export function deckState(st: DeckState | undefined, n: number): DeckState {
  const ok = (k: unknown): k is number => Number.isInteger(k) && (k as number) >= 0 && (k as number) < n;
  const known = [...new Set((st?.known ?? []).filter(ok))];
  const queue = [...new Set((st?.queue ?? []).filter(ok))].filter((k) => !known.includes(k));
  for (let k = 0; k < n; k++) if (!known.includes(k) && !queue.includes(k)) queue.push(k);
  return { queue, known, open: !!st?.open };
}

defineBlock<FlashProps>('flashcards', {
  render(p) {
    const items = itemsOf(p);
    const deck = p.mode === 'deck';
    const key = `fc${hash(JSON.stringify(items.map((x) => [x.front ?? '', x.back ?? ''])))}`;
    const cols = Math.max(1, Math.min(6, Math.round(Number(p.cols)) || Math.min(4, items.length || 1)));
    const label = typeof p.label === 'string' ? p.label : 'Термин';
    const card = (m: FlashItem, k: number) => `<div class="fc-card" data-k="${k}" role="button" tabindex="0" aria-pressed="false" aria-label="Карточка ${k + 1}: перевернуть" data-nospot style="--k:${k}">`
      + `<div class="fc-in"><div class="fc-face fc-front">${label ? `<span class="fc-tag">${esc(label)}</span>` : ''}<b class="fc-t"${ea(m, 'front')}>${t(m.front ?? '')}</b></div>`
      + `<div class="fc-face fc-back" data-pptx-skip><span class="fc-d"${ea(m, 'back')}>${t(m.back ?? '')}</span></div></div>`
      + `<button type="button" class="fc-turn" data-nospot title="Перевернуть" aria-label="Перевернуть">${icon('reset')}</button></div>`;
    if (!deck) return `<div class="fc r" data-fk="${key}" style="--cols:${cols}"${styleAttr(p.style)}>${items.map(card).join('')}</div>`;
    return `<div class="fc deck r" data-fk="${key}" data-n="${items.length}"${styleAttr(p.style)}>`
      + `<div class="fc-stack">${items.map(card).join('')}<div class="fc-end"><b class="fc-end-t">Все карточки выучены</b><span class="fc-end-n"></span>`
      + `<button type="button" class="fc-again" data-nospot>${icon('reset')}Начать заново</button></div></div>`
      + `<div class="fc-bar"><button type="button" class="fc-no" data-nospot>${icon('redo')}Ещё раз</button>`
      + `<span class="fc-count"><b class="fc-known">0</b> из ${items.length} выучено</span>`
      + `<button type="button" class="fc-yes" data-nospot>${icon('check')}Знаю</button></div>`
      + `<div class="fc-prog"><i></i></div></div>`;
  },
  mount(el) {
    const key = el.dataset.fk!;
    const deck = el.classList.contains('deck');
    const cards = [...el.querySelectorAll<HTMLElement>('.fc-card')];
    const n = cards.length;
    const flipKey = `~${key}`;
    /** В правке карточка поворачивается только здесь (править оборот), без запоминания и второго окна */
    const local = new Set<number>();
    const draw = () => {
      if (!deck) {
        const open = new Set([...(quizStore.get<number[]>(flipKey) ?? []), ...local]);
        cards.forEach((c, k) => { c.classList.toggle('flip', open.has(k)); c.setAttribute('aria-pressed', String(open.has(k))); });
        return;
      }
      const st = deckState(quizStore.get<DeckState>(key), n);
      const cur = st.queue[0];
      cards.forEach((c, k) => {
        c.classList.toggle('cur', k === cur);
        c.classList.toggle('flip', k === cur && (!!st.open || local.has(k)));
      });
      el.classList.toggle('over', n > 0 && !st.queue.length);
      el.querySelector('.fc-known')!.textContent = String(st.known.length);
      el.querySelector('.fc-end-n')!.textContent = `${st.known.length} из ${n}`;
      (el.querySelector('.fc-prog i') as HTMLElement).style.width = `${n ? (st.known.length / n) * 100 : 0}%`;
    };
    const flipGrid = (k: number) => {
      const open = new Set(quizStore.get<number[]>(flipKey) ?? []);
      if (open.has(k)) open.delete(k); else open.add(k);
      quizStore.set(flipKey, [...open]);
    };
    const step = (yes: boolean) => {
      const st = deckState(quizStore.get<DeckState>(key), n);
      const cur = st.queue.shift();
      if (cur === undefined) return;
      if (yes) st.known.push(cur); else st.queue.push(cur);
      quizStore.set(key, { queue: st.queue, known: st.known });
    };
    const turn = (k: number, own: boolean) => {
      // В правке ↻ поворачивает карточку только здесь
      if (!live()) {
        if (!own) return;
        if (local.has(k)) local.delete(k); else local.add(k);
        draw();
        return;
      }
      if (!deck) { flipGrid(k); return; }
      const st = deckState(quizStore.get<DeckState>(key), n);
      if (st.queue[0] === k) quizStore.set(key, { ...st, open: !st.open });
    };
    const onClick = (e: MouseEvent) => {
      if (!e.isTrusted) return;
      const t = e.target as Element;
      const own = !!t.closest('.fc-turn');
      const c = t.closest<HTMLElement>('.fc-card');
      if (c && (own || live())) { turn(Number(c.dataset.k), own); return; }
      if (!live()) return;
      if (t.closest('.fc-yes')) step(true);
      else if (t.closest('.fc-no')) step(false);
      else if (t.closest('.fc-again')) quizStore.set(key, null);
    };
    const onKey = (e: KeyboardEvent) => {
      const c = (e.target as Element).closest<HTMLElement>('.fc-card');
      if (c && live() && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); turn(Number(c.dataset.k), false); }
    };
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    const off = quizStore.on((m) => { if (m.key === key || m.key === flipKey || m.key === '*') draw(); });
    el.classList.add('ready');
    draw();
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); off(); };
  },
});
