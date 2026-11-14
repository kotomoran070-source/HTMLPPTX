// «Вид» → «Размер слайда»: что делать со слайдами, у которых варианты дают разное (fitChoices, slide-resize.ts), —
// вопрос с превью, каким слайд станет. Сужение (16:9 → 4:3): «Уместить» (композиция тесного слайда уменьшается
// целиком) или «Сохранить размер» (объекты к краям своего размера — могут наложиться). Расширение (4:3 → 16:9,
// 16:9 → 21:9): «Увеличить» (композиция холста целая — крупнее, насколько позволяет высота, или целиком на месте) или
// «Расставить по ширине» (объекты разойдутся к краям и центру). Большие карточки — для всех таких слайдов сразу (Enter —
// первая); «Выбрать для каждого слайда» — вместо них миниатюры всех с переключателем у каждой («Для всех» — разом)
// и «Применить». Esc — отмена
import { icon } from '../components/icons';
import { staticSlide } from '../engine/deck-view';
import { plural } from '../engine/editor/font-picker';
import { esc } from '../engine/html';
import { leave as fadeOut } from '../engine/motion';
import { resizeDeck } from '../engine/slide-resize';
import { SLIDE_SIZES, type SlideSize } from '../engine/slide-size';
import type { Deck } from '../types';
import '../engine/import-ui.css';
import './leave-ask.css';
import './size-ask.css';

/** «3», «3 и 5», «3, 5 и 7» */
const list = (n: number[]) => (n.length > 1 ? `${n.slice(0, -1).join(', ')} и ${n.at(-1)}` : String(n[0]));

/** Тексты окна: сужение — «Уместить», расширение — «Увеличить»; третья строка — подпись переключателя у миниатюры */
const TEXT = {
  shrink: {
    title: (size: string) => `Объекты не помещаются в ${size}`,
    what: (w: number) => `содержимое шире нового слайда (${w} px)`,
    fit: ['Уместить', 'Уменьшить содержимое целиком — расположение сохранится', 'Уместить'],
    keep: ['Сохранить размер', 'Объекты своего размера встанут к краям — могут наложиться', 'Как есть'],
  },
  grow: {
    title: (size: string) => `Как разместить содержимое в ${size}?`,
    what: (w: number) => `своя композиция объектов, а слайд стал шире (${w} px)`,
    fit: ['Увеличить', 'Композиция остаётся целой: крупнее, насколько позволяет высота, или целиком на месте', 'Увеличить'],
    keep: ['Расставить по ширине', 'Объекты своего размера разойдутся к краям и центру', 'По ширине'],
  },
};

/** Ответ: true — вписать все, false — все по краям, список — вписать эти слайды (номера с 1), null — отмена */
export function askFit(deck: Deck, size: SlideSize, slides: number[], mode: 'shrink' | 'grow' = 'shrink'): Promise<boolean | number[] | null> {
  return new Promise((resolve) => {
    const before = document.activeElement as HTMLElement | null;
    const w = SLIDE_SIZES[size];
    const t = TEXT[mode];
    const where = slides.length === 1 ? `На слайде ${slides[0]}` : `На ${slides.length} ${plural(slides.length, 'слайде', 'слайдах', 'слайдах')} (${list(slides.slice(0, 5))}${slides.length > 5 ? ' и других' : ''})`;
    const box = document.createElement('div');
    box.className = 'imp-bd';
    box.innerHTML = `<div class="imp lv sz" role="dialog" aria-modal="true" aria-labelledby="sz-h" aria-describedby="sz-d">
  <div class="lv-head"><span class="lv-icon">${icon('slide-size')}</span><h2 id="sz-h">${esc(t.title(size))}</h2></div>
  <p class="sz-note" id="sz-d">${esc(where)} ${esc(t.what(w))}. Остальные слайды перестроятся сами.</p>
  <div class="sz-opts">
    <button type="button" class="sz-opt" data-a="fit"><span class="sz-th"></span><b>${esc(t.fit[0])}<kbd>Enter</kbd></b><small>${esc(t.fit[1])}</small></button>
    <button type="button" class="sz-opt" data-a="keep"><span class="sz-th"></span><b>${esc(t.keep[0])}</b><small>${esc(t.keep[1])}</small></button>
  </div>
  ${slides.length > 1 ? `<button type="button" class="sz-more" data-a="more" aria-expanded="false">${icon('chev-down')}Выбрать для каждого слайда (${slides.length})</button>
  <div class="sz-each" hidden>
    <div class="sz-allrow"><span>Для всех</span><span class="sz-seg" role="group" aria-label="Для всех слайдов"><button type="button" data-all="fit">${esc(t.fit[2])}</button><button type="button" data-all="keep">${esc(t.keep[2])}</button></span></div>
    <div class="sz-grid" role="list"></div>
  </div>` : ''}
  <div class="imp-actions"><button type="button" class="btn lv-n lv-cancel" data-a="cancel">Отмена</button><button type="button" class="btn primary sz-apply" data-a="apply" hidden>Применить</button></div>
</div>`;
    // Оба варианта целиком — по ним превью: большие карточки (первый такой слайд) и миниатюры каждого
    const variant = { fit: JSON.parse(JSON.stringify(deck)) as Deck, keep: JSON.parse(JSON.stringify(deck)) as Deck };
    resizeDeck(variant.fit, size, { fit: true });
    resizeDeck(variant.keep, size, { fit: false });
    box.querySelectorAll<HTMLElement>('.sz-opt').forEach((b) => {
      b.querySelector('.sz-th')!.append(staticSlide(variant[b.dataset.a as 'fit' | 'keep'], slides[0] - 1, 200));
    });
    // Выбор по слайдам: сначала у всех — первый вариант; миниатюра — каким слайд станет при выбранном
    const pick = new Map(slides.map((n) => [n, 'fit' as 'fit' | 'keep']));
    const grid = box.querySelector<HTMLElement>('.sz-grid');
    const thumbs = new Map<string, HTMLElement>();
    const shot = (n: number, v: 'fit' | 'keep') => {
      const key = `${n}:${v}`;
      if (!thumbs.has(key)) thumbs.set(key, staticSlide(variant[v], n - 1, 140));
      return thumbs.get(key)!;
    };
    const paint = (n: number) => {
      const card = grid?.querySelector<HTMLElement>(`[data-n="${n}"]`);
      if (!card) return;
      const v = pick.get(n)!;
      card.querySelector('.sz-th')!.replaceChildren(shot(n, v));
      card.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
      // «Для всех» отмечено, только когда у всех одно и то же
      const all = new Set(pick.values());
      box.querySelectorAll<HTMLButtonElement>('[data-all]').forEach((b) => b.setAttribute('aria-pressed', String(all.size === 1 && all.has(b.dataset.all as 'fit' | 'keep'))));
    };
    const open = () => {
      if (!grid || grid.childElementCount) return;
      grid.innerHTML = slides.map((n) => `<div class="sz-item" role="listitem" data-n="${n}"><span class="sz-th"></span><span class="sz-n">Слайд ${n}</span>`
        + `<span class="sz-seg" role="group" aria-label="Слайд ${n}"><button type="button" data-v="fit">${esc(t.fit[2])}</button><button type="button" data-v="keep">${esc(t.keep[2])}</button></span></div>`).join('');
      slides.forEach(paint);
    };
    document.body.append(box);
    const close = (a: boolean | number[] | null) => {
      removeEventListener('keydown', onKey, true);
      fadeOut(box, { box: '.imp' });
      if (a === null) before?.focus?.();
      resolve(a);
    };
    const buttons = () => [...box.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.hidden && b.offsetParent);
    const onKey = (e: KeyboardEvent) => {
      const at = document.activeElement;
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter' && !(at instanceof HTMLButtonElement && box.contains(at))) close(true);
      else if (e.key === 'Tab') {
        const all = buttons();
        const i = all.indexOf(at as HTMLButtonElement);
        all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', onKey, true);
    box.addEventListener('click', (e) => {
      const all = (e.target as Element).closest<HTMLButtonElement>('[data-all]');
      if (all) {
        slides.forEach((n) => pick.set(n, all.dataset.all as 'fit' | 'keep'));
        return slides.forEach(paint);
      }
      const seg = (e.target as Element).closest<HTMLButtonElement>('[data-v]');
      if (seg) {
        const n = Number(seg.closest<HTMLElement>('[data-n]')!.dataset.n);
        pick.set(n, seg.dataset.v as 'fit' | 'keep');
        return paint(n);
      }
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-a]');
      if (!b) { if (e.target === box) close(null); return; }
      const a = b.dataset.a;
      if (a === 'cancel') close(null);
      else if (a === 'fit') close(true);
      else if (a === 'keep') close(false);
      else if (a === 'apply') close(slides.filter((n) => pick.get(n) === 'fit'));
      else if (a === 'more') {
        const each = box.querySelector<HTMLElement>('.sz-each')!;
        const on = each.hidden;
        each.hidden = !on;
        b.setAttribute('aria-expanded', String(on));
        box.querySelector<HTMLElement>('.sz-apply')!.hidden = !on;
        box.querySelector('.sz')!.classList.toggle('wide', on);
        if (on) open();
      }
    });
    // Enter на кнопке-карточке — то же, что щелчок; без фокуса на кнопке — «вписать все»
    box.querySelector<HTMLButtonElement>('.sz-opt')!.focus();
  });
}
