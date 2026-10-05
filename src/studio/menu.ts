import { icon } from '../components/icons';
import { esc } from '../engine/html';

export interface MenuItem {
  label: string;
  icon?: string;
  /** Подсказка справа: сочетание клавиш */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Образец цвета вместо иконки (меню заливки и контура) */
  swatch?: string;
  /** Отмечено галочкой: текущее значение */
  checked?: boolean;
  /** Предпросмотр, пока пункт под мышью или в фокусе: например, подсветить то, что удалится */
  preview?(on: boolean): void;
  run(): void;
}

/** null — разделитель */
export type MenuEntry = MenuItem | null;

let open: { el: HTMLElement; close(): void } | null = null;

export function closeMenu(): void {
  open?.close();
}

/**
 * Всплывающее меню у точки или под кнопкой. Клавиатура: стрелки, Enter, Esc.
 * Закрывается кликом мимо, прокруткой и сменой размера окна.
 */
export function showMenu(at: { x: number; y: number } | HTMLElement, items: MenuEntry[]): void {
  const el = document.createElement('div');
  // Меню выбора без значков (угол, толщина): короткий список, отмеченное — галочкой и цветом
  const plain = !items.some((it) => it && (it.icon || it.swatch));
  el.className = `st-menu${plain ? ' plain' : ''}`;
  el.setAttribute('role', 'menu');
  el.innerHTML = items.map((it, k) => it === null
    ? '<i class="st-menu-sep" role="separator"></i>'
    : `<button type="button" role="${it.checked === undefined ? 'menuitem' : 'menuitemradio'}" data-k="${k}"${it.disabled ? ' disabled' : ''}${it.checked === undefined ? '' : ` aria-checked="${it.checked}"`}${it.danger ? ' class="danger"' : ''}>`
      + `${it.swatch ? `<i class="st-sw" style="background:${it.swatch}"></i>` : it.icon ? icon(it.icon) : plain ? '' : '<i class="ic"></i>'}<span>${esc(it.label)}</span>${it.checked ? icon('check') : ''}${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</button>`).join('');
  mount(at, el, (b) => {
    const it = items[Number(b.dataset.k)];
    return it ? () => it.run() : null;
  }, true);
  if (items.some((it) => it?.preview)) watchPreview(el, items);
}

/** Предпросмотр пунктов: включается наведением и фокусом, гаснет при уходе и закрытии меню */
function watchPreview(el: HTMLElement, items: MenuEntry[]): void {
  let cur: MenuItem | null = null;
  const set = (it: MenuItem | null) => {
    if (cur === it) return;
    cur?.preview?.(false);
    cur = it;
    cur?.preview?.(true);
  };
  const at = (t: EventTarget | null) => {
    const b = (t as Element | null)?.closest?.<HTMLElement>('button[data-k]:not([disabled])');
    const it = b ? items[Number(b.dataset.k)] : null;
    return it?.preview ? it : null;
  };
  el.addEventListener('pointerover', (e) => set(at(e.target)));
  el.addEventListener('pointerleave', () => { if (!el.contains(document.activeElement)) set(null); });
  el.addEventListener('focusin', (e) => set(at(e.target)));
  // Меню закрыли (выбор, Esc, щелчок мимо) — подсветка гаснет
  const mo = new MutationObserver(() => {
    if (el.isConnected) return;
    set(null);
    mo.disconnect();
  });
  mo.observe(document.body, { childList: true });
}

/**
 * Всплывающая панель со своей разметкой (палитра цветов и т. п.).
 * pick(кнопка) возвращает действие; true в keep — панель остаётся открытой после клика.
 */
export function showPopover(at: HTMLElement, html: string, pick: (b: HTMLButtonElement) => { run(): void; keep?: boolean } | null, cls = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `st-menu st-pop ${cls}`.trim();
  el.setAttribute('role', 'dialog');
  el.innerHTML = html;
  mount(at, el, (b) => {
    const a = pick(b);
    if (!a) return null;
    return a.keep ? Object.assign(() => a.run(), { keep: true }) : () => a.run();
  }, false);
  return el;
}

type Action = (() => void) & { keep?: boolean };

function mount(at: { x: number; y: number } | HTMLElement, el: HTMLElement, action: (b: HTMLButtonElement) => Action | null, arrows: boolean): void {
  closeMenu();
  el.dataset.edKeep = '';
  document.body.appendChild(el);

  let x: number;
  let y: number;
  let anchor: HTMLElement | null = null;
  if (at instanceof HTMLElement) {
    anchor = at;
    const r = at.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
    at.setAttribute('aria-expanded', 'true');
  } else {
    ({ x, y } = at);
  }
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x))}px`;
  el.style.top = `${y + h > innerHeight - 8 ? Math.max(8, y - h - (anchor ? anchor.offsetHeight + 8 : 0)) : y}px`;

  const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  const close = () => {
    el.remove();
    anchor?.setAttribute('aria-expanded', 'false');
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', close);
    removeEventListener('scroll', onScroll, true);
    open = null;
  };
  // Прокрутка страницы уводит якорь — меню закрывается; своя прокрутка (длинная галерея) — нет
  const onScroll = (e: Event) => { if (!el.contains(e.target as Node)) close(); };
  const outside = (e: PointerEvent) => {
    // Список выбора шрифта открывается поверх панели (замена шрифта) — щелчок по нему её не закрывает
    if ((e.target as Element).closest?.('.fontpick')) return;
    if (!el.contains(e.target as Node) && e.target !== anchor && !anchor?.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab' && arrows) close();
    else if (!arrows && e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') list[(i + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list[list.length - 1]?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  el.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!b || b.disabled || !el.contains(b)) return;
    const run = action(b);
    if (!run) return;
    if (!run.keep) {
      close();
      anchor?.focus();
    }
    run();
  });
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', onKey, true);
  addEventListener('resize', close);
  addEventListener('scroll', onScroll, true);
  open = { el, close };
  (el.querySelector<HTMLButtonElement>("button[aria-checked=\"true\"]:not([disabled]), button.on") ?? buttons()[0])?.focus({ preventScroll: true });
}
