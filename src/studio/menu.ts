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
  closeMenu();
  const el = document.createElement('div');
  el.className = 'st-menu';
  el.setAttribute('role', 'menu');
  el.dataset.edKeep = '';
  el.innerHTML = items.map((it, k) => it === null
    ? '<i class="st-menu-sep" role="separator"></i>'
    : `<button type="button" role="menuitem" data-k="${k}"${it.disabled ? ' disabled' : ''}${it.danger ? ' class="danger"' : ''}>`
      + `${it.swatch ? `<i class="st-sw" style="background:${it.swatch}"></i>` : it.icon ? icon(it.icon) : '<span class="ic"></span>'}<span>${esc(it.label)}</span>${it.checked ? icon('check') : ''}${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</button>`).join('');
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

  const buttons = [...el.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  const close = () => {
    el.remove();
    anchor?.setAttribute('aria-expanded', 'false');
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', close);
    removeEventListener('scroll', close, true);
    open = null;
  };
  const outside = (e: PointerEvent) => {
    if (!el.contains(e.target as Node) && e.target !== anchor && !anchor?.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') buttons[(i + 1) % buttons.length]?.focus();
    else if (e.key === 'ArrowUp') buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    else if (e.key === 'Home') buttons[0]?.focus();
    else if (e.key === 'End') buttons[buttons.length - 1]?.focus();
    else if (e.key === 'Tab') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  el.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-k]');
    if (!b || b.disabled) return;
    const it = items[Number(b.dataset.k)];
    close();
    anchor?.focus();
    it?.run();
  });
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', onKey, true);
  addEventListener('resize', close);
  addEventListener('scroll', close, true);
  open = { el, close };
  buttons[0]?.focus({ preventScroll: true });
}
