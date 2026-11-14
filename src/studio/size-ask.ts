// «Вид» → «Размер слайда»: что делать с композицией слайдов — вопрос с превью слайда, каким он станет при каждом
// варианте. Сужение (16:9 → 4:3), содержимое части слайдов шире нового размера: «Уместить» (композиция уменьшается
// целиком) или «Сохранить размер» (объекты к краям своего размера — могут наложиться). Расширение (4:3 → 16:9,
// 16:9 → 21:9): «Увеличить» (композиция растёт, насколько позволяет высота) или «Расставить по ширине». Enter — первый
// вариант, Esc — отмена. Остальные слайды переставляются сами (slide-resize.ts)
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

/** Тексты окна: сужение — «Уместить», расширение — «Увеличить» */
const TEXT = {
  shrink: {
    title: (size: string) => `Объекты не помещаются в ${size}`,
    what: (w: number) => `содержимое шире нового слайда (${w} px)`,
    fit: ['Уместить', 'Уменьшить содержимое этих слайдов целиком — расположение сохранится'],
    keep: ['Сохранить размер', 'Объекты своего размера встанут к краям — могут наложиться'],
  },
  grow: {
    title: (size: string) => `Увеличить содержимое под ${size}?`,
    what: (w: number) => `композицию можно увеличить: слайд стал шире (${w} px)`,
    fit: ['Увеличить', 'Содержимое этих слайдов крупнее целиком — насколько позволяет высота слайда'],
    keep: ['Расставить по ширине', 'Объекты своего размера встанут по краям и центру'],
  },
};

export function askFit(deck: Deck, size: SlideSize, slides: number[], mode: 'shrink' | 'grow' = 'shrink'): Promise<'fit' | 'keep' | null> {
  return new Promise((resolve) => {
    const before = document.activeElement as HTMLElement | null;
    const w = SLIDE_SIZES[size];
    const t = TEXT[mode];
    const where = slides.length === 1 ? `На слайде ${slides[0]}` : `На ${slides.length} ${plural(slides.length, 'слайде', 'слайдах', 'слайдах')} (${list(slides.slice(0, 5))}${slides.length > 5 ? ' и других' : ''})`;
    const box = document.createElement('div');
    box.className = 'imp-bd';
    box.innerHTML = `<div class="imp lv sz" role="dialog" aria-modal="true" aria-labelledby="sz-h" aria-describedby="sz-d">
  <div class="lv-head"><span class="lv-icon">${icon('slide-size')}</span><h2 id="sz-h">${esc(t.title(size))}</h2></div>
  <p class="sz-note" id="sz-d">${esc(where)} ${esc(t.what(w))}. Остальные слайды перестроятся сами: что у края — останется у края, что по центру — по центру.</p>
  <div class="sz-opts">
    <button type="button" class="sz-opt" data-a="fit"><span class="sz-th"></span><b>${esc(t.fit[0])}<kbd>Enter</kbd></b><small>${esc(t.fit[1])}</small></button>
    <button type="button" class="sz-opt" data-a="keep"><span class="sz-th"></span><b>${esc(t.keep[0])}</b><small>${esc(t.keep[1])}</small></button>
  </div>
  <div class="imp-actions"><button type="button" class="btn lv-n lv-cancel" data-a="cancel">Отмена</button></div>
</div>`;
    // Превью: первый такой слайд — каким он станет при каждом варианте
    const at = slides[0] - 1;
    box.querySelectorAll<HTMLElement>('.sz-opt').forEach((b) => {
      const copy = JSON.parse(JSON.stringify(deck)) as Deck;
      resizeDeck(copy, size, { fit: b.dataset.a === 'fit' });
      b.querySelector('.sz-th')!.append(staticSlide(copy, at, 200));
    });
    document.body.append(box);
    const buttons = [...box.querySelectorAll<HTMLButtonElement>('button[data-a]')];
    const close = (a: 'fit' | 'keep' | null) => {
      removeEventListener('keydown', onKey, true);
      fadeOut(box, { box: '.imp' });
      if (!a) before?.focus?.();
      resolve(a);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter' && !(document.activeElement instanceof HTMLButtonElement && box.contains(document.activeElement))) close('fit');
      else if (e.key === 'Tab') {
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const opts = buttons.filter((b) => b.classList.contains('sz-opt'));
        const i = opts.indexOf(document.activeElement as HTMLButtonElement);
        opts[(i + (e.key === 'ArrowRight' ? 1 : -1) + opts.length) % opts.length].focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', onKey, true);
    box.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-a]');
      if (b) close(b.dataset.a === 'cancel' ? null : b.dataset.a as 'fit' | 'keep');
      else if (e.target === box) close(null);
    });
    buttons[0].focus();
  });
}
