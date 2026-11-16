/**
 * «Параметры вставки», как в PowerPoint: после вставки оформленного текста у него — маленькая кнопка; щелчок или
 * Ctrl (нажать и отпустить) открывает строку значков: «Использовать тему», «Сохранить исходное форматирование»,
 * «Рисунок» (если в буфере была и картинка — Excel, Word кладут её вместе с текстом), «Только текст»
 * (paste-html.ts, paste-table.ts). Кнопка уходит, как только сделали что-то другое: щёлкнули
 * мимо, начали печатать, прокрутили вставку из виду. Выбор не запоминается — следующая вставка снова с темой.
 * Одна на страницу; ничего не знает о студии — общая для студии и правки в показе.
 */
import { icon } from '../../components/icons';
import { esc } from '../html';
import type { PasteMode } from './paste-html';

/** Режим вставки: текстовые и «Рисунок» */
export type PasteChoice = PasteMode | 'picture';

const MODES: [PasteChoice, string, string][] = [
  ['theme', 'brush', 'Использовать тему'],
  ['source', 'paste', 'Сохранить исходное форматирование'],
  ['picture', 'image', 'Рисунок'],
  ['text', 'text', 'Только текст'],
];

let live: { hide(): void } | null = null;

export function hidePasteOptions(): void {
  live?.hide();
}

/**
 * Кнопка у вставленного: at — где он сейчас (правый нижний угол; null — его уже нет, кнопка уходит);
 * apply — вставить заново в другом режиме; modes — какие режимы есть у этой вставки (по умолчанию три текстовых)
 */
export function showPasteOptions(at: () => DOMRect | null, apply: (mode: PasteChoice) => void, modes: PasteChoice[] = ['theme', 'source', 'text']): void {
  hidePasteOptions();
  let mode: PasteChoice = 'theme';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ed-po';
  // Щелчок по кнопке и по значкам — не «щелчок мимо»: правка текста и выделение остаются (editor.ts)
  btn.dataset.edKeep = '';
  btn.title = 'Параметры вставки (Ctrl)';
  btn.setAttribute('aria-label', 'Параметры вставки');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `${icon('paste')}${icon('chev-down')}`;
  document.body.appendChild(btn);
  let pop: HTMLElement | null = null;

  const place = () => {
    const r = at();
    // Вставки уже нет или она ушла из виду (прокрутили) — кнопка тоже уходит
    if (!r || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return hide();
    btn.style.left = `${Math.min(innerWidth - btn.offsetWidth - 8, r.right - btn.offsetWidth)}px`;
    btn.style.top = `${Math.min(innerHeight - btn.offsetHeight - 8, r.bottom + 6)}px`;
    if (pop) {
      const b = btn.getBoundingClientRect();
      pop.style.left = `${Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, b.right - pop.offsetWidth))}px`;
      const below = b.bottom + 6 + pop.offsetHeight <= innerHeight - 8;
      pop.style.top = `${below ? b.bottom + 6 : b.top - 6 - pop.offsetHeight}px`;
    }
  };
  /** Дождаться, пока вставка снова на месте (несколько кадров), и встать к ней; так и не появилась — уйти */
  const settle = (frames: number) => requestAnimationFrame(() => {
    if (live !== handle) return;
    if (at() || frames <= 0) place();
    else settle(frames - 1);
  });
  const close = (focusBack = false) => {
    if (!pop) return;
    pop.remove();
    pop = null;
    btn.setAttribute('aria-expanded', 'false');
    if (focusBack) btn.focus({ preventScroll: true });
  };
  const open = () => {
    if (pop) return close(true);
    pop = document.createElement('div');
    pop.className = 'ed-po-pop';
    pop.dataset.edKeep = '';
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', 'Параметры вставки');
    pop.innerHTML = `<div class="ed-po-h">Параметры вставки</div><div class="ed-po-row">${MODES.filter(([m]) => modes.includes(m)).map(([m, ic, label]) =>
      `<button type="button" class="ed-po-m" role="menuitemradio" data-m="${m}" aria-checked="${m === mode}" title="${esc(label)}" aria-label="${esc(label)}">${icon(ic)}</button>`).join('')}</div>`;
    document.body.appendChild(pop);
    btn.setAttribute('aria-expanded', 'true');
    place();
    pop.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    pop.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('[data-m]');
      if (!b) return;
      const m = b.dataset.m as PasteChoice;
      close();
      if (m !== mode) {
        mode = m;
        apply(m);
      }
      // Вставку переделали — кнопка остаётся у неё, на новом месте (слайд перерисовывается не сразу)
      settle(12);
    });
  };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    open();
  });
  // Не уводить фокус из текста щелчком по кнопке: правка текста продолжается
  btn.addEventListener('mousedown', (e) => e.preventDefault());

  let ctrl = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Control') {
      ctrl = !e.repeat && !e.shiftKey && !e.altKey && !e.metaKey;
      return;
    }
    ctrl = false;
    if (pop && pop.contains(document.activeElement)) {
      const list = [...pop.querySelectorAll<HTMLButtonElement>('[data-m]')];
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]?.focus();
      } else if (e.key === 'Escape') {
        close();
      } else if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Tab') {
        return hide();
      } else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return;
    // Esc — убрать кнопку, не прерывая остального (правка текста закончится как обычно)
    hide();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== 'Control' || !ctrl) return;
    ctrl = false;
    open();
  };
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (btn.contains(t) || pop?.contains(t)) return;
    hide();
  };
  // Прокрутка: кнопка едет за вставкой (прокрутка соседних панелей её не трогает — место то же)
  let queued = false;
  const onScroll = (e: Event) => {
    if (pop?.contains(e.target as Node) || queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (live === handle) place();
    });
  };
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onKeyUp, true);
  addEventListener('pointerdown', onDown, true);
  addEventListener('scroll', onScroll, true);
  addEventListener('resize', hidePasteOptions);
  function hide() {
    removeEventListener('keydown', onKey, true);
    removeEventListener('keyup', onKeyUp, true);
    removeEventListener('pointerdown', onDown, true);
    removeEventListener('scroll', onScroll, true);
    removeEventListener('resize', hidePasteOptions);
    pop?.remove();
    btn.remove();
    if (live === handle) live = null;
  }
  const handle = { hide };
  live = handle;
  place();
}
