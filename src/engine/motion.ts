/**
 * Движение интерфейса студии и страницы выбора (вариант «Мягко», токены --ui-* в styles/tokens.css).
 * Появление меню, окон и панелей — в CSS: анимация при вставке. Здесь — то, чего CSS не умеет:
 *
 * - уход (leave): закрытое окно или меню убирается из страницы сразу, как и раньше, а гаснет его призрак —
 *   в закрытом теневом дереве: его не видят ни мышь, ни клавиатура, ни читалки экрана, ни поиск элементов, и
 *   щелчок сразу после закрытия попадает в то, что под ним;
 * - полоска под выбранной вкладкой ленты, которая переезжает к новой вкладке (inkTabs);
 * - смена темы интерфейса — растворением старой в новой (themeFade).
 *
 * «Уменьшить движение» в системе обнуляет длительности — всё происходит сразу.
 */

const root = document.documentElement;
const msOf = (name: string): number => {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? (v.endsWith('ms') ? n : n * 1000) : 0;
};

/** Стили страницы для призраков: собираются один раз (и заново, если на странице добавились стили) */
let sheet: CSSStyleSheet | null = null;
let sheetOf = -1;
function ghostStyles(): CSSStyleSheet | null {
  const n = document.styleSheets.length;
  if (sheet && sheetOf === n) return sheet;
  const css: string[] = [];
  for (const s of document.styleSheets) {
    let rules: CSSRuleList;
    try { rules = s.cssRules; } catch { continue; }
    for (const r of rules) if (!(r instanceof CSSImportRule)) css.push(r.cssText);
  }
  try {
    const next = new CSSStyleSheet();
    next.replaceSync(css.join('\n'));
    sheet = next;
    sheetOf = n;
  } catch {
    return null;
  }
  return sheet;
}

/** Собрать стили призраков заранее — в свободное время, чтобы первое закрытие меню не ждало (studio/warm.ts) */
export function warmGhosts(): void { ghostStyles(); }

export interface LeaveOpts {
  /** Окно на затемнении: гаснет затемнение, а само окно (box) ещё и чуть отъезжает */
  box?: string;
  /** Только погаснуть, без сдвига (окно стоит по центру своим transform) */
  fade?: boolean;
  /** Оставить элемент на месте (панель, которую прячут, а не убирают) — гаснет его копия */
  copy?: boolean;
}

/**
 * Убрать элемент со страницы с плавным уходом. Без copy элемент переносится в призрак: дальше его не
 * трогают — он исчезнет сам. С copy гаснет копия, а элемент остаётся (его прячут сами)
 */
export function leave(el: HTMLElement, o: LeaveOpts = {}): void {
  const t = msOf('--ui-out');
  const css = el.isConnected && t > 0 ? ghostStyles() : null;
  if (!css) {
    if (!o.copy) el.remove();
    return;
  }
  const z = getComputedStyle(el).zIndex;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  host.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${/^-?\d+$/.test(z) ? z : 40}`;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.adoptedStyleSheets = [css];
  const ghost = o.copy ? el.cloneNode(true) as HTMLElement : el;
  ghost.classList.add('ui-leave');
  if (o.box || o.fade) ghost.classList.add('ui-dim');
  if (o.box) ghost.querySelector(o.box)?.classList.add('ui-box');
  shadow.append(ghost);
  document.body.append(host);
  setTimeout(() => host.remove(), t + 40);
}

/** Элемент на странице, а не в призраке (уходящее меню больше не считается открытым) */
export const onPage = (el: Element): boolean => el.isConnected && el.getRootNode() === document;

/**
 * Полоска под выбранной вкладкой: одна на ряд вкладок, переезжает к выбранной. Следит за выбором
 * (aria-selected), появлением и исчезновением вкладок (контекстные, настройка ленты) и шириной окна
 */
export function inkTabs(tabs: HTMLElement): void {
  const ink = document.createElement('i');
  ink.className = 'st-ink';
  ink.setAttribute('aria-hidden', 'true');
  tabs.append(ink);
  tabs.classList.add('inked');
  let first = true;
  const place = () => {
    const on = tabs.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]:not([hidden])');
    ink.classList.toggle('off', !on || !on.offsetWidth);
    if (!on || !on.offsetWidth) return;
    // Первая расстановка (и после скрытия) — без переезда
    if (first) ink.style.transition = 'none';
    ink.style.width = `${on.offsetWidth}px`;
    ink.style.transform = `translateX(${on.offsetLeft}px)`;
    if (first) {
      void ink.offsetWidth;
      ink.style.transition = '';
      first = false;
    }
  };
  let queued = 0;
  const later = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; place(); }); };
  new MutationObserver(later).observe(tabs, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'hidden', 'class'] });
  new ResizeObserver(later).observe(tabs);
  void document.fonts?.ready.then(later);
  place();
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

/** Сменить тему интерфейса растворением: старая картинка гаснет над новой за --ui-theme */
export function themeFade(apply: () => void): void {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || !(msOf('--ui-theme') > 0) || document.visibilityState !== 'visible') {
    apply();
    return;
  }
  root.classList.add('ui-vt');
  doc.startViewTransition(apply).finished.finally(() => root.classList.remove('ui-vt'));
}
