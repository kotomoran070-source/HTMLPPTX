import { icon } from '../components/icons';
import { esc } from '../engine/html';
import { leave, onPage } from '../engine/motion';

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
  /** Пояснение второй строкой — мелко, под названием */
  sub?: string;
  /** Свой класс пункта: «живая» иконка эффекта (fxi-…), образец эффекта текста в названии (tfx-s-…) */
  cls?: string;
  /** Предпросмотр, пока пункт под мышью или в фокусе: например, подсветить то, что удалится */
  preview?(on: boolean): void;
  run(): void;
}

/** null — разделитель */
export type MenuEntry = MenuItem | null;
/** Заголовок группы пунктов */
export interface MenuHead { head: string }
/**
 * Своё число в меню выбора (шаг сетки): поле под готовыми значениями. Enter — применить и закрыть, стрелки ↑↓ —
 * шаг, изменение стрелками у поля — сразу; число вне min…max становится ближайшим допустимым
 */
export interface MenuField { field: string; value: number; min: number; max: number; unit?: string; set(n: number): void }
type MenuRow = MenuEntry | MenuHead | MenuField;
const isHead = (it: MenuRow): it is MenuHead => !!it && 'head' in it;
const isField = (it: MenuRow): it is MenuField => !!it && 'field' in it;

let open: { el: HTMLElement; close(): void } | null = null;

/**
 * Кнопка, которой только что вызвали команду не с ленты (панель быстрого доступа, qat.ts). Меню и панели команды
 * ищут свою кнопку на ленте — а та может быть на закрытой вкладке; тогда они открываются у этой
 */
let invoker: { el: HTMLElement; at: number } | null = null;
export function setInvoker(el: HTMLElement): void {
  invoker = { el, at: performance.now() };
}
const fresh = (): HTMLElement | null => (invoker && performance.now() - invoker.at < 1500 && invoker.el.isConnected && invoker.el.offsetParent ? invoker.el : null);
const cmdOf = (el: Element) => el.closest<HTMLElement>('[data-cmd]')?.dataset.cmd?.replace(/-menu$/, '');

/** Где открыть меню у кнопки at: у только что нажатой кнопки той же команды, если at не видна или та же команда */
export function anchorOf(at: HTMLElement): HTMLElement {
  const inv = fresh();
  if (!inv || inv === at) return at;
  const cmd = cmdOf(at);
  return !at.isConnected || !at.getClientRects().length || (cmd && cmd === cmdOf(inv)) ? inv : at;
}

/** Видимая кнопка команды: только что нажатая (панель быстрого доступа), иначе — на открытой вкладке ленты */
export function cmdAnchor(cmd: string): HTMLElement | null {
  const inv = fresh();
  if (inv && cmdOf(inv) === cmd) return inv;
  const all = [...document.querySelectorAll<HTMLElement>(`[data-cmd="${CSS.escape(cmd)}"]`)];
  return all.find((b) => b.offsetParent) ?? all[0] ?? null;
}

export function closeMenu(): void {
  open?.close();
}

/**
 * Всплывающее меню у точки или под кнопкой. Клавиатура: стрелки, Enter, Esc.
 * Закрывается кликом мимо, прокруткой и сменой размера окна.
 */
/** onClose — меню закрылось (выбран пункт, Esc, щелчок мимо): снять подсветку того, к чему оно открывалось */
export function showMenu(at: { x: number; y: number } | HTMLElement, rows: MenuRow[], onClose?: () => void): void {
  const el = document.createElement('div');
  const items = rows.map((it) => (isHead(it) || isField(it) ? null : it));
  // Меню выбора без значков (угол, толщина): короткий список, отмеченное — галочкой и цветом
  const plain = !items.some((it) => it && (it.icon || it.swatch));
  el.className = `st-menu${plain ? ' plain' : ''}`;
  el.setAttribute('role', 'menu');
  el.innerHTML = rows.map((it, k) => {
    if (it === null) return '<i class="st-menu-sep" role="separator"></i>';
    if (isHead(it)) return `<div class="st-menu-h" role="presentation">${esc(it.head)}</div>`;
    if (isField(it)) {
      return `<label class="st-menu-field">${plain ? '' : '<i class="ic"></i>'}<span>${esc(it.field)}</span>`
        + `<input type="number" data-f="${k}" min="${it.min}" max="${it.max}" step="1" value="${it.value}" aria-label="${esc(it.field)}">`
        + `${it.unit ? `<small>${esc(it.unit)}</small>` : ''}</label>`;
    }
    const cls = [it.danger ? 'danger' : '', it.cls ?? ''].filter(Boolean).join(' ');
    const text = it.sub ? `<span class="st-mi-t"><b>${esc(it.label)}</b><small>${esc(it.sub)}</small></span>` : `<span>${esc(it.label)}</span>`;
    return `<button type="button" role="${it.checked === undefined ? 'menuitem' : 'menuitemradio'}" data-k="${k}"${it.disabled ? ' disabled' : ''}${it.checked === undefined ? '' : ` aria-checked="${it.checked}"`}${cls ? ` class="${cls}"` : ''}>`
      + `${it.swatch ? `<i class="st-sw" style="background:${it.swatch}"></i>` : it.icon ? icon(it.icon) : plain ? '' : '<i class="ic"></i>'}${text}${it.checked ? icon('check') : ''}${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</button>`;
  }).join('');
  mount(at, el, (b) => {
    const it = items[Number(b.dataset.k)];
    return it ? () => it.run() : null;
  }, true, onClose);
  if (items.some((it) => it?.preview)) watchPreview(el, items);
  el.querySelectorAll<HTMLInputElement>('input[data-f]').forEach((inp) => {
    const f = rows[Number(inp.dataset.f)] as MenuField;
    const apply = () => {
      const n = Math.round(Number(inp.value));
      if (!inp.value.trim() || !Number.isFinite(n)) { inp.value = String(f.value); return; }
      const v = Math.max(f.min, Math.min(f.max, n));
      inp.value = String(v);
      if (v !== f.value) { f.value = v; f.set(v); }
    };
    inp.addEventListener('change', apply);
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      apply();
      closeMenu();
    });
  });
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
  // Меню закрыли (выбор, Esc, щелчок мимо) — подсветка гаснет; уходящее меню (призрак) — уже закрыто
  const mo = new MutationObserver(() => {
    if (onPage(el)) return;
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

function mount(at: { x: number; y: number } | HTMLElement, el: HTMLElement, action: (b: HTMLButtonElement) => Action | null, arrows: boolean, onClose?: () => void): void {
  closeMenu();
  el.dataset.edKeep = '';
  document.body.appendChild(el);

  let x: number;
  let y: number;
  let anchor: HTMLElement | null = null;
  if (at instanceof HTMLElement) {
    at = anchorOf(at);
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
  const up = y + h > innerHeight - 8;
  el.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x))}px`;
  el.style.top = `${up ? Math.max(8, y - h - (anchor ? anchor.offsetHeight + 8 : 0)) : y}px`;
  // Не поместилось под кнопкой — открылось над ней: появляется и уходит вверх (studio.css, .st-menu[data-up])
  if (up) el.dataset.up = '';

  const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  const close = () => {
    // Гаснет призрак меню (engine/motion.ts): самого меню на странице уже нет
    leave(el);
    anchor?.setAttribute('aria-expanded', 'false');
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', close);
    removeEventListener('scroll', onScroll, true);
    open = null;
    onClose?.();
  };
  // Прокрутка страницы уводит якорь — меню закрывается; своя прокрутка (длинная галерея) — нет
  // Закрывается, если прокрутилось то, к чему меню прикреплено (иначе оно уехало бы от кнопки);
  // прокрутка соседней панели (список слайдов при переходе) меню не трогает
  const onScroll = (e: Event) => {
    const t = e.target as Node;
    if (el.contains(t)) return;
    if (!anchor || t === document || (t as Element).contains?.(anchor)) close();
  };
  const outside = (e: PointerEvent) => {
    // Список выбора шрифта открывается поверх панели (замена шрифта) — щелчок по нему её не закрывает
    if ((e.target as Element).closest?.('.fontpick')) return;
    // Стрелки числового поля (num-step) — часть окошка, не щелчок мимо
    if (!el.contains(e.target as Node) && e.target !== anchor && !anchor?.contains(e.target as Node) && !(e.target as Element).closest?.('.st-numstep')) close();
  };
  const onKey = (e: KeyboardEvent) => {
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    // Своё число в меню (MenuField): стрелки и Home/End — полю; ↓ из него не уводит, Tab — к пунктам
    const typing = document.activeElement instanceof HTMLInputElement && el.contains(document.activeElement);
    if (typing && e.key !== 'Escape' && e.key !== 'Tab') return;
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
