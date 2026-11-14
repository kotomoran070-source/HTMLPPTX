// «Вид» → «Размер слайда»: при сужении (16:9 → 4:3) содержимое части слайдов шире нового размера — спросить, что
// делать. Два варианта карточками с превью слайда, каким он станет: «Уместить» (композиция слайда уменьшается целиком)
// и «Сохранить размер» (объекты к краям своего размера — могут наложиться). Enter — «Уместить», Esc — отмена.
// Остальные слайды переставляются сами (slide-resize.ts)
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

export function askFit(deck: Deck, size: SlideSize, tight: number[]): Promise<'fit' | 'keep' | null> {
  return new Promise((resolve) => {
    const before = document.activeElement as HTMLElement | null;
    const w = SLIDE_SIZES[size];
    const where = tight.length === 1 ? `На слайде ${tight[0]}` : `На ${tight.length} ${plural(tight.length, 'слайде', 'слайдах', 'слайдах')} (${list(tight.slice(0, 5))}${tight.length > 5 ? ' и других' : ''})`;
    const what = `содержимое шире нового слайда (${w} px)`;
    const box = document.createElement('div');
    box.className = 'imp-bd';
    box.innerHTML = `<div class="imp lv sz" role="dialog" aria-modal="true" aria-labelledby="sz-h" aria-describedby="sz-d">
  <div class="lv-head"><span class="lv-icon">${icon('slide-size')}</span><h2 id="sz-h">Объекты не помещаются в ${esc(size)}</h2></div>
  <p class="sz-note" id="sz-d">${esc(where)} ${esc(what)}. Остальные слайды перестроятся сами: что у края — останется у края, что по центру — по центру.</p>
  <div class="sz-opts">
    <button type="button" class="sz-opt" data-a="fit"><span class="sz-th"></span><b>Уместить<kbd>Enter</kbd></b><small>Уменьшить содержимое этих слайдов целиком — расположение сохранится</small></button>
    <button type="button" class="sz-opt" data-a="keep"><span class="sz-th"></span><b>Сохранить размер</b><small>Объекты своего размера встанут к краям — могут наложиться</small></button>
  </div>
  <div class="imp-actions"><button type="button" class="btn lv-n lv-cancel" data-a="cancel">Отмена</button></div>
</div>`;
    // Превью: первый такой слайд — каким он станет при каждом варианте
    const at = tight[0] - 1;
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
